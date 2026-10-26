"""The Universe: one picture of everything AIOS is, built only from stored facts.

  core      you: how much AIOS knows about you
  planets   your AIs. Distance from the core is how much each may be told (inner = private memories, outer = public only)
  stars     approved memories (see constellation.py for what shape, size and brightness mean)
  comets    things waiting for you: approvals, blocked work, suggestions to review
  beams     the memories one AI has actually been given (shown when you pick a planet)

Nothing here is decorative: every element is one stored fact, and each is explained on screen."""
from __future__ import annotations

from . import abilities, briefing, constellation, memory_capture, providers, sharing
from .config import Settings
from .db import Database


def _ai_mode(caps: dict[str, dict], provider: str) -> str:
    cap = caps.get(provider)
    if provider == "claude":
        return (cap or {}).get("mode", "unknown")      # interactive / unavailable, from the real preflight
    return "manual"                                    # reached by copy and paste: AIOS never contacts it


def build(db: Database, settings: Settings) -> dict:
    con = constellation.build(db)
    caps = {c["provider"]: c for c in providers.list_caps(db)}
    ais = []
    for p in sharing.providers():
        b = briefing.build(db, settings, provider=p)
        ais.append({"provider": p, "name": sharing.LABEL[p], "mode": _ai_mode(caps, p), "level": sharing.level(db, p),
                    "default_level": sharing.DEFAULT_LEVEL[p], "told": [i["id"] for i in b["items"]], "told_count": len(b["items"])})
    approvals = db.one("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'")["n"]
    blocked = db.one("SELECT COUNT(*) AS n FROM runs WHERE state IN ('blocked','interrupted')")["n"]
    suggestions = db.one("SELECT COUNT(*) AS n FROM memories WHERE status='candidate' AND deleted=0")["n"]
    history = db.one("SELECT COUNT(*) AS n FROM candidates WHERE status='candidate'")["n"]
    stars = con["stars"]
    return {
        "you": {"approved": sum(1 for s in stars if s["state"] in ("fresh", "stale")), "suggested": suggestions,
                "learning": memory_capture.learning_on(db)},
        "ais": ais,
        "stars": stars, "links": con["links"], "clusters": con["clusters"], "totals": con["totals"],
        "comets": {"approvals": approvals, "blocked": blocked, "to_review": suggestions + history},
        "paused": abilities.is_paused(db),
    }
