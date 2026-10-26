"""Routines: a saved request that runs through the dashboard's single prompt. The owner can press Run, or (only if they turn on the
"routines" ability) let AIOS run it at the time they chose. A scheduled run uses their own Claude plan, happens at most once a day
per routine, never while AIOS is paused or Claude is not signed in, and can do nothing a typed request could not."""
from __future__ import annotations

import time
from datetime import datetime

from . import abilities, assist, widgets
from .config import Settings
from .db import Database
from .errors import ApiError
from .util import now

_last_check = {"t": 0.0}


def run(db: Database, engine, settings: Settings, wid: str) -> dict:
    w = widgets.get(db, wid)
    if w["kind"] != "routine":
        raise ApiError(422, "not_a_routine", "Only a routine can be run.")
    if abilities.is_paused(db):
        raise ApiError(423, "paused", "AIOS is paused. Resume it first.")
    view = assist.create(db, engine, settings, w["config"]["prompt"])
    cfg = {**w["config"], "last_run": now(), "last_task": view["id"]}
    _t, c = widgets.validate("routine", w["title"], cfg)
    db_update(db, wid, c)
    abilities.receipt(db, actor="owner", kind="routine.ran", changed=True, summary=f"Ran the routine \"{w['title']}\".")
    return view


def db_update(db: Database, wid: str, config: dict) -> None:
    import json
    db.execute("UPDATE widgets SET config_json=?, updated_at=? WHERE id=?", (json.dumps(config), now(), wid))


def is_due(config: dict, at: datetime) -> bool:
    """Whether a scheduled routine should start now: its time has passed today, it fits the schedule, and it has not run today."""
    when = config.get("when", "manual")
    if when == "manual":
        return False
    wd = at.weekday()
    if when == "weekdays" and wd >= 5:
        return False
    if when == "weekly" and wd != config.get("day", 6):
        return False
    hh, mm = (int(x) for x in config.get("at", "08:00").split(":"))
    return (at.hour, at.minute) >= (hh, mm)                  # whether it already ran today is checked separately, in local time


def _ran_today(config: dict, at: datetime) -> bool:
    raw = str(config.get("last_run", ""))
    if not raw:
        return False
    try:
        t = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return False
    return t.date() == at.date()


def tick(db: Database, engine, settings: Settings, at: datetime | None = None, every: float = 30.0) -> list[str]:
    """Start any scheduled routine that is due. Called by the engine about once a second; does real work at most every `every` seconds."""
    if at is None:
        if time.monotonic() - _last_check["t"] < every:
            return []
        _last_check["t"] = time.monotonic()
    at = at or datetime.now().astimezone()
    if abilities.is_paused(db) or not db.one("SELECT 1 AS x FROM abilities WHERE name='routines' AND enabled=1"):
        return []
    started: list[str] = []
    for w in widgets.list_all(db):
        if w["kind"] != "routine" or not is_due(w["config"], at) or _ran_today(w["config"], at):
            continue
        if not assist.claude_ready(db):
            continue
        try:
            run(db, engine, settings, w["id"])
            abilities.receipt(db, actor="routines", kind="routine.scheduled", changed=True, summary=f"Started the routine \"{w['title']}\" at its scheduled time.")
            started.append(w["id"])
        except ApiError:
            continue
    return started
