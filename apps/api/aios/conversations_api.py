"""Conversation routes (/api/v1). Same auth, CSRF and idempotency rules as the rest of the API.
There is no route that runs a command or reads an arbitrary path: a turn is a task of kind
claude.turn on a registered project, and verification needs an approval."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field

from . import conversations, handoff, idempotency, services
from .config import Settings
from .db import Database
from .errors import not_found
from .security import redact_obj


class ConversationIn(BaseModel):
    project_id: str
    title: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=64)


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=conversations.MAX_MESSAGE_CHARS)
    mode: str = "read"


class ConversationReviewIn(BaseModel):    # not "ReviewIn": history_api already publishes a schema by that name
    model: str | None = Field(default=None, max_length=64)
    patch_message_id: str | None = None


class HandoffIn(BaseModel):
    provider: str = Field(max_length=32)
    question: str = Field(min_length=1, max_length=handoff.MAX_QUESTION)


class HandoffReplyIn(BaseModel):
    provider: str = Field(max_length=32)
    reply: str = Field(min_length=1, max_length=handoff.MAX_REPLY)


class VerifyCommandIn(BaseModel):
    argv: list[str] | None = None


def build_router(db: Database, engine, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.get("/conversations")
    def list_conversations(project_id: str | None = None, limit: int | None = Query(None, ge=1, le=200),
                           cursor: str | None = None):
        return redact_obj(conversations.list_conversations(db, project_id=project_id, limit=limit,
                                                           cursor=cursor))

    @r.post("/conversations", status_code=201)
    def create_conversation(body: ConversationIn):
        return redact_obj(conversations.create(db, project_id=body.project_id, title=body.title,
                                               model=body.model))

    @r.get("/conversations/{conversation_id}")
    def conversation(conversation_id: str):
        return conversations.view(db, conversation_id)

    @r.get("/conversations/{conversation_id}/messages")
    def conversation_messages(conversation_id: str, after_seq: int = Query(0, ge=0)):
        """Cheap poll for new messages plus the current turn's state."""
        conversations.require(db, conversation_id)
        items = conversations.messages(db, conversation_id, after_seq)
        run = conversations.active_turn(db, conversation_id)
        last = db.one("SELECT COALESCE(MAX(seq),0) AS m FROM conversation_messages WHERE conversation_id=?",
                      (conversation_id,))["m"]
        return redact_obj({"items": items, "last_seq": last,
                           "active_run": services.decorate_run(db, run, with_cancel=False) if run else None})

    @r.post("/conversations/{conversation_id}/messages", status_code=201)
    def post_message(conversation_id: str, body: MessageIn, response: Response,
                     idempotency_key: str | None = Header(default=None)):
        def create() -> tuple[int, dict]:
            return 201, redact_obj(conversations.post_user_message(db, engine, conversation_id,
                                                                   body.content, body.mode))
        status, out, replay = idempotency.run_idempotent(
            db, "POST /conversations/messages", idempotency_key,
            {"conversation": conversation_id, **body.model_dump()}, create)
        response.status_code = 200 if replay else status
        if replay:
            response.headers["Idempotent-Replay"] = "true"
        return out

    @r.post("/conversations/{conversation_id}/apply", status_code=201)
    def request_apply(conversation_id: str):
        return redact_obj(conversations.request_apply(db, engine, conversation_id))

    @r.post("/conversations/{conversation_id}/handoff", status_code=201)
    def prepare_handoff(conversation_id: str, body: HandoffIn):
        return redact_obj(handoff.prepare(db, settings, conversation_id, body.provider, body.question))

    @r.post("/conversations/{conversation_id}/handoff/reply", status_code=201)
    def record_handoff_reply(conversation_id: str, body: HandoffReplyIn):
        return redact_obj(handoff.record_reply(db, conversation_id, body.provider, body.reply))

    @r.post("/conversations/{conversation_id}/review", status_code=201)
    def request_review(conversation_id: str, body: ConversationReviewIn, response: Response,
                       idempotency_key: str | None = Header(default=None)):
        """Ask for an independent review of the latest recorded change. A fresh read-only Claude session
        reviews the exact revision; AIOS, not the reviewer, decides readiness."""
        def create() -> tuple[int, dict]:
            return 201, redact_obj(conversations.request_review(db, engine, conversation_id, model=body.model,
                                                                patch_message_id=body.patch_message_id))
        status, out, replay = idempotency.run_idempotent(
            db, "POST /conversations/review", idempotency_key, {"conversation": conversation_id, **body.model_dump()},
            create)
        response.status_code = 200 if replay else status
        if replay:
            response.headers["Idempotent-Replay"] = "true"
        return out

    @r.get("/conversations/{conversation_id}/changes")
    def conversation_changes(conversation_id: str):
        conversations.require(db, conversation_id)
        return redact_obj(conversations.changes(db, conversation_id))

    @r.get("/projects/{project_id}/verify-command")
    def get_verify_command(project_id: str):
        if not db.one("SELECT 1 AS x FROM projects WHERE id=?", (project_id,)):
            raise not_found("project")
        return {"project_id": project_id, "argv": conversations.verify_argv(db, project_id)}

    @r.put("/projects/{project_id}/verify-command")
    def put_verify_command(project_id: str, body: VerifyCommandIn):
        """The owner decides what verification means for a project. Providers cannot set this."""
        return {"project_id": project_id, "argv": conversations.set_verify_command(db, project_id, body.argv)}

    return r
