"""Opt-in, bounded, deterministic scheduled review of the approved history folder.

Off by default. When the owner turns it on, a background thread runs the same `review_new` the button runs: it reads only
files in the approved folder, makes no model calls, and is limited in files and seconds. The attempt time is recorded
BEFORE the review runs, so a failing review cannot loop; it simply waits for the next interval.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..config import Settings
from ..db import Database
from . import review

KEY = "review_schedule"
MIN_HOURS, MAX_HOURS = 1, 168
DEFAULT = {"enabled": False, "every_hours": 24, "last_attempt": None, "last_status": None}


def get(db: Database) -> dict:
    row = db.one("SELECT value FROM kv WHERE key=?", (KEY,))
    try:
        saved = json.loads(row["value"]) if row else {}
    except (ValueError, TypeError):
        saved = {}
    out = {**DEFAULT, **{k: saved.get(k) for k in DEFAULT if k in saved}}
    out["enabled"] = out["enabled"] is True
    hours = out["every_hours"] if isinstance(out["every_hours"], int) and not isinstance(out["every_hours"], bool) else DEFAULT["every_hours"]
    out["every_hours"] = max(MIN_HOURS, min(MAX_HOURS, hours))
    out["next_due"] = _next_due(out)
    return out


def _save(db: Database, state: dict) -> None:
    keep = {k: state.get(k) for k in DEFAULT}
    db.execute("INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (KEY, json.dumps(keep)))


def configure(db: Database, *, enabled: bool, every_hours: int) -> dict:
    if not MIN_HOURS <= every_hours <= MAX_HOURS:
        raise ValueError(f"every_hours must be between {MIN_HOURS} and {MAX_HOURS}")
    cur = get(db)
    _save(db, {**cur, "enabled": bool(enabled), "every_hours": every_hours})
    return get(db)


def _next_due(state: dict) -> str | None:
    if not state["enabled"]:
        return None
    if not state["last_attempt"]:
        return "now"
    return (datetime.fromisoformat(state["last_attempt"]) + timedelta(hours=state["every_hours"])).isoformat(timespec="seconds")


def is_due(state: dict, now: datetime) -> bool:
    if not state["enabled"]:
        return False
    if not state["last_attempt"]:
        return True
    return now >= datetime.fromisoformat(state["last_attempt"]) + timedelta(hours=state["every_hours"])


def tick(db: Database, settings: Settings, skills_dir: Path | None = None, now: datetime | None = None) -> str | None:
    """Run one review if one is due. Returns the status that was recorded, or None when nothing was due."""
    now = now or datetime.now(timezone.utc)
    state = get(db)
    if not is_due(state, now):
        return None
    _save(db, {**state, "last_attempt": now.isoformat(timespec="seconds"), "last_status": "running"})
    try:
        status = review.review_new(db, settings, max_files=200, max_seconds=60, skills_dir=skills_dir)["status"]
    except review.ReviewBusy:
        status = "busy"
    except Exception as e:                       # never let a bad file kill the scheduler thread
        status = f"failed: {type(e).__name__}"
    _save(db, {**get(db), "last_attempt": now.isoformat(timespec="seconds"), "last_status": status})
    return status


class Runner:
    """Checks once a minute. Daemon thread; stops with the server."""

    def __init__(self, db: Database, settings: Settings, skills_dir: Path | None = None, period_s: float = 60.0):
        self.db, self.settings, self.skills_dir, self.period_s = db, settings, skills_dir, period_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="review-schedule", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(self.period_s):
            try:
                tick(self.db, self.settings, self.skills_dir)
            except Exception:
                pass
