"""Proposes memories from what happened in a conversation. Everything here is a CANDIDATE: nothing is used
by any AI until the owner approves it.

Only two sources are trusted enough to propose from:
  * the owner's own words, when they clearly ask to remember something ("remember that...", "always...", "never...");
  * a verification result AIOS itself ran and saw pass.
AI-written text, repository text and retrieved notes are never mined: that is how memory poisoning works."""
from __future__ import annotations

import hashlib
import re

from . import abilities, memory
from .config import Settings
from .db import Database
from .security import find_secret_kinds

MAX_PER_MESSAGE = 3
MIN_LEN, MAX_LEN = 12, 300
_CUES = (("remember that ", "fact"), ("remember: ", "fact"), ("remember ", "fact"), ("from now on", "preference"),
         ("always ", "preference"), ("never ", "preference"), ("please always ", "preference"), ("please never ", "preference"),
         ("i prefer ", "preference"), ("don't ever ", "preference"), ("do not ever ", "preference"))
_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def learning_on(db: Database) -> bool:
    """The owner's switch for learning from what they type. On by default; off stops every automatic suggestion."""
    return abilities.get_flag(db, "learning", "1") == "1"


def _exists(db: Database, source: str) -> bool:
    return bool(db.one("SELECT 1 AS x FROM memory_evidence e JOIN memories m ON m.id=e.memory_id WHERE e.source=? AND m.deleted=0", (source,)))


def _title(sentence: str) -> str:
    t = re.sub(r"^(please\s+)?(remember(\s+that)?[:,]?\s+)", "", sentence.strip(), flags=re.I)
    t = t[0].upper() + t[1:] if t else t
    return (t[:77] + "…") if len(t) > 78 else t


def from_user_message(db: Database, settings: Settings, conv: dict, message: dict) -> list[str]:
    """Candidate memories from one message the owner typed. Returns the new memory ids."""
    if message.get("author_kind") != "user" or message.get("kind", "message") != "message":
        return []
    if not learning_on(db):
        return []
    made: list[str] = []
    for raw in _SPLIT.split(message["content"] or ""):
        s = raw.strip()
        low = s.lower()
        if len(made) >= MAX_PER_MESSAGE or not (MIN_LEN <= len(s) <= MAX_LEN) or "?" in s:
            continue
        kind = next((k for cue, k in _CUES if low.startswith(cue)), None)
        if not kind or find_secret_kinds(s):
            continue
        source = f"conversation_message:{message['id']}:{hashlib.sha256(low.encode()).hexdigest()[:10]}"
        if _exists(db, source):
            continue
        made.append(memory.create(
            db, settings, scope="project", project_id=conv["project_id"], type=kind, title=_title(s),
            body=f"{s}\n\nCaptured automatically from something you wrote in the conversation \"{conv['title']}\". "
                 "Check that it says what you meant before approving it.",
            basis="observation", confidence=0.6, status="candidate", sources=[source], tags=["captured"]))
    if made:
        abilities.receipt(db, actor="learning", kind="memory.proposed", changed=True,
                          summary=f"Noticed {len(made)} thing{'s' if len(made) > 1 else ''} you asked to remember and suggested {'them' if len(made) > 1 else 'it'} for your approval.")
    return made


def from_passed_verification(db: Database, settings: Settings, conv: dict, argv: list[str], revision: str) -> str | None:
    """One candidate per project and command: the owner's verification command passed on a real change."""
    if not learning_on(db):
        return None
    key = hashlib.sha256(" ".join(argv).encode()).hexdigest()[:12]
    source = f"verification:{conv['project_id']}:{key}"
    if _exists(db, source):
        return None
    project = db.one("SELECT name FROM projects WHERE id=?", (conv["project_id"],)) or {"name": "this project"}
    cmd = " ".join(argv)
    return memory.create(
        db, settings, scope="project", project_id=conv["project_id"], type="fact", title=f"`{cmd}` passes for {project['name']}",
        body=f"AIOS ran `{cmd}` and it passed on revision {revision[:12]} of {project['name']}. "
             "This is a fact AIOS observed itself, not something an AI claimed.",
        basis="observation", confidence=0.8, status="candidate", sources=[source], tags=["captured", "verified"])
