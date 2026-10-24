"""HTTP surface for the skill improvement loop. Evaluation is automatic; promotion and rollback are human actions
that require an authenticated device session and an explicit confirmation flag."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from . import improvements
from .config import Settings
from .db import Database
from .security import redact_obj


class SubmitIn(BaseModel):
    name: str = Field(min_length=3, max_length=49)
    content: str = Field(min_length=20, max_length=60_000)
    evals: dict
    rationale: str = Field(min_length=3, max_length=2000)
    target_path: str | None = None
    new_evidence: str | None = Field(default=None, max_length=2000)


class RejectIn(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


class PromoteIn(BaseModel):
    confirm: bool = False
    note: str = Field(default="", max_length=1000)


class RollbackIn(BaseModel):
    to_version: int | None = Field(default=None, ge=1)
    note: str = Field(default="", max_length=1000)


def build_router(db: Database, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    def who(request: Request) -> str:
        return f"session:{request.state.session['id']}"

    @r.get("/skills")
    def overview():
        return redact_obj(improvements.overview(db))

    @r.get("/skills/candidates/{cid}")
    def candidate(cid: str):
        return redact_obj(improvements.candidate_detail(db, cid))

    @r.post("/skills/candidates", status_code=201)
    def submit(body: SubmitIn):
        return redact_obj(improvements.submit(db, name=body.name, content=body.content, evals=body.evals,
                                              rationale=body.rationale, target_path=body.target_path,
                                              new_evidence=body.new_evidence))

    @r.post("/skills/candidates/{cid}/evaluate")
    def evaluate(cid: str):
        return improvements.evaluate(db, settings, cid)

    @r.post("/skills/candidates/{cid}/reject")
    def reject(cid: str, body: RejectIn):
        return redact_obj(improvements.reject(db, cid, body.note))

    @r.post("/skills/candidates/{cid}/promote")
    def promote(cid: str, body: PromoteIn, request: Request):
        return improvements.promote(db, settings, cid, confirm=body.confirm, approved_by=who(request), note=body.note)

    @r.post("/skills/{name}/rollback")
    def rollback(name: str, body: RollbackIn, request: Request):
        return improvements.rollback(db, settings, name, approved_by=who(request), to_version=body.to_version, note=body.note)

    return r
