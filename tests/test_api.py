import time

import pytest
from fastapi.testclient import TestClient

from aios import auth
from aios.main import create_app

V = "/api/v1"


@pytest.fixture()
def app(settings):
    return create_app(settings)


def pair(app, client, kind="browser", name="pytest"):
    code = auth.new_pairing_code(app.state.db)["code"]
    r = client.post(f"{V}/auth/pair", json={"code": code, "device_name": name, "kind": kind})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def client(app):
    """Browser-style client: HttpOnly cookie session + CSRF header."""
    with TestClient(app) as c:
        c.headers["X-CSRF-Token"] = pair(app, c)["csrf"]
        yield c


@pytest.fixture()
def native(app, client):
    """Separate cookie-less client using a Bearer token (what the Android app does)."""
    token = pair(app, TestClient(app), kind="native", name="phone")["token"]
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {token}"
        yield c


def wait_state(c, run_id, states, timeout=15):
    end = time.time() + timeout
    st = None
    while time.time() < end:
        st = c.get(f"{V}/runs/{run_id}").json()["run"]["state"]
        if st in states:
            return st
        time.sleep(0.15)
    raise AssertionError(f"run stuck in {st}")


def test_end_to_end_audit_over_http(client, sample_ws):
    p = client.post(f"{V}/projects", json={"name": "Sample", "path": str(sample_ws)}).json()
    t = client.post(f"{V}/tasks", json={"title": "audit", "kind": "audit.workspace", "project_id": p["id"],
                                        "acceptance": [{"type": "artifact_kind", "kind": "audit_report"}],
                                        "start_run": True}).json()
    rid = t["run"]["id"]
    assert wait_state(client, rid, {"succeeded", "failed"}) == "succeeded"
    d = client.get(f"{V}/runs/{rid}").json()
    assert d["run"]["display_state"] == "completed"
    art = client.get(f"{V}/artifacts/{d['artifacts'][0]['id']}").json()
    assert art["sha256"] and "abcdefghijklmnop1234" not in art["content"]
    h = client.get(f"{V}/health").json()
    assert h["db"] == "ok" and h["run_counts"]["succeeded"] == 1 and h["backup_status"] == "never run"


def test_api_rejects_foreign_host_and_bad_paths(client, tmp_path):
    r = client.get(f"{V}/health", headers={"host": "evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "bad_host"
    r = client.post(f"{V}/projects", json={"name": "x", "path": "C:\\"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "path_not_allowed"
    r = client.post(f"{V}/projects", content="a=b", headers={"content-type": "application/x-www-form-urlencoded"})
    assert r.status_code == 415


def test_approval_flow_over_http(client):
    t = client.post(f"{V}/tasks", json={"title": "g", "kind": "demo.guarded_write", "start_run": True,
                                        "spec": {"filename": "a.txt", "content": "z"}}).json()
    rid = t["run"]["id"]
    assert wait_state(client, rid, {"awaiting_approval"}) == "awaiting_approval"
    pend = client.get(f"{V}/approvals?status=pending").json()["items"]
    assert len(pend) == 1 and pend[0]["action"]["content"] == "z"
    ok = client.post(f"{V}/approvals/{pend[0]['id']}/decide", json={"approve": True})
    assert ok.status_code == 200 and ok.json()["status"] in ("approved", "consumed")      # the run can use the approval before this response is written
    assert wait_state(client, rid, {"succeeded", "failed"}) == "succeeded"
    again = client.post(f"{V}/approvals/{pend[0]['id']}/decide", json={"approve": True})
    assert again.status_code == 409


def test_unknown_task_kind_rejected(client):
    r = client.post(f"{V}/tasks", json={"title": "x", "kind": "rm.rf"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_task_kind"


def test_a_pairing_code_comes_with_phone_links_only_for_allowed_https_names(settings):
    from dataclasses import replace
    s = replace(settings, allowed_hosts=("yoga2in1.tail8c1f7a.ts.net", "127.0.0.1", "localhost", "192.168.1.5"))
    app2 = create_app(s)
    with TestClient(app2) as c:
        c.headers["X-CSRF-Token"] = pair(app2, c)["csrf"]
        r = c.post(f"{V}/auth/pairing-codes")
        assert r.status_code == 201
        body = r.json()
        assert body["links"] == [f"https://yoga2in1.tail8c1f7a.ts.net/#pair={body['code']}"]          # no IP addresses, no plain http, no bare names
    plain = create_app(settings)
    with TestClient(plain) as c3:
        c3.headers["X-CSRF-Token"] = pair(plain, c3)["csrf"]
        assert c3.post(f"{V}/auth/pairing-codes").json()["links"] == []                                  # nothing allowed, nothing offered
