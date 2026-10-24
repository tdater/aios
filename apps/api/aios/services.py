"""Domain operations shared by the API and tests."""
from __future__ import annotations

import json
import re

from .config import REPO_ROOT, Settings
from .db import Database
from .security import resolve_within, validate_workspace_root
from .util import canonical_json, new_id, now


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "project"


def register_project(db: Database, settings: Settings, name: str, path: str, kind: str = "generic") -> dict:
    root = validate_workspace_root(path, state_dir=settings.state_dir, repo_root=REPO_ROOT)
    if db.one("SELECT id FROM workspaces WHERE path=?", (str(root),)):
        raise ValueError("that workspace is already registered")
    pid, wid, slug = new_id("prj"), new_id("wsp"), _slug(name)
    n = 1
    while db.one("SELECT id FROM projects WHERE slug=?", (slug,)):
        n += 1
        slug = f"{_slug(name)}-{n}"
    with db.tx() as con:
        con.execute("INSERT INTO projects(id,slug,name,created_at,updated_at) VALUES (?,?,?,?,?)",
                    (pid, slug, name, now(), now()))
        con.execute("INSERT INTO workspaces(id,project_id,path,kind,registered_at) VALUES (?,?,?,?,?)",
                    (wid, pid, str(root), kind, now()))
        con.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
                    (now(), "operator", "project.register", canonical_json({"project": pid, "path": str(root)})))
    return {"id": pid, "slug": slug, "name": name, "workspace_id": wid, "path": str(root)}


def list_projects(db: Database) -> list[dict]:
    return db.query("SELECT p.*, w.id AS workspace_id, w.path, w.kind FROM projects p "
                    "LEFT JOIN workspaces w ON w.project_id=p.id ORDER BY p.created_at")


def create_task(db: Database, *, title: str, kind: str, project_id: str | None = None,
                spec: dict | None = None, acceptance: list | None = None,
                depends_on: list[str] | None = None) -> dict:
    ws_id = None
    if project_id:
        ws = db.one("SELECT id FROM workspaces WHERE project_id=?", (project_id,))
        if not ws:
            raise KeyError(f"project {project_id} has no workspace")
        ws_id = ws["id"]
    tid = new_id("tsk")
    with db.tx() as con:
        con.execute("INSERT INTO tasks(id,project_id,workspace_id,title,kind,spec_json,acceptance_json,"
                    "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (tid, project_id, ws_id, title, kind, canonical_json(spec or {}),
                     canonical_json(acceptance or []), now(), now()))
        for d in depends_on or []:
            con.execute("INSERT INTO task_deps(task_id,depends_on) VALUES (?,?)", (tid, d))
    return db.one("SELECT * FROM tasks WHERE id=?", (tid,))


def list_tasks(db: Database) -> list[dict]:
    rows = db.query("SELECT t.*, p.name AS project_name FROM tasks t "
                    "LEFT JOIN projects p ON p.id=t.project_id ORDER BY t.created_at DESC")
    for r in rows:
        r["spec"] = json.loads(r.pop("spec_json"))
        r["acceptance"] = json.loads(r.pop("acceptance_json"))
    return rows


def list_runs(db: Database, limit: int = 100) -> list[dict]:
    return db.query("SELECT r.*, t.title AS task_title, t.kind AS task_kind FROM runs r "
                    "JOIN tasks t ON t.id=r.task_id ORDER BY r.created_at DESC LIMIT ?", (limit,))


def run_detail(db: Database, run_id: str) -> dict | None:
    run = db.one("SELECT r.*, t.title AS task_title, t.kind AS task_kind FROM runs r "
                 "JOIN tasks t ON t.id=r.task_id WHERE r.id=?", (run_id,))
    if not run:
        return None
    q = lambda sql: db.query(sql, (run_id,))  # noqa: E731
    return {
        "run": run,
        "attempts": q("SELECT * FROM run_attempts WHERE run_id=? ORDER BY n"),
        "steps": q("SELECT * FROM steps WHERE run_id=? ORDER BY seq"),
        "events": q("SELECT * FROM run_events WHERE run_id=? ORDER BY id"),
        "artifacts": q("SELECT * FROM artifacts WHERE run_id=? ORDER BY created_at"),
        "evidence": q("SELECT * FROM evidence WHERE run_id=? ORDER BY created_at"),
        "approvals": q("SELECT id,status,summary,action_hash,requested_at,decided_at FROM approvals "
                       "WHERE run_id=? ORDER BY requested_at"),
    }


def read_artifact(db: Database, settings: Settings, artifact_id: str, max_bytes: int = 500_000) -> dict | None:
    a = db.one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not a:
        return None
    path = resolve_within(settings.artifacts_dir, a["path"])
    data = path.read_bytes()[:max_bytes]
    return {**a, "content": data.decode("utf-8", errors="replace")}


def list_approvals(db: Database, status: str | None = None) -> list[dict]:
    sql = ("SELECT a.id,a.run_id,a.summary,a.status,a.action_hash,a.action_json,a.requested_at,a.decided_at "
           "FROM approvals a")
    rows = db.query(sql + (" WHERE a.status=?" if status else "") + " ORDER BY a.requested_at DESC",
                    (status,) if status else ())
    for r in rows:
        r["action"] = json.loads(r.pop("action_json"))
    return rows
