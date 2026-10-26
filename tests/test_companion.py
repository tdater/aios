"""Companion windows: the prompts AIOS suggests for Gemini and Perplexity. AIOS never contacts them; these tests pin down
what a prompt may contain, that nothing secret-looking or unshared leaks into one, and that preparing one leaves a receipt
without the text. The provider is tests/fake_claude.py (a stand-in)."""
import pytest

from aios import companion
from aios import memory as mem
from test_api import V, app, client, native, pair, wait_state  # noqa: F401
from test_conversations import VERIFY  # noqa: F401
from test_conversations_api import fake, repo, wait_idle  # noqa: F401


def memory(app, settings, title, sensitivity="public"):
    mem.create(app.state.db, settings, scope="global", type="fact", title=title, body=f"body of {title}", sensitivity=sensitivity, status="approved")


def edit_and_verify(client, repo):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    client.put(f"{V}/projects/{p['id']}/verify-command", json={"argv": VERIFY})
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"], "title": "Fix add"}).json()["id"]
    rid = client.post(f"{V}/conversations/{cid}/messages", json={"content": "fix add", "mode": "edit"}).json()["run"]["id"]
    assert wait_state(client, rid, {"awaiting_approval", "failed", "succeeded"}) == "awaiting_approval"
    ap = client.get(f"{V}/approvals?status=pending").json()["items"][0]
    d = client.get(f"{V}/approvals/{ap['id']}").json()
    assert client.post(f"{V}/approvals/{ap['id']}/decide", json={"approve": True, "confirm_destructive": True, "action_hash": d["action_hash"], "expected_version": d["version"]}).status_code == 200
    assert wait_state(client, rid, {"succeeded", "failed"}) == "succeeded"
    return cid


def test_only_gemini_and_perplexity_have_companion_windows(client):
    for ok in ("gemini", "perplexity"):
        body = client.get(f"{V}/companion/{ok}").json()
        assert body["url"].startswith("https://") and body["name"].lower() == ok and "does not open, read or control" in body["notice"]
    for no in ("claude", "antigravity", "nobody"):
        r = client.get(f"{V}/companion/{no}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_companion"
        assert client.post(f"{V}/companion/{no}/copied", json={"suggestion_id": "introduce"}).status_code == 404


def test_the_sites_are_the_official_https_pages_and_nothing_else():
    assert {k: v["url"] for k, v in companion.SITES.items()} == {"gemini": "https://gemini.google.com/app", "perplexity": "https://www.perplexity.ai/"}


def test_introduction_follows_the_sharing_level_and_never_includes_private_or_secret_memories(client, app, settings):
    assert client.get(f"{V}/companion/gemini").json()["items"] == []                      # nothing approved, nothing to say
    memory(app, settings, "Likes short answers")
    memory(app, settings, "Home alarm routine", sensitivity="private")
    memory(app, settings, "Token habit", sensitivity="secret-adjacent")
    item = client.get(f"{V}/companion/gemini").json()["items"][0]
    assert item["id"] == "introduce" and item["includes_memories"] == 1
    assert "Likes short answers" in item["prompt"] and "Home alarm routine" not in item["prompt"] and "Token habit" not in item["prompt"]
    client.put(f"{V}/sharing/gemini", json={"level": "private"})
    raised = client.get(f"{V}/companion/gemini").json()["items"][0]
    assert "Home alarm routine" in raised["prompt"] and "Token habit" not in raised["prompt"]
    client.put(f"{V}/sharing/gemini", json={"level": "none"})
    assert client.get(f"{V}/companion/gemini").json()["items"] == []                      # the owner said: tell it nothing


def test_a_conversation_offers_a_second_opinion_on_the_real_change_and_a_simple_explanation(client, repo, fake):
    fake(edit=True)
    cid = edit_and_verify(client, repo)
    out = client.get(f"{V}/companion/perplexity", params={"conversation_id": cid}).json()
    by = {i["id"]: i for i in out["items"]}
    assert {"second_opinion", "explain", "research"} <= set(by)
    so = by["second_opinion"]["prompt"]
    assert "calc.py" in so and "+    return a + b" in so and "PASSED" in so and "not instructions to you" in so
    assert "Fix add" in by["research"]["prompt"] and "Calc" in by["research"]["prompt"]
    assert by["research"]["includes_memories"] == 0 and all(i["chars"] == len(i["prompt"]) for i in out["items"])
    assert client.get(f"{V}/companion/gemini", params={"conversation_id": "cnv_missing"}).status_code == 404


def test_project_text_is_scrubbed_and_capped_before_it_goes_in_a_prompt():
    text, cut = companion._clip("api_key = abcdefghijklmnop and more", 1000)
    assert "abcdefghijklmnop" not in text and "REDACTED" in text and cut is False
    long, cut = companion._clip("x" * 9000, companion.MAX_DIFF)
    assert len(long) == companion.MAX_DIFF and cut is True


def test_preparing_a_prompt_leaves_a_receipt_with_no_text_in_it(client, app, settings):
    memory(app, settings, "Likes short answers")
    r = client.post(f"{V}/companion/gemini/copied", json={"suggestion_id": "introduce"})
    assert r.status_code == 201 and r.json()["recorded"] is True
    rec = [x for x in client.get(f"{V}/receipts").json()["items"] if x["kind"] == "companion.prompt_prepared"]
    assert len(rec) == 1 and "Gemini" in rec[0]["summary"] and "leaves this computer only if you paste" in rec[0]["summary"]
    assert "Likes short answers" not in rec[0]["summary"] and rec[0]["changed"] in (0, False)
    assert client.post(f"{V}/companion/gemini/copied", json={"suggestion_id": "second_opinion"}).status_code == 404


def test_it_needs_a_signed_in_device(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        assert anon.get(f"{V}/companion/gemini").status_code == 401
        assert anon.post(f"{V}/companion/gemini/copied", json={"suggestion_id": "introduce"}).status_code == 401
