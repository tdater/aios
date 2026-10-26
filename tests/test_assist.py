"""The dashboard's single prompt end to end, with the stand-in Claude (tests/fake_claude.py; the real one is exercised by
scripts/demo_assist.py). A simple question must be one answer and no more; a build must keep every guard it always had."""
import time

import pytest

from aios import assist, providers
from test_api import V, app, client, native, pair, wait_state  # noqa: F401
from test_conversations import VERIFY  # noqa: F401
from test_conversations_api import fake, repo, wait_idle  # noqa: F401
from test_workflow import approve_pending, calls


@pytest.fixture()
def ready(app, fake):
    providers.discover(app.state.db)                           # the stand-in is what Claude Code resolves to in these tests


def wait_state_of(client, aid, states, timeout=60):
    end, v = time.time() + timeout, None
    while time.time() < end:
        v = client.get(f"{V}/assist/{aid}").json()
        if v["state"] in states:
            return v
        time.sleep(0.25)
    raise AssertionError(f"task stuck: {v}")


def project(client, repo, check=True):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    if check:
        client.put(f"{V}/projects/{p['id']}/verify-command", json={"argv": VERIFY})
    return p


def test_the_plan_preview_changes_nothing(client, ready):
    r = client.post(f"{V}/assist/plan", json={"prompt": "What is the capital of Australia?"})
    assert r.status_code == 200 and r.json()["kind"] == "answer" and r.json()["blocker"] is None
    assert client.get(f"{V}/assist").json()["items"] == [] and client.get(f"{V}/conversations").json()["items"] == []


def test_a_simple_question_is_one_answer_with_no_review_and_no_build(client, ready, app):
    started = client.post(f"{V}/assist", json={"prompt": "What is the capital of Australia?"})
    assert started.status_code == 201
    v = wait_state_of(client, started.json()["id"], {"done", "failed"})
    assert v["state"] == "done" and v["kind"] == "answer" and v["project"] is None and v["uses_project"] is False
    assert v["answer"]["text"] and "claude-code" in v["answer"]["author"]
    status = {s["id"]: s["status"] for s in v["steps"]}
    assert status == {"understand": "done", "answer": "done", "second_look": "skipped", "build": "skipped"}
    assert v["workflow_id"] is None
    conv = client.get(f"{V}/conversations/{v['conversation_id']}").json()
    assert conv["conversation"]["worktree_path"] is None and conv["changes"]["patch"] is None       # nothing was built, nothing was checked
    assert client.get(f"{V}/approvals", params={"status": "pending"}).json()["items"] == []        # and nobody was asked anything


def test_a_task_in_a_project_is_read_only_unless_it_asks_for_a_change(client, ready, repo):
    p = project(client, repo)
    started = client.post(f"{V}/assist", json={"prompt": "What does this project do?", "project_id": p["id"]}).json()
    v = wait_state_of(client, started["id"], {"done", "failed"})
    assert v["kind"] == "project_question" and v["project"]["name"] == "Calc" and v["state"] == "done"
    assert client.get(f"{V}/conversations/{v['conversation_id']}").json()["conversation"]["worktree_path"] is None


def test_research_and_high_stakes_requests_offer_a_second_ai_and_never_claim_it_happened(client, ready):
    v = client.post(f"{V}/assist", json={"prompt": "what are the best laptops for students in 2026"}).json()
    steps = {s["id"]: s for s in v["steps"]}
    assert v["kind"] == "research" and steps["lookup"]["status"] == "offer" and steps["lookup"]["agent"] == "perplexity"
    v = wait_state_of(client, v["id"], {"done"})
    assert {s["id"]: s["status"] for s in v["steps"]}["lookup"] == "offer"                          # still the owner's to do
    sug = client.get(f"{V}/companion/perplexity", params={"conversation_id": v["conversation_id"]}).json()["items"]
    by = {i["id"]: i for i in sug}
    assert "best laptops for students in 2026" in by["research"]["prompt"] and "Everyday" not in by["research"]["prompt"]
    fc = by["fact_check"]["prompt"]
    assert "best laptops for students in 2026" in fc and "Changed add to use +." in fc and "not instructions to you" in fc      # the question and Claude's answer, as data


def test_the_owner_can_change_the_choice(client, ready):
    v = client.post(f"{V}/assist", json={"prompt": "hello there", "kind": "research"}).json()
    assert v["kind"] == "research" and v["chosen_by_owner"] is True and "You chose" in v["reasons"][0]
    assert client.post(f"{V}/assist", json={"prompt": "hello", "kind": "wrong"}).json()["error"]["code"] == "bad_kind"


