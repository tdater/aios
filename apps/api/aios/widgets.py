"""Widgets are data, not code. A widget is one of a few fixed kinds plus plain-text settings that are validated here.
Anything (including an AI) may PROPOSE one; nothing is stored until the owner creates it, and it can only ever render as text.

Kinds: counter, checklist, note, habit (a daily check with a streak), timer (focus and rest lengths), routine (a saved
request the owner can run in one click, or on a schedule they choose; see routines.py). The CATALOG is a list of ready-made
widgets people pick from and then change: every one works with only what the owner types in, no calendar, email or bank."""
from __future__ import annotations

import json
import re
from datetime import date

from . import abilities
from .db import Database
from .errors import ApiError
from .util import new_id, now

KINDS = ("counter", "checklist", "note", "habit", "timer", "routine", "facts", "mission")
MAX_WIDGETS, MAX_ITEMS = 24, 20
MAX_FACTS = 60
MAX_STEPS = 30
WHENS = ("manual", "daily", "weekdays", "weekly")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _text(v, limit: int, field: str, allow_empty: bool = False) -> str:
    if not isinstance(v, str):
        raise ApiError(422, "bad_widget", f"{field} must be text")
    t = _CONTROL.sub("", v).strip()
    if (not t and not allow_empty) or len(t) > limit:
        raise ApiError(422, "bad_widget", f"{field} must be {'up to' if allow_empty else '1 to'} {limit} characters")
    return t


def _int(v, lo: int, hi: int, field: str) -> int:
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise ApiError(422, "bad_widget", f"{field} must be a whole number from {lo} to {hi}")
    return v


ALLOWED = {"counter": {"value", "step"}, "checklist": {"items"}, "note": {"text"}, "habit": {"days", "per_week"}, "timer": {"focus", "rest", "sessions"},
           "routine": {"prompt", "when", "at", "day", "last_run", "last_task"}, "facts": {"items"}, "mission": {"target", "steps", "note"}}


def validate(kind: str, title, config) -> tuple[str, dict]:
    """Returns the clean title and config, or raises. Unknown keys are rejected, not ignored."""
    if kind not in KINDS:
        raise ApiError(422, "bad_widget", f"kind must be one of {list(KINDS)}")
    if not isinstance(config, dict):
        raise ApiError(422, "bad_widget", "settings must be an object")
    title = _text(title, 60, "title")
    extra = set(config) - ALLOWED[kind]
    if extra:
        raise ApiError(422, "bad_widget", f"unknown setting(s): {sorted(extra)}")
    if kind == "counter":
        value, step = config.get("value", 0), config.get("step", 1)
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (value, step)) or not (-1_000_000 <= value <= 1_000_000) or not (1 <= step <= 1000):
            raise ApiError(422, "bad_widget", "value and step must be whole numbers in a sensible range")
        return title, {"value": value, "step": step}
    if kind == "note":
        return title, {"text": _text(config.get("text", ""), 500, "text", allow_empty=True)}
    if kind == "habit":
        days = config.get("days", [])
        if not isinstance(days, list) or len(days) > 400 or not all(isinstance(d, str) and _DAY.match(d) and _real_date(d) for d in days):
            raise ApiError(422, "bad_widget", "days must be a list of dates like 2026-10-26")
        return title, {"days": sorted(set(days))[-400:], "per_week": _int(config.get("per_week", 7), 1, 7, "days per week")}
    if kind == "timer":
        return title, {"focus": _int(config.get("focus", 25), 1, 180, "focus minutes"), "rest": _int(config.get("rest", 5), 0, 60, "rest minutes"),
                       "sessions": _int(config.get("sessions", 0), 0, 99999, "sessions")}
    if kind == "routine":
        when = config.get("when", "manual")
        at = config.get("at", "08:00")
        if when not in WHENS:
            raise ApiError(422, "bad_widget", f"when must be one of {list(WHENS)}")
        if not isinstance(at, str) or not _TIME.match(at):
            raise ApiError(422, "bad_widget", "at must be a time like 08:30")
        return title, {"prompt": _text(config.get("prompt", ""), 1500, "request"), "when": when, "at": at, "day": _int(config.get("day", 6), 0, 6, "day of the week"),
                       "last_run": _text(config.get("last_run", ""), 40, "last run", allow_empty=True), "last_task": _text(config.get("last_task", ""), 64, "last task", allow_empty=True)}
    if kind == "mission":
        target = config.get("target", "")
        if target != "" and not (isinstance(target, str) and _DAY.match(target) and _real_date(target)):
            raise ApiError(422, "bad_widget", "target must be a date like 2026-12-31, or empty")
        steps = config.get("steps", [])
        if not isinstance(steps, list) or len(steps) > MAX_STEPS:
            raise ApiError(422, "bad_widget", f"a mission holds up to {MAX_STEPS} steps")
        clean_steps = []
        for st in steps:
            if not isinstance(st, dict) or set(st) - {"text", "done"}:
                raise ApiError(422, "bad_widget", "each step is {text, done}")
            clean_steps.append({"text": _text(st.get("text"), 120, "step text"), "done": bool(st.get("done", False))})
        return title, {"target": target, "steps": clean_steps, "note": _text(config.get("note", ""), 500, "note", allow_empty=True)}
    if kind == "facts":
        facts = config.get("items", [])
        if not isinstance(facts, list) or len(facts) > MAX_FACTS:
            raise ApiError(422, "bad_widget", f"a household vault holds up to {MAX_FACTS} facts")
        out = []
        for f in facts:
            if not isinstance(f, dict) or set(f) != {"label", "value"}:
                raise ApiError(422, "bad_widget", "each fact is {label, value}")
            out.append({"label": _text(f.get("label"), 60, "label"), "value": _text(f.get("value"), 200, "value")})
        return title, {"items": out}
    items = config.get("items", [])
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ApiError(422, "bad_widget", f"a checklist holds up to {MAX_ITEMS} items")
    clean = []
    for it in items:
        if not isinstance(it, dict) or set(it) - {"text", "done"}:
            raise ApiError(422, "bad_widget", "each item is {text, done}")
        clean.append({"text": _text(it.get("text"), 120, "item text"), "done": bool(it.get("done", False))})
    return title, {"items": clean}


