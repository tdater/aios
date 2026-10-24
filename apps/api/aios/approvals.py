"""Exact-action approvals. An approval is bound to sha256(canonical action JSON), is
single use, and silently stops matching if the action changes by even one byte."""
from __future__ import annotations

from .db import Database
from .util import canonical_json, new_id, now, sha256_text


def action_hash(action: dict) -> str:
    return sha256_text(canonical_json(action))


def request(db: Database, run_id: str, action: dict, summary: str) -> str:
    h = action_hash(action)
    with db.tx() as con:
        row = con.execute(
            "SELECT id FROM approvals WHERE run_id=? AND action_hash=? "
            "AND status IN ('pending','approved')", (run_id, h)).fetchone()
        if row:
            return row["id"]
        # a changed action invalidates any earlier pending request for this run
        con.execute("UPDATE approvals SET status='expired', decided_at=? "
                    "WHERE run_id=? AND status='pending'", (now(), run_id))
        aid = new_id("apr")
        con.execute("INSERT INTO approvals(id,run_id,action_json,action_hash,summary,status,requested_at) "
                    "VALUES (?,?,?,?,?,'pending',?)",
                    (aid, run_id, canonical_json(action), h, summary, now()))
        return aid


def status_for(db: Database, run_id: str, action: dict) -> tuple[str, str | None]:
    """Return (state, approval_id) for this exact action: approved|rejected|pending|none."""
    h = action_hash(action)
    for status in ("approved", "rejected", "pending"):
        row = db.one("SELECT id FROM approvals WHERE run_id=? AND action_hash=? AND status=? "
                     "ORDER BY requested_at DESC", (run_id, h, status))
        if row:
            return status, row["id"]
    return "none", None


def decide(db: Database, approval_id: str, approve: bool, note: str = "") -> dict:
    with db.tx() as con:
        row = con.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()
        if not row:
            raise KeyError(approval_id)
        if row["status"] != "pending":
            raise ValueError(f"approval is {row['status']}, not pending")
        con.execute("UPDATE approvals SET status=?, decided_at=?, decision_note=? WHERE id=?",
                    ("approved" if approve else "rejected", now(), note, approval_id))
        return dict(row)


def consume(db: Database, approval_id: str, run_id: str, action: dict) -> None:
    """Atomically spend an approval. Fails unless it is approved, unspent, and matches
    this run and this exact action."""
    h = action_hash(action)
    n = db.execute("UPDATE approvals SET status='consumed', consumed_at=? "
                   "WHERE id=? AND run_id=? AND action_hash=? AND status='approved'",
                   (now(), approval_id, run_id, h))
    if n != 1:
        raise PermissionError("approval does not match this exact action or was already used")
