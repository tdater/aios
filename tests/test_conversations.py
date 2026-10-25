"""Conversations end to end: persisted attributed messages, isolated worktrees, patches at pinned
revisions, approval-gated verification, honest status, isolation failures, cancellation.

The provider is tests/fake_claude.py, a stand-in executable that mimics Claude Code's stream-json
output. These tests prove AIOS's side of the contract. The real Claude connection is proven by
scripts/demo_workspace.py (and scripts/demo_claude_connection.py) on a signed-in machine.
"""
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from aios import approvals, claude_code, context_pack, conversations, memory, services, verification, worktrees
from aios.errors import ApiError

FAKE = [sys.executable, str(Path(__file__).with_name("fake_claude.py"))]
CALC = "def add(a, b):\n    return a - b\n\n\ndef mul(a, b):\n    return a * b\n"
TESTS = ("import unittest\nfrom calc import add, mul\n\n\nclass T(unittest.TestCase):\n"
         "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n\n"
         "    def test_mul(self):\n        self.assertEqual(mul(2, 3), 6)\n\n\n"
         "if __name__ == '__main__':\n    unittest.main()\n")
VERIFY = [sys.executable, "-B", "-m", "unittest", "test_calc"]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, check=True).stdout


@pytest.fixture()
def repo(tmp_path):
    root = tmp_path / "ws" / "calc"
    root.mkdir(parents=True)
    (root / "calc.py").write_text(CALC)
    (root / "test_calc.py").write_text(TESTS)
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed")
    return root


@pytest.fixture()
def proj(db, settings, repo):
    return services.register_project(db, settings, "Calc", str(repo))


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    log = tmp_path / "calls.jsonl"

    def configure(**cfg):
        cfg.setdefault("log", str(log))
        monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps(cfg))
        return log
    configure()
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    return configure


def start_turn(db, engine, proj, content, mode="read", conv=None):
    conv = conv or conversations.create(db, project_id=proj["id"], title="t")
    posted = conversations.post_user_message(db, engine, conv["id"], content, mode)
    return conv, posted["run"]["id"]


def kinds(db, cid):
    return [(m["author_kind"], m["kind"]) for m in conversations.messages(db, cid)]


# ---------------------------------------------------------------- read turn
def test_read_turn_persists_attributed_messages_and_honest_status(db, settings, engine, proj, fake):
    conv, rid = start_turn(db, engine, proj, "What does calc.py do?")
    assert engine.execute(rid) == "succeeded"
    msgs = conversations.messages(db, conv["id"])
    user, reply = msgs[0], msgs[1]
    assert (user["role"], user["author_kind"], user["author"]) == ("user", "user", "you")
    assert (reply["role"], reply["author_kind"]) == ("assistant", "provider")
    assert reply["author"] == "claude-code 2.1.300 (fake-model)"
    assert "sk-ant-" not in reply["content"]                       # the stand-in leaked a key; it is redacted
    turn = reply["meta"]["turn"]
    assert turn["tools"] == ["Read", "Glob", "Grep"] and turn["unexpected_tools"] == []
    assert turn["api_key_source"] == "none" and turn["permission_mode"] == "dontAsk"
    conv = conversations.get(db, conv["id"])
    assert conv["session_id"] and conv["worktree_path"] is None   # a read turn never creates a worktree
    status = conversations.status_block(db, conv)
    assert status["quota"]["five_hour"]["utilization"] == 0.1
    assert status["permissions"]["shell"] == "denied"
    assert status["session"]["resumable"] is True
    run = services.run_detail(db, rid)
    assert {a["kind"] for a in run["artifacts"]} == {"claude_transcript"}
    assert any(e["kind"] == "claude" and "says:" in e["message"] for e in run["events"])
    assert not any("sk-ant-" in e["message"] for e in run["events"])


def test_second_turn_resumes_the_same_provider_session(db, engine, proj, fake):
    conv, rid = start_turn(db, engine, proj, "first question")
    engine.execute(rid)
    sid = conversations.get(db, conv["id"])["session_id"]
    _, rid2 = start_turn(db, engine, proj, "follow up", conv=conv)
    assert engine.execute(rid2) == "succeeded"
    assert conversations.get(db, conv["id"])["session_id"] == sid


