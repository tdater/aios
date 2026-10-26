"""Home Base: turns the read-only health check into findings the owner can understand and act on by hand.

Each finding has an Explain (what it is), a Show me how (numbered Windows steps), and a safety class:
  read_only   AIOS only reads and explains.
  reversible  AIOS may hand back a Windows settings address (ms-settings:...) for the client to open. AIOS deletes and changes nothing.
  never       refused in code with a 403 and a receipt, whoever asks.
Anything not listed here is refused too: the rule is an allow-list, not a block-list. This module reads numbers and returns text."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Callable

from . import abilities, system_scan
from .db import Database
from .errors import ApiError
from .util import now

CLASSES = ("read_only", "reversible", "never")
CHECKUP_DAYS = 7
_last_check = {"t": float("-inf")}

# What each finding means, in plain words, and the route to fix it by hand. The numbers come from system_scan.suggest.
_CATALOG: dict[str, dict] = {
    "memory": {
        "title": "Memory is nearly full",
        "explain": "Memory (RAM) is where your programs keep what they are working on. When it is nearly full, Windows has to shuffle data to the disk, "
                   "and everything feels slow.",
        "how_to": ["Press Ctrl+Shift+Esc to open Task Manager.", "Open the Processes tab and click the Memory column heading to sort by memory.",
                   "Look for programs you are not using. Save your work in them, then close them the normal way.",
                   "If it keeps happening, restart the computer: that clears everything at once."],
        "action_class": "read_only", "safe_to_automate": False, "page": None,
    },
    "disk": {
        "title": "Your main drive is nearly full",
        "explain": "Windows needs free space on its drive to update and to swap data out of memory. When free space gets low, the whole computer slows down.",
        "how_to": ["Open Settings, then System, then Storage.", "Look at what is using the most space: the list shows apps, temporary files and more.",
                   "Turn on Storage Sense, or choose Temporary files and remove only the kinds you recognise. Leave Downloads alone unless you have checked it.",
                   "Move large photos and videos to another drive or cloud storage yourself."],
        "action_class": "reversible", "safe_to_automate": True, "page": "ms-settings:storagesense",
    },
    "temp": {
        "title": "Temporary files are taking a lot of space",
        "explain": "Programs leave scratch files in a temporary folder and rarely tidy up. Windows' own cleanup tools know which are safe to clear.",
        "how_to": ["Open Settings, then System, then Storage, then Temporary files.", "Tick Temporary files (and Recycle Bin if you are sure it is empty of anything you want).",
                   "Click Remove files. Windows only removes files it knows are safe.",
                   "Or type Disk Cleanup in the Start menu, pick your main drive, tick Temporary files, and click OK."],
        "action_class": "reversible", "safe_to_automate": True, "page": "ms-settings:storagesense",
    },
    "startup": {
        "title": "Many programs start with Windows",
        "explain": "Every program that starts with Windows takes memory and makes start-up slower. Most are not needed until you open them yourself.",
        "how_to": ["Open Settings, then Apps, then Startup.", "Sort by Startup impact.",
                   "Switch off programs you do not need right at start. You can switch them back on at any time.", "Leave security software and your touchpad or audio tools on."],
        "action_class": "reversible", "safe_to_automate": True, "page": "ms-settings:startupapps",
    },
}

# Things AIOS will never do. Each is refused with a 403 and a receipt, even if a client or an AI asks.
NEVER: dict[str, str] = {
    "registry_edit": "changing the Windows registry",
    "service_change": "starting, stopping or changing Windows services",
    "driver_change": "installing, updating or removing drivers",
    "antivirus_change": "changing antivirus or firewall settings",
    "delete_user_files": "deleting your documents, photos, downloads or any other files",
    "delete_files": "deleting files",
    "install_software": "installing software",
    "uninstall_software": "uninstalling programs",
    "kill_process": "force-closing programs",
    "toggle_startup_item": "switching a start-up program on or off for you",
    "clear_temp": "clearing the temporary-files folder for you",
}
# The whole allow-list of Home Base actions.
ACTIONS = {"check_health": "read_only", "open_windows_page": "reversible"}


def classify(action: str) -> str:
    if action in ACTIONS:
        return ACTIONS[action]
    return "never"


def finding(fid: str, text: str = "", level: str = "info") -> dict | None:
    c = _CATALOG.get(fid)
    if not c:
        return None
    return {"id": fid, "title": c["title"], "explain": (c["explain"] + (" " + text if text else "")).strip(), "how_to": list(c["how_to"]),
            "safe_to_automate": c["safe_to_automate"], "action_class": c["action_class"], "open_uri": c["page"], "level": level}


def findings_from(suggestions: list[dict]) -> list[dict]:
    out = []
    for s in suggestions:
        f = finding(s.get("id", ""), s.get("text", ""), s.get("level", "info"))
        if f:
            out.append(f)
    return out


def last_scan(db: Database) -> dict | None:
    raw = abilities.get_flag(db, "last_scan", "")
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def current_findings(db: Database) -> list[dict]:
    abilities.require(db, "system_scan")
    scan = last_scan(db)
    return findings_from((scan or {}).get("suggestions", []))


def run_scan(db: Database, collect: Callable[[], dict] | None = None, actor: str = "owner") -> dict:
    """The same read-only check as Home Base's 'Check this computer now'. Stored so the asteroid belt can show it."""
    abilities.require(db, "system_scan")
    facts = (collect or system_scan.collect)()
    result = {"at": now(), "facts": facts, "suggestions": system_scan.suggest(facts)}
    abilities.set_flag(db, "last_scan", json.dumps(result))
    abilities.receipt(db, actor=actor if actor != "owner" else "system_scan", kind="system_scan.run", summary="Read memory, disk, temp-folder size and start-up count. Changed nothing.")
    return {**result, "findings": findings_from(result["suggestions"])}


