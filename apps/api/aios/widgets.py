"""Widgets are data, not code. A widget is one of a few fixed kinds plus plain-text settings that are validated here.
Anything (including an AI) may PROPOSE one; nothing is stored until the owner creates it, and it can only ever render as text."""
from __future__ import annotations

import json
import re

from . import abilities
from .db import Database
from .errors import ApiError
from .util import new_id, now

KINDS = ("counter", "checklist", "note")
MAX_WIDGETS, MAX_ITEMS = 12, 20
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _text(v, limit: int, field: str) -> str:
    if not isinstance(v, str):
        raise ApiError(422, "bad_widget", f"{field} must be text")
    t = _CONTROL.sub("", v).strip()
    if not t or len(t) > limit:
        raise ApiError(422, "bad_widget", f"{field} must be 1 to {limit} characters")
    return t


def validate(kind: str, title, config) -> tuple[str, dict]:
    """Returns the clean title and config, or raises. Unknown keys are rejected, not ignored."""
    if kind not in KINDS:
        raise ApiError(422, "bad_widget", f"kind must be one of {list(KINDS)}")
    if not isinstance(config, dict):
        raise ApiError(422, "bad_widget", "settings must be an object")
    title = _text(title, 60, "title")
    allowed = {"counter": {"value", "step"}, "checklist": {"items"}, "note": {"text"}}[kind]
    extra = set(config) - allowed
    if extra:
        raise ApiError(422, "bad_widget", f"unknown setting(s): {sorted(extra)}")
    if kind == "counter":
        value, step = config.get("value", 0), config.get("step", 1)
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (value, step)) or not (-1_000_000 <= value <= 1_000_000) or not (1 <= step <= 1000):
            raise ApiError(422, "bad_widget", "value and step must be whole numbers in a sensible range")
        return title, {"value": value, "step": step}
    if kind == "note":
        return title, {"text": _text(config.get("text", ""), 500, "text")}
    items = config.get("items", [])
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ApiError(422, "bad_widget", f"a checklist holds up to {MAX_ITEMS} items")
    clean = []
    for it in items:
        if not isinstance(it, dict) or set(it) - {"text", "done"}:
            raise ApiError(422, "bad_widget", "each item is {text, done}")
        clean.append({"text": _text(it.get("text"), 120, "item text"), "done": bool(it.get("done", False))})
    return title, {"items": clean}


def propose(kind: str, title, config) -> dict:
    """A preview of exactly what would be stored. Writes nothing and needs no ability."""
    t, c = validate(kind, title, config)
    return {"kind": kind, "title": t, "config": c}


def _row(r: dict) -> dict:
    return {"id": r["id"], "kind": r["kind"], "title": r["title"], "config": json.loads(r["config_json"]), "created_at": r["created_at"]}


def list_all(db: Database) -> list[dict]:
    return [_row(r) for r in db.query("SELECT * FROM widgets ORDER BY created_at, id")]


def create(db: Database, kind: str, title, config) -> dict:
    abilities.require(db, "widgets")
    t, c = validate(kind, title, config)
    if db.one("SELECT COUNT(*) AS n FROM widgets")["n"] >= MAX_WIDGETS:
        raise ApiError(409, "too_many_widgets", f"up to {MAX_WIDGETS} widgets")
    wid = new_id("wdg")
    db.execute("INSERT INTO widgets(id,kind,title,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)", (wid, kind, t, json.dumps(c), now(), now()))
    abilities.receipt(db, actor="widgets", kind="widget.created", summary=f"Added a {kind} panel called \"{t}\" to Today.", changed=True)
    return _row(db.one("SELECT * FROM widgets WHERE id=?", (wid,)))


def update(db: Database, wid: str, config) -> dict:
    abilities.require(db, "widgets")
    row = db.one("SELECT * FROM widgets WHERE id=?", (wid,))
    if not row:
        raise ApiError(404, "not_found", "No such widget.")
    _, c = validate(row["kind"], row["title"], config)
    db.execute("UPDATE widgets SET config_json=?, updated_at=? WHERE id=?", (json.dumps(c), now(), wid))
    return _row(db.one("SELECT * FROM widgets WHERE id=?", (wid,)))


def delete(db: Database, wid: str) -> None:
    row = db.one("SELECT title FROM widgets WHERE id=?", (wid,))
    if not row:
        raise ApiError(404, "not_found", "No such widget.")
    db.execute("DELETE FROM widgets WHERE id=?", (wid,))        # removing is always allowed, even when the ability is off or paused
    abilities.receipt(db, actor="owner", kind="widget.deleted", summary=f"Removed the panel \"{row['title']}\".", changed=True)
