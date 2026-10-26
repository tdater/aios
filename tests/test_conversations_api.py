"""The conversation routes over HTTP: the same auth, CSRF and idempotency rules as the rest of the API.
The provider is tests/fake_claude.py (a stand-in); the real one is exercised by scripts/demo_workspace.py."""
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from test_api import V, app, client, native, pair, wait_state  # noqa: F401  (fixtures and helpers)
from test_conversations import FAKE, VERIFY  # noqa: F401

from aios import claude_code

CALC = "def add(a, b):\n    return a - b\n"
TESTS = ("import unittest\nfrom calc import add\n\n\nclass T(unittest.TestCase):\n"
         "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n")


@pytest.fixture()
def repo(tmp_path):
    root = tmp_path / "ws" / "calc"
    root.mkdir(parents=True)
    (root / "calc.py").write_text(CALC)
    (root / "test_calc.py").write_text(TESTS)
    for args in (["init", "-q", "-b", "main"], ["add", "-A"],
                 ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed"]):
        subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)
    return root


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    def configure(**cfg):
        cfg.setdefault("log", str(tmp_path / "calls.jsonl"))
        monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps(cfg))
    configure()
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    return configure


def wait_idle(c, cid, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        body = c.get(f"{V}/conversations/{cid}/messages").json()
        if body["active_run"] is None:
            return body
        time.sleep(0.2)
    raise AssertionError("turn never finished")


def test_full_turn_over_http_with_idempotent_send(client, repo, fake):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    conv = client.post(f"{V}/conversations", json={"project_id": p["id"], "title": "Hello", "model": "sonnet"})
    assert conv.status_code == 201 and conv.json()["model"] == "sonnet"
    cid = conv.json()["id"]

    key = {"Idempotency-Key": "send-key-0001"}
    first = client.post(f"{V}/conversations/{cid}/messages", json={"content": "What is this?", "mode": "read"}, headers=key)
    assert first.status_code == 201
    again = client.post(f"{V}/conversations/{cid}/messages", json={"content": "What is this?", "mode": "read"}, headers=key)
    assert again.status_code == 200 and again.headers["Idempotent-Replay"] == "true"
    assert again.json()["run"]["id"] == first.json()["run"]["id"]                 # one turn, not two
    changed = client.post(f"{V}/conversations/{cid}/messages", json={"content": "Different", "mode": "read"}, headers=key)
    assert changed.status_code == 422                                              # same key, different body

    assert wait_state(client, first.json()["run"]["id"], {"succeeded", "failed"}) == "succeeded"
    idle = wait_idle(client, cid)
    assert [m["author_kind"] for m in idle["items"]] == ["user", "provider"]
    after = client.get(f"{V}/conversations/{cid}/messages", params={"after_seq": 1}).json()
    assert [m["seq"] for m in after["items"]] == [2] and after["last_seq"] == 2    # cheap incremental poll

    view = client.get(f"{V}/conversations/{cid}").json()
    assert view["project"]["name"] == "Calc" and view["status"]["provider"]["name"] == "claude"
    assert view["status"]["permissions"]["shell"] == "denied"
    assert view["status"]["last_turn"]["role"] == "writer" and view["status"]["last_review_turn"] is None
    assert view["status"]["quota"]["five_hour"]["utilization"] == 0.1
    assert view["changes"]["readiness"]["ready"] is False
    listed = client.get(f"{V}/conversations", params={"project_id": p["id"]}).json()["items"]
    assert [c["id"] for c in listed] == [cid] and listed[0]["project_name"] == "Calc"
    assert client.get(f"{V}/conversations", params={"project_id": "prj_nope"}).json()["items"] == []


def test_edit_verify_review_over_http(client, repo, fake):
    fake(edit=True)
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    assert client.put(f"{V}/projects/{p['id']}/verify-command", json={"argv": ["a\x00b"]}).status_code == 422
    assert client.put(f"{V}/projects/{p['id']}/verify-command", json={"argv": []}).status_code == 422
    ok = client.put(f"{V}/projects/{p['id']}/verify-command", json={"argv": VERIFY})
    assert ok.status_code == 200 and client.get(f"{V}/projects/{p['id']}/verify-command").json()["argv"] == VERIFY
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"]}).json()["id"]

    posted = client.post(f"{V}/conversations/{cid}/messages", json={"content": "fix add", "mode": "edit"}).json()
    rid = posted["run"]["id"]
    assert wait_state(client, rid, {"awaiting_approval", "failed", "succeeded"}) == "awaiting_approval"
    assert client.post(f"{V}/conversations/{cid}/messages", json={"content": "more", "mode": "read"}).json()["error"]["code"] == "turn_in_progress"
    pending = client.get(f"{V}/approvals?status=pending").json()["items"]
    assert len(pending) == 1 and pending[0]["action"]["type"] == "run_verification"
    detail = client.get(f"{V}/approvals/{pending[0]['id']}").json()
    assert detail["destructive"] is True and "not a sandbox" in " ".join(detail["review"]["side_effects"])
    refused = client.post(f"{V}/approvals/{pending[0]['id']}/decide", json={"approve": True})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "confirmation_required"
    ok = client.post(f"{V}/approvals/{pending[0]['id']}/decide",
                     json={"approve": True, "confirm_destructive": True, "action_hash": detail["action_hash"],
                           "expected_version": detail["version"]})
    assert ok.status_code == 200
    assert wait_state(client, rid, {"succeeded", "failed"}) == "succeeded"
    changes = client.get(f"{V}/conversations/{cid}/changes").json()
    assert changes["verification"]["meta"]["passed"] is True and changes["readiness"]["ready"] is True
    art = client.get(f"{V}/artifacts/{changes['patch']['meta']['artifact_id']}").json()
    assert "+    return a + b" in art["content"]

    r = client.post(f"{V}/conversations/{cid}/review", json={"model": "opus"}, headers={"Idempotency-Key": "review-key-0001"})
    assert r.status_code == 201
    assert client.post(f"{V}/conversations/{cid}/review", json={"model": "opus"}, headers={"Idempotency-Key": "review-key-0001"}).headers["Idempotent-Replay"] == "true"
    assert wait_state(client, r.json()["run"]["id"], {"succeeded", "failed"}) == "succeeded"
    view = client.get(f"{V}/conversations/{cid}").json()
    assert view["status"]["last_review_turn"]["role"] == "reviewer" and view["status"]["last_turn"]["role"] == "writer"
    assert view["status"]["last_review_turn"]["run_id"] != view["status"]["last_turn"]["run_id"]
    assert view["changes"]["review"]["meta"]["review"]["separate_session"] is True
    assert (repo / "calc.py").read_text() == CALC                                   # project folder never touched


def test_errors_and_auth(client, native, repo, fake, app):
    assert client.get(f"{V}/conversations/cnv_missing").status_code == 404
    assert client.get(f"{V}/conversations/cnv_missing/messages").status_code == 404
    assert client.get(f"{V}/conversations/cnv_missing/changes").status_code == 404
    assert client.post(f"{V}/conversations", json={"project_id": "prj_missing"}).status_code == 404
    assert client.put(f"{V}/projects/prj_missing/verify-command", json={"argv": VERIFY}).status_code == 404
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    assert client.post(f"{V}/conversations", json={"project_id": p["id"], "model": "x; rm -rf"}).json()["error"]["code"] == "bad_model"
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"]}).json()["id"]
    assert client.post(f"{V}/conversations/{cid}/review", json={}).json()["error"]["code"] == "nothing_to_review"
    assert client.post(f"{V}/conversations/{cid}/messages", json={"content": "x", "mode": "yolo"}).json()["error"]["code"] == "bad_mode"
    assert client.post(f"{V}/conversations/{cid}/messages", json={"content": "", "mode": "read"}).status_code == 422
    nocsrf = client.post(f"{V}/conversations/{cid}/messages", json={"content": "x", "mode": "read"}, headers={"X-CSRF-Token": "wrong"})
    assert nocsrf.status_code in (401, 403)                                         # cookie sessions need the CSRF token
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        for method, path in (("get", f"{V}/conversations"), ("get", f"{V}/conversations/{cid}"),
                             ("post", f"{V}/conversations"), ("put", f"{V}/projects/{p['id']}/verify-command")):
            assert getattr(anon, method)(path).status_code == 401, (method, path)
    assert native.get(f"{V}/conversations/{cid}").status_code == 200                # bearer tokens work too


def test_a_remember_request_and_a_passed_check_become_memory_candidates(client, repo, fake):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"], "title": "Cap"}).json()["id"]
    r = client.post(f"{V}/conversations/{cid}/messages", headers={"Idempotency-Key": "cap-key-0001"},
                    json={"content": "Remember that we always run tests with unittest here.", "mode": "read"})
    assert r.status_code in (200, 201, 202)
    wait_idle(client, cid)
    cands = client.get(f"{V}/memories", params={"status": "candidate"}).json()
    items = cands["items"] if isinstance(cands, dict) else cands
    assert any("unittest" in i["title"] for i in items) and all(i["status"] == "candidate" for i in items)


def test_other_ais_are_by_copy_and_paste_and_replies_stay_unverified(client, repo, fake):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"], "title": "Multi"}).json()["id"]
    pub = client.post(f"{V}/memories", json={"scope": "global", "type": "fact", "title": "Team uses pytest", "body": "pytest everywhere", "sensitivity": "public", "status": "approved"})
    prep = client.post(f"{V}/conversations/{cid}/handoff", json={"provider": "gemini", "question": "How should I name tests?"})
    assert prep.status_code == 201
    out = prep.json()
    assert "How should I name tests?" in out["prompt"] and out["prompt"].count("<aios_briefing>") == (1 if out["briefing_items"] else 0)
    assert client.post(f"{V}/conversations/{cid}/handoff", json={"provider": "claude", "question": "x"}).status_code == 422
    assert client.post(f"{V}/conversations/{cid}/handoff", json={"provider": "gemini", "question": "  "}).status_code in (400, 422)
    rep = client.post(f"{V}/conversations/{cid}/handoff/reply", json={"provider": "gemini", "reply": "Use test_<thing>_<case>."})
    assert rep.status_code == 201
    msgs = client.get(f"{V}/conversations/{cid}/messages").json()["items"]
    reply = [m for m in msgs if (m.get("meta") or {}).get("handoff", {}).get("step") == "reply"][0]
    assert reply["author_kind"] == "provider" and "did not run or verify" in reply["author"] and reply["meta"]["handoff"]["unverified"] is True
    cands = client.get(f"{V}/memories", params={"status": "candidate"}).json()
    items = cands["items"] if isinstance(cands, dict) else cands
    assert not any("test_<thing>" in i["title"] for i in items)       # pasted replies are never mined for memories
