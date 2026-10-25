"""Smallest real Claude Code connection, outside the UI (course-correction Step 2).

What it does, in order:
 1. Checks the official Claude Code client: version, and that it is signed in with a claude.ai
    subscription (never an API key). Prints only non-secret fields.
 2. Creates a disposable git repository with a deliberate bug and a failing unit test.
 3. Runs the tests (expected to fail) to record a baseline.
 4. Starts Claude Code in print mode inside that repository, allowed to read and edit files only
    (no shell, web, or MCP), and asks it to fix the bug without touching the tests.
 5. Records the real patch (git diff), refuses the result if anything besides calc.py changed.
 6. Runs the same tests again. AIOS decides pass/fail, not the model.
 7. Resumes the same Claude session, read-only, to prove the conversation continues.
 8. Writes evidence (summary JSON, patch, redacted transcripts, test output) and exits 0 only if
    every step passed.

Usage (Windows, from the AIOS folder):
    .\\.venv\\Scripts\\python.exe scripts\\demo_claude_connection.py
    .\\.venv\\Scripts\\python.exe scripts\\demo_claude_connection.py --dry-run

This uses your Claude subscription for two short turns. It never uses an API key.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from aios import claude_code  # noqa: E402
from aios.security import redact  # noqa: E402

CALC = '''def add(a, b):
    return a - b


def multiply(a, b):
    return a * b
'''

TESTS = '''import unittest

from calc import add, multiply


class CalcTests(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_multiply(self):
        self.assertEqual(multiply(4, 5), 20)


if __name__ == "__main__":
    unittest.main()
'''

FIX_PROMPT = ("The unit tests in test_calc.py fail. Fix the bug in calc.py so they pass. "
              "Do not modify test_calc.py. Keep the change as small as possible, then reply "
              "with one short paragraph describing the change.")
FOLLOW_UP = "In one sentence, which function did you change and why?"


def git(repo: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def run_tests(repo: Path) -> dict:
    # -B: no bytecode cache. A same-size edit within one second would otherwise reuse the stale
    # compiled module and verify the old code.
    p = subprocess.run([sys.executable, "-B", "-m", "unittest", "-v", "test_calc"], cwd=repo,
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=120)
    return {"command": "python -B -m unittest -v test_calc", "exit_code": p.returncode,
            "passed": p.returncode == 0, "output": (p.stdout + p.stderr)[-6000:]}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=False)
    (repo / "calc.py").write_text(CALC, encoding="utf-8")
    (repo / "test_calc.py").write_text(TESTS, encoding="utf-8")
    (repo / "README.md").write_text("# AIOS Claude demo\n\nDisposable repository.\n",
                                    encoding="utf-8")
    (repo / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", ".")
    git(repo, "-c", "user.name=aios-demo", "-c", "user.email=demo@localhost",
        "commit", "-q", "-m", "seed: failing test")


def main() -> int:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workspace", type=Path, help="where to create the disposable repo")
    ap.add_argument("--evidence", type=Path, help="where to write evidence")
    ap.add_argument("--max-turns", type=int, default=8)
    ap.add_argument("--timeout", type=int, default=600, help="seconds per Claude run")
    ap.add_argument("--dry-run", action="store_true", help="check the client and print the "
                    "exact command, without starting a Claude run")
    a = ap.parse_args()

    workspaces = Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces"))
    state = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    repo = (a.workspace or workspaces / f"claude-demo-{stamp}").resolve()
    evidence = (a.evidence or state / "evidence" / f"claude-demo-{stamp}").resolve()
    summary: dict = {"started_at": stamp, "workspace": str(repo), "steps": {}}

    def step(name: str, data: dict) -> None:
        summary["steps"][name] = data
        flag = "OK  " if data.get("ok", True) else "FAIL"
        print(f"[{flag}] {name}")

    # 1. Official client check.
    try:
        pf = claude_code.preflight()
    except claude_code.ClaudeUnavailable as e:
        print(f"[FAIL] preflight: {e}")
        return 2
    step("preflight", {"ok": True, **pf.public()})
    print(f"       Claude Code {pf.version}, signed in via {pf.auth_method}, plan {pf.plan}")

    if a.dry_run:
        cmd = claude_code.build_command(pf.exe, FIX_PROMPT, mode="edit", max_turns=a.max_turns)
        print("\nCommand AIOS would run inside the disposable repo:\n  " +
              subprocess.list2cmdline(cmd))
        return 0

    evidence.mkdir(parents=True, exist_ok=True)

    # 2-3. Disposable repo and baseline.
    make_repo(repo)
    base_rev = git(repo, "rev-parse", "HEAD").strip()
    test_hash = sha256(repo / "test_calc.py")
    baseline = run_tests(repo)
    step("baseline_tests", {"ok": not baseline["passed"], "revision": base_rev, **baseline,
                            "expected": "fail"})
    (evidence / "tests-before.txt").write_text(baseline["output"], encoding="utf-8")

    # 4. Real Claude Code run, edit mode.
    print("       Running Claude Code (edit mode, no shell)... this can take a minute.")
    fix = claude_code.run(repo, FIX_PROMPT, exe=pf.exe, mode="edit", max_turns=a.max_turns,
                          timeout_s=a.timeout, transcript=evidence / "claude-fix.jsonl")
    step("claude_fix", fix.summary())
    if fix.stderr:
        (evidence / "claude-fix.stderr.txt").write_text(fix.stderr, encoding="utf-8")

    # 5. Real patch, scope check.
    changed = sorted({ln[3:].strip() for ln in git(repo, "status", "--porcelain").splitlines()
                      if ln.strip()})
    patch = git(repo, "diff", base_rev)
    (evidence / "change.patch").write_text(patch, encoding="utf-8")
    in_scope = changed == ["calc.py"] and sha256(repo / "test_calc.py") == test_hash
    step("patch", {"ok": in_scope and bool(patch), "base_revision": base_rev,
                   "changed_files": changed, "tests_untouched":
                   sha256(repo / "test_calc.py") == test_hash,
                   "patch_sha256": hashlib.sha256(patch.encode()).hexdigest(),
                   "patch_lines": len(patch.splitlines())})

    # 6. Verification by AIOS.
    after = run_tests(repo)
    step("tests_after", {"ok": after["passed"], **after})
    (evidence / "tests-after.txt").write_text(after["output"], encoding="utf-8")

    # 7. Same conversation, read-only follow-up.
    follow = None
    if fix.session_id:
        follow = claude_code.run(repo, FOLLOW_UP, exe=pf.exe, mode="read", max_turns=2,
                                 timeout_s=a.timeout, resume=fix.session_id,
                                 transcript=evidence / "claude-follow-up.jsonl")
        step("claude_follow_up", {**follow.summary(),
                                  "ok": follow.ok and follow.session_id == fix.session_id,
                                  "same_session": follow.session_id == fix.session_id})
    else:
        step("claude_follow_up", {"ok": False, "reason": "no session id from the first run"})

    # 8. Evidence.
    all_ok = all(s.get("ok", True) for s in summary["steps"].values())
    summary["result"] = "PASS" if all_ok else "FAIL"
    (evidence / "summary.json").write_text(redact(json.dumps(summary, indent=2)),
                                           encoding="utf-8")
    print(f"\n{summary['result']}. Evidence: {evidence}")
    if fix.result_text:
        print(f"\nClaude said: {redact(fix.result_text)[:800]}")
    if follow and follow.result_text:
        print(f"Follow-up: {redact(follow.result_text)[:400]}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
