"""The universe's object model: every piece of AIOS as one object with a plain name, a one-line job, a state, and the settings
that belong to it. This module only DESCRIBES and ROUTES. Every change goes through the function that already guards it
(sharing levels, abilities, the pause switch, a project's check command), so an object never gains a power by existing.

An object is {id, type, region, name, job, state: {tone, text}, meta}. A card adds the settings in three tiers
(basics, more, expert), each field typed so the interface can draw it without knowing what it is."""
from __future__ import annotations

import json
import re
import shlex
import subprocess
from pathlib import Path

from . import abilities, auth, backup, briefing, conversations, improvements, memory_capture, providers, services, sharing, system_scan, widgets
from .config import Settings
from .db import Database
from .errors import ApiError, not_found
from .util import now

ACTIVE_RUN = ("queued", "running", "awaiting_approval", "blocked", "interrupted")
PLAIN_JOB = {
    "claude": "Your main assistant. Does the work using your own Claude sign-in.",
    "gemini": "Second opinions, by copy and paste.",
    "perplexity": "Finds sources, by copy and paste.",
    "antigravity": "Big coding jobs you hand over yourself.",
}
LEVEL_WORDS = {"private": "Everything (public and private memories)", "public": "Only memories I marked public", "none": "Nothing"}
WIDGET_JOB = {"counter": "A counter in your universe.", "checklist": "A checklist in your universe.", "note": "A note in your universe.",
              "habit": "A daily check with a streak.", "timer": "A focus and rest timer.", "routine": "A saved request you can run in one click."}


def _o(oid: str, typ: str, region: str, name: str, job: str, tone: str, text: str, **meta) -> dict:
    return {"id": oid, "type": typ, "region": region, "name": name, "job": job, "state": {"tone": tone, "text": text}, "meta": meta}


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


# ---------------------------------------------------------------- what was last seen on this computer
def last_scan(db: Database) -> dict | None:
    raw = abilities.get_flag(db, "last_scan", "")
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _gb(n: int) -> str:
    return f"{n / 1024 ** 3:.1f} GB"