def _real_date(s: str) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def propose(kind: str, title, config) -> dict:
    """A preview of exactly what would be stored. Writes nothing and needs no ability."""
    t, c = validate(kind, title, config)
    return {"kind": kind, "title": t, "config": c}


def streak(days: list[str], today: date | None = None) -> int:
    """Consecutive days checked, counting back from today (or from yesterday, if today is not checked yet)."""
    today = today or date.today()
    have = set(days)
    d, n = today, 0
    if d.isoformat() not in have:
        d = date.fromordinal(d.toordinal() - 1)
    while d.isoformat() in have:
        n += 1
        d = date.fromordinal(d.toordinal() - 1)
    return n


def _row(r: dict) -> dict:
    return {"id": r["id"], "kind": r["kind"], "title": r["title"], "config": json.loads(r["config_json"]), "created_at": r["created_at"]}


def list_all(db: Database) -> list[dict]:
    return [_row(r) for r in db.query("SELECT * FROM widgets ORDER BY created_at, id")]


def get(db: Database, wid: str) -> dict:
    row = db.one("SELECT * FROM widgets WHERE id=?", (wid,))
    if not row:
        raise ApiError(404, "not_found", "No such widget.")
    return _row(row)


def create(db: Database, kind: str, title, config) -> dict:
    abilities.require(db, "widgets")
    t, c = validate(kind, title, config)
    if db.one("SELECT COUNT(*) AS n FROM widgets")["n"] >= MAX_WIDGETS:
        raise ApiError(409, "too_many_widgets", f"up to {MAX_WIDGETS} widgets")
    wid = new_id("wdg")
    db.execute("INSERT INTO widgets(id,kind,title,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)", (wid, kind, t, json.dumps(c), now(), now()))
    abilities.receipt(db, actor="widgets", kind="widget.created", summary=f"Added a {kind} panel called \"{t}\" to Today.", changed=True)
    return _row(db.one("SELECT * FROM widgets WHERE id=?", (wid,)))


def update(db: Database, wid: str, config, title=None) -> dict:
    abilities.require(db, "widgets")
    row = db.one("SELECT * FROM widgets WHERE id=?", (wid,))
    if not row:
        raise ApiError(404, "not_found", "No such widget.")
    t, c = validate(row["kind"], row["title"] if title is None else title, config)
    db.execute("UPDATE widgets SET title=?, config_json=?, updated_at=? WHERE id=?", (t, json.dumps(c), now(), wid))
    return _row(db.one("SELECT * FROM widgets WHERE id=?", (wid,)))