def test_only_one_turn_at_a_time(db, engine, proj, fake):
    conv, _ = start_turn(db, engine, proj, "first")
    with pytest.raises(ApiError) as e:
        conversations.post_user_message(db, engine, conv["id"], "second", "read")
    assert e.value.status == 409 and e.value.code == "turn_in_progress"


def test_message_and_mode_validation(db, engine, proj, fake):
    conv = conversations.create(db, project_id=proj["id"])
    for content, mode, code in (("  ", "read", "empty_message"), ("hi", "yolo", "bad_mode"),
                                ("x" * (conversations.MAX_MESSAGE_CHARS + 1), "read", "message_too_long")):
        with pytest.raises(ApiError) as e:
            conversations.post_user_message(db, engine, conv["id"], content, mode)
        assert e.value.code == code
    with pytest.raises(ApiError) as e:
        conversations.create(db, project_id=proj["id"], model="bad model; rm -rf")
    assert e.value.code == "bad_model"


def test_provider_unavailable_blocks_honestly_with_no_fabricated_reply(db, engine, proj, fake):
    fake(auth={"loggedIn": False, "authMethod": "none"})
    conv, rid = start_turn(db, engine, proj, "hello")
    assert engine.execute(rid) == "blocked"
    run = services.run_detail(db, rid)["run"]
    assert run["block_code"] == "provider_unavailable"
    assert [k for k in kinds(db, conv["id"])] == [("user", "message"), ("aios", "status")]


# ---------------------------------------------------------------- edit turn
def test_edit_turn_works_in_an_isolated_worktree_and_records_the_patch(db, settings, engine, proj, repo, fake):
    fake(edit=True)
    conv, rid = start_turn(db, engine, proj, "fix the add bug", mode="edit")
    assert engine.execute(rid) == "succeeded"
    assert "return a - b" in (repo / "calc.py").read_text()                       # project folder untouched
    assert git(repo, "status", "--porcelain").strip() == ""
    c = conversations.get(db, conv["id"])
    wt = Path(c["worktree_path"])
    assert wt.parent == settings.worktrees_dir and c["branch"] == f"aios/{conv['id']}"
    assert "return a + b" in (wt / "calc.py").read_text()
    assert c["base_revision"] == git(repo, "rev-parse", "HEAD").strip() and c["head_revision"] != c["base_revision"]
    patch_msg = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "patch")
    assert patch_msg["author_kind"] == "aios"
    assert patch_msg["meta"]["files"] == [{"status": "M", "path": "calc.py"}]
    assert (patch_msg["meta"]["added"], patch_msg["meta"]["removed"]) == (1, 1)
    art = services.read_artifact(db, settings, patch_msg["meta"]["artifact_id"])
    assert "+    return a + b" in art["content"] and art["sha256"] == patch_msg["meta"]["sha256"]
    # the same patch can be re-derived from git at the pinned revisions
    again, _ = worktrees.diff_text(wt, c["base_revision"], c["head_revision"])
    assert again == art["content"]
    assert any("No verification command" in m["content"] for m in conversations.messages(db, conv["id"]))
    events = services.run_detail(db, rid)["events"]
    assert any(e["message"] == "editing calc.py" for e in events)


def test_two_conversations_get_separate_worktrees_and_branches(db, settings, engine, proj, fake):
    fake(edit=True)
    c1, r1 = start_turn(db, engine, proj, "one", mode="edit")
    assert engine.execute(r1) == "succeeded"
    c2, r2 = start_turn(db, engine, proj, "two", mode="edit")
    assert engine.execute(r2) == "succeeded"
    a, b = conversations.get(db, c1["id"]), conversations.get(db, c2["id"])
    assert a["worktree_path"] != b["worktree_path"] and a["branch"] != b["branch"]


def test_edit_needs_a_usable_git_repository(db, settings, engine, sample_ws, fake):
    p = services.register_project(db, settings, "NoCommits", str(sample_ws))      # git init, no commit
    conv = conversations.create(db, project_id=p["id"])
    with pytest.raises(ApiError) as e:
        conversations.post_user_message(db, engine, conv["id"], "edit something", "edit")
    assert e.value.status == 409 and e.value.code == "repo_not_ready" and "no commits" in e.value.message


