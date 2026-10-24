"""FastAPI app. Loopback only; Host/Origin validated; no shell or arbitrary-path endpoints."""
from __future__ import annotations

import json
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, backup, providers, services
from .config import REPO_ROOT, LOOPBACK_HOSTS, Settings, load_settings
from .db import Database
from .engine import EXECUTORS, Engine
from .executors import audit, demo, provider_task  # noqa: F401  (registers executors)
from .security import PathViolation, redact_obj

WEB_DIST = REPO_ROOT / "apps" / "web" / "dist"


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


class RunIn(BaseModel):
    task_id: str
    idempotency_key: str | None = None
    deadline_s: int | None = Field(default=None, ge=1, le=3600)
    max_attempts: int = Field(default=3, ge=1, le=5)
    max_iterations: int = Field(default=1000, ge=1, le=100000)


class DecideIn(BaseModel):
    approve: bool
    note: str = ""


class ImportIn(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)
    source: str = Field(min_length=1, max_length=200)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.db_path)
    engine = Engine(settings, db)
    startup: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_dirs()
        startup["migrations"] = db.migrate(settings.backups_dir)
        startup["reconcile"] = engine.reconcile()
        threading.Thread(target=providers.discover, args=(db,), daemon=True).start()
        engine.start()
        yield
        engine.stop()

    app = FastAPI(title="AIOS", version=__version__, lifespan=lifespan)
    app.state.settings, app.state.db, app.state.engine = settings, db, engine

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in LOOPBACK_HOSTS and host != "testserver":
            return JSONResponse({"detail": "bad Host header"}, status_code=403)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin:
                o = origin.split("://", 1)[-1].rsplit(":", 1)[0].strip("[]")
                if o not in LOOPBACK_HOSTS:
                    return JSONResponse({"detail": "cross-origin request refused"}, status_code=403)
            if "application/json" not in (request.headers.get("content-type") or "") and \
                    request.headers.get("content-length") not in (None, "0"):
                return JSONResponse({"detail": "JSON content-type required"}, status_code=415)
        return await call_next(request)

    @app.exception_handler(PathViolation)
    async def _pv(_, e):
        return JSONResponse({"detail": str(e)}, status_code=400)

    def j(obj):
        return redact_obj(obj)

    # ---- health / providers ----
    @app.get("/api/health")
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

    @app.get("/api/providers")
    def get_providers():
        return providers.list_caps(db)

    @app.post("/api/providers/refresh")
    def refresh_providers():
        return providers.discover(db)

    # ---- projects / tasks / runs ----
    @app.get("/api/projects")
    def projects():
        return services.list_projects(db)

    @app.post("/api/projects", status_code=201)
    def add_project(p: ProjectIn):
        try:
            return services.register_project(db, settings, p.name, p.path, p.kind)
        except ValueError as e:
            raise HTTPException(409, str(e))

    @app.get("/api/tasks")
    def tasks():
        return services.list_tasks(db)

    @app.post("/api/tasks", status_code=201)
    def add_task(t: TaskIn):
        if t.kind not in EXECUTORS:
            raise HTTPException(422, f"unknown task kind; available: {sorted(EXECUTORS)}")
        try:
            return services.create_task(db, title=t.title, kind=t.kind, project_id=t.project_id,
                                        spec=t.spec, acceptance=t.acceptance, depends_on=t.depends_on)
        except KeyError as e:
            raise HTTPException(404, str(e))

    @app.get("/api/runs")
    def runs():
        return services.list_runs(db)

    @app.post("/api/runs", status_code=201)
    def start_run(r: RunIn):
        try:
            return engine.create_run(r.task_id, idempotency_key=r.idempotency_key, deadline_s=r.deadline_s,
                                     max_attempts=r.max_attempts, max_iterations=r.max_iterations)
        except KeyError:
            raise HTTPException(404, "task not found")

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        d = services.run_detail(db, run_id)
        if not d:
            raise HTTPException(404, "run not found")
        return j(d)

    def _op(fn, *a):
        try:
            fn(*a)
        except KeyError:
            raise HTTPException(404, "not found")
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {"ok": True}

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: str):
        return _op(engine.cancel, run_id)

    @app.post("/api/runs/{run_id}/resume")
    def resume(run_id: str):
        return _op(engine.resume, run_id)

    @app.post("/api/runs/{run_id}/import-result")
    def import_result(run_id: str, body: ImportIn):
        return _op(engine.import_result, run_id, body.text, body.source)

    @app.get("/api/artifacts/{artifact_id}")
    def artifact(artifact_id: str):
        a = services.read_artifact(db, settings, artifact_id)
        if not a:
            raise HTTPException(404, "artifact not found")
        return a

    # ---- approvals ----
    @app.get("/api/approvals")
    def get_approvals(status: str | None = None):
        return j(services.list_approvals(db, status))

    @app.post("/api/approvals/{approval_id}/decide")
    def decide(approval_id: str, body: DecideIn):
        return _op(engine.decide_approval, approval_id, body.approve, body.note)

    # ---- backups ----
    @app.post("/api/backup", status_code=201)
    def make_backup():
        return backup.create_backup(settings, db)

    # ---- static UI ----
    if WEB_DIST.exists():
        app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
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
