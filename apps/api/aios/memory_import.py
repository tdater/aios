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
_BULLET = re.compile(r"^\s*(?:[-*•·▪◦‣–—]|\d{1,2}[.)])\s+(.*\S)\s*$")
_HEADING = re.compile(r"^\s*(?:#{1,4}\s*)?\**([A-Za-z][A-Za-z '&/-]{2,40}?)\**\s*:?\s*$")


def prompt_for(provider: str) -> dict:
    if provider not in SOURCES:
        raise ApiError(404, "unknown_source", f"source must be one of {sorted(SOURCES)}")
    return {"provider": provider, "name": SOURCES[provider], "prompt": PROMPT}


def _type_for(heading: str) -> str:
    h = heading.lower()
    return next((t for key, t in _SECTIONS if key in h), "fact")


_META = re.compile(r"^(here('s| is| are)|sure|certainly|of course|okay|ok|i (don't|do not|cannot|can't|am unable|have no)|as an ai|note:|i hope|let me know|feel free)", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")


def _classify(fact: str, section: str, items: list, skipped: list, seen: set) -> None:
    key = fact.casefold()
    if key in seen:
        return
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


def _table_cells(line: str) -> str | None:
    """A markdown table row such as `| Likes | Short answers |` becomes 'Likes: Short answers'. Separator rows give nothing."""
    if "|" not in line or not line.strip().startswith("|"):
        return None
    cells = [c.strip().strip("*_ ") for c in line.strip().strip("|").split("|")]
    if all(re.fullmatch(r":?-{2,}:?", c) or not c for c in cells):
        return ""
    return ": ".join(c for c in cells if c)


def parse(text: str) -> tuple[list[dict], list[dict]]:
    """Returns (items, skipped). An item is {type, title}. Nothing is dropped silently: skipped says why.
    A list of dashed or numbered lines is the expected shape. When the answer has none (some AIs reply in paragraphs or a
    table), each sentence or table row is read as a fact instead, so a perfectly good answer is not thrown away."""
    items, skipped, section, seen, bulleted = [], [], "", set(), set()
    loose: list[tuple[str, str]] = []                    # (section, text) read only if no list was found
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
            row = _table_cells(line)
            if row is not None:
                if row:
                    loose.append((section, row))
                continue
            plain = " ".join(line.split()).strip("*_ ")
            if plain and not _META.match(plain):
                loose += [(section, sent.strip()) for sent in _SENTENCE.split(plain) if sent.strip()]
            continue
        bulleted.add(section)
        _classify(" ".join(m.group(1).split()).strip("*_ "), section, items, skipped, seen)
    for sec, fact in loose:                              # prose or table rows: under a heading that has no list of its own, or when there is no list at all
        if not _META.match(fact) and (not bulleted or (sec and sec not in bulleted)):
            _classify(fact, sec, items, skipped, seen)
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
    return {"created": len(created), "memory_ids": created, "duplicates": duplicates, "skipped": skipped, "source": SOURCES[provider],
            "lines_read": len([x for x in text.splitlines() if x.strip()]),
            "hint": None if created or duplicates or skipped else
            "AIOS did not find any facts about you in that text. Check that you pasted the answer and not the request, and that the AI did not say it has nothing to share."}
