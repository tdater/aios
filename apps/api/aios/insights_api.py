"""Read-only views over what AIOS already knows: the Constellation and the Skyline."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import abilities, briefing, calibration, companion, constellation, memory_capture, memory_import, overview, services, sharing, system_scan, universe, widgets
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
    title: str | None = Field(default=None, max_length=60)


class FromCatalogIn(BaseModel):
    template: str = Field(max_length=40)
    title: str | None = Field(default=None, max_length=60)
    config: dict | None = None


class LevelIn(BaseModel):
    level: str = Field(max_length=16)


class PasteIn(BaseModel):
    provider: str = Field(max_length=16)
    text: str = Field(max_length=memory_import.MAX_TEXT)


class CopiedIn(BaseModel):
    suggestion_id: str = Field(max_length=32)
    conversation_id: str | None = Field(default=None, max_length=64)


class LearningIn(BaseModel):
    enabled: bool


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

    @r.get("/universe")
    def get_universe():
        return redact_obj(universe.build(db, settings))

    @r.get("/sharing")
    def get_sharing():
        out = []
        for p in sharing.providers():
            b = briefing.build(db, settings, provider=p)
            out.append({"provider": p, "name": sharing.LABEL[p], "level": sharing.level(db, p), "default_level": sharing.DEFAULT_LEVEL[p],
                        "told_count": len(b["items"])})
        return {"items": out, "levels": list(sharing.LEVELS)}

    @r.put("/sharing/{provider}")
    def put_sharing(provider: str, body: LevelIn):
        sharing.set_level(db, provider, body.level)
        return get_sharing()

    @r.get("/companion/{provider}")
    def get_companion(provider: str, conversation_id: str | None = None):
        return redact_obj(companion.suggestions(db, settings, provider, conversation_id))

    @r.post("/companion/{provider}/copied", status_code=201)
    def companion_copied(provider: str, body: CopiedIn):
        return companion.record_copied(db, settings, provider, body.suggestion_id, body.conversation_id)

    @r.get("/calibration")
    def get_calibration():
        """The last reviewer scorecard from the firing range. Read-only: running it is a deliberate script, since it uses Claude."""
        return redact_obj(calibration.latest(settings))

    @r.get("/learning")
    def get_learning():
        return {"enabled": memory_capture.learning_on(db)}

    @r.put("/learning")
    def put_learning(body: LearningIn):
        abilities.set_flag(db, "learning", "1" if body.enabled else "0")
        abilities.receipt(db, actor="owner", kind="learning.changed", changed=True,
                          summary="Turned on learning from what you ask AIOS to remember." if body.enabled else "Turned off learning: AIOS will not suggest memories on its own.")
        return {"enabled": body.enabled}

    @r.get("/import/prompt")
    def import_prompt(provider: str = "other"):
        return memory_import.prompt_for(provider)

    @r.post("/import/paste", status_code=201)
    def import_paste(body: PasteIn):
        return redact_obj(memory_import.import_paste(db, settings, body.provider, body.text))

    @r.post("/everyday", status_code=201)
    def make_everyday():
        out = services.ensure_everyday_project(db, settings)
        abilities.receipt(db, actor="owner", kind="project.everyday", changed=True,
                          summary="Created the Everyday space for chatting without a project.") if out["created"] else None
        return out

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

    @r.get("/widgets/catalog")
    def widget_catalog():
        return widgets.catalog()

    @r.post("/widgets/from-catalog", status_code=201)
    def widget_from_catalog(body: FromCatalogIn):
        return redact_obj(widgets.from_catalog(db, body.template, body.title, body.config))

    @r.put("/widgets/{wid}")
    def put_widget(wid: str, body: WidgetConfigIn):
        return redact_obj(widgets.update(db, wid, body.config, body.title))

    @r.delete("/widgets/{wid}", status_code=204)
    def del_widget(wid: str):
        widgets.delete(db, wid)

    return r