def test_no_changes_is_reported_as_no_changes(db, engine, proj, fake):
    conv, rid = start_turn(db, engine, proj, "just look", mode="edit")
    assert engine.execute(rid) == "succeeded"
    patch = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "patch")
    assert patch["content"] == "Claude made no file changes." and patch["meta"] == {"changed": False}


def test_sensitive_paths_and_secret_like_values_are_flagged(db, engine, proj, fake):
    fake(edit_files={".github/workflows/ci.yml": "on: push\n", "notes.txt": "api_key = abcdefghijklmnop1234\n"})
    conv, rid = start_turn(db, engine, proj, "add stuff", mode="edit")
    assert engine.execute(rid) == "succeeded"
    meta = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "patch")["meta"]
    assert meta["sensitive_paths"] == [".github/workflows/ci.yml"]
    assert "assigned-secret" in meta["possible_secret_kinds"]


# ---------------------------------------------------------------- verification
def test_verification_runs_only_after_the_exact_action_is_approved(db, settings, engine, proj, fake):
    fake(edit=True)
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "fix the add bug", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    pending = db.query("SELECT * FROM approvals WHERE run_id=? AND status='pending'", (rid,))
    assert len(pending) == 1
    action = json.loads(pending[0]["action_json"])
    assert action["type"] == "run_verification" and action["argv"] == VERIFY
    assert action["head_revision"] == conversations.get(db, conv["id"])["head_revision"]
    desc = approvals.describe(action)
    assert desc["destructive"] is True and "not a sandbox" in " ".join(desc["side_effects"])
    assert not any(m["kind"] == "verification" for m in conversations.messages(db, conv["id"]))
    assert any("Waiting for your approval" in m["content"] for m in conversations.messages(db, conv["id"]))
    with pytest.raises(ApiError) as e:                           # destructive actions need deliberate confirmation
        engine.decide_approval(pending[0]["id"], True)
    assert e.value.code == "confirmation_required"
    engine.decide_approval(pending[0]["id"], True, confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    ver = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "verification")
    assert ver["author_kind"] == "aios" and ver["meta"]["passed"] is True and ver["meta"]["exit_code"] == 0
    assert ver["meta"]["head_revision"] == action["head_revision"]
    result = services.run_detail(db, rid)
    assert any(a["kind"] == "verification" for a in result["artifacts"])
    assert db.one("SELECT status FROM approvals WHERE id=?", (pending[0]["id"],))["status"] == "consumed"


def test_failing_verification_is_a_recorded_outcome_not_an_engine_error(db, engine, proj, fake):
    fake(edit_files={"README.md": "# changed\n"})                # bug stays, so the tests fail
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "touch the readme", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    aid = db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"]
    engine.decide_approval(aid, True, confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    ver = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "verification")
    assert ver["meta"]["passed"] is False and ver["meta"]["exit_code"] != 0
    assert "FAILED" in ver["content"] and "test_add" in ver["content"]
    assert services.run_detail(db, rid)["run"]["state"] == "succeeded"


def test_rejecting_the_approval_cancels_and_nothing_runs(db, engine, proj, fake):
    fake(edit=True)
    conversations.set_verify_command(db, proj["id"], VERIFY)
    conv, rid = start_turn(db, engine, proj, "fix", mode="edit")
    assert engine.execute(rid) == "awaiting_approval"
    aid = db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"]
    engine.decide_approval(aid, False, "no")
    assert services.run_detail(db, rid)["run"]["state"] == "cancelled"
    assert not any(m["kind"] == "verification" for m in conversations.messages(db, conv["id"]))


def test_a_missing_program_is_recorded_as_a_failed_verification(db, engine, proj, fake):
    fake(edit=True)
    conversations.set_verify_command(db, proj["id"], ["definitely-not-a-real-program-xyz"])
    conv, rid = start_turn(db, engine, proj, "fix", mode="edit")
    engine.execute(rid)
    engine.decide_approval(db.one("SELECT id FROM approvals WHERE run_id=?", (rid,))["id"], True,
                           confirm_destructive=True)
    assert engine.execute(rid) == "succeeded"
    ver = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "verification")
    assert ver["meta"]["passed"] is False and "could not start" in ver["content"]


