"""Read-only views over what AIOS already knows: the Constellation and the Skyline."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from . import constellation, overview
from .config import Settings
from .db import Database
from .errors import ApiError
from .security import redact_obj


def build_router(db: Database, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.get("/constellation")
    def get_constellation():
        return redact_obj(constellation.build(db))

    @r.get("/constellation/{memory_id}")
    def get_star(memory_id: str):
        ev = constellation.evidence(db, memory_id)
        if ev is None:
            raise ApiError(404, "not_found", "No such memory.")
        return redact_obj(ev)

    @r.get("/skyline")
    def get_skyline():
        return redact_obj(overview.skyline(db))

    return r
