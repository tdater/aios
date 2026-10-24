"""HTTP surface for history review and memory (v1). Sources are never uploaded through the API:
files are placed in <state>/imports/approved by the user, which is the approval act."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from . import memory
from .config import REPO_ROOT, Settings
from .db import Database
from .errors import ApiError, check_version, not_found
from .history import extract, review
from .history.ingest import Ingestor
from .pagination import page
from .security import redact_obj


class Decision(BaseModel):
    note: str = Field(default="", max_length=2000)
    confirm_global: bool = False
    override_injection: bool = False
    expected_version: int | None = None


class EditIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    problem: str | None = Field(default=None, max_length=2000)
    scope: str | None = Field(default=None, pattern="^(global|project)$")
    confirm_global: bool = False
    note: str = ""
    expected_version: int | None = None


class MergeIn(BaseModel):
    into: str
    note: str = ""
    expected_version: int | None = None


class SupersedeIn(BaseModel):
    by: str
    note: str
    confirm_global: bool = False
    override_injection: bool = False
    expected_version: int | None = None


class ReviewIn(BaseModel):
    max_files: int = Field(default=200, ge=1, le=2000)
    max_seconds: float = Field(default=120, ge=1, le=900)


class MemoryIn(BaseModel):
    scope: str = Field(pattern="^(global|project)$")
    type: str = Field(pattern="^(preference|fact|decision|lesson|procedure)$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=50_000)
    project_id: str | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    tags: list[str] = Field(default_factory=list, max_length=30)
    # A note written by the signed-in user is their own statement, so it defaults to approved. Machine-derived notes never
    # come through this endpoint (they stay `candidate` via the review queue).
    status: str = Field(default="approved", pattern="^(candidate|approved)$")


class MemoryPatch(BaseModel):
    title: str | None = None
    body: str | None = None
    tags: list[str] | None = Field(default=None, max_length=30)
    confidence: float | None = Field(default=None, ge=0, le=1)
    status: str | None = Field(default=None, pattern="^(candidate|approved|superseded|rejected)$")
    expected_version: int | None = None


def build_router(db: Database, settings: Settings, require_auth) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])
    skills_dir = REPO_ROOT / ".claude" / "skills"

    def guard(fn, *a, **kw):
        try:
            return redact_obj(fn(*a, **kw))
        except KeyError as e:
            raise not_found(str(e).strip("'"))
        except review.ReviewBusy as e:
            raise ApiError(409, "review_busy", str(e))
        except (review.ReviewError, ValueError) as e:
            raise ApiError(409, "review_rejected", str(e))

    def versioned(table: str, rid: str, expected: int | None) -> None:
        row = db.one(f"SELECT version FROM {table} WHERE id=?", (rid,))
        if not row:
            raise not_found(table.rstrip("s"))
        check_version(row, expected)

    @r.get("/history/summary")
    def summary():
        return {"totals": review.totals(db), "approved_dir": str(settings.approved_dir),
                "last_review": db.one("SELECT id,status,started_at,finished_at FROM review_runs "
                                      "ORDER BY started_at DESC LIMIT 1"),
                "candidate_counts": {x["status"]: x["n"] for x in db.query(
                    "SELECT status, COUNT(*) n FROM candidates GROUP BY status")},
                "note": "Coverage is limited to files you placed in the approved folder."}

    @r.get("/history/sources")
    def sources(limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        res = page(db, "SELECT id,rel_path,kind,provider,project_id,date_start,date_end,imported_at,status,"
                       "status_detail,message_count,sensitivity,secret_kinds_json,coverage_json,summary_json,"
                       "content_hash,parser_version FROM sources", [], [], sort="imported_at", limit=limit,
                   cursor=cursor)
        for x in res["items"]:
            for k in ("secret_kinds_json", "coverage_json", "summary_json"):
                x[k[:-5]] = json.loads(x.pop(k))
        return redact_obj(res)

    @r.post("/history/review-new")
    def review_new(body: ReviewIn):
        return guard(review.review_new, db, settings, max_files=body.max_files, max_seconds=body.max_seconds,
                     skills_dir=skills_dir)

    @r.get("/history/review-runs")
    def review_runs():
        rows = db.query("SELECT * FROM review_runs ORDER BY started_at DESC LIMIT 20")
        for x in rows:
            x["report"] = json.loads(x.pop("report_json"))
        return redact_obj({"items": rows})

    @r.post("/history/sources/{source_id}/delete")
    def delete_source(source_id: str, delete_file: bool = False):
        return guard(Ingestor(db, settings).delete_source, source_id, delete_file)

    @r.get("/history/search")
    def search(q: str):
        terms = re.findall(r"[A-Za-z0-9_]{2,}", q)
        if not terms:
            return {"items": []}
        match = " OR ".join(f'"{t}"' for t in terms)
        return redact_obj({"items": db.query(
            "SELECT m.id, m.source_id, m.ref, m.role, m.kind, snippet(messages_fts,0,'[',']','…',16) AS excerpt "
            "FROM messages_fts JOIN messages m ON m.id=messages_fts.rowid WHERE messages_fts MATCH ? "
            "ORDER BY bm25(messages_fts) LIMIT 25", (match,))})

    # ---- candidates ----
    @r.get("/candidates")
    def candidates(status: str | None = None, q: str | None = None,
                   limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        where, params = [], []
        for cond, val in (("status=?", status), ("title LIKE ?", f"%{q}%" if q else None)):
            if val:
                where.append(cond)
                params.append(val)
        res = page(db, "SELECT id,type,title,scope,project_id,status,confidence,score,validation,"
                       "distinct_occurrences,distinct_sources,flags_json,uncertainty,active,version FROM candidates",
                   where, params, sort="score", limit=limit, cursor=cursor)
        for x in res["items"]:
            x["flags"] = json.loads(x.pop("flags_json"))
        return redact_obj(res)

    @r.get("/candidates/shortlist")
    def shortlist(limit: int = Query(10, ge=1, le=10)):
        return redact_obj({"items": extract.shortlist(db, limit)})

    @r.get("/candidates/{cid}")
    def candidate(cid: str):
        return guard(review.detail, db, cid)

    @r.post("/candidates/{cid}/approve")
    def approve(cid: str, d: Decision):
        versioned("candidates", cid, d.expected_version)
        return guard(review.approve, db, settings, cid, d.note, confirm_global=d.confirm_global,
                     override_injection=d.override_injection)

    @r.post("/candidates/{cid}/reject")
    def reject(cid: str, d: Decision):
        versioned("candidates", cid, d.expected_version)
        return guard(review.reject, db, cid, d.note)

    @r.post("/candidates/{cid}/defer")
    def defer(cid: str, d: Decision):
        versioned("candidates", cid, d.expected_version)
        return guard(review.defer, db, cid, d.note)

    @r.post("/candidates/{cid}/edit")
    def edit(cid: str, e: EditIn):
        versioned("candidates", cid, e.expected_version)
        return guard(review.edit, db, cid, title=e.title, problem=e.problem, scope=e.scope,
                     confirm_global=e.confirm_global, note=e.note)

    @r.post("/candidates/{cid}/merge")
    def merge(cid: str, m: MergeIn):
        versioned("candidates", cid, m.expected_version)
        return guard(review.merge, db, cid, m.into, m.note)

    @r.post("/candidates/{cid}/supersede")
    def supersede(cid: str, s: SupersedeIn):
        versioned("candidates", cid, s.expected_version)
        return guard(review.supersede, db, settings, cid, s.by, s.note, confirm_global=s.confirm_global,
                     override_injection=s.override_injection)

    # ---- memory ----
    @r.get("/memories")
    def memories(q: str = "", scope: str | None = None, type: str | None = None, status: str | None = None,
                 tag: str | None = None, limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        if q:
            return redact_obj({"items": memory.search(db, q, scope=scope, type=type, status=status, tag=tag),
                               "next_cursor": None})
        where, params = [], []
        for col, val in (("scope", scope), ("type", type), ("status", status)):
            if val:
                where.append(f"{col}=?")
                params.append(val)
        t = memory.normalize_tag(tag) if tag else None
        if t:
            where.append("tags_json LIKE ?")
            params.append(f'%"{t}"%')
        res = page(db, "SELECT id,title,scope,project_id,type,status,basis,confidence,sensitivity,"
                       "created_at,last_reviewed_at,version,tags_json FROM memories", where, params,
                   sort="created_at", limit=limit, cursor=cursor)
        for row in res["items"]:
            row["tags"] = json.loads(row.pop("tags_json") or "[]")
        return redact_obj(res)

    @r.post("/memories", status_code=201)
    def add_memory(m: MemoryIn):
        mid = memory.create(db, settings, scope=m.scope, type=m.type, title=m.title, body=m.body,
                            project_id=m.project_id, confidence=m.confidence, basis="observation", tags=m.tags,
                            status=m.status)
        return redact_obj(memory.get(db, settings, mid))

    @r.get("/memories/tags")
    def memory_tags():
        return {"items": memory.all_tags(db)}

    @r.get("/graph")
    def knowledge_graph(tags: bool = False, candidates: bool = False, unresolved: bool = True,
                        limit: int = Query(400, ge=10, le=1000)):
        return redact_obj(memory.graph(db, settings, include_tags=tags, include_candidates=candidates,
                                       include_unresolved=unresolved, limit=limit))

    @r.get("/published")
    def published_preview():
        """What `scripts/export_published.py` would write: only notes tagged `publish` and approved, redacted."""
        return redact_obj(memory.published(db, settings))

    @r.get("/memories/export")
    def export():
        return redact_obj({"items": memory.export_all(db, settings)})

    @r.post("/memories/rebuild-index")
    def rebuild():
        return memory.rebuild_index(db, settings)

    @r.get("/memories/{mid}")
    def get_memory(mid: str):
        m = memory.get(db, settings, mid)
        if not m:
            raise not_found("memory")
        return redact_obj(m)

    @r.get("/memories/{mid}/links")
    def memory_links(mid: str):
        try:
            return redact_obj(memory.links(db, settings, mid))
        except KeyError:
            raise not_found("memory")

    @r.patch("/memories/{mid}")
    def patch_memory(mid: str, p: MemoryPatch):
        versioned("memories", mid, p.expected_version)
        changes = p.model_dump(exclude_none=True)
        changes.pop("expected_version", None)
        return guard(memory.update, db, settings, mid, **changes)

    @r.post("/memories/{mid}/forget")
    def forget(mid: str):
        guard(memory.forget, db, settings, mid)
        return {"ok": True}

    return r
