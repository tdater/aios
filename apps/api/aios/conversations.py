"""Conversations: persisted, attributed exchanges between the owner, a provider and AIOS about one
project. Shared by the API, the claude.turn executor and tests.

Attribution is part of the record. Every message says who produced it: the owner ('user'), the
provider's model ('provider', with the client version and model name), or AIOS itself ('aios',
for status, patch and verification facts that AIOS computed rather than a model claimed).
"""
from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

from . import claude_code, context_pack, providers, verification, worktrees
from .config import Settings
from .db import Database
from .errors import ApiError, not_found
from .pagination import page
from .security import redact, redact_obj
from .util import canonical_json, new_id, now

if TYPE_CHECKING:  # pragma: no cover
    from .engine import Engine

MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-\[\]:]{0,63}$")
MODES = tuple(claude_code.MODES)
ACTIVE_STATES = ("queued", "running", "awaiting_approval", "blocked", "interrupted")
MAX_MESSAGE_CHARS = 20_000
TURN_DEADLINE_S = 1800


# ---------------------------------------------------------------- records
def get(db: Database, conversation_id: str) -> dict | None:
    return db.one("SELECT * FROM conversations WHERE id=?", (conversation_id,))


def require(db: Database, conversation_id: str) -> dict:
    conv = get(db, conversation_id)
    if not conv:
        raise not_found("conversation")
    return conv


def create(db: Database, *, project_id: str, title: str | None = None, model: str | None = None) -> dict:
    ws = db.one("SELECT w.id, w.path FROM workspaces w JOIN projects p ON p.id=w.project_id "
                "WHERE p.id=? AND p.status='active'", (project_id,))
    if not ws:
        raise not_found("project")
    if model is not None and not MODEL_RE.match(model):
        raise ApiError(422, "bad_model", "model names use letters, digits and . _ - [ ] : only")
    cid = new_id("cnv")
    t = now()
    db.execute("INSERT INTO conversations(id,project_id,workspace_id,title,model,created_at,updated_at) "
               "VALUES (?,?,?,?,?,?,?)",
               (cid, project_id, ws["id"], (title or "Conversation").strip()[:200] or "Conversation",
                model, t, t))
    db.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
               (t, "operator", "conversation.create", canonical_json({"conversation": cid, "project": project_id})))
    return get(db, cid)


def list_conversations(db: Database, *, project_id: str | None = None, limit: int | None = None,
                       cursor: str | None = None) -> dict:
    where, params = [], []
    if project_id:
        where.append("c.project_id=?")
        params.append(project_id)
    return page(db, "SELECT c.*, p.name AS project_name FROM conversations c "
                    "JOIN projects p ON p.id=c.project_id", where, params, sort="c.created_at",
                id_col="c.id", limit=limit, cursor=cursor)


def add_message(db: Database, conversation_id: str, *, role: str, author_kind: str, author: str,
                content: str, kind: str = "message", run_id: str | None = None,
                meta: dict | None = None) -> dict:
    if author_kind != "user":                 # the owner's own words are kept as typed
        content = redact(content)
    with db.tx() as con:
        seq = con.execute("SELECT COALESCE(MAX(seq),0)+1 AS n FROM conversation_messages "
                          "WHERE conversation_id=?", (conversation_id,)).fetchone()["n"]
        mid = new_id("msg")
        con.execute("INSERT INTO conversation_messages(id,conversation_id,seq,role,author_kind,author,kind,"
                    "content,run_id,meta_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (mid, conversation_id, seq, role, author_kind, author, kind, content, run_id,
                     canonical_json(meta) if meta else None, now()))
        con.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now(), conversation_id))
    return db.one("SELECT * FROM conversation_messages WHERE id=?", (mid,))


def note_once(db: Database, conversation_id: str, run_id: str, text: str, kind: str = "status",
              meta: dict | None = None) -> None:
    """AIOS status line, written at most once per run even if the run is resumed."""
    if db.one("SELECT 1 AS x FROM conversation_messages WHERE conversation_id=? AND run_id=? "
              "AND kind=? AND content=?", (conversation_id, run_id, kind, text)):
        return
    add_message(db, conversation_id, role="system", author_kind="aios", author="aios", content=text,
                kind=kind, run_id=run_id, meta=meta)


def messages(db: Database, conversation_id: str, after_seq: int = 0) -> list[dict]:
    rows = db.query("SELECT * FROM conversation_messages WHERE conversation_id=? AND seq>? ORDER BY seq",
                    (conversation_id, after_seq))
    for r in rows:
        r["meta"] = json.loads(r.pop("meta_json")) if r.get("meta_json") else None
    return rows


