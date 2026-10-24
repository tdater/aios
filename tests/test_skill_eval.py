"""The skill evaluator is part of the safety boundary, so it is tested, including that it can actually FAIL a bad skill."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("skill_eval", ROOT / "scripts" / "skill_eval.py")
se = importlib.util.module_from_spec(spec)
sys.modules["skill_eval"] = se
spec.loader.exec_module(se)

SKILLS = sorted(p.parent.name for p in (ROOT / ".claude" / "skills").glob("*/SKILL.md"))
EXPECTED = {"project-onboard", "workflow-audit", "plan-execute-verify", "android-build-verify", "research-handoff",
            "capture-lesson", "propose-skill", "evaluate-improvement", "session-handoff"}


def run(name):
    text = (ROOT / ".claude" / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
    return text, se.evaluate_text(text, name, se.load_evals(name, ROOT / "evals" / "skills"))


def test_all_nine_initial_skills_exist():
    assert set(SKILLS) == EXPECTED


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_each_shipped_skill_passes_structural_evaluation(name):
    _, res = run(name)
    assert [r for r in res if r["status"] == "fail"] == []
    # behavioural cases exist and are honestly reported as NOT executed, never as passed
    beh = [r for r in res if r["case"].startswith("behaviour:")]
    assert len(beh) >= 4 and {r["status"] for r in beh} == {"not_executed"}


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_skill_has_negative_cases_and_ids_match(name):
    ev = json.loads((ROOT / "evals" / "skills" / f"{name}.json").read_text(encoding="utf-8"))
    kinds = [c["kind"] for c in ev["cases"]]
    assert "positive" in kinds and kinds.count("negative") >= 2


def mutate(name, old, new):
    text, _ = run(name)
    assert old in text
    return se.evaluate_text(text.replace(old, new), name, se.load_evals(name, ROOT / "evals" / "skills"))


def failed(res):
    return {r["case"] for r in res if r["status"] == "fail"}


def test_missing_required_section_fails():
    assert "section:Failure / stop conditions" in failed(mutate("capture-lesson", "## Failure / stop conditions", "## Oops"))


def test_unrestricted_shell_fails():
    assert "no-unrestricted-shell" in failed(mutate("capture-lesson", "allowed-tools: Read Grep Bash(curl*)", "allowed-tools: Read Bash PowerShell"))


def test_scoped_shell_is_accepted():
    assert "no-unrestricted-shell" not in failed(mutate("capture-lesson", "allowed-tools: Read Grep Bash(curl*)", "allowed-tools: Read Bash(git status*)"))


@pytest.mark.parametrize("path", ["scripts/claude_guard.py", ".claude/settings.json", "scripts/skill_eval.py"])
def test_skill_that_can_write_protected_policy_files_fails(path):
    res = mutate("capture-lesson", "allowed-tools: Read Grep Bash(curl*)", f"allowed-tools: Read Edit({path})")
    assert f"no-protected-write:{path}" in failed(res)


def test_skill_without_negative_cases_fails(tmp_path):
    text, _ = run("capture-lesson")
    ev = json.loads((ROOT / "evals" / "skills" / "capture-lesson.json").read_text(encoding="utf-8"))
    ev["cases"] = [c for c in ev["cases"] if c["kind"] == "positive"]
    res = se.evaluate_text(text, "capture-lesson", ev)
    assert {"eval-has-negative", "eval-ids-match-skill"} <= failed(res)


def test_missing_eval_file_fails():
    text, _ = run("capture-lesson")
    assert "eval-file-exists" in failed(se.evaluate_text(text, "capture-lesson", None))


def test_name_must_match_directory():
    assert "name-matches-directory" in failed(mutate("capture-lesson", "name: capture-lesson", "name: something-else"))


def test_cli_exit_codes(tmp_path):
    import subprocess
    ok = subprocess.run([sys.executable, str(ROOT / "scripts" / "skill_eval.py")], capture_output=True, text=True)
    assert ok.returncode == 0, ok.stdout
    bad = tmp_path / "bad" / "SKILL.md"
    bad.parent.mkdir()
    bad.write_text("no frontmatter at all")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "skill_eval.py"), str(bad)], capture_output=True, text=True)
    assert r.returncode == 1 and "FAIL" in r.stdout
