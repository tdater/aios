"""Object routes (/api/v1/universe/objects): list, one card, change settings, run an action. Same auth and CSRF as the rest."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import objects
from .config import Settings
from .db import Database
from .errors import not_found
from .security import redact_obj


class ConfigIn(BaseModel):
    values: dict = Field(default_factory=dict)
    confirm: bool = False


def build_router(db: Database, settings: Settings, require_auth, skills_dir: Path | None = None) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.get("/universe/objects")
    def list_objects():
        return {"items": redact_obj(objects.build(db, settings, skills_dir)), "version": 1}

    @r.get("/universe/objects/{object_id:path}/card")
    def one(object_id: str):
        return redact_obj(objects.card(db, settings, object_id, skills_dir))

    @r.put("/universe/objects/{object_id:path}/config")
    def change(object_id: str, body: ConfigIn):
        return redact_obj(objects.apply(db, settings, object_id, body.values, body.confirm))

    @r.post("/universe/objects/{object_id:path}/actions/{action}")
    def do(object_id: str, action: str):
        return redact_obj(objects.act(db, settings, object_id, action))

    return r