# ---------------------------------------------------------------- the list
def build(db: Database, settings: Settings, skills_dir: Path | None = None) -> list[dict]:
    caps = {c["provider"]: c for c in providers.list_caps(db)}
    out: list[dict] = []
    approved = db.one("SELECT COUNT(*) AS n FROM memories WHERE status='approved' AND deleted=0")["n"]
    suggested = db.one("SELECT COUNT(*) AS n FROM memories WHERE status='candidate' AND deleted=0")["n"]
    learning = memory_capture.learning_on(db)
    out.append(_o("sun", "sun", "sun", "You", "Your preferences and privacy. Everything orbits you.", "ok" if learning else "muted",
                  f"AIOS remembers {_plural(approved, 'thing')}; learning is {'on' if learning else 'off'}", approved=approved, suggested=suggested))
    for p in sharing.providers():
        lvl = sharing.level(db, p)
        told = len(briefing.build(db, settings, provider=p)["items"])
        if p == "claude":
            mode = (caps.get("claude") or {}).get("mode", "unknown")
            ok = mode == "interactive" and (((caps.get("claude") or {}).get("detail") or {}).get("logged_in") is not False)
            tone, text = ("ok", "Connected through your sign-in") if ok else ("bad", "Not signed in on this computer")
        else:
            tone, text = ("info", f"May be told {_plural(told, 'memory', 'memories')}") if lvl != "none" else ("muted", "Told nothing")
        out.append(_o(f"planet:{p}", "planet", "fleet", sharing.LABEL[p], PLAIN_JOB[p], tone, text, provider=p, level=lvl, told=told))
    pending_skill = {r["name"] for r in db.query("SELECT DISTINCT name FROM skill_candidates WHERE status NOT IN ('rejected','approved')")}
    if skills_dir and skills_dir.is_dir():
        for d in sorted(p for p in skills_dir.iterdir() if (p / "SKILL.md").is_file()):
            desc = _skill_description(d / "SKILL.md")
            better = d.name in pending_skill
            out.append(_o(f"moon:{d.name}", "moon", "fleet", d.name.replace("-", " ").capitalize(), desc, "warn" if better else "ok",
                          "A better version is proposed" if better else "On", parent="planet:claude", skill=d.name))
    waiting = db.one("SELECT COUNT(*) AS n FROM candidates WHERE status='candidate'")["n"]
    out.append(_o("nebula:history", "nebula", "stars", "Imported history", "Old chats and notes AIOS has not sorted yet.", "warn" if waiting else "muted",
                  f"{waiting} waiting" if waiting else "Nothing waiting", size=waiting))
    out.append(_o("wormhole:import", "wormhole", "stars", "Bring in from another AI", "Bring in what ChatGPT, Gemini or Claude already know about you.", "info", "Ready"))
    out.append(_o("beacon:publish", "beacon", "stars", "Shared notes", "Notes you chose to share outside AIOS. Nothing leaves until you export.", "muted", "Nothing is shared unless you export"))

    ev = db.one("SELECT id FROM projects WHERE name=? ORDER BY created_at LIMIT 1", (services.EVERYDAY_NAME,))
    active = db.query("SELECT r.id, r.state, t.title, t.project_id FROM runs r JOIN tasks t ON t.id=r.task_id "
                      f"WHERE r.state IN ({','.join('?' * len(ACTIVE_RUN))}) ORDER BY r.created_at DESC LIMIT 40", ACTIVE_RUN)
    for pr in db.query("SELECT id, name FROM projects WHERE status='active' ORDER BY created_at LIMIT 20"):
        if ev and pr["id"] == ev["id"]:
            continue
        mine = [r for r in active if r["project_id"] == pr["id"]]
        wait = any(r["state"] in ("awaiting_approval", "blocked", "interrupted") for r in mine)
        tone, text = ("warn", "Waiting on you") if wait else (("info", "A job is running") if mine else ("ok", "Idle"))
        out.append(_o(f"station:{pr['id']}", "station", "yards", pr["name"], "A project folder. Your real files stay untouched until you apply a change.", tone, text, project_id=pr["id"]))
    for r in active[:8]:
        if r["project_id"] and not (ev and r["project_id"] == ev["id"]):
            out.append(_o(f"shuttle:{r['id']}", "shuttle", "yards", r["title"], "A job in flight.", "warn" if r["state"] in ("awaiting_approval", "blocked", "interrupted") else "info",
                          "Waiting on you" if r["state"] == "awaiting_approval" else ("Stuck" if r["state"] in ("blocked", "interrupted") else "Working"), station=f"station:{r['project_id']}", run_id=r["id"]))
    for w in widgets.list_all(db):
        out.append(_o(f"probe:{w['id']}", "probe", "yards", w["title"], WIDGET_JOB.get(w["kind"], "A small panel on your Today screen."), "ok", _widget_state(w), widget_kind=w["kind"]))

    approvals = db.one("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'")["n"]
    blocked = db.one("SELECT COUNT(*) AS n FROM runs WHERE state IN ('blocked','interrupted')")["n"]
    review = suggested + waiting
    if approvals:
        out.append(_o("comet:approvals", "comet", "control", f"{approvals} waiting for your approval", "AIOS will not act until you decide.", "warn", "Waiting for you", count=approvals, to={"tab": "inbox"}))
    if blocked:
        out.append(_o("comet:blocked", "comet", "control", f"{blocked} stuck", "A job stopped and needs a decision.", "bad", "Stuck", count=blocked, to={"tab": "runs"}))
    if review:
        out.append(_o("comet:review", "comet", "control", f"{review} to look over", "Memories AIOS noticed or imported. None is used until you approve it.", "info", "Not used until you approve", count=review, to={"tab": "ais", "id": "knows"}))
    today = db.one("SELECT COUNT(*) AS n FROM receipts WHERE ts >= ?", (now()[:10],))["n"]
    out.append(_o("log", "log", "control", "Ship's log", "What AIOS did, in plain words.", "ok", f"{_plural(today, 'entry', 'entries')} today", count=today))
    paused = abilities.is_paused(db)
    out.append(_o("allstop", "allstop", "control", "All Stop", "Stop everything now. Nothing new starts until you resume.", "bad" if paused else "ok", "Paused" if paused else "Running normally", paused=paused))

    scan = last_scan(db)
    facts = (scan or {}).get("facts") or {}
    on = abilities.status(db)
    scan_on = next((a["enabled"] for a in on["abilities"] if a["name"] == "system_scan"), False)
    mem = facts.get("memory")
    mem_text = f"Memory {round((1 - mem['available_bytes'] / mem['total_bytes']) * 100)}% in use" if mem and mem.get("total_bytes") else ("Not checked yet" if not scan else "Unknown")
    temp = facts.get("temp")
    out.append(_o("home", "home", "home", "Home Base", "Your computer: health, space, start-up, and a helper for the mouse and browser.",
                  "warn" if any(s["level"] == "attention" for s in (scan or {}).get("suggestions", [])) else ("ok" if scan else "muted"),
                  "Needs attention" if any(s["level"] == "attention" for s in (scan or {}).get("suggestions", [])) else ("Looks healthy" if scan else "Not checked yet")))
    out.append(_o("home:engine", "module", "home", "Engine room", "Speed: memory and heavy programs.", "warn" if mem and mem["total_bytes"] and (1 - mem["available_bytes"] / mem["total_bytes"]) > 0.85 else "ok" if scan else "muted", mem_text))
    out.append(_o("home:cargo", "module", "home", "Cargo bay", "Space: disk and temporary files.", "warn" if (temp and temp["bytes"] > 2 * 1024 ** 3) else "ok" if scan else "muted",
                  f"Temporary files {_gb(temp['bytes'])}" if temp else "Not checked yet"))
    startup = facts.get("startup_items")
    out.append(_o("home:launch", "module", "home", "Launch bay", "Programs that start with Windows.", "info" if (startup or 0) > 12 else "ok" if scan else "muted",
                  f"{startup} start with Windows" if startup is not None else "Not checked yet"))
    out.append(_o("home:rover", "module", "home", "Rover bay", "A helper that can use the mouse and browser, only when you allow it.", "muted", "Off. Not built yet."))
    sessions = [s for s in auth.list_sessions(db) if not s["revoked_at"]]
    out.append(_o("home:port", "module", "home", "Docking port", "Connections, devices and backups.", "ok", f"{_plural(len(sessions), 'device')} paired"))
    sizes = {"attention": 5, "info": 3, "ok": 2}
    for s in (scan or {}).get("suggestions", []):
        if s["id"] != "ok":
            out.append(_o(f"rock:{s['id']}", "rock", "home", s["text"].split(".")[0][:60], s["text"], "warn" if s["level"] == "attention" else "info", "Open to see", size=sizes.get(s["level"], 3), finding=s["id"]))
    return out


