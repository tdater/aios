"""The Skyline: one building per active project, computed from stored facts only.

floors   = distinct revisions whose tests AIOS ran and saw pass (verified outcomes)
working  = runs queued or running for the project
waiting  = runs that need the owner (approval, blocked, interrupted)"""
from __future__ import annotations

import json

from .db import Database

WORKING = ("queued", "running")
WAITING = ("awaiting_approval", "blocked", "interrupted")


def skyline(db: Database) -> dict:
    floors: dict[str, set[str]] = {}
    for m in db.query("SELECT c.project_id AS pid, m.meta_json AS meta FROM conversation_messages m "
                      "JOIN conversations c ON c.id=m.conversation_id WHERE m.kind='verification'"):
        try:
            meta = json.loads(m["meta"] or "{}")
        except ValueError:
            continue
        if meta.get("passed") is True and meta.get("head_revision"):
            floors.setdefault(m["pid"], set()).add(str(meta["head_revision"]))
    runs: dict[str, dict[str, int]] = {}
    for r in db.query("SELECT t.project_id AS pid, r.state AS state, COUNT(*) AS n FROM runs r JOIN tasks t ON t.id=r.task_id "
                      "WHERE r.state IN ('queued','running','awaiting_approval','blocked','interrupted') GROUP BY t.project_id, r.state"):
        runs.setdefault(r["pid"], {})[r["state"]] = r["n"]
    convs = {c["project_id"]: c["n"] for c in db.query(
        "SELECT project_id, COUNT(*) AS n FROM conversations WHERE status='open' GROUP BY project_id")}
    out = []
    for p in db.query("SELECT id, name FROM projects WHERE status='active' ORDER BY name"):
        rs = runs.get(p["id"], {})
        out.append({"id": p["id"], "name": p["name"], "floors": len(floors.get(p["id"], ())),
                    "working": sum(rs.get(s, 0) for s in WORKING), "waiting": sum(rs.get(s, 0) for s in WAITING),
                    "conversations": convs.get(p["id"], 0)})
    return {"projects": out, "totals": {"projects": len(out), "floors": sum(b["floors"] for b in out),
                                         "waiting": sum(b["waiting"] for b in out)}}
