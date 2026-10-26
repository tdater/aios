"""Independent review: a fresh read-only Claude session sees only the request, the diff and the recorded
verification of a pinned revision. AIOS grounds the findings and decides readiness itself.

The provider is tests/fake_claude.py. The real reviewer is exercised by scripts/demo_workspace.py."""
import json
from pathlib import Path

import pytest

from aios import conversations, reviewer, services
from aios.errors import ApiError
from aios.executors.claude_review import default_reviewer_model
from test_conversations import VERIFY, fake, proj, repo, start_turn  # noqa: F401  (fixtures and helpers)


def verified_change(db, engine, proj, fake):
    fake(edit=True)
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "fix the add bug", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    engine.decide_approval(db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"], True,
                           confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    return conv


def review(db, engine, conv, **kw):
    r = conversations.request_review(db, engine, conv["id"], **kw)
    return r, engine.execute(r["run"]["id"])


def review_calls(log):
    return [json.loads(x) for x in Path(log).read_text().splitlines() if '"--json-schema"' in x]


def test_review_is_independent_pinned_and_cleaned_up(db, settings, engine, proj, fake):
    conv = verified_change(db, engine, proj, fake)
    before = conversations.get(db, conv["id"])
    log = fake(review={"summary": "Looks correct.", "findings": []})
    r, state = review(db, engine, conv)
    assert state == "succeeded"
    call = review_calls(log)[-1]
    argv = call["argv"]
    assert "--resume" not in argv                                                  # a fresh session
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep"                     # read-only
    assert argv[argv.index("--model") + 1] == "sonnet"                             # writer on the default model
    assert "independent code reviewer" in argv[argv.index("--append-system-prompt") + 1]
    checkout = Path(call["cwd"])
    assert checkout.name.startswith(f"{conv['id']}-rev-") and not checkout.exists()  # pinned checkout removed
    assert not any("-rev-" in line for line in
                   __import__("subprocess").run(["git", "-C", str(proj["path"]), "worktree", "list"],
                                                capture_output=True, text=True).stdout.splitlines())
    run = services.run_detail(db, r["run"]["id"])
    text = services.read_artifact(db, settings, next(a for a in run["artifacts"] if a["kind"] == "review_input")["id"]
                                  )["content"]
    assert "fix the add bug" in text and "+    return a + b" in text and before["head_revision"] in text
    assert "PASSED" in text                                                         # the recorded verification
    assert "Changed add to use +." not in text and "working; saw" not in text      # never the writer's words
    after = conversations.get(db, conv["id"])
    assert after["session_id"] == before["session_id"]                              # writer session untouched
    ch = conversations.changes(db, conv["id"])
    meta = ch["review"]["meta"]["review"]
    assert ch["review"]["author_kind"] == "provider" and "independent reviewer" in ch["review"]["author"]
    assert meta["separate_session"] is True and meta["reviewed_revision"] == before["head_revision"]
    assert meta["session_id"] != before["session_id"] and meta["patch_sha256"]
    assert ch["readiness"]["ready"] is True and ch["readiness"]["reviewed"] is True
    ready = [m for m in conversations.messages(db, conv["id"]) if m["kind"] == "status" and "readiness" in m["content"]]
    assert ready[-1]["author_kind"] == "aios" and "READY" in ready[-1]["content"]


def test_findings_are_grounded_by_aios_and_a_high_one_blocks_readiness(db, settings, engine, proj, fake):
    conv = verified_change(db, engine, proj, fake)
    fake(review={"summary": "Problems.", "findings": [
        {"severity": "high", "title": "Wrong result", "detail": "d", "file": "calc.py", "line": 2},
        {"severity": "medium", "title": "Ghost file", "detail": "d", "file": "nope.py", "line": 5},
        {"severity": "low", "title": "Past the end", "detail": "d", "file": "calc.py", "line": 999},
        {"severity": "weird", "title": "No location", "detail": "d"},
        {"severity": "low", "title": "Escape", "detail": "d", "file": "../../outside.txt", "line": 1}]})
    r, state = review(db, engine, conv)
    assert state == "succeeded"
    ch = conversations.changes(db, conv["id"])
    f = {x["title"]: x for x in ch["review"]["meta"]["review"]["findings"]}
    assert f["Wrong result"]["grounded"] is True
    assert f["Ghost file"]["grounded"] is False and f["Past the end"]["grounded"] is False
    assert f["Escape"]["grounded"] is False                                        # cannot point outside the checkout
    assert f["No location"]["grounded"] is None and f["No location"]["severity"] == "low"
    assert ch["review"]["meta"]["review"]["counts"] == {"high": 1, "medium": 1, "low": 3}
    assert "location not found" in ch["review"]["content"]
    assert ch["readiness"]["ready"] is False and ch["readiness"]["high_findings"] == 1
    assert any("high-severity" in why for why in ch["readiness"]["reasons"])


def test_a_new_revision_makes_the_old_review_and_verification_stale(db, settings, engine, proj, fake):
    conv = verified_change(db, engine, proj, fake)
    fake(review={"summary": "ok", "findings": []})
    review(db, engine, conv)
    assert conversations.changes(db, conv["id"])["readiness"]["ready"] is True
    conversations.set_verify_command(db, proj["id"], None)
    fake(edit_files={"README.md": "# more\n"})
    _, rid = start_turn(db, engine, proj, "also touch the readme", mode="edit", conv=conv)
    assert engine.execute(rid) == "succeeded"
    ready = conversations.changes(db, conv["id"])["readiness"]
    assert ready["ready"] is False and ready["reviewed"] is False
    assert any("older revision" in why for why in ready["reasons"])


def test_nothing_to_review_and_no_review_during_a_turn(db, engine, proj, fake):
    conv = conversations.create(db, project_id=proj["id"])
    with pytest.raises(ApiError) as e:
        conversations.request_review(db, engine, conv["id"])
    assert e.value.code == "nothing_to_review"
    conv = verified_change(db, engine, proj, fake)
    conversations.post_user_message(db, engine, conv["id"], "another question", "read")   # left unexecuted
    with pytest.raises(ApiError) as e:
        conversations.request_review(db, engine, conv["id"])
    assert e.value.code == "turn_in_progress"


def test_a_review_without_structured_findings_is_not_trusted(db, engine, proj, fake):
    conv = verified_change(db, engine, proj, fake)
    fake(no_structured_output=True)
    r, state = review(db, engine, conv)
    assert state == "failed"
    assert conversations.changes(db, conv["id"])["review"] is None
    assert any("did not return structured findings" in m["content"] for m in conversations.messages(db, conv["id"]))


def test_isolation_failure_discards_the_review_and_still_cleans_up(db, settings, engine, proj, fake):
    conv = verified_change(db, engine, proj, fake)
    log = fake(extra_tools=["Bash"], review={"summary": "x", "findings": []})
    r, state = review(db, engine, conv)
    assert state == "failed"
    assert conversations.changes(db, conv["id"])["review"] is None
    assert any("Isolation check FAILED" in m["content"] for m in conversations.messages(db, conv["id"]))
    assert not Path(review_calls(log)[-1]["cwd"]).exists()


def test_reviewer_model_differs_from_the_writer_when_we_can_tell():
    assert default_reviewer_model("sonnet") == "opus" and default_reviewer_model("claude-sonnet-5-5") == "opus"
    assert default_reviewer_model("opus") == "sonnet" and default_reviewer_model(None) == "sonnet"


def test_normalize_findings_limits_and_cleans(tmp_path):
    (tmp_path / "a.py").write_text("x = 1\ny = 2\n")
    many = [{"severity": "HIGH", "title": f"t{i}", "detail": "d" * 5000, "file": "./a.py", "line": 2}
            for i in range(60)]
    out = reviewer.normalize_findings({"findings": many + ["junk", None]}, tmp_path)
    assert len(out) == reviewer.MAX_FINDINGS and out[0]["severity"] == "high" and out[0]["file"] == "a.py"
    assert len(out[0]["detail"]) == 2000 and out[0]["grounded"] is True and out[0]["id"] == "f1"
    assert reviewer.normalize_findings(None, tmp_path) == [] and reviewer.normalize_findings({"findings": "x"}, None) == []


def test_readiness_is_deterministic_from_recorded_facts():
    patch = {"changed": True, "head_revision": "h1"}
    ok_v = {"passed": True, "head_revision": "h1"}
    r = reviewer.readiness(None, None, None)
    assert r["ready"] is False and "no proposed change" in r["reasons"][0]
    assert reviewer.readiness({"changed": False}, None, None)["ready"] is False
    r = reviewer.readiness(patch, None, None)
    assert r["ready"] is False and r["verified"] is None
    r = reviewer.readiness(patch, {"passed": False, "head_revision": "h1"}, None)
    assert r["ready"] is False and r["verified"] is False
    r = reviewer.readiness(patch, ok_v, None)
    assert r["ready"] is True and r["reviewed"] is False and "optional" in " ".join(r["reasons"])
    assert reviewer.readiness(patch, ok_v, {"reviewed_revision": "h1", "counts": {"high": 0}})["ready"] is True
    assert reviewer.readiness(patch, ok_v, {"reviewed_revision": "h1", "counts": {"high": 2}})["ready"] is False
    stale = reviewer.readiness(patch, ok_v, {"reviewed_revision": "h0", "counts": {"high": 5}})
    assert stale["ready"] is True and stale["reviewed"] is False        # a stale review neither blocks nor counts
    assert reviewer.readiness(patch, {"passed": True, "head_revision": "h0"}, None)["ready"] is False