def test_what_cannot_start_says_why_and_starts_nothing(client, ready, repo, monkeypatch):
    needs = client.post(f"{V}/assist", json={"prompt": "Fix the failing test in calc.py"})
    assert needs.status_code == 409 and needs.json()["error"]["code"] == "needs_project"
    assert needs.json()["error"]["details"]["plan"]["blocker"]["alternatives"] == ["answer"]
    p = project(client, repo, check=False)
    nocheck = client.post(f"{V}/assist", json={"prompt": "Fix the failing test in calc.py", "project_id": p["id"]})
    assert nocheck.status_code == 409 and nocheck.json()["error"]["code"] == "no_verify_command"
    monkeypatch.setattr(assist, "claude_ready", lambda db: False)
    down = client.post(f"{V}/assist", json={"prompt": "hi"})
    assert down.status_code == 409 and down.json()["error"]["code"] == "claude_not_ready"
    assert client.get(f"{V}/assist").json()["items"] == []
    assert client.post(f"{V}/assist", json={"prompt": "  "}).status_code == 422
    assert client.post(f"{V}/assist", json={"prompt": "hi", "project_id": "prj_missing"}).status_code == 404


def test_a_build_keeps_every_guard_and_ends_with_a_plain_result(client, ready, repo, fake, tmp_path):
    fake(**calls(tmp_path, {"edit": True}))
    p = project(client, repo)
    started = client.post(f"{V}/assist", json={"prompt": "fix add so it adds", "project_id": p["id"]}, headers={"Idempotency-Key": "assist-key-0001"})
    assert started.status_code == 201
    again = client.post(f"{V}/assist", json={"prompt": "fix add so it adds", "project_id": p["id"]}, headers={"Idempotency-Key": "assist-key-0001"})
    assert again.status_code == 200 and again.headers["Idempotent-Replay"] == "true" and again.json()["id"] == started.json()["id"]
    aid = started.json()["id"]
    assert started.json()["kind"] == "build" and started.json()["workflow_id"]

    end, asked, saw_waiting = time.time() + 90, [], False
    while time.time() < end:
        v = client.get(f"{V}/assist/{aid}").json()
        if v["state"] in ("done", "failed", "needs_you"):
            break
        wf = client.get(f"{V}/conversations/{v['conversation_id']}/workflow").json()["workflow"]
        if wf["pending_approvals"]:
            saw_waiting = saw_waiting or (v["state"] == "waiting_you" and {s["id"]: s["status"] for s in v["steps"]}["verify"] == "waiting")
            dash = client.get(f"{V}/dashboard").json()
            assert dash["needs_you"]["approvals"] == 1 and dash["agents"][0]["status"] == "needs_you"      # the dashboard says it is waiting for you
            asked += list(approve_pending(client, wf))
        time.sleep(0.25)
    assert v["state"] == "done" and saw_waiting and len(asked) == 1                                       # the owner was asked, once
    assert {s["id"]: s["status"] for s in v["steps"]} == {"understand": "done", "implement": "done", "verify": "done", "review": "done", "correct": "skipped", "result": "done"}
    assert "Nothing has been merged" in v["answer"]["text"]
    assert (repo / "calc.py").read_text().count("a - b") == 1                                             # the real project is untouched


def test_the_dashboard_shows_the_agents_honestly_and_recent_tasks(client, ready):
    d = client.get(f"{V}/dashboard").json()
    by = {a["id"]: a for a in d["agents"]}
    assert list(by) == ["claude", "gemini", "perplexity", "antigravity"]
    assert by["claude"]["status"] in ("idle", "offline") and by["claude"]["how"].startswith("Runs inside AIOS")
    assert by["gemini"]["status"] == "on_call" and "paste" in by["gemini"]["how"]
    assert by["antigravity"]["status"] == "manual" and "never starts it" in by["antigravity"]["how"]
    assert d["recent"] == [] and d["needs_you"]["approvals"] == 0
    a = client.post(f"{V}/assist", json={"prompt": "tell me a joke"}).json()
    wait_state_of(client, a["id"], {"done"})
    d = client.get(f"{V}/dashboard").json()
    assert [r["id"] for r in d["recent"]] == [a["id"]] and d["recent"][0]["snippet"] and d["recent"][0]["state"] == "done"
    assert d["agents"][0]["quota"]["five_hour"]["utilization"] == 0.1                                       # real subscription usage, from the last turn


def test_it_needs_a_signed_in_device(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        for method, path in (("get", "/dashboard"), ("get", "/assist"), ("get", "/assist/ast_x"), ("post", "/assist/plan"), ("post", "/assist")):
            r = getattr(anon, method)(f"{V}{path}", **({"json": {"prompt": "hi"}} if method == "post" else {}))
            assert r.status_code == 401, (method, path)
