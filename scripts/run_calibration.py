"""Turing Firing Range: measure the independent reviewer on known-bad and known-good changes, with the REAL Claude Code CLI.

Each case is a tiny disposable repository whose planted fault passes its own tests. The reviewer is run exactly like the review
executor runs it (fresh read-only session, pinned checkout). Scoring is deterministic code. It uses your Claude subscription (one
short review per case, about 8) and never an API key. The scorecard is saved to <state>\calibration\latest.json and shown in AIOS.

Usage (Windows, from the AIOS folder):
    .\.venv\Scripts\python.exe scripts\run_calibration.py --model opus
    .\.venv\Scripts\python.exe scripts\run_calibration.py --model sonnet --only hardcoded_add,clean_docstring
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from aios import calibration  # noqa: E402
from aios.config import Settings  # noqa: E402


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model", default=None, help="reviewer model alias, e.g. opus or sonnet (default: account default)")
    ap.add_argument("--only", default=None, help="comma-separated case ids; default all")
    ap.add_argument("--list", action="store_true", help="list the cases and exit")
    a = ap.parse_args()
    if a.list:
        for c in calibration.CASES:
            print(f"{c['id']:28} {c['category']:18} {'planted fault' if c['bug'] else 'clean control'}")
        return 0
    chosen = [c for c in calibration.CASES if not a.only or c["id"] in a.only.split(",")]
    if not chosen:
        print("no such case; use --list")
        return 2
    state_root = Path(os.environ.get("AIOS_STATE_DIR", ROOT.parent / "aios-state"))
    settings = Settings(state_dir=state_root, workspaces_dir=Path(os.environ.get("AIOS_WORKSPACES_DIR", ROOT.parent / "aios-workspaces")))

    def show(r: dict) -> None:
        verdict = ("ERROR: " + r["error"]) if r.get("error") else (
            ("CAUGHT" if r["caught"] else "MISSED") if r["kind"] == "bug" else ("FALSE ALARM" if r["false_alarm"] else "clean, no alarm"))
        print(f"{r['id']:28} {verdict}", flush=True)

    out = calibration.run_range(a.model, cases=chosen, on_result=show)
    path = calibration.save(settings, out)
    print(json.dumps(out["scorecard"], indent=2))
    print(f"saved {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
