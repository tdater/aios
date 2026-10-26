"""Home Base routes (/api/v1/home): findings, the weekly check-up, and the one door for actions. Same auth and CSRF as the rest."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import homebase
from .db import Database
from .security import redact_obj


class HomeActionIn(BaseModel):
    action: str
    finding_id: str | None = None


class HomeCheckupIn(BaseModel):
    enabled: bool


def build_router(db: Database, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.get("/home/findings")
    def findings():
        return {"items": redact_obj(homebase.current_findings(db))}

    @r.post("/home/actions")
    def action(body: HomeActionIn):
        return redact_obj(homebase.act(db, body.action, body.finding_id))

    @r.get("/home/check-up")
    def checkup_status():
        return homebase.checkup_status(db)

    @r.put("/home/check-up")
    def checkup_set(body: HomeCheckupIn):
        homebase.set_checkup(db, body.enabled)
        return homebase.checkup_status(db)

    @r.post("/home/check-up/run")
    def checkup_run():
        return redact_obj(homebase.run_checkup(db))

    return r
