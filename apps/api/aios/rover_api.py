"""Rover routes (/api/v1/rover): visible state, start a task (explicit opt-in), take a step, finish, and Stop. Same auth and CSRF as the rest.
Stop is deliberately not behind the ability or pause checks: it must always work."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import rover
from .config import Settings
from .db import Database
from .errors import not_found
from .security import redact_obj


class RoverTaskIn(BaseModel):
    goal: str
    level: int = 1
    target: str
    minutes: int | None = None
    opt_in: bool = False


def build_router(db: Database, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    @r.get("/rover")
    def state():
        return redact_obj(rover.state(db, settings))

    @r.post("/rover/tasks")
    def start(body: RoverTaskIn):
        return redact_obj(rover.start(db, body.goal, body.level, body.target, body.opt_in, body.minutes))

    @r.get("/rover/tasks/{task_id}")
    def one(task_id: str):
        row = rover._row(db, task_id)
        if not row:
            raise not_found("rover task")
        return redact_obj(rover._view(db, row))

    @r.post("/rover/tasks/{task_id}/step")
    def step(task_id: str):
        return redact_obj(rover.step(db, settings, task_id))

    @r.post("/rover/tasks/{task_id}/finish")
    def finish(task_id: str):
        return redact_obj(rover.finish(db, settings, task_id))

    @r.post("/rover/stop")
    def stop():
        return rover.stop(db, settings)

    return r
