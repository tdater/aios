"""FastAPI app: versioned API under /api/v1. Loopback bind; Host allowlist; every route except
/meta and /auth/pair requires a device session. No shell, no arbitrary-path endpoints."""
from __future__ import annotations

import json
import re
import shutil
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, approvals, auth, backup, idempotency, providers, services, workflow
from .config import LOOPBACK_HOSTS, REPO_ROOT, Settings, load_settings
from .db import Database
from .engine import EXECUTORS, Engine
from .errors import ApiError, check_version, not_found
from .assist_api import build_router as build_assist_router
from .objects_api import build_router as build_objects_router
from .conversations_api import build_router as build_conversations_router
from .executors import apply_change, audit, capture, claude_review, claude_turn, demo, provider_task  # noqa: F401  (registers executors)
from .history import schedule
from .history_api import build_router
from .insights_api import build_router as build_insights_router
from .skills_api import build_router as build_skills_router
from .pagination import page
from .security import PathViolation, redact_obj

WEB_DIST = REPO_ROOT / "apps" / "web" / "dist"
API_VERSION, MIN_CLIENT_API = 1, 1
CAPABILITIES = {
    "pagination": True, "idempotency": True, "record_versions": True, "run_events_after": True,
    "run_snapshot": True, "cancel_two_phase": True, "approvals_exact_binding": True,
    "history_review": True, "memory": True, "sse_stream": False, "push_notifications": False,
    # Claude runs through the official CLI in print mode (conversations, claude.turn tasks).
    # Antigravity and Perplexity remain manual handoffs.
    "provider_execution": "claude_code_print_mode",
    "conversations": True,
    "universe_objects": True,            # the web app needs this: older servers have no object model, and the app says so
    "assist": True,
}


class PairIn(BaseModel):
    code: str = Field(min_length=4, max_length=32)
    device_name: str = Field(min_length=1, max_length=80)
    kind: str = Field(pattern="^(browser|native)$")


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    path: str
    kind: str = "generic"


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str
    project_id: str | None = None
    spec: dict = {}
    acceptance: list = []
    depends_on: list[str] = []
    start_run: bool = False
    deadline_s: int | None = Field(default=None, ge=1, le=3600)


class RunIn(BaseModel):
    task_id: str
    deadline_s: int | None = Field(default=None, ge=1, le=3600)
    max_attempts: int = Field(default=3, ge=1, le=5)
    max_iterations: int = Field(default=1000, ge=1, le=100000)


class CancelIn(BaseModel):
    expected_version: int | None = None


class DecideIn(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=1000)
    expected_version: int | None = None
    action_hash: str | None = None
    confirm_destructive: bool = False


