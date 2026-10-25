"""Claude Code transport. These tests use tests/fake_claude.py as a stand-in executable, so they
prove AIOS's side of the contract (flags, env, parsing, scope checks), not Claude itself. The real
connection is proven only by scripts/demo_claude_connection.py on a signed-in machine."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

from aios import claude_code

FAKE = [sys.executable, str(Path(__file__).with_name("fake_claude.py"))]
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    log = tmp_path / "calls.jsonl"

    def configure(**cfg):
        cfg.setdefault("log", str(log))
        monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps(cfg))
        return log
    configure()
    return configure


def calls(log: Path) -> list[dict]:
    return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]


def test_command_carries_every_safety_flag_and_ends_options_before_prompt():
    cmd = claude_code.build_command(["claude"], "-rm everything", mode="edit", max_turns=4)
    assert cmd[cmd.index("--permission-mode") + 1] == "acceptEdits"
    assert cmd[cmd.index("--permission-prompts") + 1] == "none"
    assert cmd[cmd.index("--setting-sources") + 1] == ""  # no user, project, or local settings
    assert json.loads(cmd[cmd.index("--settings") + 1]) == {"disableAllHooks": True}
    assert "--strict-mcp-config" in cmd
    assert "Bash" in cmd[cmd.index("--disallowedTools") + 1].split(",")
    assert cmd[cmd.index("--max-turns") + 1] == "4"
    assert cmd[-2:] == ["--", "-rm everything"]
    assert "--bare" not in cmd  # bare mode ignores the subscription login


def test_empty_setting_sources_survives_windows_argument_quoting():
    """The empty value must reach the child as its own argument, not vanish."""
    cmd = claude_code.build_command(["claude.exe"], "fix it")
    line = subprocess.list2cmdline(cmd)
    assert '--setting-sources "" --settings' in line


def test_user_hooks_and_settings_do_not_reach_the_child(fake, tmp_path):
    log = fake()
    claude_code.run(tmp_path, "hello", exe=FAKE)
    argv = calls(log)[-1]["argv"]
    assert argv[argv.index("--setting-sources") + 1] == ""
    assert "disableAllHooks" in argv[argv.index("--settings") + 1]


def test_older_claude_rejecting_empty_sources_is_reported_not_hidden(fake, tmp_path):
    fake(reject_empty_sources=True)
    with pytest.raises(claude_code.ClaudeUnavailable, match="claude update"):
        claude_code.run(tmp_path, "hello", exe=FAKE)


def test_read_mode_cannot_edit():
    cmd = claude_code.build_command(["claude"], "look", mode="read")
    assert cmd[cmd.index("--permission-mode") + 1] == "dontAsk"
    assert "Edit" not in cmd[cmd.index("--allowedTools") + 1].split(",")
    with pytest.raises(ValueError):
        claude_code.build_command(["claude"], "x", mode="yolo")
    with pytest.raises(ValueError):
        claude_code.build_command(["claude"], "   ")


def test_billing_variables_are_removed_from_the_child_environment():
    env = claude_code.child_env({"PATH": "x", "ANTHROPIC_API_KEY": "k", "CLAUDE_CODE_USE_BEDROCK": "1"})
    assert env == {"PATH": "x"}


def test_preflight_accepts_only_a_signed_in_claude_ai_login(fake):
    pf = claude_code.preflight(FAKE)
    assert pf.public() == {"version": "2.1.300 (Claude Code)", "logged_in": True,
                           "auth_method": "claude.ai", "plan": "max"}
    fake(auth={"loggedIn": False, "authMethod": "none"})
    with pytest.raises(claude_code.ClaudeUnavailable, match="not signed in"):
        claude_code.preflight(FAKE)
    fake(auth={"loggedIn": True, "authMethod": "api_key"})
    with pytest.raises(claude_code.ClaudeUnavailable, match="api_key"):
        claude_code.preflight(FAKE)
    fake(version="2.1.100 (Claude Code)")
    with pytest.raises(claude_code.ClaudeUnavailable, match="too old"):
        claude_code.preflight(FAKE)


def test_batch_shims_are_refused(monkeypatch):
    monkeypatch.setattr(claude_code.shutil, "which", lambda _: r"C:\npm\claude.cmd")
    with pytest.raises(claude_code.ClaudeUnavailable, match="batch shim"):
        claude_code.default_exe()
    monkeypatch.setattr(claude_code.shutil, "which", lambda _: None)
    with pytest.raises(claude_code.ClaudeUnavailable, match="not installed"):
        claude_code.default_exe()


def test_run_parses_the_stream_and_redacts_the_transcript(fake, tmp_path, monkeypatch):
    log = fake()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "should-never-reach-the-child")
    seen = []
    t = tmp_path / "t.jsonl"
    r = claude_code.run(tmp_path, "hello", exe=FAKE, transcript=t, on_event=seen.append)
    assert r.ok and r.exit_code == 0 and r.subtype == "success"
    assert r.num_turns == 3 and r.model == "fake-model" and r.session_id
    assert any(e.get("type") == "raw" for e in r.events)  # non-JSON line kept, not fatal
    assert len(seen) == 3
    text = t.read_text(encoding="utf-8")
    assert "sk-ant-" not in text and "[REDACTED:anthropic-key]" in text
    last = calls(log)[-1]
    assert last["api_key_present"] is False
    assert Path(last["cwd"]).resolve() == tmp_path.resolve()


def test_error_result_is_not_ok(fake, tmp_path):
    fake(outcome="error")
    r = claude_code.run(tmp_path, "hello", exe=FAKE)
    assert not r.ok and r.subtype == "error_max_turns"
    assert r.permission_denials == [{"tool_name": "Bash"}]


def test_timeout_kills_the_run(fake, tmp_path):
    fake(outcome="hang")
    r = claude_code.run(tmp_path, "hello", exe=FAKE, timeout_s=1)
    assert r.timed_out and not r.ok


def test_resume_reuses_the_session(fake, tmp_path):
    r = claude_code.run(tmp_path, "again", exe=FAKE, resume="abc-123")
    assert r.session_id == "abc-123"


def test_demo_script_end_to_end_with_stand_in(fake, tmp_path, monkeypatch, capsys):
    """Exercises the demo's own logic (baseline, patch scope check, AIOS-run verification,
    resume). The model is the stand-in, so this is NOT evidence of a real connection."""
    fake(edit=True)
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    spec = importlib.util.spec_from_file_location("demo", ROOT / "scripts" / "demo_claude_connection.py")
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    ws, ev = tmp_path / "repo", tmp_path / "evidence"
    monkeypatch.setattr(sys, "argv", ["demo", "--workspace", str(ws), "--evidence", str(ev)])
    assert demo.main() == 0
    summary = json.loads((ev / "summary.json").read_text(encoding="utf-8"))
    assert summary["result"] == "PASS"
    assert summary["steps"]["patch"]["changed_files"] == ["calc.py"]
    assert summary["steps"]["claude_follow_up"]["same_session"] is True
    assert "+    return a + b" in (ev / "change.patch").read_text(encoding="utf-8")


def test_demo_fails_isolation_when_a_plugin_loads(fake, tmp_path, monkeypatch):
    fake(edit=True, plugins=[{"name": "personal-hooks", "path": "/x"}])
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    spec = importlib.util.spec_from_file_location("demo3", ROOT / "scripts" / "demo_claude_connection.py")
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    ev = tmp_path / "evidence"
    monkeypatch.setattr(sys, "argv", ["demo", "--workspace", str(tmp_path / "repo"), "--evidence", str(ev)])
    assert demo.main() == 1
    summary = json.loads((ev / "summary.json").read_text(encoding="utf-8"))
    assert summary["steps"]["isolation"]["ok"] is False
    assert summary["steps"]["isolation"]["external_plugins"] == ["personal-hooks"]


BUILTIN = {"name": "cc-plugin-telemetry", "path": "builtin", "source": "cc-plugin-telemetry@builtin"}


def test_builtin_plugins_pass_isolation_but_are_recorded(fake, tmp_path, monkeypatch):
    """Shape observed in Claude Code 2.1.310 on Windows, 2026-10-25."""
    fake(edit=True, plugins=[BUILTIN, {**BUILTIN, "name": "cc-plugin-agents-md",
                                       "source": "cc-plugin-agents-md@builtin"}])
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    spec = importlib.util.spec_from_file_location("demo4", ROOT / "scripts" / "demo_claude_connection.py")
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    ev = tmp_path / "evidence"
    monkeypatch.setattr(sys, "argv", ["demo", "--workspace", str(tmp_path / "repo"), "--evidence", str(ev)])
    assert demo.main() == 0
    iso = json.loads((ev / "summary.json").read_text(encoding="utf-8"))["steps"]["isolation"]
    assert iso["ok"] is True and iso["external_plugins"] == []
    assert iso["builtin_plugins"] == ["cc-plugin-telemetry", "cc-plugin-agents-md"]


@pytest.mark.parametrize("plugin", [
    {"name": "x", "path": "builtin", "source": "x@my-marketplace"},     # source not built in
    {"name": "x", "path": "C:/plugins/x", "source": "x@builtin"},       # real path claims built in
    {"name": "x", "source": "x@builtin"},                               # path missing
    "x@builtin",                                                        # unrecognised shape
])
def test_anything_short_of_both_builtin_markers_counts_as_external(plugin):
    assert claude_code.is_builtin_plugin(plugin) is False
    r = claude_code.RunResult(ok=True, exit_code=0, session_id="s", subtype="success", result_text="",
                              num_turns=1, duration_ms=1, cost_estimate_usd=None, permission_denials=[],
                              model=None, plugins=[BUILTIN, plugin])
    assert r.isolated is False and len(r.external_plugins) == 1
    assert claude_code.RunResult(**{**r.__dict__, "plugins": [BUILTIN]}).isolated is True


def test_demo_rejects_a_run_that_does_not_fix_the_bug(fake, tmp_path, monkeypatch):
    fake(edit=False)
    monkeypatch.setattr(claude_code, "default_exe", lambda: FAKE)
    spec = importlib.util.spec_from_file_location("demo2", ROOT / "scripts" / "demo_claude_connection.py")
    demo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(demo)
    ev = tmp_path / "evidence"
    monkeypatch.setattr(sys, "argv", ["demo", "--workspace", str(tmp_path / "repo"), "--evidence", str(ev)])
    assert demo.main() == 1
    summary = json.loads((ev / "summary.json").read_text(encoding="utf-8"))
    assert summary["result"] == "FAIL" and summary["steps"]["tests_after"]["ok"] is False
