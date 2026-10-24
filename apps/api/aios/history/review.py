"""Human review of candidates + the incremental 'review new sessions' action.
Approving never activates anything: scripts, guardrails and skills stay inert proposals;
only memory-type candidates become (approved) vault memories."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .. import memory
from ..config import Settings
from ..db import Database
from ..util import canonical_json, new_id, now
from . import extract, formats
from .ingest import Ingestor

MEMORY_TYPE = {"preference": "preference", "project_fact": "fact", "decision": "decision", "lesson": "lesson"}
REVIEW_STALE_AFTER_S = 600


class ReviewError(Exception):
    pass


class ReviewBusy(Exception):
    pass


def _cand(db: Database, cid: str) -> dict:
    c = db.one("SELECT * FROM candidates WHERE id=?", (cid,))
    if not c:
        raise KeyError(cid)
    c["flags"] = json.loads(c["flags_json"])
    return c


def _log(db: Database, cid: str, action: str, note: str, before: dict | None = None) -> None:
    db.execute("INSERT INTO candidate_decisions(candidate_id,action,note,before_json,ts) VALUES (?,?,?,?,?)",
               (cid, action, note, canonical_json(before) if before else None, now()))


def detail(db: Database, cid: str) -> dict:
    c = _cand(db, cid)
    c["evidence"] = db.query(
        "SELECT e.role, e.excerpt, e.source_id, m.ref, m.kind, m.ts, m.role AS speaker FROM candidate_evidence e "
        "JOIN messages m ON m.id=e.message_id WHERE e.candidate_id=? ORDER BY m.id", (cid,))
    c["decisions"] = db.query("SELECT action, note, ts FROM candidate_decisions WHERE candidate_id=? ORDER BY id",
                              (cid,))
    c.pop("flags_json", None)
    return c


def approve(db: Database, settings: Settings, cid: str, note: str = "", *, confirm_global: bool = False,
            override_injection: bool = False) -> dict:
    c = _cand(db, cid)
    if c["status"] not in ("candidate", "deferred"):
        raise ReviewError(f"candidate is {c['status']}; only candidate/deferred can be approved")
    if "injection_suspect" in c["flags"] and not override_injection:
        raise ReviewError("candidate contains injection-like text; explicit override_injection is required")
    if c["scope"] == "global" and not confirm_global:
        raise ReviewError("global scope changes behaviour everywhere; pass confirm_global after reviewing evidence")
    if "conflict" in c["flags"] and not note.strip():
        raise ReviewError("contradicting evidence exists; a note acknowledging it is required")
    mem_id = None
    if c["type"] in MEMORY_TYPE:
        ev = db.query("SELECT excerpt, source_id FROM candidate_evidence WHERE candidate_id=? AND role='support'",
                      (cid,))
        body = f"{c['problem']}\n\n**Outcome:** {c['outcome']}\n\n**Evidence excerpts**\n" + \
            "\n".join(f"- {e['excerpt']}" for e in ev[:8])
        mem_id = memory.create(
            db, settings, scope=c["scope"], project_id=c["project_id"], type=MEMORY_TYPE[c["type"]],
            basis="observation" if c["type"] == "preference" else "inference", title=c["title"], body=body,
            confidence=c["confidence"], status="approved", from_candidate=cid,
            sources=[f"history:{e['source_id']}" for e in ev[:20]])
    db.execute("UPDATE candidates SET status='approved', decided_at=?, reviewer_note=?, evidence_at_decision=?, "
               "memory_id=COALESCE(?, memory_id), updated_at=? WHERE id=?",
               (now(), note, c["distinct_occurrences"], mem_id, now(), cid))
    _log(db, cid, "approve", note)
    return detail(db, cid)


def reject(db: Database, cid: str, note: str = "") -> dict:
    c = _cand(db, cid)
    if c["status"] in ("approved", "merged", "superseded"):
        raise ReviewError(f"candidate is {c['status']}; use supersede instead")
    db.execute("UPDATE candidates SET status='rejected', decided_at=?, reviewer_note=?, evidence_at_decision=?, "
               "updated_at=? WHERE id=?", (now(), note, c["distinct_occurrences"], now(), cid))
    _log(db, cid, "reject", note)
    return detail(db, cid)


def defer(db: Database, cid: str, note: str = "") -> dict:
    c = _cand(db, cid)
    if c["status"] != "candidate":
        raise ReviewError(f"only candidates can be deferred (is {c['status']})")
    db.execute("UPDATE candidates SET status='deferred', decided_at=?, reviewer_note=?, updated_at=? WHERE id=?",
               (now(), note, now(), cid))
    _log(db, cid, "defer", note)
    return detail(db, cid)


def edit(db: Database, cid: str, *, title: str | None = None, problem: str | None = None,
         scope: str | None = None, confirm_global: bool = False, note: str = "") -> dict:
    c = _cand(db, cid)
    if scope == "global" and not confirm_global:
        raise ReviewError("promoting to global scope requires confirm_global")
    before = {k: c[k] for k in ("title", "problem", "scope")}
    db.execute("UPDATE candidates SET title=COALESCE(?,title), problem=COALESCE(?,problem), "
               "scope=COALESCE(?,scope), updated_at=? WHERE id=?", (title, problem, scope, now(), cid))
    _log(db, cid, "edit", note, before)
    return detail(db, cid)


def merge(db: Database, cid: str, into: str, note: str = "") -> dict:
    a, b = _cand(db, cid), _cand(db, into)
    if cid == into or a["type"] != b["type"]:
        raise ReviewError("can only merge two different candidates of the same type")
    with db.tx() as con:
        con.execute("UPDATE OR IGNORE candidate_evidence SET candidate_id=? WHERE candidate_id=?", (into, cid))
        con.execute("DELETE FROM candidate_evidence WHERE candidate_id=?", (cid,))
        con.execute("UPDATE candidates SET status='merged', merged_into=?, decided_at=?, reviewer_note=?, "
                    "updated_at=? WHERE id=?", (into, now(), note, now(), cid))
    extract.recompute_candidate(db, into)
    _log(db, cid, "merge", f"into {into}. {note}")
    return detail(db, into)


def supersede(db: Database, settings: Settings, old: str, new: str, note: str = "", *,
              confirm_global: bool = False, override_injection: bool = False) -> dict:
    o, n = _cand(db, old), _cand(db, new)
    if o["status"] != "approved":
        raise ReviewError("only an approved record can be superseded")
    if not note.strip():
        raise ReviewError("a note explaining the new evidence is required")
    if n["status"] in ("candidate", "deferred"):
        approve(db, settings, new, note, confirm_global=confirm_global, override_injection=override_injection)
    elif n["status"] != "approved":
        raise ReviewError(f"replacement is {n['status']}")
    new_mem = _cand(db, new)["memory_id"]
    with db.tx() as con:
        con.execute("UPDATE candidates SET status='superseded', superseded_by=?, decided_at=?, reviewer_note=?, "
                    "updated_at=? WHERE id=?", (new, now(), note, now(), old))
    if o["memory_id"]:
        memory.update(db, settings, o["memory_id"], status="superseded")
        db.execute("UPDATE memories SET superseded_by=? WHERE id=?", (new_mem, o["memory_id"]))
    _log(db, old, "supersede", f"by {new}. {note}")
    return detail(db, new)


def revalidate(db: Database, cid: str, run_id: str, note: str) -> dict:
    """Mark 'revalidated in the current environment' only when backed by a succeeded AIOS run."""
    run = db.one("SELECT state FROM runs WHERE id=?", (run_id,))
    if not run or run["state"] != "succeeded":
        raise ReviewError("revalidation requires a succeeded AIOS run as evidence")
    db.execute("UPDATE candidates SET validation='revalidated_current', updated_at=? WHERE id=?", (now(), cid))
    _log(db, cid, "revalidate", f"run {run_id}. {note}")
    return detail(db, cid)


# ---------------------------------------------------------------------------
def _analysis_fingerprint(db: Database) -> str:
    rows = db.query("SELECT id, content_hash FROM sources WHERE status='parsed' ORDER BY id")
    h = hashlib.sha256(f"{extract.ANALYZER_VERSION}|{formats.PARSER_VERSION}".encode())
    for r in rows:
        h.update(f"{r['id']}:{r['content_hash']};".encode())
    return h.hexdigest()


def totals(db: Database) -> dict:
    t = {r["status"]: r["n"] for r in db.query("SELECT status, COUNT(*) n FROM sources GROUP BY status")}
    return {"discovered": sum(t.values()), "parsed": t.get("parsed", 0), "quarantined": t.get("quarantined", 0),
            "duplicate": t.get("duplicate", 0), "unsupported": t.get("unsupported", 0),
            "failed": t.get("failed", 0), "deleted": t.get("deleted", 0)}


def review_new(db: Database, settings: Settings, *, max_files: int = 200, max_seconds: float = 120,
               skills_dir: Path | None = None, after_file=None) -> dict:
    """Manual 'review new sessions'. Cheap when nothing changed; never starts a nested review."""
    stale = db.query("SELECT id FROM review_runs WHERE status='running' AND started_at < ?",
                     (_ago(REVIEW_STALE_AFTER_S),))
    for s in stale:  # a crashed earlier review must not wedge the system forever
        db.execute("UPDATE review_runs SET status='failed', finished_at=?, report_json=? WHERE id=?",
                   (now(), canonical_json({"error": "stale: process stopped during review"}), s["id"]))
    if db.one("SELECT id FROM review_runs WHERE status='running'"):
        raise ReviewBusy("a review is already running")
    rid = new_id("rev")
    db.execute("INSERT INTO review_runs(id,started_at,status) VALUES (?,?,'running')", (rid, now()))
    status, report = "failed", {}
    try:
        ing = Ingestor(db, settings).run(max_files=max_files, max_seconds=max_seconds, after_file=after_file)
        fp = _analysis_fingerprint(db)
        prev = (db.one("SELECT value FROM kv WHERE key='analysis_fp'") or {}).get("value")
        report = {"ingest": ing, "provider_usage": "none (deterministic; no model calls)"}
        if fp == prev and not ing["limit_reached"]:
            status = "no_change"
            report["analysis"] = "skipped: no new or changed parsed material"
        else:
            report["analysis"] = extract.analyze(db, skills_dir)
            db.execute("INSERT INTO kv(key,value) VALUES ('analysis_fp',?) ON CONFLICT(key) DO UPDATE SET "
                       "value=excluded.value", (fp,))
            status = "limit_reached" if ing["limit_reached"] else "succeeded"
        report["totals"] = totals(db)
        return {"id": rid, "status": status, **report}
    except BaseException as e:
        report = {"error": type(e).__name__}
        raise
    finally:
        db.execute("UPDATE review_runs SET status=?, finished_at=?, report_json=? WHERE id=?",
                   (status, now(), canonical_json(report), rid))


def _ago(seconds: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat(timespec="milliseconds")
