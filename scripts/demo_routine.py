"""A daily-widget routine with the REAL Claude Code CLI, outside the UI.

Adds the "Morning briefing" widget from the catalog, runs it once through the single prompt, and checks that Claude answered, the
widget remembers the run, and a receipt was written. It is read-only: nothing is built or changed. It uses your Claude subscription
(one short turn) and never an API key. State goes to its own folder under the evidence directory; your real AIOS data is untouched.

Usage (Windows, from the AIOS folder):
    .\\.venv\\Scripts\\python.exe scripts\\demo_routine.py --model sonnet
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from aios import abilities, assist, claude_code, providers, routines, widgets  # noqa: E402
from aios.config import Settings  # noqa: E402
from aios.db import Database  # noqa: E402
from aios.engine import Engine  # noqa: E402
from aios.executors import claude_review, claude_turn  # noqa: E402,F401


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model", default=None)
    a = ap.parse_args()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    state_root = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    workspaces = Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces"))
    evidence = (state_root / "evidence" / f"routine-demo-{stamp}").resolve()
    settings = Settings(state_dir=evidence / "state", workspaces_dir=workspaces)
    settings.ensure_dirs()
    failures: list[str] = []

    def check(name: str, ok: bool, detail: object = None) -> None:
        print(f"[{'OK  ' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""), flush=True)
        if not ok:
            failures.append(name)

    try:
        pf = claude_code.preflight()
    except claude_code.ClaudeUnavailable as e:
        print(f"[FAIL] Claude Code is not usable: {e}")
        return 2
    print(f"Claude Code {pf.version}, signed in via {pf.auth_method}, plan {pf.plan}\n", flush=True)

    db = Database(settings.db_path)
    db.migrate()
    engine = Engine(settings, db)
    providers.discover(db)
    abilities.set_enabled(db, "widgets", True, True)
    w = widgets.from_catalog(db, "briefing", None, None)
    check("the briefing widget was added from the catalog", w["kind"] == "routine" and w["config"]["when"] == "manual", w)

    started = routines.run(db, engine, settings, w["id"])
    print(f"      started task {started['id']} ({started['kind']})", flush=True)
    end = time.time() + 600
    view = started
    while time.time() < end:
        view = assist.view(db, started["id"])
        if view["state"] in ("done", "failed", "needs_you", "cancelled"):
            break
        queued = db.one("SELECT r.id FROM runs r JOIN conversation_messages m ON m.run_id=r.id WHERE m.conversation_id=? AND r.state='queued' ORDER BY r.created_at LIMIT 1", (view["conversation_id"],))
        if queued:
            t = threading.Thread(target=lambda: engine.execute(queued["id"]), daemon=True)
            t.start()
            t.join(timeout=300)
        time.sleep(0.5)
    answer = ((view.get("answer") or {}).get("text") or "").strip()
    check("the task finished", view["state"] == "done", view["state"])
    check("Claude gave a real answer", len(answer) > 40, answer[:80])
    again = next(x for x in widgets.list_all(db) if x["id"] == w["id"])
    check("the widget remembers the run", again["config"]["last_task"] == started["id"] and bool(again["config"]["last_run"]), again["config"])
    check("a receipt was written", any(r["kind"] == "routine.ran" for r in abilities.receipts(db, limit=20)))
    print("\n--- Claude's briefing ---\n" + answer[:900], flush=True)
    summary = {"result": "PASS" if not failures else "FAIL", "failures": failures, "evidence": str(evidence)}
    (evidence / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\n{summary['result']}. Evidence: {evidence}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
