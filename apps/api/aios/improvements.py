"""Evaluation-gated, versioned, reversible skill improvement.

run evidence -> candidate -> EVALUATION (executable checks) -> HUMAN review -> versioned deployment -> rollback.

Hard rules enforced in code, not by prompts:
- Nothing is ever promoted automatically. promote() needs an explicit human confirmation and a fresh passing evaluation.
- A candidate that fails evaluation stays a candidate; it cannot be promoted by any path.
- The evaluator, safety policy and permissions (scripts/skill_eval.py, scripts/claude_guard.py, .claude/settings.json,
  scan scripts, CI) can never be targeted by a candidate: submission is refused. Changing them is a manual, human edit.
- Only `<skills_dir>/<name>/SKILL.md` (+ its eval file) can be deployed. Names are validated; paths are confined.
- Every deployed version stores its exact bytes + sha256; rollback restores those bytes and verifies the hash.
- A previously rejected content hash is not re-proposed without new evidence."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

from .config import REPO_ROOT, Settings
from .db import Database
from .errors import ApiError
from .security import find_secret_kinds, resolve_within
from .util import canonical_json, new_id, now

NAME_RX = re.compile(r"^[a-z][a-z0-9-]{2,48}$")
PROTECTED_NAMES = {"claude-guard", "skill-eval", "settings", "scan-secrets"}


def _evaluator():
    spec = importlib.util.spec_from_file_location("aios_skill_eval", REPO_ROOT / "scripts" / "skill_eval.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("aios_skill_eval", mod)
    spec.loader.exec_module(mod)
    return mod


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _err(code: str, msg: str, status: int = 409, **details) -> ApiError:
    return ApiError(status, code, msg, details)


def _cand(db: Database, cid: str) -> dict:
    c = db.one("SELECT * FROM skill_candidates WHERE id=?", (cid,))
    if not c:
        raise ApiError(404, "not_found", "skill candidate not found")
    return c


def submit(db: Database, *, name: str, content: str, evals: dict, rationale: str, target_path: str | None = None,
           new_evidence: str | None = None) -> dict:
    """Create an inert candidate. Refuses protected targets, secrets, bad names, and re-proposals of rejected content."""
    if not NAME_RX.match(name) or name in PROTECTED_NAMES:
        raise _err("bad_skill_name", "Skill names are lowercase letters, digits and hyphens (3-49 chars).", 422)
    expected = f".claude/skills/{name}/SKILL.md"
    if target_path is not None and target_path.replace("\\", "/") != expected:
        raise _err("protected_target",
                   "Candidates may only deploy to their own skill file. The evaluator, guard, settings and CI files can "
                   "only be changed by a human edit.", 422, target=target_path)
    if find_secret_kinds(content) or find_secret_kinds(json.dumps(evals)):
        raise _err("contains_secret", "The candidate contains something that looks like a secret.", 422)
    sha = _sha(content)
    rejected = db.one("SELECT id FROM skill_candidates WHERE name=? AND content_sha256=? AND status='rejected'", (name, sha))
    if rejected and not (new_evidence or "").strip():
        raise _err("previously_rejected", "This exact content was rejected before. Provide new evidence to reconsider.",
                   409, candidate=rejected["id"])
    cid = new_id("skc")
    pid = new_id("imp")
    with db.tx() as con:
        con.execute("INSERT INTO improvement_proposals(id,title,rationale,risk,status,evidence_json,created_at) "
                    "VALUES (?,?,?,?,?,?,?)", (pid, f"Skill: {name}", rationale[:2000], "medium", "proposed",
                                               canonical_json([new_evidence] if new_evidence else []), now()))
        con.execute("INSERT INTO skill_candidates(id,name,rationale,definition_path,status,created_at,content,evals_json,"
                    "content_sha256,eval_status,proposal_id) VALUES (?,?,?,?,'candidate',?,?,?,?,'not_run',?)",
                    (cid, name, rationale[:2000], expected, now(), content, json.dumps(evals, sort_keys=True), sha, pid))
    return _cand(db, cid)


def _active_version(db: Database, name: str) -> dict | None:
    return db.one("SELECT * FROM skill_versions WHERE name=? AND status='active' ORDER BY version DESC LIMIT 1", (name,))


def _regression_failures(settings: Settings, ev) -> list[str]:
    """Every skill already deployed must still pass its own evaluation (the regression set)."""
    bad = []
    if settings.skills_dir.is_dir():
        for p in sorted(settings.skills_dir.glob("*/SKILL.md")):
            res = ev.evaluate_text(p.read_text(encoding="utf-8"), p.parent.name, ev.load_evals(p.parent.name, settings.evals_dir))
            bad += [f"{p.parent.name}:{r['case']}" for r in res if r["status"] == "fail"]
    return bad


def evaluate(db: Database, settings: Settings, cid: str) -> dict:
    """Run executable checks on the candidate plus the regression set; record every result. Never promotes."""
    c = _cand(db, cid)
    if c["status"] != "candidate":
        raise _err("not_a_candidate", f"candidate is {c['status']}")
    ev = _evaluator()
    evals = json.loads(c["evals_json"]) if c["evals_json"] else None
    results = ev.evaluate_text(c["content"], c["name"], evals)
    regression = _regression_failures(settings, ev)
    failed = [r for r in results if r["status"] == "fail"]
    passed = not failed and not regression
    with db.tx() as con:
        for r in results:
            case_id = f"{cid}:{r['case']}"
            con.execute("INSERT OR IGNORE INTO eval_cases(id,target,description,definition_json,created_at) VALUES (?,?,?,?,?)",
                        (case_id, c["name"], r["case"], "{}", now()))
            con.execute("INSERT INTO eval_results(id,case_id,subject,passed,detail,created_at) VALUES (?,?,?,?,?,?)",
                        (new_id("evr"), case_id, cid, int(r["status"] == "pass"),
                         f"{r['status']}: {r['detail']}"[:500], now()))
        con.execute("UPDATE skill_candidates SET eval_status=? WHERE id=?", ("passed" if passed else "failed", cid))
        con.execute("UPDATE improvement_proposals SET status='evaluated' WHERE id=?", (c["proposal_id"],))
    return {"candidate": cid, "eval_status": "passed" if passed else "failed",
            "failed_cases": [r["case"] for r in failed], "regression_failures": regression,
            "not_executed": sum(1 for r in results if r["status"] == "not_executed"),
            "note": "Behavioural cases are specifications; they were NOT executed. Promotion still needs a human decision."}


def reject(db: Database, cid: str, note: str) -> dict:
    c = _cand(db, cid)
    if c["status"] != "candidate":
        raise _err("not_a_candidate", f"candidate is {c['status']}")
    with db.tx() as con:
        con.execute("UPDATE skill_candidates SET status='rejected', decision_note=?, decided_at=? WHERE id=?", (note, now(), cid))
        con.execute("UPDATE improvement_proposals SET status='rejected', decided_at=? WHERE id=?", (now(), c["proposal_id"]))
    return _cand(db, cid)


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(text.encode("utf-8"))
    tmp.replace(path)


def promote(db: Database, settings: Settings, cid: str, *, confirm: bool, approved_by: str, note: str = "") -> dict:
    """Deploy a candidate as a new version. Requires: human confirmation, a FRESH passing evaluation, regression set green."""
    if not confirm:
        raise _err("confirmation_required", "Promotion deploys executable instructions; explicit human confirmation is required.")
    c = _cand(db, cid)
    if c["status"] != "candidate":
        raise _err("not_a_candidate", f"candidate is {c['status']}")
    fresh = evaluate(db, settings, cid)              # never trust a stale result
    if fresh["eval_status"] != "passed":
        raise _err("evaluation_failed", "The candidate does not pass evaluation and cannot be promoted.", 409,
                   failed_cases=fresh["failed_cases"], regression_failures=fresh["regression_failures"])
    name = c["name"]
    target = resolve_within(settings.skills_dir, f"{name}/SKILL.md")
    evals_target = resolve_within(settings.evals_dir, f"{name}.json") if settings.evals_dir else None
    prev = _active_version(db, name)
    version = (db.one("SELECT COALESCE(MAX(version),0) v FROM skill_versions WHERE name=?", (name,))["v"]) + 1
    vid = new_id("skv")
    with db.tx() as con:
        if prev:
            con.execute("UPDATE skill_versions SET status='retired' WHERE id=?", (prev["id"],))
        con.execute("INSERT INTO skill_versions(id,name,version,git_ref,status,created_at,content,sha256,evals_json,candidate_id,"
                    "parent_version,deployed_at,note) VALUES (?,?,?,?,'active',?,?,?,?,?,?,?,?)",
                    (vid, name, version, None, now(), c["content"], c["content_sha256"], c["evals_json"], cid,
                     prev["version"] if prev else None, now(), note[:500]))
        con.execute("UPDATE skill_candidates SET status='approved', decision_note=?, decided_at=? WHERE id=?", (note, now(), cid))
        con.execute("UPDATE improvement_proposals SET status='deployed', decided_at=? WHERE id=?", (now(), c["proposal_id"]))
        con.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
                    (now(), approved_by, "skill.promote", canonical_json({"skill": name, "version": version, "candidate": cid})))
    _write_atomic(target, c["content"])
    if evals_target and c["evals_json"]:
        _write_atomic(evals_target, json.dumps(json.loads(c["evals_json"]), indent=2) + "\n")
    return {"skill": name, "version": version, "sha256": c["content_sha256"], "path": str(target), "previous_version": prev["version"] if prev else None}


def rollback(db: Database, settings: Settings, name: str, *, approved_by: str, to_version: int | None = None, note: str = "") -> dict:
    """Restore a previous version's exact bytes (or remove the skill if it had no earlier version)."""
    cur = _active_version(db, name)
    if not cur:
        raise _err("nothing_to_roll_back", f"no active version of '{name}'")
    target = resolve_within(settings.skills_dir, f"{name}/SKILL.md")
    evals_target = resolve_within(settings.evals_dir, f"{name}.json")
    if to_version is None:
        to_version = cur["parent_version"]
    dest = db.one("SELECT * FROM skill_versions WHERE name=? AND version=?", (name, to_version)) if to_version else None
    if dest is not None:
        if _sha(dest["content"]) != dest["sha256"]:
            raise _err("integrity_failure", "Stored version content does not match its recorded hash; refusing to deploy it.", 500)
    with db.tx() as con:
        con.execute("UPDATE skill_versions SET status='rolled_back', note=? WHERE id=?", (f"rolled back: {note}"[:500], cur["id"]))
        if dest is not None:
            con.execute("UPDATE skill_versions SET status='active' WHERE id=?", (dest["id"],))
        con.execute("UPDATE improvement_proposals SET status='rolled_back' WHERE id=(SELECT proposal_id FROM skill_candidates WHERE id=?)",
                    (cur["candidate_id"],))
        con.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
                    (now(), approved_by, "skill.rollback", canonical_json({"skill": name, "from": cur["version"], "to": to_version})))
    if dest is not None:
        _write_atomic(target, dest["content"])
        if dest["evals_json"]:
            _write_atomic(evals_target, json.dumps(json.loads(dest["evals_json"]), indent=2) + "\n")
        return {"skill": name, "restored_version": dest["version"], "sha256": dest["sha256"]}
    target.unlink(missing_ok=True)
    evals_target.unlink(missing_ok=True)
    try:
        target.parent.rmdir()
    except OSError:
        pass
    return {"skill": name, "restored_version": None, "removed": True}


