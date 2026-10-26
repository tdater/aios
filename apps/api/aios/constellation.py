"""The Constellation: every approved memory as a star, with what it has actually been used for.

Every visual property is one stored fact, computed here from the ledgers AIOS already keeps (`memories`,
`context_supplied`, and the verification results AIOS itself recorded). Nothing is similarity-guessed and
nothing is hidden in a score: a star that was used but never verified is reported as exactly that."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone

from .db import Database

STALE_AFTER_DAYS = 90
HALF_LIFE_DAYS = 60.0
LINK_KINDS = ("supersedes",)   # derived-from and contradicts have no stored source yet; none are invented


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def brightness(verified_uses: int, uses: int, days_since_verified: float | None) -> float:
    """0..1. Verified-and-used is bright and fades with time since the last verified use; used-only is a
    dim hollow outline; never used is faintest. A verified use is what makes a star bright, nothing else."""
    if verified_uses > 0 and days_since_verified is not None:
        fade = math.exp(-max(0.0, days_since_verified) * math.log(2) / HALF_LIFE_DAYS)
        reach = min(1.0, 0.5 + 0.1 * verified_uses)
        return round(0.2 + 0.8 * reach * fade, 3)
    return 0.15 if uses > 0 else 0.08


def _usage(db: Database) -> tuple[dict[str, list[dict]], set[str]]:
    passed_runs: set[str] = set()
    for m in db.query("SELECT run_id, meta_json FROM conversation_messages WHERE kind='verification' AND run_id IS NOT NULL"):
        try:
            if json.loads(m["meta_json"] or "{}").get("passed") is True:
                passed_runs.add(m["run_id"])
        except ValueError:
            continue
    by_mem: dict[str, list[dict]] = {}
    for u in db.query("SELECT item_ref, run_id, conversation_id, item_version, created_at FROM context_supplied "
                      "WHERE item_kind='memory' ORDER BY created_at"):
        by_mem.setdefault(u["item_ref"], []).append(u)
    return by_mem, passed_runs


def build(db: Database, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    usage, passed = _usage(db)
    projects = {p["id"]: p["name"] for p in db.query("SELECT id, name FROM projects")}
    stars, ids = [], set()
    rows = db.query("SELECT id, scope, project_id, type, title, status, sensitivity, created_at, last_reviewed_at, "
                    "superseded_by FROM memories WHERE deleted=0 AND status IN ('approved','candidate','superseded')")
    for m in rows:
        uses = usage.get(m["id"], [])
        ok = [u for u in uses if u["run_id"] in passed]
        last_ok = _parse(ok[-1]["created_at"]) if ok else None
        reviewed = _parse(m["last_reviewed_at"]) or _parse(m["created_at"])
        if m["status"] == "candidate":
            state = "candidate"
        elif m["status"] == "superseded":
            state = "superseded"
        elif reviewed and now - reviewed > timedelta(days=STALE_AFTER_DAYS):
            state = "stale"
        else:
            state = "fresh"
        days_ok = (now - last_ok).total_seconds() / 86400 if last_ok else None
        title = "(private item)" if m["sensitivity"] == "secret-adjacent" else m["title"]
        stars.append({
            "id": m["id"], "title": title, "type": m["type"], "scope": m["scope"], "project_id": m["project_id"],
            "project": projects.get(m["project_id"]) if m["project_id"] else None, "state": state,
            "uses": len(uses), "verified_uses": len(ok), "hollow": bool(uses) and not ok,
            "last_used": uses[-1]["created_at"] if uses else None, "last_verified": ok[-1]["created_at"] if ok else None,
            "brightness": brightness(len(ok), len(uses), days_ok) if m["status"] != "candidate" else 0.1,
        })
        ids.add(m["id"])
    links = [{"kind": "supersedes", "from": m["superseded_by"], "to": m["id"]}
             for m in rows if m["status"] == "superseded" and m["superseded_by"] in ids]
    clusters = sorted({s["project"] or "Everywhere" for s in stars})
    return {"stars": stars, "links": links, "clusters": clusters, "link_kinds": list(LINK_KINDS),
            "totals": {"stars": len(stars), "verified": sum(1 for s in stars if s["verified_uses"]),
                       "hollow": sum(1 for s in stars if s["hollow"]), "stale": sum(1 for s in stars if s["state"] == "stale")}}


def evidence(db: Database, memory_id: str) -> dict | None:
    """Where a star has been used: each use with its conversation and whether AIOS's own check passed."""
    if not db.one("SELECT id FROM memories WHERE id=? AND deleted=0", (memory_id,)):
        return None
    usage, passed = _usage(db)
    titles = {c["id"]: c["title"] for c in db.query("SELECT id, title FROM conversations")}
    uses = [{"run_id": u["run_id"], "conversation_id": u["conversation_id"], "conversation": titles.get(u["conversation_id"]),
             "memory_version": u["item_version"], "at": u["created_at"], "verified": u["run_id"] in passed}
            for u in usage.get(memory_id, [])]
    return {"memory_id": memory_id, "uses": uses[-50:], "total_uses": len(uses),
            "verified_uses": sum(1 for u in uses if u["verified"])}