def _widget_state(w: dict) -> str:
    c = w["config"]
    if w["kind"] == "counter":
        return f"{c.get('value', 0)}"
    if w["kind"] == "checklist":
        items = c.get("items", [])
        return f"{sum(1 for i in items if i['done'])} of {len(items)} done"
    if w["kind"] == "habit":
        n = widgets.streak(c.get("days", []))
        return f"{n}-day streak" if n else "No streak yet"
    if w["kind"] == "timer":
        return f"{c.get('focus', 25)} minutes, {c.get('sessions', 0)} done"
    if w["kind"] == "routine":
        when = {"manual": "Runs when you press Run", "daily": f"Daily at {c.get('at')}", "weekdays": f"Weekdays at {c.get('at')}",
                "weekly": f"Weekly, {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][c.get('day', 6)]} at {c.get('at')}"}[c.get("when", "manual")]
        return when
    return "1 note"


def _skill_description(path: Path) -> str:
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:1500]
    except OSError:
        return "A ready-made way of doing one job."
    m = re.search(r"(?m)^description:\s*(.+)$", head)
    text = (m.group(1).strip().strip("\"'") if m else "A ready-made way of doing one job.")
    return text[:140]


# ---------------------------------------------------------------- cards and fields
def F(key: str, kind: str, label: str, value=None, *, help: str = "", options: list[dict] | None = None, confirm: bool = False, to: dict | None = None, action: str | None = None, client: str | None = None) -> dict:
    f = {"key": key, "kind": kind, "label": label, "value": value, "help": help}
    for k, v in (("options", options), ("confirm", confirm or None), ("to", to), ("action", action), ("client", client)):
        if v:
            f[k] = v
    return f