def test_only_the_owner_command_is_used_and_it_is_validated(db, proj):
    assert conversations.set_verify_command(db, proj["id"], VERIFY) == VERIFY
    assert conversations.verify_argv(db, proj["id"]) == VERIFY
    for bad in ([], "pytest", [""], ["a"] * 25, ["x", 3], ["a\x00b"]):
        with pytest.raises(ApiError) as e:
            conversations.set_verify_command(db, proj["id"], bad)
        assert e.value.code == "bad_verify_command"
    assert conversations.set_verify_command(db, proj["id"], None) is None
    assert db.one("SELECT 1 AS x FROM audit_log WHERE action='project.verify_command'")


# ---------------------------------------------------------------- isolation and cancellation
@pytest.mark.parametrize("cfg,needle", [
    ({"extra_tools": ["Bash"]}, "tools AIOS did not allow: Bash"),
    ({"api_key_source": "ANTHROPIC_API_KEY"}, "API key source"),
    ({"plugins": [{"name": "mine", "path": "C:/x", "source": "mine@market"}]}, "plugins loaded"),
])
def test_isolation_failures_fail_the_run_and_say_why(db, engine, proj, fake, cfg, needle):
    fake(edit=True, **cfg)
    conv, rid = start_turn(db, engine, proj, "fix", mode="edit")
    assert engine.execute(rid) == "failed"
    status = [m for m in conversations.messages(db, conv["id"]) if m["kind"] == "status"]
    assert any("Isolation check FAILED" in m["content"] and needle in m["content"] for m in status)
    assert not any(m["kind"] == "patch" for m in conversations.messages(db, conv["id"]))   # result not used


def test_a_failed_provider_turn_is_reported_not_hidden(db, engine, proj, fake):
    fake(outcome="error")
    conv, rid = start_turn(db, engine, proj, "go")
    assert engine.execute(rid) == "failed"
    assert any("did not complete" in m["content"] for m in conversations.messages(db, conv["id"]))


def test_cancel_kills_a_hung_provider_promptly(db, engine, proj, fake):
    fake(outcome="hang")
    conv, rid = start_turn(db, engine, proj, "this will hang")
    result = {}
    t = threading.Thread(target=lambda: result.setdefault("state", engine.execute(rid)))
    t0 = time.time()
    t.start()
    deadline = time.time() + 20
    while time.time() < deadline and not any(
            e["message"] == "claude started" for e in services.run_detail(db, rid)["events"]):
        time.sleep(0.1)
    time.sleep(1.5)                                              # let the child start sleeping
    assert engine.cancel(rid) == "requested"
    t.join(timeout=30)
    assert not t.is_alive(), "the hung child was not killed"
    assert time.time() - t0 < 45                                 # the stand-in sleeps for 60s
    assert result["state"] == "cancelled"


# ---------------------------------------------------------------- context
def test_context_has_only_approved_notes_and_records_versions(db, settings, engine, proj, fake):
    mk = lambda title, **kw: memory.create(db, settings, scope=kw.pop("scope", "global"), type="decision",  # noqa: E731
                                           title=title, body=f"{title} about the frobnicator rules", **kw)
    good = mk("Approved frobnicator decision", status="approved")
    mine = mk("Project frobnicator note", status="approved", scope="project", project_id=proj["id"])
    mk("Candidate frobnicator idea", status="candidate")
    mk("Secretish frobnicator thing", status="approved", sensitivity="secret-adjacent")
    other_dir = settings.workspaces_dir / "other"
    other_dir.mkdir()
    other = services.register_project(db, settings, "Other", str(other_dir))
    mk("Other project frobnicator", status="approved", scope="project", project_id=other["id"])
    pack = context_pack.build(db, settings, project_id=proj["id"], prompt="explain the frobnicator", mode="read")
    refs = {i["ref"] for i in pack.items if i["kind"] == "memory"}
    assert refs == {good, mine}
    assert "Approved frobnicator decision" in pack.text and "Candidate" not in pack.text
    assert "Secretish" not in pack.text and "Other project" not in pack.text
    versions = {i["ref"]: i["version"] for i in pack.items if i["kind"] == "memory"}
    assert all(v for v in versions.values())
    # and a real turn records exactly what it supplied
    conv, rid = start_turn(db, engine, proj, "explain the frobnicator")
    engine.execute(rid)
    rows = context_pack.supplied_for_run(db, rid)
    assert {r["ref"] for r in rows if r["kind"] == "memory"} == {good, mine}
    assert all(len(r["sha256"]) == 64 for r in rows)
    evidence = services.run_detail(db, rid)["evidence"]
    assert any(e["kind"] == "context" and "2 of them approved note" in e["summary"] for e in evidence)


