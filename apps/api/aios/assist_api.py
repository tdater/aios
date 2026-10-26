"""The dashboard's single prompt: preview the plan, start the task, read it back, and the dashboard summary (/api/v1)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field

from . import assist, idempotency, triage
from .config import Settings
from .db import Database
from .security import redact_obj


class AssistIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=triage.MAX_PROMPT)
    project_id: str | None = Field(default=None, max_length=64)
    kind: str | None = Field(default=None, max_length=32)


def build_router(db: Database, engine, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.post("/assist/plan")
    def plan(body: AssistIn):
        """What AIOS would do with this request. Changes nothing."""
        return redact_obj(assist.preview(db, settings, body.prompt, body.project_id, body.kind))

    @r.post("/assist", status_code=201)
    def start(body: AssistIn, response: Response, idempotency_key: str | None = Header(default=None)):
        def create() -> tuple[int, dict]:
            return 201, assist.create(db, engine, settings, body.prompt, body.project_id, body.kind)
        status, out, replay = idempotency.run_idempotent(db, "POST /assist", idempotency_key, body.model_dump(), create)
        response.status_code = 200 if replay else status
        if replay:
            response.headers["Idempotent-Replay"] = "true"
        return out

    @r.get("/assist")
    def recent(limit: int = Query(12, ge=1, le=50)):
        return {"items": redact_obj(assist.recent(db, limit))}

    @r.get("/assist/{assist_id}")
    def one(assist_id: str):
        return assist.view(db, assist_id)

    @r.get("/dashboard")
    def dashboard():
        return redact_obj(assist.dashboard(db, settings))

    return r