EXPLAIN = {
    "sun": "This is you. Everything in AIOS exists to serve you, so it sits in the middle. Here you decide how AIOS looks, how much it shows, and whether it learns from what you tell it.",
    "planet": "An AI you can use. Its distance from you is how much it may be told: closer means more of your private memories. You choose, and nothing marked secret is ever shared.",
    "moon": "A ready-made way of doing one job, like checking a change. It belongs to the AI that uses it.",
    "nebula": "A cloud of old chats and notes you brought in. AIOS reads it, hides anything secret, and suggests memories for you to approve. Nothing is used until you say yes.",
    "wormhole": "A way in from another AI. You copy a short request, paste it into the other AI, and bring its answer back as suggestions.",
    "beacon": "Notes you marked to share outside AIOS. Nothing is uploaded: exporting only writes files on this computer.",
    "station": "A project folder you work on. Claude edits a safe copy, your real files stay untouched, and AIOS asks before running your tests or applying a change.",
    "shuttle": "A job in flight between a project and an AI. It shows where it is and whether it needs you.",
    "probe": "A small panel you added to your Today screen. It is plain data: it cannot run code or reach the internet.",
    "comet": "Something is waiting for you. AIOS will not go ahead until you decide.",
    "log": "A plain-words record of what AIOS did, so nothing happens that you cannot read back.",
    "allstop": "The big red button. It stops AIOS from starting anything new, and everything waits until you resume.",
    "home": "Your computer. AIOS can look at its health and, only when you allow it, help tidy it up.",
    "module": "One part of your computer's health, or a control for what AIOS may do on it.",
    "rock": "One thing slowing your computer down. AIOS explains it first, shows you how to fix it, and only changes anything with your approval.",
}


def find(objects: list[dict], oid: str) -> dict | None:
    return next((o for o in objects if o["id"] == oid), None)


def _count_for_level(db: Database, level: str) -> int:
    allowed = sorted(sharing.SENSITIVITIES[level])
    if not allowed:
        return 0
    return db.one(f"SELECT COUNT(*) AS n FROM memories WHERE status='approved' AND deleted=0 AND sensitivity IN ({','.join('?' * len(allowed))}) AND sensitivity != 'secret-adjacent'", allowed)["n"]


def _ability(db: Database, name: str) -> bool:
    return next((a["enabled"] for a in abilities.status(db)["abilities"] if a["name"] == name), False)