def set_worktree(db: Database, conversation_id: str, path: str, branch: str, base: str) -> None:
    db.execute("UPDATE conversations SET worktree_path=?, branch=?, base_revision=?, head_revision=?, "
               "updated_at=? WHERE id=?", (path, branch, base, base, now(), conversation_id))


def set_session(db: Database, conversation_id: str, session_id: str | None) -> None:
    if session_id:
        db.execute("UPDATE conversations SET session_id=?, updated_at=? WHERE id=?",
                   (session_id, now(), conversation_id))


def set_head(db: Database, conversation_id: str, head: str) -> None:
    db.execute("UPDATE conversations SET head_revision=?, updated_at=? WHERE id=?",
               (head, now(), conversation_id))


# ---------------------------------------------------------------- verification command
def verify_argv(db: Database, project_id: str) -> list[str] | None:
    row = db.one("SELECT verify_json FROM projects WHERE id=?", (project_id,))
    if not row or not row["verify_json"]:
        return None
    try:
        return verification.validate_argv(json.loads(row["verify_json"]))
    except (ValueError, json.JSONDecodeError):
        return None


def set_verify_command(db: Database, project_id: str, argv) -> list[str] | None:
    """Only the owner sets this (an explicit API call from a paired device). Providers cannot."""
    if not db.one("SELECT 1 AS x FROM projects WHERE id=?", (project_id,)):
        raise not_found("project")
    if argv is None:
        db.execute("UPDATE projects SET verify_json=NULL, updated_at=? WHERE id=?", (now(), project_id))
        out = None
    else:
        try:
            out = verification.validate_argv(argv)
        except ValueError as e:
            raise ApiError(422, "bad_verify_command", str(e))
        db.execute("UPDATE projects SET verify_json=?, updated_at=? WHERE id=?",
                   (json.dumps(out), now(), project_id))
    db.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
               (now(), "operator", "project.verify_command",
                canonical_json({"project": project_id, "argv": out})))
    return out


# ---------------------------------------------------------------- turns
def active_turn(db: Database, conversation_id: str) -> dict | None:
    marks = ",".join("?" * len(ACTIVE_STATES))
    return db.one(f"SELECT r.* FROM runs r JOIN conversation_messages m ON m.run_id=r.id "
                  f"WHERE m.conversation_id=? AND m.role='user' AND r.state IN ({marks}) "
                  f"ORDER BY r.created_at DESC LIMIT 1", (conversation_id, *ACTIVE_STATES))


def post_user_message(db: Database, engine: "Engine", conversation_id: str, content: str,
                      mode: str = "read", idempotency_key: str | None = None) -> dict:
    from . import services
    conv = require(db, conversation_id)
    content = (content or "").strip()
    if not content:
        raise ApiError(422, "empty_message", "write a message first")
    if len(content) > MAX_MESSAGE_CHARS:
        raise ApiError(422, "message_too_long", f"messages are limited to {MAX_MESSAGE_CHARS} characters")
    if mode not in MODES:
        raise ApiError(422, "bad_mode", f"mode must be one of {list(MODES)}")
    if conv["status"] != "open":
        raise ApiError(409, "conversation_archived", "this conversation is archived")
    busy = active_turn(db, conversation_id)
    if busy:
        raise ApiError(409, "turn_in_progress",
                       "the previous turn has not finished; wait for it, resolve it, or cancel it",
                       {"run_id": busy["id"], "state": busy["state"]})
    if mode == "edit" and not worktrees.worktree_ok(conv["worktree_path"]):
        ws = db.one("SELECT path FROM workspaces WHERE id=?", (conv["workspace_id"],))
        st = worktrees.repo_state(ws["path"])
        if not st["usable"]:
            raise ApiError(409, "repo_not_ready", st["reason"])
    msg = add_message(db, conversation_id, role="user", author_kind="user", author="you",
                      content=content, meta={"mode": mode})
    task = services.create_task(
        db, title=content.splitlines()[0][:80], kind="claude.turn", project_id=conv["project_id"],
        spec={"conversation_id": conversation_id, "message_id": msg["id"], "mode": mode},
        acceptance=[{"type": "artifact_kind", "kind": "claude_transcript"}])
    run = engine.create_run(task["id"], deadline_s=TURN_DEADLINE_S, max_attempts=1,
                            idempotency_key=idempotency_key)
    db.execute("UPDATE conversation_messages SET run_id=? WHERE id=?", (run["id"], msg["id"]))
    return {"message": db.one("SELECT * FROM conversation_messages WHERE id=?", (msg["id"],)),
            "task": task, "run": services.decorate_run(db, run)}


