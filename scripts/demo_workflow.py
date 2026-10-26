"""The end-to-end workflow with the REAL Claude Code CLI, outside the UI.

One request goes through: implement -> your check (approved by you) -> independent review -> corrections -> re-check ->
re-review -> result -> knowledge candidates. The request (a function that reads a file from a notes folder) invites a
classic mistake, reading outside the folder with "../", which tests tend not to catch and a reviewer can. How many
corrections it takes is reported, not assumed: zero is a fine outcome.

Each point is a pass/fail check: the project folder is never touched, the check is approved before every run, the review
is a separate session, AIOS (not a model) decides readiness, correction requests are AIOS-authored and never mined for
memories, and nothing is approved or merged without you.

State goes to its own database under the evidence folder. It uses your Claude subscription (a few short turns plus
reviews). It never uses an API key.

Usage (Windows, from the AIOS folder):
    .\\.venv\\Scripts\\python.exe scripts\\demo_workflow.py --auto-approve --model sonnet
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from aios import claude_code, conversations, providers, services, workflow  # noqa: E402
from aios.config import Settings  # noqa: E402
from aios.db import Database  # noqa: E402
from aios.engine import Engine  # noqa: E402
from aios.executors import claude_review, claude_turn  # noqa: E402,F401  (registers claude.turn and claude.review)
from aios.security import redact  # noqa: E402

DURATION_TESTS = '''import unittest

from duration import parse_duration


class ParseDuration(unittest.TestCase):
    def test_single_units(self):
        for text, secs in [("90s", 90), ("5m", 300), ("2h", 7200), ("1d", 86400), ("0s", 0)]:
            self.assertEqual(parse_duration(text), secs, text)

    def test_combined_units_spaces_and_case(self):
        for text, secs in [("1h30m", 5400), ("1h 30m 15s", 5415), (" 2m ", 120), ("1H30M", 5400), ("1d2h3m4s", 93784)]:
            self.assertEqual(parse_duration(text), secs, text)

    def test_fractions(self):
        self.assertEqual(parse_duration("1.5h"), 5400)
        self.assertEqual(parse_duration("0.5s"), 0.5)

    def test_bad_input_raises_value_error(self):
        for text in ["", "   ", "abc", "5", "5x", "1h30", "-5s", "1h1h", "h", "1..5h", "1 h"]:
            with self.assertRaises(ValueError, msg=repr(text)):
                parse_duration(text)


if __name__ == "__main__":
    unittest.main()
'''
CONVENTION_TESTS = '''import inspect
import unittest

import duration


class Conventions(unittest.TestCase):
    """House rules for this project's modules."""

    def test_no_regular_expressions(self):
        self.assertNotIn("import re", inspect.getsource(duration))

    def test_public_names_are_declared(self):
        self.assertEqual(duration.__all__, ["parse_duration"])

    def test_the_function_documents_an_example(self):
        self.assertIn("Example", inspect.getdoc(duration.parse_duration) or "")


if __name__ == "__main__":
    unittest.main()
