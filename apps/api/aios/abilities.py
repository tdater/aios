"""Opt-in abilities, the pause-everything switch, and receipts.

An ability is off until the owner turns it on, says in plain words what it can see and do, and can be turned off at any
time. Pausing stops new runs and blocks every ability at once. Both are enforced here in code, not by asking a model."""
from __future__ import annotations

from .db import Database
from .errors import ApiError
from .util import new_id, now

ABILITIES: dict[str, dict] = {
    "system_scan": {
        "title": "Check this PC and suggest improvements",
        "can_see": ["memory and disk usage", "the size of your temporary-files folder", "how many programs start with Windows"],
        "can_do": ["read those numbers and explain them in plain language"],
        "cannot": ["change, delete or install anything", "read your files, passwords or browsing history", "touch the registry"],
    },
    "widgets": {
        "title": "Small panels on Today",
        "can_see": ["the panels you create or approve"],
        "can_do": ["show a counter, a checklist or a note on Today, from a short description you preview first"],
        "cannot": ["run code", "reach the internet", "read anything outside AIOS"],
    },
}
ABILITIES["routines"] = {
    "title": "Run my routines on a schedule",
    "can_see": ["the routines you made, and the time you chose for each"],
    "can_do": ["start a routine's saved request at its time, using your own Claude plan, and put the answer on your Home screen"],
    "cannot": ["run while AIOS is paused or Claude is not signed in", "run a routine more than once a day", "act on your computer or send anything anywhere"],
}
ABILITIES["rover"] = {
    "title": "Rover: look at one window and guide me",
    "can_see": ["one window you name, only for the task you start, and only while it is not on the block list (banking, passwords, payments, admin tools)"],
    "can_do": ["take a picture of that window and keep it on this computer", "write numbered instructions for you to follow yourself"],
    "cannot": ["click, type or press keys for you", "open a browser or take over the screen", "start by itself, or keep going after you press Stop",
               "look at banking, payment, password or admin windows"],
}
ACTIVE_ROVER = ("armed", "looking", "guiding")
PLANNED = {"computer_look": "Look at one window and explain it (not built yet)",
           "browser_control": "Control a browser in a separate profile (not built yet)",
           "app_control": "Control other apps (not built yet)"}


def receipt(db: Database, *, actor: str, kind: str, summary: str, changed: bool = False) -> None:
    db.execute("INSERT INTO receipts(id,ts,actor,kind,summary,changed) VALUES (?,?,?,?,?,?)",
               (new_id("rcp"), now(), actor, kind, summary[:400], 1 if changed else 0))


def receipts(db: Database, *, changed_only: bool = False, limit: int = 100) -> list[dict]:
    where = "WHERE changed=1" if changed_only else ""
    return db.query(f"SELECT id, ts, actor, kind, summary, changed FROM receipts {where} ORDER BY ts DESC, id DESC LIMIT ?", (min(limit, 500),))


def get_flag(db: Database, key: str, default: str = "") -> str:
    row = db.one("SELECT value FROM flags WHERE key=?", (key,))
    return row["value"] if row else default


def set_flag(db: Database, key: str, value: str) -> None:
    db.execute("INSERT INTO flags(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
               (key, value, now()))


def is_paused(db: Database) -> bool:
    row = db.one("SELECT value FROM flags WHERE key='paused'")
    return bool(row and row["value"] == "1")


def set_paused(db: Database, paused: bool) -> None:
    db.execute("INSERT INTO flags(key,value,updated_at) VALUES ('paused',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
               ("1" if paused else "0", now()))
    receipt(db, actor="owner", kind="pause" if paused else "resume", changed=True,
            summary="Paused everything: no new runs start and abilities are blocked." if paused else "Resumed.")
    if paused:
        stop_rover_tasks(db, "All Stop was pressed")


def status(db: Database) -> dict:
    on = {r["name"]: bool(r["enabled"]) for r in db.query("SELECT name, enabled FROM abilities")}
    return {"paused": is_paused(db),
            "abilities": [{"name": k, **v, "enabled": on.get(k, False)} for k, v in ABILITIES.items()],
            "planned": [{"name": k, "title": t} for k, t in PLANNED.items()]}


def set_enabled(db: Database, name: str, enabled: bool, confirm: bool) -> None:
    if name not in ABILITIES:
        raise ApiError(404, "unknown_ability", "No such ability." + (" That one is not built yet." if name in PLANNED else ""))
    if enabled and not confirm:
        raise ApiError(422, "confirmation_required", "Turning this on needs your explicit confirmation.")
    db.execute("INSERT INTO abilities(name,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at",
               (name, 1 if enabled else 0, now()))
    receipt(db, actor="owner", kind="ability.enabled" if enabled else "ability.disabled", changed=True,
            summary=f"{'Turned on' if enabled else 'Turned off'}: {ABILITIES[name]['title']}.")
    if name == "rover" and not enabled:
        stop_rover_tasks(db, "the Rover was turned off")


def stop_rover_tasks(db: Database, reason: str) -> int:
    """End every live Rover task now. One conditional UPDATE, no lock and no ability check, so it works mid-step and while paused."""
    n = db.execute(f"UPDATE rover_tasks SET status='stopped', stop_reason=?, ended_at=? WHERE status IN ({','.join('?' * len(ACTIVE_ROVER))})",
                   (reason, now(), *ACTIVE_ROVER))
    count = n if isinstance(n, int) else 0
    if count:
        receipt(db, actor="rover", kind="rover.stopped", changed=True, summary=f"Stopped the Rover: {reason}.")
    return count


def require(db: Database, name: str) -> None:
    """Call at the top of anything an ability does. Raises unless the owner turned it on and nothing is paused."""
    if is_paused(db):
        raise ApiError(423, "paused", "AIOS is paused. Resume it in Settings first.")
    row = db.one("SELECT enabled FROM abilities WHERE name=?", (name,))
    if not row or not row["enabled"]:
        raise ApiError(403, "ability_off", f"'{ABILITIES.get(name, {}).get('title', name)}' is turned off. You can turn it on in Settings.")
