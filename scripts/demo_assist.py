"""The dashboard's single prompt with the REAL Claude Code CLI, outside the UI.

Four different requests go through the same box, and each must get only the steps it needs:
  1. a simple question          -> one Claude answer; no review, no second AI, nothing built, nobody asked anything
  2. a piece of writing         -> one Claude draft
  3. a question needing the web -> Claude answers, and a Perplexity step is OFFERED (never claimed as done)
  4. a change to a project      -> the whole path: build, your check (you approve), independent review, result

Everything is a pass/fail check. State goes to its own database under the evidence folder; your real AIOS data is untouched.
It uses your Claude subscription (about five short turns plus a review). It never uses an API key.

Usage (Windows, from the AIOS folder):
    .\\.venv\\Scripts\\python.exe scripts\\demo_assist.py --auto-approve --model sonnet
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from aios import assist, claude_code, conversations, providers, services, workflow  # noqa: E402
from aios.config import Settings  # noqa: E402
from aios.db import Database  # noqa: E402
from aios.engine import Engine  # noqa: E402
from aios.executors import claude_review, claude_turn  # noqa: E402,F401
from aios.security import redact  # noqa: E402

FILES = {"greeting.py": "def greeting(name):\n    return 'Hi ' + name\n", ".gitignore": "__pycache__/\n",
         "test_greeting.py": "import unittest\nfrom greeting import greeting\n\n\nclass T(unittest.TestCase):\n    def test_greeting(self):\n        self.assertEqual(greeting('Ann'), 'Hello, Ann!')\n"}
CHECK = [sys.executable, "-B", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"]


def git(repo: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--auto-approve", action="store_true", help="approve the check run without asking (disposable repo only)")
    ap.add_argument("--model", default=None)
    ap.add_argument("--keep-going", action="store_true")
    a = ap.parse_args()
    workspaces = Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces"))
    state_root = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    evidence = (state_root / "evidence" / f"assist-demo-{stamp}").resolve()
    repo = (workspaces / f"assist-demo-{stamp}").resolve()
    settings = Settings(state_dir=evidence / "state", workspaces_dir=workspaces)
    settings.ensure_dirs()
    checks: list[dict] = []
    summary: dict = {"started_at": stamp, "evidence": str(evidence), "checks": checks, "tasks": {}}

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
    print(f"Claude Code {pf.version}, signed in via {pf.auth_method}, plan {pf.plan}\n", flush=True)
    summary["provider"] = pf.public()

    repo.mkdir(parents=True)
    for rel, text in FILES.items():
        (repo / rel).write_text(text, encoding="utf-8")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=aios-demo", "-c", "user.email=demo@localhost", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed")
    greeting_before = (repo / "greeting.py").read_text(encoding="utf-8")

    db = Database(settings.db_path)
    db.migrate()
    engine = Engine(settings, db)
    providers.discover(db)
    proj = services.register_project(db, settings, "Greeter", str(repo))
    conversations.set_verify_command(db, proj["id"], CHECK)
    approvals_given: list[dict] = []
    seen: dict[str, int] = {}

    def drive(run_id: str) -> None:
        t = threading.Thread(target=lambda: engine.execute(run_id), daemon=True)
        t.start()
        while t.is_alive():
            for e in db.query("SELECT id, kind, message FROM run_events WHERE run_id=? AND id>? ORDER BY id", (run_id, seen.get(run_id, 0))):
                seen[run_id] = e["id"]
                if e["kind"] in ("claude", "provider") and "says" not in e["message"]:
                    print(f"      {e['message'][:110]}", flush=True)
            time.sleep(0.5)

    def run_task(prompt: str, project_id: str | None = None, kind: str | None = None) -> dict:
        print(f"\n--- {prompt[:90]}", flush=True)
        v = assist.create(db, engine, settings, prompt, project_id, kind)
        end = time.time() + 1800
        while time.time() < end:
            workflow.advance_all(db, engine)
            v = assist.view(db, v["id"])
            if v["state"] in ("done", "failed", "needs_you", "cancelled"):
                break
            queued = db.one("SELECT r.id FROM runs r JOIN conversation_messages m ON m.run_id=r.id WHERE m.conversation_id=? AND r.state='queued' ORDER BY r.created_at LIMIT 1", (v["conversation_id"],))
            if queued:
                drive(queued["id"])
                continue
            pend = db.query("SELECT a.* FROM approvals a JOIN conversation_messages m ON m.run_id=a.run_id WHERE m.conversation_id=? AND a.status='pending' GROUP BY a.id", (v["conversation_id"],))
            if pend:
                action = json.loads(pend[0]["action_json"])
                print("  APPROVAL REQUESTED:", pend[0]["summary"][:120], flush=True)
                ok = a.auto_approve or input("  Type APPROVE to run this exact command (anything else rejects): ").strip() == "APPROVE"
                engine.decide_approval(pend[0]["id"], ok, "demo", confirm_destructive=ok)
                approvals_given.append({"type": action.get("type"), "approved": ok})
                continue
            time.sleep(0.5)
        v = assist.view(db, v["id"])
        print(f"  -> {v['kind']} / {v['state']}; steps: " + ", ".join(f"{s['id']}={s['status']}" for s in v["steps"]), flush=True)
        summary["tasks"][prompt[:40]] = {"kind": v["kind"], "state": v["state"], "steps": {s["id"]: s["status"] for s in v["steps"]}}
        return v

    def statuses(v: dict) -> dict:
        return {s["id"]: s["status"] for s in v["steps"]}

    # 1. a simple question
    before = len(approvals_given)
    v1 = run_task("What is the capital of Australia?")
    conv1 = conversations.get(db, v1["conversation_id"])
    check("a simple question is answered", v1["kind"] == "answer" and v1["state"] == "done" and "Canberra" in (v1["answer"] or {}).get("text", ""), (v1.get("answer") or {}).get("text", "")[:120])
    check("...with no review, no second AI and nothing built", statuses(v1) == {"understand": "done", "answer": "done", "second_look": "skipped", "build": "skipped"} and v1["workflow_id"] is None, statuses(v1))
    check("...no workspace copy was made and nobody was asked anything", conv1["worktree_path"] is None and len(approvals_given) == before)

    # 2. writing
    v2 = run_task("Write a two sentence thank-you note to my neighbour for watering my plants.")
    check("a request to write something is a draft, not a build", v2["kind"] == "write" and v2["state"] == "done" and len((v2["answer"] or {}).get("text", "")) > 20 and statuses(v2)["build"] == "skipped", statuses(v2))

    # 3. something that needs the web
    v3 = run_task("What are the best budget laptops for students in 2026?")
    check("a question needing current facts is answered, and a Perplexity step is offered, not claimed", v3["kind"] == "research" and v3["state"] == "done" and statuses(v3)["lookup"] == "offer", statuses(v3))
    sug = {i["id"] for i in __import__("aios.companion", fromlist=["x"]).suggestions(db, settings, "perplexity", v3["conversation_id"])["items"]}
    check("...and the prompt for it is ready, built from the question", {"research", "fact_check"} <= sug, sug)

    # 4. a change to a project
    v4 = run_task("Change greeting so it returns 'Hello, ' plus the name plus an exclamation mark. Do not edit the tests.", project_id=proj["id"])
    check("a request to change a project gets the whole path", v4["kind"] == "build" and v4["workflow_id"], v4["kind"])
    check("...the check was approved by you before it ran", len(approvals_given) >= 1 and all(x["type"] == "run_verification" and x["approved"] for x in approvals_given), approvals_given)
    check("...it ended ready, with a separate review", v4["state"] == "done" and statuses(v4)["review"] == "done" and statuses(v4)["result"] == "done", statuses(v4))
    check("...and nothing was merged into the project", (repo / "greeting.py").read_text(encoding="utf-8") == greeting_before and git(repo, "status", "--porcelain").strip() == "")

    dash = assist.dashboard(db, settings)
    check("the dashboard lists the four tasks and the four agents", len(dash["recent"]) == 4 and [x["id"] for x in dash["agents"]] == ["claude", "gemini", "perplexity", "antigravity"])
    check("Antigravity is shown as manual and was never started", {x["id"]: x["status"] for x in dash["agents"]}["antigravity"] == "manual")
    summary["quota_after"] = dash["agents"][0]["quota"]
    (evidence / "dashboard.json").write_text(redact(json.dumps(dash, indent=2, default=str)), encoding="utf-8")
    finish()
    return 0 if summary["result"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