'''
SCENARIOS = {
    "notes": {
        "files": {"notes/hello.txt": "hello from the notes folder\n", ".gitignore": "__pycache__/\n",
                  "test_basic.py": "import unittest\n\n\nclass Basic(unittest.TestCase):\n    def test_truth(self):\n        self.assertTrue(True)\n"},
        "request": ("Add a function read_note(name) in a new file notes_api.py. It returns the text of the file notes/<name>.txt, where "
                    "the notes folder sits next to notes_api.py. Add a unittest for it in test_notes_api.py. Keep it simple."),
        "baseline_passes": True, "new_file": "notes_api.py", "title": "Add read_note",
    },
    "duration": {
        "files": {"duration.py": "def parse_duration(text):\n    raise NotImplementedError\n", "test_duration.py": DURATION_TESTS, ".gitignore": "__pycache__/\n"},
        "request": "Implement parse_duration(text) in duration.py so that every test in test_duration.py passes. Do not modify the tests.",
        "baseline_passes": False, "new_file": None, "title": "Implement parse_duration",
    },
    "duration_rules": {      # the same task, plus house rules enforced by a second test file that the request does not mention
        "files": {"duration.py": "def parse_duration(text):\n    raise NotImplementedError\n", "test_duration.py": DURATION_TESTS,
                  "test_conventions.py": CONVENTION_TESTS, ".gitignore": "__pycache__/\n"},
        "request": "Implement parse_duration(text) in duration.py so that every test in test_duration.py passes. Do not modify the tests.",
        "baseline_passes": False, "new_file": None, "title": "Implement parse_duration",
    },
}
FILES: dict = {}
CHECK = [sys.executable, "-B", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"]
REQUEST = ""

def git(repo: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unittest_run(cwd: Path) -> bool:
    return subprocess.run(CHECK, cwd=cwd, capture_output=True, timeout=120).returncode == 0


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--auto-approve", action="store_true", help="approve each check run without asking (disposable repo only)")
    ap.add_argument("--model", default=None, help="Claude model alias, e.g. sonnet (default: account default)")
    ap.add_argument("--max-rounds", type=int, default=2)
    ap.add_argument("--scenario", choices=sorted(SCENARIOS), default="notes", help="what to ask for")
    ap.add_argument("--keep-going", action="store_true", help="do not stop at the first failed check")
    a = ap.parse_args()
    global FILES, REQUEST
    sc = SCENARIOS[a.scenario]
    FILES, REQUEST = sc["files"], sc["request"]

    workspaces = Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces"))
    state_root = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    evidence = (state_root / "evidence" / f"workflow-demo-{stamp}").resolve()
    repo = (workspaces / f"workflow-demo-{stamp}").resolve()
    settings = Settings(state_dir=evidence / "state", workspaces_dir=workspaces)
    settings.ensure_dirs()
    checks: list[dict] = []
    summary: dict = {"started_at": stamp, "repo": str(repo), "evidence": str(evidence), "checks": checks}

    def finish() -> None:
        summary["result"] = "PASS" if all(c["ok"] for c in checks) else "FAIL"
        (evidence / "summary.json").write_text(redact(json.dumps(summary, indent=2, default=str)), encoding="utf-8")
        print(f"\n{summary['result']}. Evidence: {evidence}", flush=True)

    def check(name: str, ok: bool, detail=None) -> bool:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'OK  ' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""), flush=True)
        if not ok and not a.keep_going:
            finish()
            raise SystemExit(1)
        return bool(ok)

    try:
        pf = claude_code.preflight()
    except claude_code.ClaudeUnavailable as e:
        print(f"[FAIL] Claude Code is not usable: {e}")
        return 2
    summary["provider"] = pf.public()
    print(f"Claude Code {pf.version}, signed in via {pf.auth_method}, plan {pf.plan}\n", flush=True)

    repo.mkdir(parents=True)
    for rel, text in FILES.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(text, encoding="utf-8")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=aios-demo", "-c", "user.email=demo@localhost", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed")
    before = {rel: sha(repo / rel) for rel in FILES}
    check("baseline: the starting project " + ("passes its own check" if sc["baseline_passes"] else "fails its check (there is work to do)"),
          unittest_run(repo) == sc["baseline_passes"])

    db = Database(settings.db_path)
    db.migrate()
    engine = Engine(settings, db)
    providers.discover(db)
    proj = services.register_project(db, settings, "Workflow demo", str(repo))
    conversations.set_verify_command(db, proj["id"], CHECK)
    conv = conversations.create(db, project_id=proj["id"], title=sc["title"], model=a.model)

    seen: dict[str, int] = {}

    def drive(run_id: str) -> None:
        t = threading.Thread(target=lambda: engine.execute(run_id), daemon=True)
        t.start()
        while t.is_alive():
            for e in db.query("SELECT id, kind, message FROM run_events WHERE run_id=? AND id>? ORDER BY id", (run_id, seen.get(run_id, 0))):
                seen[run_id] = e["id"]
                if e["kind"] in ("claude", "provider") or (e["kind"] == "state" and "->" in e["message"]):
                    print(f"      {e['kind']}: {e['message']}", flush=True)
            time.sleep(0.5)

    started = workflow.start(db, engine, conv["id"], REQUEST, "build_and_check", a.max_rounds)
    wid = started["id"]
    print(f"\n--- workflow {wid} started: {REQUEST[:80]}", flush=True)
    approvals_given: list[dict] = []
    done = set()
    deadline = time.time() + 3600
    while time.time() < deadline:
        workflow.advance(db, engine, wid)
        wf = workflow.view_by_id(db, wid)
        if wf["state"] in ("finished", "cancelled"):
            break
        for s in wf["steps"]:
            if (s["id"], s["status"]) not in done and s["status"] != "running":
                done.add((s["id"], s["status"]))
                print(f"  step done: {s['kind']} (round {s['round']}) {s['summary'] or ''}", flush=True)
        run = wf["current_run"]
        if not run:
            time.sleep(0.5)
            continue
        if run["state"] == "queued":
            drive(run["id"])
        elif run["state"] == "awaiting_approval":
            pend = db.query("SELECT * FROM approvals WHERE run_id=? AND status='pending'", (run["id"],))
            if len(pend) != 1:
                time.sleep(0.5)
                continue
            action = json.loads(pend[0]["action_json"])
            print("  APPROVAL REQUESTED:", pend[0]["summary"], flush=True)
            ok = a.auto_approve or input("  Type APPROVE to run this exact command (anything else rejects): ").strip() == "APPROVE"
            if a.auto_approve:
                print("  --auto-approve given: approving this exact action for the disposable repo.", flush=True)
            engine.decide_approval(pend[0]["id"], ok, "demo", confirm_destructive=ok)
            approvals_given.append({"type": action.get("type"), "approved": ok})
        else:
            time.sleep(0.5)
    wf = workflow.view_by_id(db, wid)
    print(f"\nWORKFLOW {wf['outcome']}: {wf['outcome_reason']}", flush=True)

    kinds = [s["kind"] for s in wf["steps"]]
    summary["workflow"] = {k: wf[k] for k in ("outcome", "outcome_reason", "round", "max_rounds")} | {"steps": [(s["kind"], s["round"], s["summary"]) for s in wf["steps"]]}
    check("the workflow ended on its own", wf["state"] == "finished", wf["state"])
    check("the result is READY", wf["outcome"] == "ready", wf["outcome_reason"])
    print(f"corrections used: {wf['round']} of {wf['max_rounds']}; steps: {kinds}", flush=True)
    check("an independent review ran after the final check", "review" in kinds and kinds.index("review") > kinds.index("implement"), kinds)
    check("you were asked to approve the check every time it ran, and it was always the verification command",
          len(approvals_given) == 1 + wf["round"] and all(x["type"] == "run_verification" and x["approved"] for x in approvals_given), approvals_given)

    ch = conversations.changes(db, conv["id"])
    rd = ch["readiness"]
    check("AIOS (not a model) says ready: the check passed on the final revision and the final review has no high-severity findings",
          rd["ready"] and rd["verified"] is True and rd["reviewed"] and rd["high_findings"] == 0, rd)
    rv = ch["review"]["meta"]["review"]
    check("the final review came from a fresh session, separate from the writer's", rv["separate_session"], rv["session_id"])
    check("the project folder is byte-for-byte untouched and nothing was merged",
          {rel: sha(repo / rel) for rel in FILES} == before and git(repo, "status", "--porcelain").strip() == ""
          and not (sc["new_file"] and (repo / sc["new_file"]).exists()))
    wt = Path(conversations.get(db, conv["id"])["worktree_path"])
    check("the final worktree really passes the tests, re-run independently by this script", unittest_run(wt))

    msgs = conversations.messages(db, conv["id"])
    fixes = [m for m in msgs if "Workflow correction round" in m["content"]]
    check("any correction requests were written by AIOS, not typed by you", len(fixes) == wf["round"] and all(m["author_kind"] == "aios" for m in fixes))
    check("the workflow left a plain-words result in the conversation",
          any(m["kind"] == "status" and "Workflow result: READY" in m["content"] and "Nothing has been merged" in m["content"] for m in msgs))

    cands = db.query("SELECT title FROM memories WHERE status='candidate' AND deleted=0")
    approved = db.query("SELECT 1 FROM memories WHERE status='approved' AND deleted=0")
    check("knowledge was proposed as candidates only, and nothing was approved for you", bool(cands) and not approved, [c["title"] for c in cands])
    summary["candidates"] = [c["title"] for c in cands]

    status = conversations.status_block(db, conversations.get(db, conv["id"]))
    summary["quota_after"] = status["quota"]
    (evidence / "conversation.json").write_text(redact(json.dumps(conversations.view(db, conv["id"]), indent=2, default=str)), encoding="utf-8")
    finish()
    print("\n=== Conversation as stored ===")
    for m in msgs:
        print(f"[{m['seq']}] {m['author_kind']}/{m['kind']} ({m['author']})\n    " + redact(m["content"]).strip().replace("\n", "\n    ")[:500], flush=True)
    return 0 if summary["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
