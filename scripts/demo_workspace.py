"""Step 3 end to end with the REAL Claude Code CLI, outside the UI.

What it proves, each as a pass/fail check:
  1. Project selection: a disposable git repo with a planted bug is registered as a project.
  2. Context from AIOS: an approved project note carrying a made-up rule id is stored in AIOS memory;
     Claude is asked (read-only turn) which rules AIOS gave it, and must quote that rule id. The
     context items supplied to the run are recorded with versions and hashes.
  3. A real supported interaction: three turns in ONE conversation (same Claude session, resumed).
  4. Isolation: Claude reports exactly the allowed tools, no plugins other than the ones built into
     Claude Code, no MCP servers, and API key source "none". Edits happen in a git worktree; the
     registered project folder is byte-for-byte untouched.
  5. A real patch artifact at a pinned base and head revision, changing only calc.py.
  6. Approval-gated verification: the exact command is shown, you approve it (or --auto-approve),
     AIOS runs it, and the real output is stored. The verdict is AIOS's, not the model's.
  7. Persisted, attributed messages (user / provider / aios), re-read from a fresh DB connection.
  8. Honest status: provider, session, permissions and the real subscription quota.

State goes to its own database under the evidence folder, so your real AIOS data is untouched.
It uses your Claude subscription for three short turns. It never uses an API key.

Usage (Windows, from the AIOS folder):
    .\\.venv\\Scripts\\python.exe scripts\\demo_workspace.py            (asks you to approve the test run)
    .\\.venv\\Scripts\\python.exe scripts\\demo_workspace.py --auto-approve --model sonnet
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

from aios import approvals, claude_code, context_pack, conversations, memory, providers, services  # noqa: E402
from aios.config import Settings  # noqa: E402
from aios.db import Database  # noqa: E402
from aios.engine import Engine  # noqa: E402
from aios.executors import claude_turn  # noqa: E402,F401  (registers the claude.turn executor)
from aios.security import redact  # noqa: E402

RULE_ID = "CALC-RULE-7"
CALC = "def add(a, b):\n    return a - b\n\n\ndef multiply(a, b):\n    return a * b\n"
TESTS = ('import unittest\n\nfrom calc import add, multiply\n\n\nclass CalcTests(unittest.TestCase):\n'
         '    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n\n'
         '    def test_multiply(self):\n        self.assertEqual(multiply(4, 5), 20)\n\n\n'
         'if __name__ == "__main__":\n    unittest.main()\n')

Q_CONTEXT = (f"Which project rules did AIOS give you that apply to calc.py? Quote each rule's id exactly and "
             "summarise it in one line. If AIOS gave you none, say NONE.")
Q_EDIT = ("The unit tests in test_calc.py fail. Fix the bug in calc.py so they pass. Do not modify "
          "test_calc.py. Keep the change as small as possible, follow any project rules you were given, "
          "then describe what you changed in one short paragraph.")
Q_FOLLOW = "In one sentence: which function did you change, and what rule (if any) did you keep to?"


def git(repo: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unittest_run(cwd: Path) -> tuple[bool, str]:
    p = subprocess.run([sys.executable, "-B", "-m", "unittest", "test_calc"], cwd=cwd, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=120)
    return p.returncode == 0, (p.stdout + p.stderr)[-1500:]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):      # Claude's replies contain characters a console may not encode
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--auto-approve", action="store_true",
                    help="approve the verification run without asking (disposable repo only)")
    ap.add_argument("--model", default=None, help="Claude model alias, e.g. sonnet (default: account default)")
    ap.add_argument("--keep-going", action="store_true", help="do not stop at the first failed check")
    a = ap.parse_args()

    workspaces = Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces"))
    state_root = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    evidence = (state_root / "evidence" / f"workspace-demo-{stamp}").resolve()
    repo = (workspaces / f"workspace-demo-{stamp}").resolve()
    settings = Settings(state_dir=evidence / "state", workspaces_dir=workspaces)
    settings.ensure_dirs()
    checks: list[dict] = []
    summary: dict = {"started_at": stamp, "repo": str(repo), "evidence": str(evidence), "checks": checks}

    def check(name: str, ok: bool, detail=None) -> bool:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(f"[{'OK  ' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""), flush=True)
        if not ok and not a.keep_going:
            finish()
            raise SystemExit(1)
        return bool(ok)

    def finish() -> None:
        summary["result"] = "PASS" if all(c["ok"] for c in checks) else "FAIL"
        (evidence / "summary.json").write_text(redact(json.dumps(summary, indent=2, default=str)), encoding="utf-8")
        print(f"\n{summary['result']}. Evidence: {evidence}", flush=True)

    # ---- provider
    try:
        pf = claude_code.preflight()
    except claude_code.ClaudeUnavailable as e:
        print(f"[FAIL] Claude Code is not usable: {e}")
        return 2
    summary["provider"] = pf.public()
    print(f"Claude Code {pf.version}, signed in via {pf.auth_method}, plan {pf.plan}\n", flush=True)

    # ---- disposable repo with a planted bug
    repo.mkdir(parents=True)
    (repo / "calc.py").write_text(CALC, encoding="utf-8")
    (repo / "test_calc.py").write_text(TESTS, encoding="utf-8")
    (repo / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=aios-demo", "-c", "user.email=demo@localhost", "-c", "commit.gpgsign=false",
        "commit", "-q", "-m", "seed: failing test")
    base_rev = git(repo, "rev-parse", "HEAD").strip()
    calc_before, tests_before = sha(repo / "calc.py"), sha(repo / "test_calc.py")
    passed, out = unittest_run(repo)
    check("baseline: the planted bug makes the tests fail", not passed, out)

    # ---- AIOS: project, memory, verification command, conversation
    db = Database(settings.db_path)
    db.migrate()
    engine = Engine(settings, db)
    providers.discover(db)
    proj = services.register_project(db, settings, "Calc demo", str(repo))
    argv = [sys.executable, "-B", "-m", "unittest", "test_calc"]
    conversations.set_verify_command(db, proj["id"], argv)
    mem_id = memory.create(db, settings, scope="project", type="decision", project_id=proj["id"],
                           title="calc.py conventions", status="approved",
                           body=f"{RULE_ID}: every function in calc.py takes two integers and returns an "
                                "integer. Fixes must be minimal and must not add imports.")
    conv = conversations.create(db, project_id=proj["id"], title="Fix calc.py", model=a.model)
    check("project registered, verification command set by the owner, approved note stored", True)

    seen_events: dict[str, int] = {}

    def drive(run_id: str) -> str:
        """Execute the run on a worker thread and print its live activity."""
        result: dict = {}
        t = threading.Thread(target=lambda: result.setdefault("state", engine.execute(run_id)), daemon=True)
        t.start()
        while True:
            last = seen_events.get(run_id, 0)
            for e in db.query("SELECT id, kind, message FROM run_events WHERE run_id=? AND id>? ORDER BY id",
                              (run_id, last)):
                seen_events[run_id] = e["id"]
                if e["kind"] in ("claude", "provider") or (e["kind"] == "state" and "->" in e["message"]):
                    print(f"      {e['kind']}: {e['message']}", flush=True)
            if not t.is_alive():
                break
            time.sleep(0.5)
        return result["state"]

    def turn(text: str, mode: str) -> tuple[str, dict]:
        posted = conversations.post_user_message(db, engine, conv["id"], text, mode)
        rid = posted["run"]["id"]
        print(f"\n--- turn ({mode}): {text[:90]}", flush=True)
        return drive(rid), {"run_id": rid}

    def last_reply() -> dict | None:
        rows = [m for m in conversations.messages(db, conv["id"]) if m["author_kind"] == "provider"]
        return rows[-1] if rows else None

    # ---- turn 1: does AIOS context reach Claude? (read-only)
    state, t1 = turn(Q_CONTEXT, "read")
    check("turn 1 (read-only) completed", state == "succeeded", state)
    reply1 = last_reply()
    meta1 = reply1["meta"]["turn"]
    check("Claude quoted the rule id AIOS supplied (context reached the provider)",
          RULE_ID in reply1["content"], reply1["content"][:300])
    check("context supplied was recorded with the approved note's id and version",
          any(r["kind"] == "memory" and r["ref"] == mem_id and r["version"] for r in
              context_pack.supplied_for_run(db, t1["run_id"])))
    check("tools Claude reported are exactly the read-only allowlist",
          sorted(meta1["tools"]) == sorted(claude_code.READ_TOOLS) and not meta1["unexpected_tools"],
          meta1["tools"])
    check("no API key in use, no external plugins, no MCP servers",
          meta1["api_key_source"] == "none" and not meta1["external_plugins"] and not meta1["mcp_servers"], meta1)
    check("a read turn does not create a worktree", conversations.get(db, conv["id"])["worktree_path"] is None)
    session1 = conversations.get(db, conv["id"])["session_id"]

    # ---- turn 2: real edit, in a worktree, approval-gated verification
    state, t2 = turn(Q_EDIT, "edit")
    check("turn 2 (edit) paused for an approval before running anything", state == "awaiting_approval", state)
    c = conversations.get(db, conv["id"])
    wt = Path(c["worktree_path"])
    check("edits went to an isolated worktree on branch aios/<conversation>",
          wt.is_dir() and wt.parent == settings.worktrees_dir and c["branch"] == f"aios/{conv['id']}", str(wt))
    check("the registered project folder is untouched",
          sha(repo / "calc.py") == calc_before and sha(repo / "test_calc.py") == tests_before
          and git(repo, "status", "--porcelain").strip() == "")
    check("the worktree contains Claude's fix", "a + b" in (wt / "calc.py").read_text(encoding="utf-8"))
    patch = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "patch")
    pm = patch["meta"]
    check("patch recorded at a pinned base and head revision, changing only calc.py",
          pm["changed"] and [f["path"] for f in pm["files"]] == ["calc.py"] and pm["base_revision"] == base_rev
          and pm["head_revision"] != base_rev and sha(wt / "test_calc.py") == tests_before, pm.get("files"))
    check("the stored patch is exactly what git reports for those revisions",
          services.read_artifact(db, settings, pm["artifact_id"])["content"]
          == subprocess.run(["git", "-C", str(wt), "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M",
                             pm["base_revision"], pm["head_revision"]], capture_output=True, text=False
                            ).stdout.decode("utf-8", errors="replace"))
    pending = db.query("SELECT * FROM approvals WHERE run_id=? AND status='pending'", (t2["run_id"],))
    check("exactly one pending approval, for running the owner's verification command",
          len(pending) == 1 and json.loads(pending[0]["action_json"])["type"] == "run_verification")
    action = json.loads(pending[0]["action_json"])
    review = approvals.describe(action)
    print("\n  APPROVAL REQUESTED:", pending[0]["summary"])
    for line in review["side_effects"]:
        print("   -", line)
    print(f"  patch: +{pm['added']} -{pm['removed']}  {pm['base_revision'][:12]}..{pm['head_revision'][:12]}")
    if a.auto_approve:
        print("  --auto-approve given: approving this exact action for the disposable repo.", flush=True)
        ok = True
    else:
        ok = input("  Type APPROVE to run this exact command (anything else rejects): ").strip() == "APPROVE"
    engine.decide_approval(pending[0]["id"], ok, "demo", confirm_destructive=ok)
    if not ok:
        check("approval rejected: nothing was run", services.run_detail(db, t2["run_id"])["run"]["state"] == "cancelled")
        finish()
        return 1
    state = drive(t2["run_id"])
    check("turn 2 completed after the approval", state == "succeeded", state)
    ver = next(m for m in conversations.messages(db, conv["id"]) if m["kind"] == "verification")
    check("verification ran, was recorded by AIOS (not the model), and passed",
          ver["author_kind"] == "aios" and ver["meta"]["passed"] is True and ver["meta"]["exit_code"] == 0,
          ver["content"][:400])
    check("the same tests also pass when AIOS re-runs them independently in the worktree", unittest_run(wt)[0])
    check("the project folder is still untouched after verification",
          sha(repo / "calc.py") == calc_before and git(repo, "status", "--porcelain").strip() == "")
    reply2 = last_reply()
    check("edit turn used the edit allowlist and stayed isolated",
          sorted(reply2["meta"]["turn"]["tools"]) == sorted(claude_code.EDIT_TOOLS)
          and not reply2["meta"]["turn"]["unexpected_tools"]
          and reply2["meta"]["turn"]["api_key_source"] == "none")

    # ---- turn 3: same session, reading the proposed change
    state, _ = turn(Q_FOLLOW, "read")
    check("turn 3 (read, same conversation) completed", state == "succeeded", state)
    check("all three turns shared one Claude session", conversations.get(db, conv["id"])["session_id"] == session1)

    # ---- persistence: re-read from a fresh connection
    db2 = Database(settings.db_path)
    msgs = conversations.messages(db2, conv["id"])
    shape = {(m["author_kind"], m["kind"]) for m in msgs}
    check("messages persisted with attribution (user, provider, aios patch and verification)",
          {("user", "message"), ("provider", "message"), ("aios", "patch"), ("aios", "verification")} <= shape, shape)
    status = conversations.status_block(db2, conversations.get(db2, conv["id"]))
    check("status reports provider, session, permissions and real subscription quota",
          status["provider"]["name"] == "claude" and status["session"]["resumable"]
          and status["permissions"]["shell"] == "denied" and bool(status["quota"]), status.get("quota"))

    # ---- evidence on disk
    (evidence / "conversation.json").write_text(
        redact(json.dumps(conversations.view(db2, conv["id"]), indent=2, default=str)), encoding="utf-8")
    (evidence / "change.patch").write_text(services.read_artifact(db2, settings, pm["artifact_id"])["content"],
                                           encoding="utf-8")
    (evidence / "verification.txt").write_text(
        services.read_artifact(db2, settings, ver["meta"]["artifact_id"])["content"], encoding="utf-8")
    summary["quota_after"] = status["quota"]
    summary["model"] = meta1.get("model")
    finish()

    print("\n=== Conversation as stored ===")
    for m in msgs:
        head = f"[{m['seq']}] {m['author_kind']}/{m['kind']} ({m['author']})"
        print(head + "\n    " + redact(m["content"]).strip().replace("\n", "\n    ")[:700], flush=True)
    def pct(window: str) -> str:
        u = ((status.get("quota") or {}).get(window) or {}).get("utilization")
        return f"{u:.0%}" if isinstance(u, (int, float)) else "unknown"
    print(f"\nQuota (5h / 7d): {pct('five_hour')} / {pct('seven_day')} of your subscription windows")
    return 0 if summary["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
