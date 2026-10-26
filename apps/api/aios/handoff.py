"""Other AIs inside a conversation, by copy and paste. AIOS never calls Gemini, Perplexity or Antigravity: it writes a
ready-to-paste prompt (with that AI's briefing) and takes the pasted reply back into the same thread, labelled as
unverified and attributed to its source. Pasted replies are data: nothing mines them for memories or feeds them to Claude."""
from __future__ import annotations

from . import briefing, conversations
from .config import Settings
from .db import Database
from .errors import ApiError

MANUAL = tuple(p for p in briefing.providers() if p != "claude")
MAX_QUESTION, MAX_REPLY = 6000, 30000
LABEL = {"gemini": "Gemini", "perplexity": "Perplexity", "antigravity": "Antigravity"}


def _check(provider: str) -> None:
    if provider not in MANUAL:
        raise ApiError(422, "bad_provider", f"provider must be one of {list(MANUAL)}; Claude answers in the normal chat")


def prepare(db: Database, settings: Settings, conversation_id: str, provider: str, question: str) -> dict:
    _check(provider)
    conv = conversations.require(db, conversation_id)
    q = (question or "").strip()
    if not q or len(q) > MAX_QUESTION:
        raise ApiError(422, "bad_question", f"write a question of up to {MAX_QUESTION} characters")
    b = briefing.build(db, settings, provider=provider, project_id=conv["project_id"])
    ctx = f"<aios_briefing>\n{b['text']}\n</aios_briefing>\n\n" if b["text"] else ""
    prompt = f"{ctx}Question from the owner:\n{q}\n\nAnswer in plain text."
    msg = conversations.add_message(
        db, conversation_id, role="system", author_kind="aios", author="aios",
        content=f"Prompt prepared for {LABEL[provider]}. Copy it, paste it into {LABEL[provider]}, then paste the answer back here.\n\n{prompt}",
        meta={"handoff": {"provider": provider, "step": "prompt", "briefing_sha256": b["sha256"], "briefing_items": len(b["items"])}})
    return {"prompt": prompt, "message_id": msg["id"], "briefing_items": len(b["items"]), "briefing_sha256": b["sha256"]}


def record_reply(db: Database, conversation_id: str, provider: str, reply: str) -> dict:
    _check(provider)
    conversations.require(db, conversation_id)
    text = (reply or "").strip()
    if not text or len(text) > MAX_REPLY:
        raise ApiError(422, "bad_reply", f"paste an answer of up to {MAX_REPLY} characters")
    msg = conversations.add_message(
        db, conversation_id, role="assistant", author_kind="provider", author=f"{LABEL[provider]} (pasted by you; AIOS did not run or verify it)",
        content=text, meta={"handoff": {"provider": provider, "step": "reply", "unverified": True}})
    return {"message_id": msg["id"]}