def test_provider_environment_is_clean_and_prompt_carries_context_as_data(db, engine, proj, fake, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "must-not-reach-the-child")
    log = fake()
    conv, rid = start_turn(db, engine, proj, "do the thing")
    engine.execute(rid)
    call = [json.loads(x) for x in Path(log).read_text().splitlines() if '"-p"' in x][-1]
    assert call["api_key_present"] is False and call["disable_auto_memory"] == "1"
    argv = call["argv"]
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep"
    assert argv[argv.index("--setting-sources") + 1] == ""
    assert "--resume" not in argv
    prompt = argv[-1]
    assert prompt.startswith("<aios_context>") and "Owner's request:\ndo the thing" in prompt
    assert "not instructions" in argv[argv.index("--append-system-prompt") + 1]


def test_published_api_schema_names_never_collide(settings):
    """Two request models with the same class name make FastAPI rename one of them in the published
    contract (module-qualified, containing '__'), silently changing an existing route's schema."""
    from aios.main import create_app
    names = list(create_app(settings).openapi()["components"]["schemas"])
    assert not [n for n in names if "__" in n], f"colliding model names: {[n for n in names if '__' in n]}"


# ---------------------------------------------------------------- git and verification helpers
def test_repo_state_explains_why_a_folder_is_unusable(tmp_path, repo):
    plain = tmp_path / "plain"
    plain.mkdir()
    assert "not a git repository" in worktrees.repo_state(plain)["reason"]
    empty = tmp_path / "empty"
    empty.mkdir()
    git(empty, "init", "-q")
    assert "no commits" in worktrees.repo_state(empty)["reason"]
    sub = repo / "pkg"
    sub.mkdir()
    assert "inside a larger git repository" in worktrees.repo_state(sub)["reason"]
    ok = worktrees.repo_state(repo)
    assert ok["usable"] and ok["branch"] == "main" and ok["dirty"] is False
    (repo / "x.txt").write_text("dirty")
    assert worktrees.repo_state(repo)["dirty"] is True


def test_sensitive_path_patterns():
    hit = worktrees.sensitive_paths(["src/app.py", ".github/workflows/x.yml", ".env.local", "tools/run.ps1",
                                     "README.md", "a/package.json", ".claude/settings.json", "id_rsa"])
    assert hit == [".claude/settings.json", ".env.local", ".github/workflows/x.yml", "a/package.json",
                   "id_rsa", "tools/run.ps1"]


def test_verification_environment_drops_credentials():
    env = verification.sanitized_env({"PATH": "p", "SystemRoot": "r", "GITHUB_TOKEN": "t", "AWS_SECRET_ACCESS_KEY": "s",
                                      "ANTHROPIC_API_KEY": "a", "OPENAI_API_KEY": "o", "SSH_AUTH_SOCK": "x",
                                      "MY_PASSWORD": "p", "CLAUDE_CODE_USE_BEDROCK": "1"})
    assert set(env) == {"PATH", "SystemRoot", "PYTHONDONTWRITEBYTECODE", "PYTHONUTF8", "CI"}


def test_verification_refuses_a_program_planted_in_the_worktree(tmp_path):
    wt = tmp_path / "wt"
    wt.mkdir()
    planted = wt / ("evil.exe" if sys.platform == "win32" else "evil")
    planted.write_text("x")
    planted.chmod(0o755)
    with pytest.raises(verification.VerifyError, match="inside the worktree"):
        verification.resolve_program(str(planted), wt, {"PATH": ""})


def test_verification_times_out_and_redacts(tmp_path):
    slow = verification.run_command([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, timeout_s=1)
    assert slow["timed_out"] and not slow["passed"] and slow["duration_s"] < 15
    leaky = verification.run_command([sys.executable, "-c", "print('token = abcdefghijklmnop1234')"], tmp_path,
                                     timeout_s=30)
    assert leaky["passed"] and "abcdefghijklmnop1234" not in leaky["output"]