def delete(db: Database, wid: str) -> None:
    row = db.one("SELECT title FROM widgets WHERE id=?", (wid,))
    if not row:
        raise ApiError(404, "not_found", "No such widget.")
    db.execute("DELETE FROM widgets WHERE id=?", (wid,))        # removing is always allowed, even when the ability is off or paused
    abilities.receipt(db, actor="owner", kind="widget.deleted", summary=f"Removed the panel \"{row['title']}\".", changed=True)


# ---------------------------------------------------------------- the catalog
def _t(id_: str, name: str, space: str, group: str, who: str, blurb: str, kind: str, title: str, config: dict, *, claude: bool = False, change: str = "") -> dict:
    return {"id": id_, "name": name, "space": space, "group": group, "who": who, "blurb": blurb, "kind": kind, "title": title, "config": config, "needs_claude": claude, "you_can_change": change}


ROUTINE_BRIEF = ("Give me a short plan for today. Use what you know about me from my approved memories and ask me nothing first. Format: three priorities in order, "
                 "one thing I might be forgetting, and one thing to say no to today. Keep it under 120 words and use plain words.")
ROUTINE_WRAP = ("Help me close out my day in three quick questions, asking them one at a time: what got done, what should carry over to tomorrow, and one thing I am "
                "grateful for. After my answers, write a four-line summary I can save.")
ROUTINE_WEEK = ("Run my weekly review. Ask me one at a time: one win this week, one thing that was harder than it should have been, and one thing to change next week. "
                "Then write a short plan for the week ahead with three priorities.")
ROUTINE_MEALS = ("Help me plan this week's dinners. Ask me how many people, any foods to avoid, and how much time I have on weeknights. Then give me seven dinners "
                 "and a combined shopping list grouped by aisle.")
ROUTINE_STANDUP = ("Help me write my stand-up. Ask me what I did yesterday, what I will do today, and anything blocking me, one at a time. Then write it as three short lines.")
ROUTINE_ERROR = ("I will paste an error message. Explain in plain words what it means, the three most likely causes in order, and what to try first. "
                 "Do not guess about files you cannot see; say what you would need to check.")

