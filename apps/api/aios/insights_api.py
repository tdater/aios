"""Read-only views over what AIOS already knows: the Constellation and the Skyline."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import abilities, briefing, constellation, overview, system_scan, widgets
from .config import Settings
from .db import Database
from .errors import ApiError
from .security import redact_obj


class AbilityIn(BaseModel):
    enabled: bool
    confirm: bool = False


class WidgetIn(BaseModel):
    kind: str = Field(max_length=16)
    title: str = Field(max_length=200)
    config: dict


class WidgetConfigIn(BaseModel):
    config: dict


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

    @r.get("/briefing/{provider}")
    def get_briefing(provider: str, project_id: str | None = None):
        if provider not in briefing.CEILING:
            raise ApiError(404, "unknown_provider", f"provider must be one of {briefing.providers()}")
        return redact_obj(briefing.build(db, settings, provider=provider, project_id=project_id))

    @r.get("/abilities")
    def get_abilities():
        return abilities.status(db)

    @r.put("/abilities/{name}")
    def put_ability(name: str, body: AbilityIn):
        abilities.set_enabled(db, name, body.enabled, body.confirm)
        return abilities.status(db)

    @r.post("/pause")
    def pause():
        abilities.set_paused(db, True)
        return {"paused": True}

    @r.post("/resume")
    def resume():
        abilities.set_paused(db, False)
        return {"paused": False}

    @r.get("/receipts")
    def get_receipts(changed_only: bool = False, limit: int = 100):
        return {"items": redact_obj(abilities.receipts(db, changed_only=changed_only, limit=max(1, limit)))}

    @r.post("/system-scan")
    def run_system_scan():
        abilities.require(db, "system_scan")
        facts = system_scan.collect()
        abilities.receipt(db, actor="system_scan", kind="system_scan.run", summary="Read memory, disk, temp-folder size and start-up count. Changed nothing.")
        return {"facts": facts, "suggestions": system_scan.suggest(facts), "changed_anything": False}

    @r.get("/widgets")
    def get_widgets():
        return {"items": redact_obj(widgets.list_all(db))}

    @r.post("/widgets/preview")
    def preview_widget(body: WidgetIn):
        return widgets.propose(body.kind, body.title, body.config)

    @r.post("/widgets", status_code=201)
    def post_widget(body: WidgetIn):
        return redact_obj(widgets.create(db, body.kind, body.title, body.config))

    @r.put("/widgets/{wid}")
    def put_widget(wid: str, body: WidgetConfigIn):
        return redact_obj(widgets.update(db, wid, body.config))

    @r.delete("/widgets/{wid}", status_code=204)
    def del_widget(wid: str):
        widgets.delete(db, wid)

    return r
