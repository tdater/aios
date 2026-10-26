"""Bring what another AI already knows about you into AIOS, so you are not starting from scratch.

The route is deliberately simple and official: you ask the other AI, in its own app, to summarise what it knows about you
(AIOS writes that request for you), and paste its answer here. AIOS turns the answer into SUGGESTED memories.

Everything imported is untrusted: it was written by an AI and passed through a person. So nothing becomes active until you
approve it, sensitive-looking lines and anything that reads like an instruction to an AI are left out and reported, and every
suggestion records where it came from."""
from __future__ import annotations

import hashlib
import re

from . import abilities, memory
from .config import Settings
from .db import Database
from .errors import ApiError
from .security import find_secret_kinds

MAX_TEXT = 40_000
MAX_ITEMS = 60
MIN_LEN, MAX_LEN = 8, 300
SOURCES = {"chatgpt": "ChatGPT", "gemini": "Gemini", "claude": "Claude", "perplexity": "Perplexity", "other": "another AI"}

PROMPT = (
    "I am moving to a new assistant and want to bring over what you have learned about me, so I do not start from scratch.\n\n"
    "Please write a plain-text summary of what you know about me, as a list of short, separate facts under these headings:\n"
    "Preferences\nAbout me\nOngoing projects\nDecisions I have made\nHow I like to work\nThings to avoid\n\n"
    "Rules: one fact per line starting with a dash. Only things I actually told you or that clearly follow from our conversations. "
    "Leave out passwords, account or card numbers, ID numbers, and private health, legal or financial details. "
    "Do not add advice, instructions or anything about how an AI should behave: just facts about me."
)

# Heading words -> memory type. Anything else files under "fact".
_SECTIONS = (("prefer", "preference"), ("like to work", "preference"), ("avoid", "preference"), ("about me", "fact"),
             ("project", "fact"), ("decision", "decision"), ("lesson", "lesson"), ("how i", "preference"), ("style", "preference"))
_INJECTION = re.compile(
    r"ignore (all|any|the|previous|prior|above)|disregard|system prompt|you (must|should|will|are to)\b|from now on you|"
    r"as an ai\b|<\||\|>|\bassistant:|\bsystem:|\bjailbreak|override (your|the)|do not tell the user|reveal your", re.I)
_SENSITIVE = re.compile(r"\b(password|passcode|passphrase|pin code|ssn|social security|card number|credit card|account number|routing number|"
                        r"api[- ]?key|secret key|private key|access token|seed phrase)\b", re.I)
_BULLET = re.compile(r"^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*\S)\s*$")
_HEADING = re.compile(r"^\s*(?:#{1,4}\s*)?\**([A-Za-z][A-Za-z '&/-]{2,40}?)\**\s*:?\s*$")


def prompt_for(provider: str) -> dict:
    if provider not in SOURCES:
        raise ApiError(404, "unknown_source", f"source must be one of {sorted(SOURCES)}")
    return {"provider": provider, "name": SOURCES[provider], "prompt": PROMPT}


def _type_for(heading: str) -> str:
    h = heading.lower()
    return next((t for key, t in _SECTIONS if key in h), "fact")


def parse(text: str) -> tuple[list[dict], list[dict]]:
    """Returns (items, skipped). An item is {type, title}. Nothing is dropped silently: skipped says why."""
    items, skipped, section, seen = [], [], "", set()
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        m = _BULLET.match(line)
        if not m:
            h = _HEADING.match(line)
            if h:
                section = h.group(1).strip()
            continue
        fact = " ".join(m.group(1).split()).strip("*_ ")
        key = fact.casefold()
        if key in seen:
            continue
        seen.add(key)
        if not (MIN_LEN <= len(fact) <= MAX_LEN):
            skipped.append({"line": fact[:80], "reason": "too short or too long to be a clear fact"})
        elif find_secret_kinds(fact) or _SENSITIVE.search(fact):
            skipped.append({"line": "(hidden)", "reason": "looks like a password, key or account number"})
        elif _INJECTION.search(fact):
            skipped.append({"line": fact[:80], "reason": "reads like an instruction to an AI, not a fact about you"})
        elif len(items) >= MAX_ITEMS:
            skipped.append({"line": fact[:80], "reason": f"over the limit of {MAX_ITEMS} suggestions at a time"})
        else:
            items.append({"type": _type_for(section), "title": fact, "section": section})
    return items, skipped


def import_paste(db: Database, settings: Settings, provider: str, text: str) -> dict:
    if provider not in SOURCES:
        raise ApiError(404, "unknown_source", f"source must be one of {sorted(SOURCES)}")
    text = (text or "").strip()
    if not text or len(text) > MAX_TEXT:
        raise ApiError(422, "bad_text", f"paste the answer (up to {MAX_TEXT} characters)")
    items, skipped = parse(text)
    created, duplicates = [], 0
    for it in items:
        source = f"import:paste:{provider}:{hashlib.sha256(it['title'].casefold().encode()).hexdigest()[:16]}"
        if db.one("SELECT 1 AS x FROM memory_evidence e JOIN memories m ON m.id=e.memory_id WHERE e.source=? AND m.deleted=0", (source,)):
            duplicates += 1
            continue
        created.append(memory.create(
            db, settings, scope="global", type=it["type"], title=it["title"][:200],
            body=f"{it['title']}\n\nImported from {SOURCES[provider]}{' (' + it['section'] + ')' if it['section'] else ''}. "
                 "It was written by an AI and pasted in by you, so check that it is true before approving it.",
            basis="inference", confidence=0.4, status="candidate", sources=[source], tags=["imported", provider]))
    if created:
        abilities.receipt(db, actor="import", kind="memory.imported", changed=True,
                          summary=f"Added {len(created)} suggested memor{'y' if len(created) == 1 else 'ies'} from {SOURCES[provider]}. None are used until you approve them.")
    return {"created": len(created), "memory_ids": created, "duplicates": duplicates, "skipped": skipped, "source": SOURCES[provider]}