def act(db: Database, action: str, finding_id: str | None = None) -> dict:
    """The only door for Home Base actions. Never-class and unknown actions are refused here, in code, and leave a receipt."""
    cls = classify(action)
    if cls == "never":
        what = NEVER.get(action, f"'{action}', which AIOS does not offer")
        abilities.receipt(db, actor="home_base", kind="home.refused", changed=False, summary=f"Refused: {what}. AIOS never does this.")
        raise ApiError(403, "action_refused", f"AIOS will not do this: {what}. It never changes these things for you.", {"action": action, "action_class": "never"})
    abilities.require(db, "system_scan")
    if action == "check_health":
        return {"action": action, "action_class": cls, "result": run_scan(db)}
    f = finding(finding_id or "")                                                                  # open_windows_page
    if not f or not f["open_uri"]:
        raise ApiError(422, "no_page", "There is no Windows page for that finding.")
    abilities.receipt(db, actor="home_base", kind="home.open_page", changed=False,
                      summary=f"Gave the client the Windows page to open for '{f['title']}'. AIOS changed nothing.")
    return {"action": action, "action_class": cls, "open_uri": f["open_uri"], "changed_anything": False,
            "note": "Your Windows settings page opens. AIOS deletes and changes nothing; you do the steps shown."}


# ---------------------------------------------------------------- weekly check-up
def checkup_enabled(db: Database) -> bool:
    return abilities.get_flag(db, "checkup_weekly", "0") == "1"


def set_checkup(db: Database, enabled: bool) -> None:
    abilities.set_flag(db, "checkup_weekly", "1" if enabled else "0")
    abilities.receipt(db, actor="owner", kind="checkup.enabled" if enabled else "checkup.disabled", changed=True,
                      summary="Turned on the weekly computer check-up." if enabled else "Turned off the weekly computer check-up.")


def last_run(db: Database) -> str | None:
    return abilities.get_flag(db, "checkup_last_run", "") or None


def is_due(db: Database, at: datetime | None = None) -> bool:
    """Due when the owner turned it on, the system_scan ability is on, nothing is paused, and a week has passed since the last one."""
    if not checkup_enabled(db) or abilities.is_paused(db) or not db.one("SELECT 1 AS x FROM abilities WHERE name='system_scan' AND enabled=1"):
        return False
    raw = last_run(db)
    if not raw:
        return True
    try:
        t = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return True
    return (at or datetime.now(timezone.utc)) - t >= timedelta(days=CHECKUP_DAYS)


def run_checkup(db: Database, collect: Callable[[], dict] | None = None) -> dict:
    res = run_scan(db, collect, actor="checkup")
    abilities.set_flag(db, "checkup_last_run", res["at"])
    n = len(res["findings"])
    lines = [f["title"] for f in res["findings"]] or ["Nothing stands out."]
    abilities.receipt(db, actor="checkup", kind="checkup.ran", changed=False,
                      summary=f"Weekly check-up: {n} thing{'s' if n != 1 else ''} to look at." if n else "Weekly check-up: nothing stands out.")
    return {"title": "Your computer this week", "at": res["at"], "lines": lines, "findings": res["findings"]}


def tick(db: Database, collect: Callable[[], dict] | None = None, at: datetime | None = None, every: float = 0.0) -> dict | None:
    """For the ticker or a routine: runs the check-up only if it is due. `every` (seconds) limits how often the ticker even looks.
    Never raises into the caller's loop."""
    if every:
        if time.monotonic() - _last_check["t"] < every:
            return None
        _last_check["t"] = time.monotonic()
    try:
        return run_checkup(db, collect) if is_due(db, at) else None
    except ApiError:
        return None


def checkup_status(db: Database) -> dict:
    return {"enabled": checkup_enabled(db), "last_run": last_run(db), "due": is_due(db), "every_days": CHECKUP_DAYS}