# ---------------------------------------------------------------- honest status
STATIC_PERMISSIONS = {
    "tools_read_mode": claude_code.READ_TOOLS,
    "tools_edit_mode": claude_code.EDIT_TOOLS,
    "shell": "denied",
    "network": "denied",
    "settings_files": "none loaded (user, project and local settings are all excluded)",
    "claude_md_and_auto_memory": "not loaded; AIOS supplies approved notes and records which",
    "edits": "made only in an isolated git worktree, never in your project folder",
    "verification": "runs only after you approve the exact command and revision",
    "api_billing": "API-billing variables removed; runs use your claude.ai subscription login",
}


def _last_turn(db: Database, conversation_id: str) -> dict | None:
    row = db.one("SELECT meta_json, created_at, run_id FROM conversation_messages WHERE conversation_id=? "
                 "AND meta_json LIKE '%\"turn\":%' ORDER BY seq DESC LIMIT 1", (conversation_id,))
    if not row:
        return None
    meta = json.loads(row["meta_json"])
    turn = meta.get("turn")
    if not turn:
        return None
    return {"at": row["created_at"], "run_id": row["run_id"], **turn}


def status_block(db: Database, conv: dict) -> dict:
    cap = providers.capability(db, "claude")
    detail = (cap or {}).get("detail", {})
    last = _last_turn(db, conv["id"])
    run = db.one("SELECT r.* FROM runs r JOIN conversation_messages m ON m.run_id=r.id "
                 "WHERE m.conversation_id=? ORDER BY r.created_at DESC LIMIT 1", (conv["id"],))
    pending = []
    if run and run["state"] == "awaiting_approval":
        pending = db.query("SELECT id, summary, requested_at, expires_at FROM approvals "
                           "WHERE run_id=? AND status='pending'", (run["id"],))
    from . import services
    return {
        "provider": {"name": "claude", "mode": (cap or {}).get("mode", "unknown"),
                     "billing": (cap or {}).get("billing", "unknown"),
                     "client_version": detail.get("version"), "plan": detail.get("plan"),
                     "auth_method": detail.get("auth_method"), "logged_in": detail.get("logged_in"),
                     "checked_at": (cap or {}).get("checked_at")},
        "session": {"id": conv["session_id"], "resumable": bool(conv["session_id"]),
                    "model": conv["model"] or "account default"},
        "permissions": STATIC_PERMISSIONS,
        "workspace": {"worktree": conv["worktree_path"], "branch": conv["branch"],
                      "base_revision": conv["base_revision"], "head_revision": conv["head_revision"]},
        "last_turn": last,
        "quota": (last or {}).get("rate_limit"),
        "quota_note": ("From the last turn's rate-limit report; shows 5-hour and 7-day usage of your "
                       "subscription. Not live." if (last or {}).get("rate_limit")
                       else "No quota report yet: it appears after the first turn."),
        "run": services.decorate_run(db, run, with_cancel=False) if run else None,
        "pending_approvals": pending,
    }


def changes(db: Database, conversation_id: str) -> dict:
    def latest(kind: str) -> dict | None:
        row = db.one("SELECT * FROM conversation_messages WHERE conversation_id=? AND kind=? "
                     "ORDER BY seq DESC LIMIT 1", (conversation_id, kind))
        if not row:
            return None
        row["meta"] = json.loads(row.pop("meta_json")) if row.get("meta_json") else None
        return row
    return {"patch": latest("patch"), "verification": latest("verification")}


def view(db: Database, conversation_id: str) -> dict:
    conv = require(db, conversation_id)
    proj = db.one("SELECT id, name FROM projects WHERE id=?", (conv["project_id"],))
    argv = verify_argv(db, conv["project_id"])
    return redact_obj({
        "conversation": conv, "project": proj, "verify_command": argv,
        "messages": messages(db, conversation_id), "status": status_block(db, conv),
        "changes": changes(db, conversation_id),
        "context": {r["run_id"]: context_pack.supplied_for_run(db, r["run_id"])
                    for r in db.query("SELECT DISTINCT run_id FROM context_supplied WHERE conversation_id=?",
                                      (conversation_id,))},
    })