CATALOG: list[dict] = [
    _t("top3", "Today's top 3", "Flight plan", "Plan your day", "Everyone", "The three things that matter most today. Tick them off as you go.", "checklist", "Today's top 3",
       {"items": [{"text": "The one thing that matters most", "done": False}, {"text": "Second thing", "done": False}, {"text": "Third thing", "done": False}]}, change="the three items"),
    _t("briefing", "Morning briefing", "Mission briefing", "Plan your day", "Everyone", "One click for a short plan for the day. Can run by itself each morning if you allow it.", "routine", "Morning briefing",
       {"prompt": ROUTINE_BRIEF, "when": "manual", "at": "08:00", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the request, and whether it runs by itself and when"),
    _t("wrapup", "Evening wrap-up", "Dock for the night", "Plan your day", "Everyone", "A two-minute close to the day: what got done, what carries over, one thing to be grateful for.", "routine", "Evening wrap-up",
       {"prompt": ROUTINE_WRAP, "when": "manual", "at": "18:30", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the questions, and when it runs"),
    _t("weekly", "Weekly review", "Star chart", "Plan your day", "Everyone", "One win, one friction, one change, and a plan for next week.", "routine", "Weekly review",
       {"prompt": ROUTINE_WEEK, "when": "manual", "at": "17:00", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the questions, the day and time"),
    _t("capture", "Quick capture", "Signal receiver", "Capture", "Everyone", "A place to drop any thought so you can sort it later.", "checklist", "Inbox",
       {"items": [{"text": "Drop a thought here", "done": False}]}, change="what is in it"),
    _t("gratitude", "Gratitude note", "Log beacon", "Capture", "Everyone", "A line or two about something good today.", "note", "Something good today", {"text": "Today I am grateful for"}, change="the wording"),
    _t("water", "Glasses of water", "Fuel gauge", "Track", "Everyone", "A counter for water, coffee, steps, anything you count in ones.", "counter", "Glasses of water", {"value": 0, "step": 1}, change="the name and the step"),
    _t("move", "Move for 20 minutes", "Constellation: Move", "Track", "Everyone", "A daily check with a streak, so you can see the pattern build.", "habit", "Move for 20 minutes", {"days": [], "per_week": 5}, change="the name and days per week"),
    _t("read", "Read a little", "Constellation: Read", "Track", "Everyone", "Check it off each day you read, even a page.", "habit", "Read a little", {"days": [], "per_week": 7}, change="the name and days per week"),
    _t("sleep", "Lights out on time", "Constellation: Rest", "Track", "Everyone", "A nightly check for going to bed when you meant to.", "habit", "Lights out on time", {"days": [], "per_week": 6}, change="the name and days per week"),
    _t("budget", "Spent this month", "Cargo manifest", "Track", "Everyone", "Add up what you spend by hand. Nothing connects to your bank.", "counter", "Spent this month", {"value": 0, "step": 10}, change="the name and the step"),
    _t("focus", "Focus timer", "Warp burn", "Focus", "Everyone", "A work-and-rest timer. It counts your finished sessions.", "timer", "Focus timer", {"focus": 25, "rest": 5, "sessions": 0}, change="focus and rest minutes"),
    _t("household", "Household vault", "Home station", "Home", "Everyone", "The facts you always lose: filter sizes, paint codes, clothing sizes, model numbers. Type to find one. Nothing leaves this computer.", "facts", "Household vault",
       {"items": [{"label": "Furnace filter size", "value": "16x25x4"}, {"label": "Living room paint", "value": "Add the brand and colour code"}]}, change="every fact"),
    _t("mission", "A life mission", "Mission board", "Plan your day", "Everyone", "A goal with a target date and steps, like Plan the summer trip or Renovate the kitchen. Tick steps off as you go.", "mission", "My mission",
       {"target": "", "steps": [{"text": "Write down what done looks like", "done": False}, {"text": "List the first three steps", "done": False}], "note": ""}, change="the goal, the date and every step"),
    _t("shopping", "Shopping list", "Supply depot", "Lists", "Everyone", "Things to buy. Tick them off in the shop.", "checklist", "Shopping list", {"items": [{"text": "Milk", "done": False}]}, change="the items"),
    _t("reading", "Reading list", "Cargo bay: Read", "Lists", "Everyone", "Books and articles to get to.", "checklist", "Reading list", {"items": [{"text": "A book you have been meaning to read", "done": False}]}, change="the items"),
    _t("meals", "Plan this week's dinners", "Galley", "Lists", "Everyone", "Answer three questions and get seven dinners plus a shopping list.", "routine", "Plan this week's dinners",
       {"prompt": ROUTINE_MEALS, "when": "manual", "at": "10:00", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the request"),
    _t("standup", "Stand-up helper", "Crew check-in", "For technical work", "Technical", "Three short questions, then a three-line stand-up you can paste.", "routine", "Stand-up helper",
       {"prompt": ROUTINE_STANDUP, "when": "manual", "at": "09:30", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the questions, and when it runs"),
    _t("errors", "Explain this error", "Decoder", "For technical work", "Technical", "Paste an error message and get it explained in plain words with what to try first.", "routine", "Explain this error",
       {"prompt": ROUTINE_ERROR, "when": "manual", "at": "09:00", "day": 6, "last_run": "", "last_task": ""}, claude=True, change="the request"),
    _t("reviews", "Review queue", "Inspection bay", "For technical work", "Technical", "Changes waiting for your eyes.", "checklist", "Review queue", {"items": [{"text": "Pull request or change to review", "done": False}]}, change="the items"),
    _t("release", "Release checklist", "Launch checklist", "For technical work", "Technical", "The steps you take every time you ship.", "checklist", "Release checklist",
       {"items": [{"text": "Tests pass", "done": False}, {"text": "Notes written", "done": False}, {"text": "Backed up", "done": False}]}, change="the steps"),
]
GROUPS = ["Plan your day", "Capture", "Track", "Focus", "Lists", "Home", "For technical work"]


def catalog() -> dict:
    return {"items": CATALOG, "groups": GROUPS}


def from_catalog(db: Database, template: str, title=None, config=None) -> dict:
    t = next((x for x in CATALOG if x["id"] == template), None)
    if not t:
        raise ApiError(404, "no_such_template", "That widget is not in the catalog.")
    merged = {**t["config"], **(config or {})}
    return create(db, t["kind"], t["title"] if title is None else title, merged)