def candidate_detail(db: Database, cid: str) -> dict:
    """Everything a human needs to decide on a candidate: the exact text that would be deployed, why, and every check result."""
    c = _cand(db, cid)
    results = db.query("SELECT r.passed, r.detail, c.description FROM eval_results r JOIN eval_cases c ON c.id = r.case_id "
                       "WHERE r.subject=? ORDER BY r.created_at, r.id", (cid,))
    active = _active_version(db, c["name"])
    return {"id": c["id"], "name": c["name"], "status": c["status"], "eval_status": c["eval_status"], "rationale": c["rationale"],
            "content": c["content"] or "", "sha256": c["content_sha256"], "decision_note": c["decision_note"],
            "results": [{"case": r["description"], "passed": bool(r["passed"]), "detail": r["detail"]} for r in results],
            "active_version": active["version"] if active else None}


def overview(db: Database) -> dict:
    return {
        "candidates": db.query("SELECT id,name,status,eval_status,content_sha256,created_at,decided_at,decision_note FROM skill_candidates ORDER BY created_at DESC LIMIT 100"),
        "versions": db.query("SELECT name,version,status,sha256,parent_version,deployed_at,note FROM skill_versions ORDER BY name, version DESC"),
        "proposals": db.query("SELECT id,title,risk,status,created_at,decided_at FROM improvement_proposals ORDER BY created_at DESC LIMIT 100"),
    }