def card(db: Database, settings: Settings, oid: str, skills_dir: Path | None = None) -> dict:
    obj = find(build(db, settings, skills_dir), oid)
    if not obj:
        raise not_found("object")
    t, basics, more, expert = obj["type"], [], [], []
    links: list[dict] = []
    if t == "sun":
        basics.append(F("learning", "toggle", "Let AIOS suggest things to remember", memory_capture.learning_on(db),
                        help="When you say “remember…” or “always…”, AIOS suggests a memory. Nothing is used until you approve it."))
        links += [{"label": "See and correct what AIOS knows", "to": {"tab": "ais", "id": "knows"}}, {"label": "Replay the tour", "client": "tour"}]
    elif t == "planet":
        p = obj["meta"]["provider"]
        basics.append(F("sharing", "choice", f"What may {obj['name']} be told?", sharing.level(db, p),
                        options=[{"value": lv, "label": LEVEL_WORDS[lv], "preview": f"{_plural(_count_for_level(db, lv), 'memory', 'memories')} would be shared"} for lv in ("private", "public", "none")],
                        help="Nothing marked secret is ever shared, at any setting.", confirm=False))
        more.append(F("show_told", "action", f"Show exactly what {obj['name']} would be told", action="show_briefing"))
        if p in ("gemini", "perplexity"):
            more.append(F("window", "action", f"Open {obj['name']} in its own window", client="open_companion", help="AIOS opens the official site; you paste prompts yourself. AIOS never reads that window."))
        if p == "claude":
            cap = providers.capability(db, "claude") or {}
            d = cap.get("detail") or {}
            expert.append(F("status", "info", "Connection", f"{d.get('version', 'unknown')}; plan {d.get('plan') or 'unknown'}; signed in: {d.get('logged_in')}"))
        expert.append(F("default", "info", "Starting level", LEVEL_WORDS[sharing.DEFAULT_LEVEL[p]], help="Where this AI begins until you change it."))
    elif t == "moon":
        basics.append(F("about", "info", "What it does", obj["job"]))
        links.append({"label": "Review proposed improvements", "to": {"tab": "inbox", "sub": "improvements"}})
    elif t == "nebula":
        links += [{"label": "Open imported history", "to": {"tab": "settings", "id": "history"}}]
    elif t == "wormhole":
        links += [{"label": "Bring in memories", "to": {"tab": "ais", "id": "import"}}]
    elif t == "beacon":
        links += [{"label": "Choose and export notes", "to": {"tab": "settings", "id": "publish"}}]
    elif t == "station":
        pid = obj["meta"]["project_id"]
        argv = conversations.verify_argv(db, pid)
        basics.append(F("check_command", "text", "How AIOS checks a change", subprocess.list2cmdline(argv) if argv else "",
                        help="The command AIOS runs (after you approve it) to test what Claude builds. Example: python -m unittest. Leave empty for no automatic check."))
        links += [{"label": "Open this project", "to": {"tab": "projects", "id": pid}}, {"label": "Start a conversation about it", "to": {"tab": "work"}}]
    elif t in ("shuttle", "comet"):
        to = obj["meta"].get("to") or {"tab": "runs", "id": obj["meta"].get("run_id")}
        links.append({"label": "Open it", "to": to})
    elif t == "probe":
        links.append({"label": "Edit or remove this panel", "to": {"tab": "settings", "id": "abilities"}})
    elif t == "log":
        links.append({"label": "Read the full log", "to": {"tab": "settings", "id": "abilities"}})
    elif t == "allstop":
        basics.append(F("paused", "toggle", "Stop everything", abilities.is_paused(db), help="While stopped, no new jobs start, and the helpers that look at your computer refuse."))
    elif obj["id"] in ("home:engine", "home:cargo", "home:launch", "home"):
        basics.append(F("ability_system_scan", "toggle", "Let AIOS look at this computer", _ability(db, "system_scan"), confirm=True,
                        help="Reads memory use, free disk space, the size of the temporary-files folder and how many programs start with Windows. It changes nothing."))
        basics.append(F("scan", "action", "Check this computer now", action="run_health_check"))
    elif obj["id"] == "home:rover":
        basics.append(F("about", "info", "Status", "Not built yet. The mouse and browser helper will be off until you turn it on, and you will always be able to stop it."))
    elif obj["id"] == "home:port":
        basics.append(F("pair", "action", "Pair another device", action="pair_device", help="Shows a one-time code to type on the other device. It works once and expires."))
        basics.append(F("backup", "action", "Back up AIOS now", action="backup_now", help="Copies your database and notes to a backup folder on this computer."))
        links.append({"label": "See paired devices", "to": {"tab": "settings"}})
    elif t == "rock":
        links.append({"label": "Check this computer again", "client": "rescan"})
    return {"object": obj, "explain": EXPLAIN.get(t, ""), "panels": {"basics": basics, "more": more, "expert": expert}, "links": links}


