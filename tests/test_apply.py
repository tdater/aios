"""Applying a reviewed change to the owner's real project: gated by AIOS's own readiness, bound to the exact approval,
refused whenever the project is not exactly where the owner saw it, and never left half-merged."""
import json
from pathlib import Path

import pytest

from test_conversations import FAKE, VERIFY, git, kinds, proj, repo, start_turn, fake  # noqa: F401  (fixtures and helpers)
from test_api import V, app, client, native, pair  # noqa: F401

from aios import approvals, conversations, services
from aios.errors import ApiError


def ready_change(db, engine, proj, fake):
    """A conversation whose change has passed AIOS's own tests, so it is READY."""
    fake(edit=True)
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "fix the add bug", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    engine.decide_approval(db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"], True, confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    assert conversations.changes(db, conv["id"])["readiness"]["ready"] is True
    return conv


def request(db, engine, conv):
    return conversations.request_apply(db, engine, conv["id"])["run"]["id"]


def pending(db, rid):
    return db.one("SELECT * FROM approvals WHERE run_id=? AND status='pending'", (rid,))


def approve(db, engine, rid):
    engine.decide_approval(pending(db, rid)["id"], True, confirm_destructive=True)


def test_a_ready_change_is_merged_only_after_an_exact_approval(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    before = git(repo, "rev-parse", "HEAD").strip()
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    assert git(repo, "rev-parse", "HEAD").strip() == before and "return a - b" in (repo / "calc.py").read_text()     # nothing yet
    ap = pending(db, rid)
    assert [p["type"] for p in conversations.view(db, conv["id"])["status"]["pending_approvals"]] == ["apply_revision"]
    action = json.loads(ap["action_json"])
    c = conversations.get(db, conv["id"])
    assert action["type"] == "apply_revision" and action["head_revision"] == c["head_revision"] and action["target_head"] == before
    assert action["target_branch"] == "main" and action["files"] == ["calc.py"]
    desc = approvals.describe(action)
    assert desc["destructive"] is True and "git reset --hard " + before[:12] in " ".join(desc["side_effects"])
    with pytest.raises(ApiError) as e:
        engine.decide_approval(ap["id"], True)
    assert e.value.code == "confirmation_required"
    engine.decide_approval(ap["id"], True, confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    assert "return a + b" in (repo / "calc.py").read_text()
    assert git(repo, "status", "--porcelain").strip() == ""
    assert len(git(repo, "rev-list", "--parents", "-n", "1", "HEAD").split()) == 3          # a real merge commit
    ch = conversations.changes(db, conv["id"])
    assert ch["applied"]["applied"] is True and ch["applied"]["tree_matches_reviewed"] is True
    assert ch["applied"]["commit"] == git(repo, "rev-parse", "HEAD").strip()
    with pytest.raises(ApiError) as again:
        conversations.request_apply(db, engine, conv["id"])
    assert again.value.code == "already_applied"
    assert db.one("SELECT status FROM approvals WHERE id=?", (ap["id"],))["status"] == "consumed"


def test_only_a_ready_change_can_be_applied(db, engine, proj, repo, fake):
    fake(edit_files={"README.md": "# changed\n"})                       # the bug stays, so the tests fail
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "touch the readme", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    engine.decide_approval(db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"], True, confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    with pytest.raises(ApiError) as e:
        conversations.request_apply(db, engine, conv["id"])
    assert e.value.status == 409 and e.value.code == "not_ready" and "FAILED" in e.value.message
    empty = conversations.create(db, project_id=proj["id"], title="none")
    with pytest.raises(ApiError) as e2:
        conversations.request_apply(db, engine, empty["id"])
    assert e2.value.code == "nothing_to_apply"
    assert git(repo, "log", "--oneline").count("\n") == 1                # still just the seed commit: never touched


def test_rejecting_the_approval_changes_nothing(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    before = git(repo, "rev-parse", "HEAD").strip()
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    engine.decide_approval(pending(db, rid)["id"], False)
    assert engine.execute(rid) in ("failed", "cancelled")
    assert git(repo, "rev-parse", "HEAD").strip() == before and "return a - b" in (repo / "calc.py").read_text()
    assert conversations.changes(db, conv["id"])["applied"] is None


def test_uncommitted_work_in_the_project_stops_it_before_asking(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    (repo / "notes.txt").write_text("my unsaved work")
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "failed"
    assert pending(db, rid) is None
    assert (repo / "notes.txt").read_text() == "my unsaved work" and "return a - b" in (repo / "calc.py").read_text()
    assert any("uncommitted changes" in m["content"] for m in conversations.messages(db, conv["id"]) if m["kind"] == "status")


def test_a_project_that_moved_after_you_approved_needs_a_fresh_approval(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    old = pending(db, rid)
    (repo / "later.txt").write_text("a new commit made while the approval was open")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "later")
    moved = git(repo, "rev-parse", "HEAD").strip()
    engine.decide_approval(old["id"], True, confirm_destructive=True)           # approves the OLD state of the project
    assert engine.execute(rid) == "awaiting_approval"                           # the action changed, so the old approval does not fit
    new = pending(db, rid)
    assert new["id"] != old["id"] and json.loads(new["action_json"])["target_head"] == moved
    assert db.one("SELECT status FROM approvals WHERE id=?", (old["id"],))["status"] == "approved"      # never spent
    assert git(repo, "rev-parse", "HEAD").strip() == moved and "return a - b" in (repo / "calc.py").read_text()


def test_the_merge_helper_itself_refuses_a_project_that_is_not_where_it_was_approved(repo, tmp_path):
    from aios import worktrees
    head = git(repo, "rev-parse", "HEAD").strip()
    kwargs = dict(revision=head, expected_branch="main", message="m", hooks_dir=tmp_path / "nohooks")
    with pytest.raises(worktrees.GitError, match="moved after you approved"):
        worktrees.apply_revision(repo, expected_head="0" * 40, **kwargs)
    with pytest.raises(worktrees.GitError, match="moved after you approved"):
        worktrees.apply_revision(repo, **{**kwargs, "expected_branch": "other"}, expected_head=head)
    (repo / "x.txt").write_text("dirty")
    with pytest.raises(worktrees.GitError, match="uncommitted changes"):
        worktrees.apply_revision(repo, expected_head=head, **kwargs)


def test_a_conflict_is_aborted_and_the_project_is_left_exactly_as_it_was(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    (repo / "calc.py").write_text(CALC_OTHER)                            # the owner changed the same line meanwhile
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "mine")
    mine = git(repo, "rev-parse", "HEAD").strip()
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    approve(db, engine, rid)
    assert engine.execute(rid) == "failed"
    assert git(repo, "rev-parse", "HEAD").strip() == mine and git(repo, "status", "--porcelain").strip() == ""
    assert not (repo / ".git" / "MERGE_HEAD").exists()
    assert (repo / "calc.py").read_text() == CALC_OTHER
    assert any("could not merge it cleanly" in m["content"] for m in conversations.messages(db, conv["id"]))


def test_a_clean_merge_over_other_changes_warns_that_it_differs_from_what_was_tested(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    (repo / "extra.py").write_text("X = 1\n")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "extra")
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    approve(db, engine, rid)
    assert engine.execute(rid) == "succeeded"
    ch = conversations.changes(db, conv["id"])
    assert ch["applied"]["applied"] is True and ch["applied"]["tree_matches_reviewed"] is False
    assert any("differs from what was tested" in m["content"] for m in conversations.messages(db, conv["id"]))
    assert (repo / "extra.py").exists() and "return a + b" in (repo / "calc.py").read_text()


def test_the_owners_repository_hooks_do_not_run_for_a_merge_of_provider_written_files(db, engine, proj, repo, fake, tmp_path):
    marker = tmp_path / "hook-ran.txt"
    hook = repo / ".git" / "hooks" / "post-merge"
    hook.write_text(f"#!/bin/sh\necho ran > '{marker.as_posix()}'\n")
    conv = ready_change(db, engine, proj, fake)
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "awaiting_approval"
    approve(db, engine, rid)
    assert engine.execute(rid) == "succeeded"
    assert not marker.exists()


def test_a_branch_that_moved_after_review_is_refused(db, engine, proj, repo, fake):
    conv = ready_change(db, engine, proj, fake)
    wt = Path(conversations.get(db, conv["id"])["worktree_path"])
    (wt / "sneaky.py").write_text("print('not reviewed')\n")
    git(wt, "add", "-A")
    git(wt, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "after review")
    rid = request(db, engine, conv)
    assert engine.execute(rid) == "failed"
    assert pending(db, rid) is None and not (repo / "sneaky.py").exists()
    assert "return a - b" in (repo / "calc.py").read_text()


def test_http_route_refuses_when_there_is_nothing_to_apply(client, repo):
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(repo)}).json()
    cid = client.post(f"{V}/conversations", json={"project_id": p["id"], "title": "x"}).json()["id"]
    r = client.post(f"{V}/conversations/{cid}/apply")
    assert r.status_code == 409 and r.json()["error"]["code"] == "nothing_to_apply"


CALC_OTHER = "def add(a, b):\n    return a * 0\n\n\ndef multiply(a, b):\n    return a * b\n"
