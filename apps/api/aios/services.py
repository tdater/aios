"""Domain operations shared by the API and tests."""
from __future__ import annotations

import json
import re

from .config import REPO_ROOT, Settings
from .db import Database
from .security import resolve_within, validate_workspace_root
from .util import canonical_json, new_id, now  # noqa: F401  (now re-exported for the API layer)


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


BLOCK_DISPLAY = {"awaiting_provider_session": "awaiting_provider_session", "quota_exhausted": "blocked_quota"}


def display_state(run: dict) -> str:
    """Honest, user-facing state. Raw `state` stays the machine contract."""
    s = run["state"]
    if s == "blocked":
        return BLOCK_DISPLAY.get(run.get("block_code") or "", "blocked")
    return {"succeeded": "completed"}.get(s, s)


def cancellation_view(db: Database, run: dict) -> dict:
    req, conf = run.get("cancel_requested_at"), run.get("cancel_confirmed_at")
    if not req:
        status = "none"
    elif conf:
        status = "confirmed"
    elif run["state"] in ("succeeded", "failed"):
        status = "too_late"      # finished before the cancellation could take effect
    else:
        status = "requested"
    inflight = None
    if status == "requested":
        s = db.one("SELECT name, side_effect FROM steps WHERE run_id=? AND state='started'", (run["id"],))
        inflight = {"step": s["name"], "side_effect": bool(s["side_effect"])} if s else None
    return {"status": status, "requested_at": req, "confirmed_at": conf,
            "in_flight_step": inflight, "may_still_finish_step": bool(inflight),
            "note": "Cancelling stops further steps. It does not reverse side effects that already completed."}


def decorate_run(db: Database, run: dict, with_cancel: bool = True) -> dict:
    run["display_state"] = display_state(run)
    if with_cancel:
        run["cancellation"] = cancellation_view(db, run)
    return run


def approval_view(db: Database, a: dict, detail: bool = True) -> dict:
    from datetime import datetime, timezone
    from .approvals import describe
    action = json.loads(a.pop("action_json"))
    t = datetime.now(timezone.utc)
    a["action"] = action
    a["review"] = describe(action)
    a["destructive"] = bool(a["destructive"])
    a["age_s"] = int((t - datetime.fromisoformat(a["requested_at"])).total_seconds())
    a["expires_in_s"] = int((datetime.fromisoformat(a["expires_at"]) - t).total_seconds())
    if detail and a.get("run_id"):
        run = db.one("SELECT r.id, r.state, t.title AS task_title, t.kind AS task_kind FROM runs r "
                     "JOIN tasks t ON t.id=r.task_id WHERE r.id=?", (a["run_id"],))
        a["context"] = {"run": run, "evidence": db.query(
            "SELECT kind, summary, created_at FROM evidence WHERE run_id=? ORDER BY created_at DESC LIMIT 5",
            (a["run_id"],))}
    return a


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
    decorate_run(db, run)
    return {
        "run": run,
        "last_event_id": (db.one("SELECT COALESCE(MAX(id),0) m FROM run_events WHERE run_id=?", (run_id,)))["m"],
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