class ImportIn(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)
    source: str = Field(min_length=1, max_length=200)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.db_path)
    engine = Engine(settings, db)
    engine.ticker = lambda: workflow.advance_all(db, engine)
    startup: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_dirs()
        startup["migrations"] = db.migrate(settings.backups_dir)
        db.execute("INSERT OR IGNORE INTO kv(key,value) VALUES ('server_id', ?)", (f"srv_{uuid.uuid4().hex[:16]}",))
        startup["reconcile"] = engine.reconcile()
        idempotency.purge_old(db)
        threading.Thread(target=providers.discover, args=(db,), daemon=True).start()
        engine.start()
        reviewer = schedule.Runner(db, settings, REPO_ROOT / ".claude" / "skills")
        reviewer.start()
        yield
        reviewer.stop()
        engine.stop()

    app = FastAPI(title="AIOS", version=__version__, lifespan=lifespan,
                  openapi_url="/api/v1/openapi.json", docs_url=None, redoc_url=None)
    app.state.settings, app.state.db, app.state.engine = settings, db, engine
    allowed_hosts = LOOPBACK_HOSTS | set(settings.allowed_hosts) | {"testserver"}

    # ---------------------------------------------------------------- middleware
    @app.middleware("http")
    async def guard(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        host = (request.headers.get("host") or "").lower()
        hostname = host.rsplit(":", 1)[0].strip("[]") if not host.startswith("[") else host.split("]")[0][1:]
        if hostname not in allowed_hosts and host not in allowed_hosts:
            return _err(403, "bad_host", "Host header not allowed", rid)
        m = re.search(r"api=(\d+)", request.headers.get("x-aios-client", ""))
        if m and int(m.group(1)) < MIN_CLIENT_API:
            return _err(426, "client_too_old", f"Update the app: server requires API >= {MIN_CLIENT_API}", rid,
                        {"min_client_api": MIN_CLIENT_API})
        if request.method not in ("GET", "HEAD", "OPTIONS") and \
                "application/json" not in (request.headers.get("content-type") or "") and \
                request.headers.get("content-length") not in (None, "0"):
            return _err(415, "unsupported_media_type", "JSON content-type required", rid)
        resp = await call_next(request)
        resp.headers["X-Request-ID"] = rid
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith("/api/") else "no-cache")
        return resp

    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins), allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-AIOS-Client", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Idempotent-Replay", "Retry-After"])

    def _err(status: int, code: str, message: str, rid: str = "", details: dict | None = None,
             headers: dict | None = None):
        return JSONResponse({"error": {"code": code, "message": message, "details": details or {}},
                             "request_id": rid}, status_code=status, headers=headers)

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, e: ApiError):
        return _err(e.status, e.code, e.message, getattr(request.state, "request_id", ""), e.details, e.headers)

    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, e: HTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(e.status_code, "http_error")
        return _err(e.status_code, code, str(e.detail), getattr(request.state, "request_id", ""))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, e: RequestValidationError):
        details = [{"loc": [str(x) for x in err["loc"]], "msg": err["msg"]} for err in e.errors()]
        return _err(422, "validation_error", "Request validation failed", getattr(request.state, "request_id", ""),
                    {"errors": details})

    @app.exception_handler(PathViolation)
    async def _path_violation(request: Request, e: PathViolation):
        return _err(400, "path_not_allowed", str(e), getattr(request.state, "request_id", ""))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, e: Exception):
        return _err(500, "internal_error", "Unexpected server error (details withheld)",
                    getattr(request.state, "request_id", ""))

    # ---------------------------------------------------------------- auth dependency
    def require_auth(request: Request) -> dict:
        sess, via = auth.session_from_request(db, request)
        if not sess:
            raise ApiError(401, "unauthenticated", "Sign in required", headers={"WWW-Authenticate": "Bearer"})
        if via == "cookie" and request.method not in auth.SAFE:
            auth.check_csrf(sess, request)
        request.state.session = sess
        return sess

    pub = APIRouter(prefix="/api/v1")
    v1 = APIRouter(prefix="/api/v1", dependencies=[Depends(require_auth)])

    # ---------------------------------------------------------------- public
    @pub.get("/meta")
    def meta():
        sid = (db.one("SELECT value FROM kv WHERE key='server_id'") or {}).get("value")
        return {"api_version": API_VERSION, "min_client_api": MIN_CLIENT_API, "server_version": __version__,
                "server_id": sid,
                "time": services.now(), "auth": {"required": True, "pairing": "one-time code from the desktop",
                                                  "browser": "HttpOnly cookie + CSRF header",
                                                  "native": "Bearer token"},
                "capabilities": CAPABILITIES}

    @pub.post("/auth/pair")
    def pair(body: PairIn, request: Request, response: Response):
        r = auth.pair(db, body.code, body.device_name, body.kind)
        out = {"session_id": r["session_id"], "kind": r["kind"], "expires_at": r["expires_at"]}
        if body.kind == "native":
            out["token"] = r["token"]               # shown once; client stores it in Keystore-backed storage
        else:
            secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
            response.set_cookie(auth.COOKIE, r["token"], httponly=True, samesite="strict", secure=secure,
                                max_age=int(auth.SESSION_TTL.total_seconds()), path="/")
            response.set_cookie(auth.CSRF_COOKIE, r["csrf"], httponly=False, samesite="strict", secure=secure,
                                max_age=int(auth.SESSION_TTL.total_seconds()), path="/")
            out["csrf"] = r["csrf"]
        return out

    # ---------------------------------------------------------------- auth (signed in)
    @v1.get("/auth/me")
    def me(request: Request):
        s = request.state.session
        return {"session_id": s["id"], "device_name": s["device_name"], "kind": s["kind"],
                "expires_at": s["expires_at"]}

    @v1.get("/auth/sessions")
    def sessions(request: Request):
        return {"items": [dict(x, current=x["id"] == request.state.session["id"]) for x in auth.list_sessions(db)]}

    @v1.post("/auth/sessions/{session_id}/revoke")
    def revoke(session_id: str):
        if not auth.revoke(db, session_id, "revoked by user"):
            raise not_found("active session")
        return {"ok": True}

    @v1.post("/auth/logout")
    def logout(request: Request, response: Response):
        auth.revoke(db, request.state.session["id"], "logout")
        response.delete_cookie(auth.COOKIE, path="/")
        response.delete_cookie(auth.CSRF_COOKIE, path="/")
        return {"ok": True}

    @v1.post("/auth/pairing-codes", status_code=201)
    def pairing_code():
        return auth.new_pairing_code(db)

    # ---------------------------------------------------------------- health / providers / home
    @v1.get("/health")
    def health():
        counts = {r["state"]: r["n"] for r in db.query("SELECT state, COUNT(*) n FROM runs GROUP BY state")}
        mig = db.query("SELECT version FROM schema_migrations ORDER BY version")
        free = shutil.disk_usage(settings.state_dir).free
        lb = backup.latest_backup(settings)
        return {"version": __version__, "db": "ok", "schema": [m["version"] for m in mig],
                "state_dir": str(settings.state_dir), "host": settings.host, "port": settings.port,
                "run_counts": counts, "disk_free_gb": round(free / 1e9, 1),
                "last_backup": lb, "backup_status": "ok" if lb else "never run",
                "startup": startup, "executors": sorted(EXECUTORS),
                "billable_env": providers.billable_env_present()}

    @v1.get("/providers")
    def get_providers():
        return {"items": providers.list_caps(db)}

    @v1.post("/providers/refresh")
    def refresh_providers():
        return {"items": providers.discover(db)}

    @v1.get("/home")
    def home():
        approvals.sweep_expired(db)
        sel = ("SELECT r.*, t.title AS task_title, t.kind AS task_kind FROM runs r JOIN tasks t ON t.id=r.task_id "
               "WHERE r.state IN {} ORDER BY r.created_at DESC LIMIT 10")
        current = [services.decorate_run(db, r) for r in db.query(sel.format("('queued','running','awaiting_approval')"))]
        blocked = [services.decorate_run(db, r) for r in db.query(sel.format("('blocked','interrupted')"))]
        one = lambda q: db.one(q)["n"]  # noqa: E731
        return redact_obj({
            "server_time": services.now(),
            "counts": {"active_runs": one("SELECT COUNT(*) n FROM runs WHERE state IN ('queued','running')"),
                       "blocked_runs": one("SELECT COUNT(*) n FROM runs WHERE state IN ('blocked','interrupted')"),
                       "pending_approvals": one("SELECT COUNT(*) n FROM approvals WHERE status='pending'"),
                       "pending_candidates": one("SELECT COUNT(*) n FROM candidates WHERE status='candidate'")},
            "current_runs": current, "blocked_runs": blocked,
            "providers": [{"provider": p["provider"], "mode": p["mode"], "billing": p["billing"]}
                          for p in providers.list_caps(db)]})

    # ---------------------------------------------------------------- projects
    @v1.get("/projects")
    def projects(q: str | None = None, limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        where, params = [], []
        if q:
            where.append("p.name LIKE ?")
            params.append(f"%{q}%")
        return page(db, "SELECT p.*, w.id AS workspace_id, w.path, w.kind FROM projects p "
                        "LEFT JOIN workspaces w ON w.project_id=p.id", where, params, sort="p.created_at",
                    id_col="p.id", limit=limit, cursor=cursor)

    @v1.post("/projects", status_code=201)
    def add_project(p: ProjectIn):
        try:
            return services.register_project(db, settings, p.name, p.path, p.kind)
        except ValueError as e:
            raise ApiError(409, "already_registered", str(e))

    @v1.get("/projects/{project_id}")
    def project_detail(project_id: str):
        p = db.one("SELECT p.*, w.id AS workspace_id, w.path FROM projects p "
                   "LEFT JOIN workspaces w ON w.project_id=p.id WHERE p.id=?", (project_id,))
        if not p:
            raise not_found("project")
        tasks = db.query("SELECT id,title,kind,status,status_reason,version,created_at FROM tasks "
                         "WHERE project_id=? ORDER BY created_at DESC LIMIT 20", (project_id,))
        runs = [services.decorate_run(db, r, with_cancel=False) for r in db.query(
            "SELECT r.id,r.task_id,r.state,r.state_reason,r.block_code,r.version,r.created_at,r.finished_at,"
            "t.title AS task_title FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=? "
            "ORDER BY r.created_at DESC LIMIT 10", (project_id,))]
        return {"project": p, "tasks": tasks, "recent_runs": runs}

    # ---------------------------------------------------------------- tasks
    @v1.get("/tasks")
    def tasks(q: str | None = None, status: str | None = None, project_id: str | None = None,
              limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        where, params = [], []
        for cond, val in (("t.title LIKE ?", f"%{q}%" if q else None), ("t.status=?", status),
                          ("t.project_id=?", project_id)):
            if val:
                where.append(cond)
                params.append(val)
        res = page(db, "SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id=t.project_id",
                   where, params, sort="t.created_at", id_col="t.id", limit=limit, cursor=cursor)
        for r in res["items"]:
            r["spec"] = json.loads(r.pop("spec_json"))
            r["acceptance"] = json.loads(r.pop("acceptance_json"))
        return res

    @v1.get("/tasks/{task_id}")
    def task_detail(task_id: str):
        t = db.one("SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id=t.project_id "
                   "WHERE t.id=?", (task_id,))
        if not t:
            raise not_found("task")
        t["spec"], t["acceptance"] = json.loads(t.pop("spec_json")), json.loads(t.pop("acceptance_json"))
        t["runs"] = [services.decorate_run(db, r, with_cancel=False) for r in db.query(
            "SELECT id,state,state_reason,block_code,version,created_at,finished_at FROM runs WHERE task_id=? "
            "ORDER BY created_at DESC LIMIT 20", (task_id,))]
        return t

    @v1.post("/tasks")
    def add_task(t: TaskIn, response: Response, idempotency_key: str | None = Header(default=None)):
        if t.kind not in EXECUTORS:
            raise ApiError(422, "unknown_task_kind", "unknown task kind", {"available": sorted(EXECUTORS)})

        def create() -> tuple[int, dict]:
            try:
                task = services.create_task(db, title=t.title, kind=t.kind, project_id=t.project_id,
                                            spec=t.spec, acceptance=t.acceptance, depends_on=t.depends_on)
            except KeyError as e:
                raise ApiError(404, "not_found", f"not found: {e}")
            run = engine.create_run(task["id"], deadline_s=t.deadline_s) if t.start_run else None
            return 201, redact_obj({"task": task, "run": services.decorate_run(db, run) if run else None})
        status, body, replay = idempotency.run_idempotent(db, "POST /tasks", idempotency_key,
                                                          t.model_dump(), create)
        response.status_code = 200 if replay else status
        if replay:
            response.headers["Idempotent-Replay"] = "true"
        return body

    # ---------------------------------------------------------------- runs
    @v1.get("/runs")
    def runs(q: str | None = None, state: str | None = None, project_id: str | None = None,
             limit: int | None = Query(None, ge=1, le=200), cursor: str | None = None):
        where, params = [], []
        for cond, val in (("t.title LIKE ?", f"%{q}%" if q else None), ("r.state=?", state),
                          ("t.project_id=?", project_id)):
            if val:
                where.append(cond)
                params.append(val)
        res = page(db, "SELECT r.*, t.title AS task_title, t.kind AS task_kind, t.project_id, p.name AS project_name "
                       "FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN projects p ON p.id=t.project_id",
                   where, params, sort="r.created_at", id_col="r.id", limit=limit, cursor=cursor)
        res["items"] = [services.decorate_run(db, r, with_cancel=False) for r in res["items"]]
        return res

    @v1.post("/runs")
    def start_run(r: RunIn, response: Response, idempotency_key: str | None = Header(default=None)):
        def create() -> tuple[int, dict]:
            try:
                run = engine.create_run(r.task_id, deadline_s=r.deadline_s, max_attempts=r.max_attempts,
                                        max_iterations=r.max_iterations)
            except KeyError:
                raise not_found("task")
            return 201, redact_obj(services.decorate_run(db, run))
        status, body, replay = idempotency.run_idempotent(db, "POST /runs", idempotency_key, r.model_dump(), create)
        response.status_code = 200 if replay else status
        if replay:
            response.headers["Idempotent-Replay"] = "true"
        return body

    @v1.get("/runs/{run_id}")
    def run_snapshot(run_id: str):
        d = services.run_detail(db, run_id)
        if not d:
            raise not_found("run")
        return redact_obj(d)

    @v1.get("/runs/{run_id}/events")
    def run_events(run_id: str, after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)):
        """Reconnect-safe incremental feed. If `after` is ahead of the server (e.g. restored backup),
        409 resync_required tells the client to reload the snapshot at /runs/{id}."""
        run = db.one("SELECT id, state, version FROM runs WHERE id=?", (run_id,))
        if not run:
            raise not_found("run")
        last = db.one("SELECT COALESCE(MAX(id),0) m FROM run_events WHERE run_id=?", (run_id,))["m"]
        if after > last:
            raise ApiError(409, "resync_required", "Event cursor is ahead of the server; reload the snapshot.",
                           {"last_event_id": last})
        items = db.query("SELECT id, ts, kind, message FROM run_events WHERE run_id=? AND id>? ORDER BY id LIMIT ?",
                         (run_id, after, limit))
        return redact_obj({"items": items, "last_event_id": last, "run_state": run["state"],
                           "run_version": run["version"],
                           "terminal": run["state"] in ("succeeded", "failed", "cancelled")})

    def _op(fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except KeyError:
            raise not_found("record")
        except ValueError as e:
            raise ApiError(409, "invalid_state", str(e))

    @v1.post("/runs/{run_id}/cancel")
    def cancel(run_id: str, body: CancelIn | None = None):
        run = db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if not run:
            raise not_found("run")
        check_version(run, body.expected_version if body else None)
        result = _op(engine.cancel, run_id)
        d = services.run_detail(db, run_id)
        return {"result": result, "run": redact_obj(d["run"])}

    @v1.post("/runs/{run_id}/resume")
    def resume(run_id: str):
        _op(engine.resume, run_id)
        return {"ok": True}

    @v1.post("/runs/{run_id}/import-result")
    def import_result(run_id: str, body: ImportIn):
        _op(engine.import_result, run_id, body.text, body.source)
        return {"ok": True}

    @v1.get("/artifacts/{artifact_id}")
    def artifact(artifact_id: str):
        a = services.read_artifact(db, settings, artifact_id)
        if not a:
            raise not_found("artifact")
        return redact_obj(a)

    # ---------------------------------------------------------------- approvals
    def _approval(aid: str) -> dict:
        approvals.sweep_expired(db)
        a = db.one("SELECT * FROM approvals WHERE id=?", (aid,))
        if not a:
            raise not_found("approval")
        return redact_obj(services.approval_view(db, a))

    @v1.get("/approvals")
    def get_approvals(status: str | None = None, limit: int | None = Query(None, ge=1, le=200),
                      cursor: str | None = None):
        approvals.sweep_expired(db)
        res = page(db, "SELECT a.* FROM approvals a", ["a.status=?"] if status else [], [status] if status else [],
                   sort="a.requested_at", id_col="a.id", limit=limit, cursor=cursor)
        res["items"] = [redact_obj(services.approval_view(db, a, detail=False)) for a in res["items"]]
        return res

    @v1.get("/approvals/{approval_id}")
    def approval_detail(approval_id: str):
        return _approval(approval_id)

    @v1.post("/approvals/{approval_id}/decide")
    def decide(approval_id: str, body: DecideIn, request: Request):
        engine.decide_approval(approval_id, body.approve, body.note, expected_version=body.expected_version,
                               action_hash_seen=body.action_hash, confirm_destructive=body.confirm_destructive,
                               session_id=request.state.session["id"])
        return _approval(approval_id)

    # ---------------------------------------------------------------- backups
    @v1.post("/backup", status_code=201)
    def make_backup():
        return backup.create_backup(settings, db)

    app.include_router(pub)
    app.include_router(v1)
    app.include_router(build_router(db, settings, require_auth))
    app.include_router(build_skills_router(db, settings, require_auth))
    app.include_router(build_conversations_router(db, engine, settings, require_auth))
    app.include_router(build_insights_router(db, settings, require_auth))
    app.include_router(build_assist_router(db, engine, settings, require_auth))
    app.include_router(build_objects_router(db, settings, require_auth, REPO_ROOT / ".claude" / "skills"))

    # ---------------------------------------------------------------- static UI (public, no secrets)
    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "not found")
            f = (WEB_DIST / path).resolve()
            if path and f.is_file() and WEB_DIST.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(WEB_DIST / "index.html")
    return app


def run() -> None:
    import uvicorn
    s = load_settings()
    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    run()
