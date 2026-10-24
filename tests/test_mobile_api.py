"""Server-side contract for the mobile companion: auth, CSRF, versioning, pagination, idempotency,
approvals, two-phase cancel, reconnectable events. Run against the real app (TestClient + real SQLite)."""
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aios import auth, services
from aios.main import create_app
from test_api import V, client, native, app, pair, wait_state  # noqa: F401  (fixtures)


def note(c, text="idea", key=None, **extra):
    h = {"Idempotency-Key": key} if key else {}
    return c.post(f"{V}/tasks", json={"title": text, "kind": "capture.note", "spec": {"text": text}, **extra}, headers=h)


# ------------------------------------------------------------------ meta / errors / compatibility
def test_meta_is_public_and_advertises_capabilities(app):
    with TestClient(app) as c:
        m = c.get(f"{V}/meta").json()
        assert m["api_version"] == 1 and m["capabilities"]["cancel_two_phase"] is True
        assert m["capabilities"]["push_notifications"] is False and m["capabilities"]["sse_stream"] is False
        assert "secret" not in json.dumps(m).lower()
        assert m["server_id"].startswith("srv_") and c.get(f"{V}/meta").json()["server_id"] == m["server_id"]


def test_unauthenticated_access_is_refused_with_structured_error(app):
    with TestClient(app) as c:
        for path in ("/health", "/projects", "/runs", "/approvals", "/home", "/memories", "/candidates",
                     "/history/sources", "/auth/me"):
            r = c.get(V + path)
            assert r.status_code == 401, path
            e = r.json()
            assert e["error"]["code"] == "unauthenticated" and e["request_id"]
            assert r.headers["x-request-id"] == e["request_id"]
        assert c.post(f"{V}/tasks", json={"title": "x", "kind": "capture.note"}).status_code == 401
        assert c.get(f"{V}/artifacts/art_x").status_code == 401


def test_client_too_old_is_rejected_with_426(client):
    r = client.get(f"{V}/home", headers={"X-AIOS-Client": "web/0.0.1 api=0"})
    assert r.status_code == 426 and r.json()["error"]["code"] == "client_too_old"
    assert client.get(f"{V}/home", headers={"X-AIOS-Client": "web/1 api=1"}).status_code == 200


