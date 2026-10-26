"""Exact-action approvals. An approval is bound to sha256(canonical action JSON), is single use,
expires, and silently stops matching if the action changes by even one byte. Decisions are
race-safe: they happen inside one IMMEDIATE transaction and re-check status, expiry, action hash
and record version."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .db import Database
from .errors import ApiError
from .security import redact
from .util import canonical_json, new_id, now, sha256_text

DEFAULT_TTL_S = 24 * 3600


def action_hash(action: dict) -> str:
    return sha256_text(canonical_json(action))


def describe(action: dict) -> dict:
    """Human-reviewable facts about an action. Unknown action types are treated as destructive."""
    t = action.get("type", "unknown")
    if t == "write_file":
        target = str(action.get("path", ""))
        exists = bool(target) and Path(target).exists()
        return {"type": t, "target": target,
                "side_effects": [f"{'Overwrites' if exists else 'Creates'} the file at {target}",
                                 "Completed writes are not undone by cancelling the run"],
                "content_preview": redact(str(action.get("content", "")))[:2000],
                "destructive": exists}
    if t == "run_verification":
        argv = [str(a) for a in action.get("argv", [])]
        rev = str(action.get("head_revision", ""))[:12]
        keep = ("argv", "cwd", "head_revision", "patch_sha256", "timeout_s")
        return {"type": t, "target": str(action.get("cwd", "")),
                "side_effects": [f"Runs this command on your computer: {' '.join(argv)}",
                                 f"It runs in an isolated worktree holding code an AI wrote or changed "
                                 f"(revision {rev})",
                                 "That code runs with your Windows account's rights. This is not a sandbox: "
                                 "the command can do anything your account can",
                                 "Your project folder is not changed, but nothing the command does outside "
                                 "the worktree is undone by cancelling"],
                "content_preview": redact(canonical_json({k: action.get(k) for k in keep}))[:2000],
                "destructive": True}
    if t == "apply_revision":
        files = [str(f) for f in action.get("files", [])]
        sens = [str(f) for f in action.get("sensitive_paths", [])]
        keep = ("project_path", "branch", "head_revision", "target_branch", "target_head", "patch_sha256", "file_count", "paths_sha256")
        effects = [f"Adds a new commit to your real project folder, on its branch '{action.get('target_branch')}'",
                   f"It merges revision {str(action.get('head_revision', ''))[:12]} (branch {action.get('branch')}), "
                   f"changing {action.get('file_count', len(files))} file(s): {', '.join(json.dumps(f) for f in files[:8])}"
                   f"{' (first 8 shown)' if int(action.get('file_count', len(files))) > 8 else ''}",
                   "Your project must be exactly as it is now (same branch and latest commit, nothing uncommitted), or nothing is changed"]
        if sens:
            effects.append("These files run code or change tool behaviour, so read them first: " + ", ".join(json.dumps(f) for f in sens))
        effects.append(f"To undo it, run: git reset --hard {str(action.get('target_head', ''))[:12]} (only before you commit more on top)")
        return {"type": t, "target": str(action.get("project_path", "")), "side_effects": effects,
                "content_preview": redact(canonical_json({k: action.get(k) for k in keep}))[:2000], "destructive": True}
    return {"type": t, "target": str(action.get("target", "")),
            "side_effects": ["Unknown action type: assume it changes state and cannot be undone"],
            "content_preview": redact(canonical_json(action))[:2000], "destructive": True}


def _iso_in(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat(timespec="milliseconds")


def sweep_expired(db: Database) -> None:
    db.execute("UPDATE approvals SET status='expired' WHERE status IN ('pending','approved') AND expires_at <= ?",
               (now(),))


def request(db: Database, run_id: str, action: dict, summary: str, ttl_s: int = DEFAULT_TTL_S) -> str:
    sweep_expired(db)
    h = action_hash(action)
    with db.tx() as con:
        row = con.execute("SELECT id FROM approvals WHERE run_id=? AND action_hash=? "
                          "AND status IN ('pending','approved')", (run_id, h)).fetchone()
        if row:
            return row["id"]
        # a changed action supersedes any earlier pending request for this run
        con.execute("UPDATE approvals SET status='superseded', decided_at=?, decision_note='action changed' "
                    "WHERE run_id=? AND status='pending'", (now(), run_id))
        aid = new_id("apr")
        con.execute("INSERT INTO approvals(id,run_id,action_json,action_hash,summary,status,requested_at,"
                    "expires_at,destructive) VALUES (?,?,?,?,?,'pending',?,?,?)",
                    (aid, run_id, canonical_json(action), h, redact(summary), now(), _iso_in(ttl_s),
                     int(describe(action)["destructive"])))
        return aid


def status_for(db: Database, run_id: str, action: dict) -> tuple[str, str | None]:
    """Return (state, approval_id) for this exact action: approved|rejected|pending|none."""
    sweep_expired(db)
    h = action_hash(action)
    for status in ("approved", "rejected", "pending"):
        row = db.one("SELECT id FROM approvals WHERE run_id=? AND action_hash=? AND status=? "
                     "ORDER BY requested_at DESC", (run_id, h, status))
        if row:
            return status, row["id"]
    return "none", None


_BAD_STATE = {
    "approved": ("approval_resolved", "This approval was already approved."),
    "rejected": ("approval_resolved", "This approval was already rejected."),
    "consumed": ("approval_resolved", "This approval was already used."),
    "expired": ("approval_expired", "This approval request expired. A new request is needed."),
    "superseded": ("approval_superseded", "The action changed or the run ended; this request no longer applies."),
}


def decide(db: Database, approval_id: str, approve: bool, note: str = "", *, expected_version: int | None = None,
           action_hash_seen: str | None = None, confirm_destructive: bool = False,
           session_id: str | None = None) -> dict:
    sweep_expired(db)  # persists expiry; the in-transaction check below only guards the tiny race window
    with db.tx() as con:
        row = con.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()
        if not row:
            raise ApiError(404, "not_found", "approval not found")
        row = dict(row)
        if row["status"] == "pending" and row["expires_at"] <= now():
            row["status"] = "expired"
        if row["status"] != "pending":
            code, msg = _BAD_STATE[row["status"]]
            raise ApiError(409, code, msg, {"status": row["status"]})
        if expected_version is not None and row["version"] != expected_version:
            raise ApiError(409, "version_conflict", "The approval changed since you loaded it.",
                           {"current_version": row["version"], "expected_version": expected_version})
        if action_hash_seen is not None and action_hash_seen != row["action_hash"]:
            raise ApiError(409, "action_changed", "The action differs from what you reviewed.",
                           {"current_action_hash": row["action_hash"]})
        if approve and row["destructive"] and not confirm_destructive:
            raise ApiError(409, "confirmation_required",
                           "This action is destructive or unrecognised; deliberate confirmation is required.")
        n = con.execute("UPDATE approvals SET status=?, decided_at=?, decision_note=?, decided_by_session=? "
                        "WHERE id=? AND status='pending'",
                        ("approved" if approve else "rejected", now(), redact(note), session_id, approval_id)).rowcount
        if n != 1:  # lost a race that BEGIN IMMEDIATE should already prevent; fail closed
            raise ApiError(409, "approval_resolved", "Another request resolved this approval first.")
        return row


def consume(db: Database, approval_id: str, run_id: str, action: dict) -> None:
    """Atomically spend an approval. Fails unless it is approved, unspent, unexpired, and matches
    this run and this exact action."""
    h = action_hash(action)
    n = db.execute("UPDATE approvals SET status='consumed', consumed_at=? "
                   "WHERE id=? AND run_id=? AND action_hash=? AND status='approved' AND expires_at > ?",
                   (now(), approval_id, run_id, h, now()))
    if n != 1:
        raise PermissionError("approval does not match this exact action, expired, or was already used")