# ---------------------------------------------------------------- applying a change
def apply(db: Database, settings: Settings, oid: str, values: dict, confirm: bool = False) -> dict:
    obj = find(build(db, settings), oid)
    if not obj:
        raise not_found("object")
    if not isinstance(values, dict) or not values:
        raise ApiError(422, "no_change", "no settings were given")
    t = obj["type"]
    known = {f["key"] for tier in card(db, settings, oid)["panels"].values() for f in tier if f["kind"] in ("toggle", "choice", "text", "number")}
    unknown = set(values) - known
    if unknown:
        raise ApiError(422, "unknown_setting", f"this object has no setting named {sorted(unknown)}")
    for key, val in values.items():
        if t == "sun" and key == "learning":
            if not isinstance(val, bool):
                raise ApiError(422, "bad_value", "learning is on or off")
            abilities.set_flag(db, "learning", "1" if val else "0")
            abilities.receipt(db, actor="owner", kind="learning.changed", changed=True,
                              summary="Turned on learning from what you ask AIOS to remember." if val else "Turned off learning: AIOS will not suggest memories on its own.")
        elif t == "planet" and key == "sharing":
            sharing.set_level(db, obj["meta"]["provider"], str(val))
        elif t == "station" and key == "check_command":
            text = str(val).strip()
            argv = [a.strip("\"'") for a in shlex.split(text, posix=False)] if text else None
            conversations.set_verify_command(db, obj["meta"]["project_id"], argv)
        elif t == "allstop" and key == "paused":
            if not isinstance(val, bool):
                raise ApiError(422, "bad_value", "stopped is on or off")
            abilities.set_paused(db, val)
        elif key == "ability_system_scan":
            if not isinstance(val, bool):
                raise ApiError(422, "bad_value", "this is on or off")
            abilities.set_enabled(db, "system_scan", val, confirm)
        else:
            raise ApiError(422, "unknown_setting", f"{key} cannot be changed here")
    return card(db, settings, oid)


# ---------------------------------------------------------------- actions
def act(db: Database, settings: Settings, oid: str, name: str) -> dict:
    obj = find(build(db, settings), oid)
    if not obj:
        raise not_found("object")
    if name == "show_briefing" and obj["type"] == "planet":
        b = briefing.build(db, settings, provider=obj["meta"]["provider"])
        return {"title": f"What {obj['name']} would be told", "count": len(b["items"]), "text": b["text"] or "Nothing at this level."}
    if name == "run_health_check" and obj["id"].startswith("home"):
        abilities.require(db, "system_scan")
        facts = system_scan.collect()
        result = {"at": now(), "facts": facts, "suggestions": system_scan.suggest(facts)}
        abilities.set_flag(db, "last_scan", json.dumps(result))
        abilities.receipt(db, actor="system_scan", kind="system_scan.run", summary="Read memory, disk, temp-folder size and start-up count. Changed nothing.")
        return result
    if name == "pair_device" and obj["id"] == "home:port":
        c = auth.new_pairing_code(db)
        abilities.receipt(db, actor="owner", kind="pairing.code", summary="Made a one-time code to pair another device.", changed=True)
        return {"code": c["code"], "expires_at": c.get("expires_at"), "note": "Type this code on the other device. It works once."}
    if name == "backup_now" and obj["id"] == "home:port":
        res = backup.create_backup(settings, db)
        abilities.receipt(db, actor="owner", kind="backup.created", summary="Made a backup of AIOS.", changed=True)
        return {"ok": True, **{k: v for k, v in res.items() if k in ("path", "created_at", "bytes", "name")}}
    raise ApiError(404, "unknown_action", "That object has no such action.")