def test_validation_errors_are_structured(client):
    r = client.post(f"{V}/tasks", json={"kind": "capture.note"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"]["errors"]


# ------------------------------------------------------------------ pairing and sessions
def test_pairing_code_is_single_use_and_rate_limited(app):
    with TestClient(app) as c:
        code = auth.new_pairing_code(app.state.db)["code"]
        ok = c.post(f"{V}/auth/pair", json={"code": code, "device_name": "a", "kind": "native"})
        assert ok.status_code == 200 and ok.json()["token"]
        again = c.post(f"{V}/auth/pair", json={"code": code, "device_name": "b", "kind": "native"})
        assert again.status_code == 401 and again.json()["error"]["code"] == "invalid_pairing_code"
        for _ in range(4):
            assert c.post(f"{V}/auth/pair", json={"code": "WRONG-CODE", "device_name": "x", "kind": "native"}
                          ).status_code == 401
        fresh = auth.new_pairing_code(app.state.db)["code"]    # even a valid code is refused while locked
        r = c.post(f"{V}/auth/pair", json={"code": fresh, "device_name": "x", "kind": "native"})
        assert r.status_code == 429 and r.headers["retry-after"] == "900"


def test_expired_pairing_code_rejected(app):
    with TestClient(app) as c:
        code = auth.new_pairing_code(app.state.db)["code"]
        app.state.db.execute("UPDATE pairing_codes SET expires_at='2000-01-01T00:00:00.000+00:00'")
        assert c.post(f"{V}/auth/pair", json={"code": code, "device_name": "x", "kind": "native"}).status_code == 401


def test_browser_session_uses_httponly_strict_cookie_and_never_returns_token(app):
    with TestClient(app) as c:
        code = auth.new_pairing_code(app.state.db)["code"]
        r = c.post(f"{V}/auth/pair", json={"code": code, "device_name": "b", "kind": "browser"})
        assert "token" not in r.json() and r.json()["csrf"]
        cookies = {h.split("=", 1)[0]: h for h in r.headers.get_list("set-cookie")}
        assert "HttpOnly" in cookies["aios_session"] and "SameSite=strict" in cookies["aios_session"]
        assert "HttpOnly" not in cookies["aios_csrf"]


def test_tokens_are_stored_hashed_only(app, native):
    tok = native.headers["Authorization"].split()[1]
    assert tok not in json.dumps(app.state.db.query("SELECT * FROM auth_sessions"))


def test_csrf_is_required_for_cookie_sessions_but_not_bearer(app, client, native):
    c2 = TestClient(app)
    c2.cookies.update(client.cookies)                       # same session, but no CSRF header
    r = c2.post(f"{V}/tasks", json={"title": "x", "kind": "capture.note"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    r = client.post(f"{V}/tasks", json={"title": "x", "kind": "capture.note"}, headers={"X-CSRF-Token": "wrong"})
    assert r.status_code == 403
    r = client.post(f"{V}/tasks", json={"title": "x", "kind": "capture.note"},
                    headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "origin_mismatch"
    assert native.post(f"{V}/tasks", json={"title": "x", "kind": "capture.note"}).status_code == 201
    assert client.get(f"{V}/home").status_code == 200       # safe methods need no CSRF


def test_session_expiry_idle_revoke_and_logout(app, client, native):
    me = native.get(f"{V}/auth/me").json()
    sessions = client.get(f"{V}/auth/sessions").json()["items"]
    assert {s["device_name"] for s in sessions} >= {"pytest", "phone"} and any(s["current"] for s in sessions)
    # absolute expiry
    app.state.db.execute("UPDATE auth_sessions SET expires_at='2000-01-01T00:00:00.000+00:00' WHERE id=?", (me["session_id"],))
    r = native.get(f"{V}/home")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"
    # revocation of another device by the desktop browser
    tok = pair(app, TestClient(app), kind="native", name="lost-phone")
    c3 = TestClient(app)
    c3.headers["Authorization"] = f"Bearer {tok['token']}"
    assert c3.get(f"{V}/home").status_code == 200
    assert client.post(f"{V}/auth/sessions/{tok['session_id']}/revoke").status_code == 200
    assert c3.get(f"{V}/home").status_code == 401
    # idle expiry
    t2 = pair(app, TestClient(app), kind="native", name="idle")
    app.state.db.execute("UPDATE auth_sessions SET last_seen_at='2000-01-01T00:00:00.000+00:00' WHERE id=?", (t2["session_id"],))
    c4 = TestClient(app)
    c4.headers["Authorization"] = f"Bearer {t2['token']}"
    assert c4.get(f"{V}/home").status_code == 401
    # logout kills the session server-side (not just the cookie)
    assert client.post(f"{V}/auth/logout").status_code == 200
    stolen = TestClient(app)
    stolen.cookies.set("aios_session", "x")
    assert client.get(f"{V}/home").status_code == 401


# ------------------------------------------------------------------ pagination
def test_cursor_pagination_is_complete_and_stable(client):
    ids = [note(client, f"n{i}").json()["task"]["id"] for i in range(7)]
    seen, cursor, pages = [], None, 0
    while True:
        r = client.get(f"{V}/tasks", params={"limit": 3, **({"cursor": cursor} if cursor else {})}).json()
        seen += [t["id"] for t in r["items"]]
        pages += 1
        cursor = r["next_cursor"]
        if not cursor:
            break
    assert pages == 3 and len(seen) == 7 == len(set(seen)) and set(seen) == set(ids)
    assert client.get(f"{V}/tasks", params={"cursor": "garbage!!"}).json()["error"]["code"] == "bad_cursor"
    assert client.get(f"{V}/tasks", params={"limit": 0}).status_code == 422
    found = client.get(f"{V}/tasks", params={"q": "n3"}).json()["items"]
    assert [t["title"] for t in found] == ["n3"]


# ------------------------------------------------------------------ idempotency
def test_retry_with_same_key_never_duplicates_work(client, app):
    k = "capture-0001-abcdef"
    a = note(client, "buy milk", key=k)
    b = note(client, "buy milk", key=k)        # the phone retried after a dropped response
    assert a.status_code == 201 and b.status_code == 200 and b.headers["idempotent-replay"] == "true"
    assert a.json()["task"]["id"] == b.json()["task"]["id"]
    assert app.state.db.one("SELECT COUNT(*) n FROM tasks")["n"] == 1
    c = note(client, "different text", key=k)
    assert c.status_code == 422 and c.json()["error"]["code"] == "idempotency_key_reuse"
    assert note(client, "x", key="short").json()["error"]["code"] == "bad_idempotency_key"


def test_submit_and_start_run_is_one_idempotent_unit(client, app):
    k = "submit-run-000001"
    a = note(client, "do it", key=k, start_run=True).json()
    b = note(client, "do it", key=k, start_run=True).json()
    assert a["run"]["id"] == b["run"]["id"]
    assert app.state.db.one("SELECT COUNT(*) n FROM runs")["n"] == 1


def test_concurrent_double_tap_creates_exactly_one_task(client, app):
    k = "double-tap-000001"
    with ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(lambda _: note(client, "tap", key=k), range(8)))
    assert {r.status_code for r in rs} <= {200, 201, 409}
    assert [r for r in rs if r.status_code == 201].__len__() == 1
    assert note(client, "tap", key=k).status_code == 200          # retry after the dust settles replays
    assert app.state.db.one("SELECT COUNT(*) n FROM tasks")["n"] == 1


# ------------------------------------------------------------------ record versions
def test_version_conflict_on_stale_write(client):
    t = note(client, "v", start_run=True).json()
    rid = t["run"]["id"]
    wait_state(client, rid, {"succeeded"})
    run = client.get(f"{V}/runs/{rid}").json()["run"]
    assert run["version"] >= 2
    r = client.post(f"{V}/runs/{rid}/cancel", json={"expected_version": 1})
    assert r.status_code == 409 and r.json()["error"]["code"] == "version_conflict"
    assert r.json()["error"]["details"]["current_version"] == run["version"]


# ------------------------------------------------------------------ approvals
def guarded(client, content="hello", filename="g.txt"):
    t = client.post(f"{V}/tasks", json={"title": "g", "kind": "demo.guarded_write", "start_run": True,
                                        "spec": {"filename": filename, "content": content}}).json()
    wait_state(client, t["run"]["id"], {"awaiting_approval"})
    a = client.get(f"{V}/approvals", params={"status": "pending"}).json()["items"][0]
    return t, client.get(f"{V}/approvals/{a['id']}").json()


def decide(c, a, **kw):
    return c.post(f"{V}/approvals/{a['id']}/decide", json={"approve": True, **kw})


def test_approval_shows_everything_needed_to_decide(client):
    t, a = guarded(client, "secret-ish body")
    assert a["review"]["target"].endswith("g.txt") and "Creates" in a["review"]["side_effects"][0]
    assert a["review"]["content_preview"] == "secret-ish body" and a["destructive"] is False
    assert a["action_hash"] and a["version"] >= 1 and a["expires_in_s"] > 0 and a["age_s"] >= 0
    assert a["context"]["run"]["task_title"] == "g"


def test_approval_binds_to_action_hash_and_version(client):
    t, a = guarded(client)
    assert decide(client, a, action_hash="0" * 64).json()["error"]["code"] == "action_changed"
    assert decide(client, a, expected_version=a["version"] + 5).json()["error"]["code"] == "version_conflict"
    ok = decide(client, a, action_hash=a["action_hash"], expected_version=a["version"])
    assert ok.status_code == 200 and ok.json()["status"] == "approved"


def test_replayed_and_resolved_approvals_are_rejected(client):
    t, a = guarded(client)
    assert decide(client, a).status_code == 200
    assert decide(client, a).json()["error"]["code"] == "approval_resolved"
    assert client.post(f"{V}/approvals/{a['id']}/decide", json={"approve": False}).json()["error"]["code"] == "approval_resolved"


def test_expired_approval_cannot_be_decided_or_used(client, app):
    t, a = guarded(client)
    app.state.db.execute("UPDATE approvals SET expires_at='2000-01-01T00:00:00.000+00:00' WHERE id=?", (a["id"],))
    r = decide(client, a)
    assert r.status_code == 409 and r.json()["error"]["code"] == "approval_expired"
    assert client.get(f"{V}/approvals/{a['id']}").json()["status"] == "expired"


def test_approved_but_expired_before_use_is_not_honoured(client, app, settings):
    t, a = guarded(client)
    assert decide(client, a).status_code == 200
    app.state.db.execute("UPDATE approvals SET expires_at='2000-01-01T00:00:00.000+00:00' WHERE id=?", (a["id"],))
    app.state.db.execute("UPDATE runs SET state='queued' WHERE id=?", (t["run"]["id"],))
    wait_state(client, t["run"]["id"], {"awaiting_approval"})            # needs a NEW approval
    assert not (settings.artifacts_dir / "guarded" / "g.txt").exists()
    assert len(client.get(f"{V}/approvals", params={"status": "pending"}).json()["items"]) == 1


def test_changed_action_supersedes_the_old_request(client, app):
    t, a = guarded(client, "v1")
    app.state.db.execute("UPDATE tasks SET spec_json=? WHERE id=?",
                         (json.dumps({"filename": "g.txt", "content": "v2"}), t["task"]["id"]))
    app.state.db.execute("UPDATE runs SET state='queued' WHERE id=?", (t["run"]["id"],))
    time.sleep(1.5)
    old = client.get(f"{V}/approvals/{a['id']}").json()
    assert old["status"] == "superseded"
    r = decide(client, a)
    assert r.status_code == 409 and r.json()["error"]["code"] == "approval_superseded"


def test_destructive_actions_need_deliberate_confirmation(client, settings):
    target = settings.artifacts_dir / "guarded" / "exists.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("old")
    t, a = guarded(client, "new", filename="exists.txt")
    assert a["destructive"] is True and "Overwrites" in a["review"]["side_effects"][0]
    r = decide(client, a)
    assert r.status_code == 409 and r.json()["error"]["code"] == "confirmation_required"
    assert target.read_text() == "old"
    assert decide(client, a, confirm_destructive=True).status_code == 200


def test_concurrent_decisions_resolve_exactly_once(client):
    t, a = guarded(client)
    with ThreadPoolExecutor(6) as ex:
        rs = list(ex.map(lambda i: client.post(f"{V}/approvals/{a['id']}/decide",
                                               json={"approve": i % 2 == 0}), range(6)))
    codes = sorted(r.status_code for r in rs)
    assert codes == [200] + [409] * 5


def test_cancelling_a_run_supersedes_its_pending_approval(client):
    t, a = guarded(client)
    r = client.post(f"{V}/runs/{t['run']['id']}/cancel", json={}).json()
    assert r["result"] == "confirmed"
    assert decide(client, a).json()["error"]["code"] == "approval_superseded"


def test_historical_approval_does_not_authorise_a_new_run(client, settings):
    t1, a1 = guarded(client, "same", filename="h.txt")
    decide(client, a1)
    wait_state(client, t1["run"]["id"], {"succeeded"})
    t2 = client.post(f"{V}/tasks", json={"title": "again", "kind": "demo.guarded_write", "start_run": True,
                                         "spec": {"filename": "h2.txt", "content": "same"}}).json()
    assert wait_state(client, t2["run"]["id"], {"awaiting_approval"}) == "awaiting_approval"
    assert not (settings.artifacts_dir / "guarded" / "h2.txt").exists()


# ------------------------------------------------------------------ cancellation, two-phase
def test_cancel_running_run_is_requested_then_confirmed_at_step_boundary(client):
    t = client.post(f"{V}/tasks", json={"title": "slow", "kind": "demo.slow_steps", "start_run": True,
                                        "spec": {"steps": 10, "pause": 0.4}}).json()
    rid = t["run"]["id"]
    wait_state(client, rid, {"running"})
    time.sleep(0.5)
    r = client.post(f"{V}/runs/{rid}/cancel", json={}).json()
    assert r["result"] == "requested"
    c = r["run"]["cancellation"]
    assert c["status"] == "requested" and c["confirmed_at"] is None and "does not reverse" in c["note"]
    assert r["run"]["state"] == "running"                           # NOT cancelled yet
    assert wait_state(client, rid, {"cancelled"}) == "cancelled"
    d = client.get(f"{V}/runs/{rid}").json()
    assert d["run"]["cancellation"]["status"] == "confirmed" and d["run"]["cancellation"]["confirmed_at"]
    assert len([s for s in d["steps"] if s["state"] == "done"]) < 10   # stopped early, finished steps remain
    assert client.post(f"{V}/runs/{rid}/cancel", json={}).json()["error"]["code"] == "invalid_state"


def test_cancel_of_a_waiting_run_is_confirmed_immediately(client):
    t = client.post(f"{V}/tasks", json={"title": "q", "kind": "demo.quota", "start_run": True}).json()
    wait_state(client, t["run"]["id"], {"blocked"})
    r = client.post(f"{V}/runs/{t['run']['id']}/cancel", json={}).json()
    assert r["result"] == "confirmed" and r["run"]["cancellation"]["status"] == "confirmed"


def test_cancellation_view_reports_too_late(app):
    run = {"id": "r", "state": "succeeded", "cancel_requested_at": "t", "cancel_confirmed_at": None}
    assert services.cancellation_view(app.state.db, run)["status"] == "too_late"


# ------------------------------------------------------------------ execution honesty
def test_display_states_distinguish_quota_provider_and_manual_session(client, app):
    q = client.post(f"{V}/tasks", json={"title": "q", "kind": "demo.quota", "start_run": True}).json()
    wait_state(client, q["run"]["id"], {"blocked"})
    r = client.get(f"{V}/runs/{q['run']['id']}").json()["run"]
    assert (r["display_state"], r["block_code"]) == ("blocked_quota", "quota_exhausted")
    assert "will not switch to paid" in r["state_reason"]
    app.state.db.execute("UPDATE provider_caps SET mode='unavailable' WHERE provider='gemini'")
    g = client.post(f"{V}/tasks", json={"title": "g", "kind": "provider.task", "start_run": True,
                                        "spec": {"provider": "gemini", "prompt": "x"}}).json()
    wait_state(client, g["run"]["id"], {"blocked"})
    r = client.get(f"{V}/runs/{g['run']['id']}").json()["run"]
    assert (r["display_state"], r["block_code"]) == ("blocked", "provider_unavailable")
    app.state.db.execute("UPDATE provider_caps SET mode='interactive' WHERE provider='claude'")
    c = client.post(f"{V}/tasks", json={"title": "c", "kind": "provider.task", "start_run": True,
                                        "spec": {"provider": "claude", "prompt": "x"}}).json()
    wait_state(client, c["run"]["id"], {"blocked"})
    assert client.get(f"{V}/runs/{c['run']['id']}").json()["run"]["display_state"] == "awaiting_provider_session"


# ------------------------------------------------------------------ reconnectable monitoring
def test_events_after_cursor_and_snapshot_resync(client):
    t = client.post(f"{V}/tasks", json={"title": "e", "kind": "demo.slow_steps", "start_run": True,
                                        "spec": {"steps": 3, "pause": 0.1}}).json()
    rid = t["run"]["id"]
    wait_state(client, rid, {"succeeded"})
    full = client.get(f"{V}/runs/{rid}/events").json()
    ids = [e["id"] for e in full["items"]]
    assert ids == sorted(ids) and full["terminal"] and full["run_state"] == "succeeded"
    mid = ids[len(ids) // 2]
    tail = client.get(f"{V}/runs/{rid}/events", params={"after": mid}).json()["items"]
    assert [e["id"] for e in tail] == [i for i in ids if i > mid]          # reconnect: no gaps, no repeats
    assert client.get(f"{V}/runs/{rid}/events", params={"after": full["last_event_id"]}).json()["items"] == []
    gone = client.get(f"{V}/runs/{rid}/events", params={"after": full["last_event_id"] + 999})
    assert gone.status_code == 409 and gone.json()["error"]["code"] == "resync_required"
    snap = client.get(f"{V}/runs/{rid}").json()
    assert snap["last_event_id"] == full["last_event_id"] and snap["run"]["version"] == full["run_version"]


# ------------------------------------------------------------------ untrusted content, home, contract
def test_untrusted_artifact_content_is_returned_as_inert_json_text(client):
    t = note(client, "<script>alert(1)</script> sk-ant-abcdefghijklmnopqr", start_run=True).json()
    wait_state(client, t["run"]["id"], {"succeeded"})
    d = client.get(f"{V}/runs/{t['run']['id']}").json()
    r = client.get(f"{V}/artifacts/{d['artifacts'][0]['id']}")
    assert r.headers["content-type"].startswith("application/json") and r.headers["x-content-type-options"] == "nosniff"
    assert "<script>" in r.json()["content"] and "sk-ant" not in r.json()["content"]


def test_home_summarises_real_state(client):
    q = client.post(f"{V}/tasks", json={"title": "q", "kind": "demo.quota", "start_run": True}).json()
    wait_state(client, q["run"]["id"], {"blocked"})
    h = client.get(f"{V}/home").json()
    assert h["counts"]["blocked_runs"] == 1 and h["blocked_runs"][0]["display_state"] == "blocked_quota"
    assert {p["provider"] for p in h["providers"]} >= {"claude", "gemini", "perplexity", "mock"}
    assert h["server_time"].endswith("+00:00")


def test_openapi_contract_matches_committed_snapshot(app):
    with TestClient(app) as c:
        spec = c.get(f"{V}/openapi.json").json()
    paths = {(p, m) for p, ops in spec["paths"].items() for m in ops}
    assert all(p.startswith("/api/v1/") for p, _ in paths)
    snap = Path(__file__).resolve().parents[1] / "docs" / "openapi-v1.json"
    if not snap.exists():
        pytest.fail("docs/openapi-v1.json missing: run scripts/export_openapi.py")
    old = json.loads(snap.read_text(encoding="utf-8"))
    old_paths = {(p, m) for p, ops in old["paths"].items() for m in ops}
    assert paths == old_paths, f"API surface changed; regenerate snapshot. Added={paths - old_paths} Removed={old_paths - paths}"
