"""Durable run engine.

States: queued -> running -> awaiting_approval | blocked | interrupted -> ... -> succeeded|failed|cancelled
Every transition is validated and atomic. Side-effecting steps are never replayed after a
crash: they are marked 'uncertain' and the run is blocked for human verification."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from . import abilities, approvals, providers
from .config import Settings
from .db import Database
from .security import PathViolation, redact, redact_obj, resolve_within
from .util import canonical_json, new_id, now, sha256_text

TERMINAL = {"succeeded", "failed", "cancelled"}
TRANSITIONS: dict[str, set[str]] = {
    "queued": {"running", "cancelled", "blocked"},
    "running": {"awaiting_approval", "succeeded", "failed", "cancelled", "blocked",
                "interrupted", "queued"},
    "awaiting_approval": {"queued", "cancelled", "failed"},
    "blocked": {"queued", "cancelled", "failed"},
    "interrupted": {"queued", "failed", "cancelled", "blocked"},
    "succeeded": set(), "failed": set(), "cancelled": set(),
}


class RunError(Exception):
    pass


class Blocked(RunError):
    """Cannot proceed for a real, reportable reason (missing provider, uncertain effect...).
    code is a stable machine-readable reason: provider_unavailable | awaiting_provider_session |
    quota_exhausted | dependency | uncertain_side_effect | other."""

    def __init__(self, message: str, code: str = "other"):
        super().__init__(message)
        self.code = code


class RetryableError(RunError):
    """Explicitly retryable failure. Anything else is final."""


class LimitExceeded(RunError):
    pass


class DeadlineExceeded(RunError):
    pass


class Cancelled(RunError):
    pass


class NeedsApproval(RunError):
    def __init__(self, approval_id: str):
        super().__init__(approval_id)
        self.approval_id = approval_id


class ApprovalRejected(RunError):
    pass


Executor = Callable[["RunContext"], dict]
EXECUTORS: dict[str, Executor] = {}


def executor(kind: str):
    def deco(fn: Executor) -> Executor:
        EXECUTORS[kind] = fn
        return fn
    return deco


def fingerprint(exc: BaseException) -> str:
    msg = re.sub(r"\d+", "N", str(exc))
    return hashlib.sha256(f"{type(exc).__name__}:{msg}".encode()).hexdigest()[:16]


class RunContext:
    def __init__(self, engine: "Engine", run: dict, task: dict, workspace: dict | None):
        self.engine, self.db, self.settings = engine, engine.db, engine.settings
        self.run, self.run_id, self.task, self.workspace = run, run["id"], task, workspace
        self.spec = json.loads(task["spec_json"] or "{}")
        self._deadline = time.monotonic() + run["deadline_s"]

    # ---- limits / liveness ----
    def check(self) -> None:
        if time.monotonic() > self._deadline:
            raise DeadlineExceeded(f"run exceeded its {self.run['deadline_s']}s deadline")
        row = self.db.one("SELECT state, cancel_requested_at FROM runs WHERE id=?", (self.run_id,))
        if not row or row["state"] != "running":
            raise Cancelled(f"run is {row['state'] if row else 'gone'}")
        if row["cancel_requested_at"]:
            self.engine.confirm_cancel(self.run_id)
            raise Cancelled("cancellation confirmed at a step boundary")
        self.db.execute("UPDATE runs SET updated_at=? WHERE id=?", (now(), self.run_id))

    def tick(self, n: int = 1) -> None:
        self.check()
        with self.db.tx() as con:
            con.execute("UPDATE runs SET iteration=iteration+? WHERE id=?", (n, self.run_id))
            r = con.execute("SELECT iteration, max_iterations FROM runs WHERE id=?",
                            (self.run_id,)).fetchone()
        if r["iteration"] > r["max_iterations"]:
            raise LimitExceeded(f"iteration limit {r['max_iterations']} exceeded")

    # ---- steps ----
    def step(self, name: str, fn: Callable[[], object], *, side_effect: bool = False):
        """Run fn once; completed steps replay from stored output (resume-safe)."""
        self.check()
        row = self.db.one("SELECT * FROM steps WHERE run_id=? AND name=?", (self.run_id, name))
        if row:
            if row["state"] == "done":
                return json.loads(row["output_json"]) if row["output_json"] else None
            if row["state"] in ("uncertain",) or (row["state"] == "started" and row["side_effect"]):
                self.db.execute("UPDATE steps SET state='uncertain' WHERE id=?", (row["id"],))
                raise Blocked(f"side-effect step '{name}' has unknown outcome after an interruption; "
                              "verify it manually before resuming (it will not be repeated automatically)",
                              code="uncertain_side_effect")
            self.db.execute("DELETE FROM steps WHERE id=?", (row["id"],))
        sid = new_id("stp")
        seq = (self.db.one("SELECT COUNT(*) c FROM steps WHERE run_id=?", (self.run_id,)) or {"c": 0})["c"] + 1
        self.db.execute("INSERT INTO steps(id,run_id,seq,name,state,side_effect,started_at) "
                        "VALUES (?,?,?,?,'started',?,?)",
                        (sid, self.run_id, seq, name, int(side_effect), now()))
        self.event("step", f"{name} started", {"side_effect": side_effect})
        try:
            out = fn()
        except BaseException as e:
            self.db.execute("UPDATE steps SET state='failed', finished_at=?, error=? WHERE id=?",
                            (now(), redact(str(e))[:2000], sid))
            raise
        self.db.execute("UPDATE steps SET state='done', finished_at=?, output_json=? WHERE id=?",
                        (now(), canonical_json(redact_obj(out)) if out is not None else None, sid))
        self.event("step", f"{name} done")
        return out

    def guarded_action(self, action: dict, summary: str, perform: Callable[[], object]):
        """Run an approval-gated side effect. Approval is bound to the exact action."""
        existing = self.db.one("SELECT state FROM steps WHERE run_id=? AND name=?",
                               (self.run_id, f"action:{approvals.action_hash(action)[:12]}"))
        step_name = f"action:{approvals.action_hash(action)[:12]}"
        if existing and existing["state"] == "done":
            return self.step(step_name, perform, side_effect=True)
        state, aid = approvals.status_for(self.db, self.run_id, action)
        if state == "rejected":
            raise ApprovalRejected(f"approval {aid} was rejected")
        if state in ("none", "pending"):
            aid = approvals.request(self.db, self.run_id, action, summary, self.settings.approval_ttl_s)
            raise NeedsApproval(aid)

        def spend_then_perform():
            approvals.consume(self.db, aid, self.run_id, action)  # spent BEFORE the effect
            return perform()
        return self.step(step_name, spend_then_perform, side_effect=True)

    # ---- records ----
    def event(self, kind: str, message: str, data: dict | None = None) -> None:
        self.engine.event(self.run_id, kind, message, data)

    def add_evidence(self, kind: str, summary: str, ref: str | None = None) -> None:
        self.db.execute("INSERT INTO evidence(id,run_id,kind,summary,ref,created_at) VALUES (?,?,?,?,?,?)",
                        (new_id("evd"), self.run_id, kind, redact(summary), ref, now()))

    def add_artifact(self, kind: str, filename: str, content: str | bytes,
                     provenance: str = "generated") -> str:
        base = self.settings.artifacts_dir / self.run_id
        base.mkdir(parents=True, exist_ok=True)
        path = resolve_within(base, filename)
        data = redact(content).encode("utf-8") if isinstance(content, str) else content
        path.write_bytes(data)
        aid = new_id("art")
        self.db.execute("INSERT INTO artifacts(id,run_id,kind,path,sha256,bytes,provenance,created_at) "
                        "VALUES (?,?,?,?,?,?,?,?)",
                        (aid, self.run_id, kind, f"{self.run_id}/{filename}",
                         hashlib.sha256(data).hexdigest(), len(data), provenance, now()))
        return aid

    def find_artifact(self, kind: str) -> dict | None:
        return self.db.one("SELECT * FROM artifacts WHERE run_id=? AND kind=? ORDER BY created_at DESC",
                           (self.run_id, kind))


class Engine:
    def __init__(self, settings: Settings, db: Database):
        self.settings, self.db = settings, db
        self._pool = ThreadPoolExecutor(max_workers=settings.max_concurrent, thread_name_prefix="run")
        self._active: set[str] = set()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    # ---- basic records ----
    def event(self, run_id: str, kind: str, message: str, data: dict | None = None) -> None:
        self.db.execute("INSERT INTO run_events(run_id,ts,kind,message,data_json) VALUES (?,?,?,?,?)",
                        (run_id, now(), kind, redact(message)[:2000],
                         canonical_json(redact_obj(data)) if data else None))

    def audit(self, actor: str, action: str, detail: dict | None = None) -> None:
        self.db.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
                        (now(), actor, action, canonical_json(redact_obj(detail)) if detail else None))

    def transition(self, run_id: str, new: str, reason: str | None = None,
                   expect: str | None = None, block_code: str | None = None) -> bool:
        with self.db.tx() as con:
            row = con.execute("SELECT state FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise KeyError(run_id)
            cur = row["state"]
            if expect and cur != expect:
                return False
            if new not in TRANSITIONS[cur]:
                raise ValueError(f"illegal transition {cur} -> {new}")
            fin = now() if new in TERMINAL else None
            con.execute("UPDATE runs SET state=?, state_reason=?, updated_at=?, "
                        "finished_at=COALESCE(?, finished_at), block_code=? WHERE id=?",
                        (new, redact(reason)[:2000] if reason else None, now(), fin,
                         (block_code or "other") if new == "blocked" else None, run_id))
        self.event(run_id, "state", f"{cur} -> {new}" + (f": {reason}" if reason else ""))
        return True

    def _set_task(self, task_id: str, status: str, reason: str | None) -> None:
        self.db.execute("UPDATE tasks SET status=?, status_reason=?, updated_at=? WHERE id=?",
                        (status, redact(reason)[:2000] if reason else None, now(), task_id))

    # ---- run creation ----
    def create_run(self, task_id: str, *, idempotency_key: str | None = None,
                   deadline_s: int | None = None, max_attempts: int = 3,
                   max_iterations: int = 1000) -> dict:
        if not self.db.one("SELECT id FROM tasks WHERE id=?", (task_id,)):
            raise KeyError(task_id)
        if idempotency_key:
            ex = self.db.one("SELECT * FROM runs WHERE idempotency_key=?", (idempotency_key,))
            if ex:
                return ex
        rid = new_id("run")
        self.db.execute(
            "INSERT INTO runs(id,task_id,state,idempotency_key,max_attempts,max_iterations,deadline_s,"
            "created_at,updated_at) VALUES (?,?,'queued',?,?,?,?,?,?)",
            (rid, task_id, idempotency_key, max_attempts, max_iterations,
             deadline_s or self.settings.default_deadline_s, now(), now()))
        self.event(rid, "state", "created (queued)")
        return self.db.one("SELECT * FROM runs WHERE id=?", (rid,))

    # ---- execution ----
    def execute(self, run_id: str) -> str:
        """Run to a stopping state. Safe to call concurrently: claiming is atomic."""
        if not self.transition(run_id, "running", expect="queued"):
            return self.db.one("SELECT state FROM runs WHERE id=?", (run_id,))["state"]
        with self._lock:
            self._active.add(run_id)
        run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        task = self.db.one("SELECT * FROM tasks WHERE id=?", (run["task_id"],))
        ws = (self.db.one("SELECT * FROM workspaces WHERE id=?", (task["workspace_id"],))
              if task["workspace_id"] else None)
        locked = False
        try:
            unmet = self.db.query(
                "SELECT t.id FROM task_deps d JOIN tasks t ON t.id=d.depends_on "
                "WHERE d.task_id=? AND t.status<>'done'", (task["id"],))
            if unmet:
                self.transition(run_id, "blocked", f"waiting on {len(unmet)} unfinished dependency task(s)",
                                block_code="dependency")
                self._set_task(task["id"], "blocked", "unfinished dependencies")
                return "blocked"
            if ws and not self._lock_workspace(ws["id"], run_id):
                self.event(run_id, "lock", "workspace busy; re-queued")
                self.transition(run_id, "queued", "workspace locked by another run")
                return "queued"
            locked = bool(ws)
            fn = EXECUTORS.get(task["kind"])
            if fn is None:
                self.transition(run_id, "failed", f"no executor for task kind '{task['kind']}'")
                self._set_task(task["id"], "failed", "no executor")
                return "failed"
            return self._attempt_loop(run_id, run, task, ws, fn)
        finally:
            if locked:
                self.db.execute("DELETE FROM workspace_locks WHERE workspace_id=? AND run_id=?",
                                (ws["id"], run_id))
            with self._lock:
                self._active.discard(run_id)

    def _lock_workspace(self, ws_id: str, run_id: str) -> bool:
        with self.db.tx() as con:
            row = con.execute("SELECT l.run_id, r.state FROM workspace_locks l JOIN runs r ON r.id=l.run_id "
                              "WHERE l.workspace_id=?", (ws_id,)).fetchone()
            if row and row["run_id"] != run_id:
                if row["state"] == "running" and row["run_id"] in self._active:
                    return False
                con.execute("DELETE FROM workspace_locks WHERE workspace_id=?", (ws_id,))  # stale
            con.execute("INSERT OR REPLACE INTO workspace_locks(workspace_id,run_id,acquired_at) VALUES (?,?,?)",
                        (ws_id, run_id, now()))
        return True

    def _attempt_loop(self, run_id, run, task, ws, fn) -> str:
        deadline_at = (datetime.now(timezone.utc) + timedelta(seconds=run["deadline_s"])).isoformat()
        self.db.execute("UPDATE runs SET deadline_at=?, started_at=COALESCE(started_at, ?) WHERE id=?",
                        (deadline_at, now(), run_id))
        while True:
            run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))
            n = run["attempt"] + 1
            self.db.execute("UPDATE runs SET attempt=? WHERE id=?", (n, run_id))
            att = new_id("att")
            self.db.execute("INSERT INTO run_attempts(id,run_id,n,started_at) VALUES (?,?,?,?)",
                            (att, run_id, n, now()))
            run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))  # fresh attempt number
            ctx = RunContext(self, run, task, ws)

            def end_attempt(outcome, exc=None, retryable=False):
                self.db.execute(
                    "UPDATE run_attempts SET finished_at=?, outcome=?, error=?, error_fingerprint=?, "
                    "retryable=? WHERE id=?",
                    (now(), outcome, redact(str(exc))[:2000] if exc else None,
                     fingerprint(exc) if exc else None, int(retryable), att))

            try:
                result = fn(ctx)
                ctx.check()
                checks = self._acceptance(ctx, task, result or {})
                failed = [c for c in checks if not c["passed"]]
                for c in checks:
                    ctx.add_evidence("acceptance", f"{'PASS' if c['passed'] else 'FAIL'}: {c['check']} "
                                     f"- {c['detail']}")
                self.db.execute(
                    "INSERT INTO checkpoints(id,run_id,name,data_json,created_at) VALUES (?,?,?,?,?)",
                    (new_id("chk"), run_id, "result", canonical_json(redact_obj(result or {})), now()))
                if failed:
                    end_attempt("failed")
                    reason = "acceptance checks failed: " + "; ".join(c["check"] for c in failed)
                    self.transition(run_id, "failed", reason)
                    self._set_task(task["id"], "failed", reason)
                    return "failed"
                end_attempt("succeeded")
                self.transition(run_id, "succeeded")
                self._set_task(task["id"], "done", None)
                return "succeeded"
            except NeedsApproval as e:
                end_attempt("awaiting_approval")
                self.db.execute("UPDATE runs SET attempt=attempt-1 WHERE id=?", (run_id,))
                self.transition(run_id, "awaiting_approval", f"approval {e.approval_id} required")
                return "awaiting_approval"
            except Blocked as e:
                end_attempt("blocked", e)
                self.db.execute("UPDATE runs SET attempt=attempt-1 WHERE id=?", (run_id,))
                if self.transition(run_id, "blocked", str(e), expect="running", block_code=e.code):
                    self._set_task(task["id"], "blocked", str(e))
                return "blocked"
            except ApprovalRejected as e:
                end_attempt("cancelled", e)
                self.transition(run_id, "cancelled", str(e))
                self._set_task(task["id"], "cancelled", str(e))
                return "cancelled"
            except Cancelled as e:
                end_attempt("cancelled", e)
                return self.db.one("SELECT state FROM runs WHERE id=?", (run_id,))["state"]
            except (DeadlineExceeded, LimitExceeded) as e:
                end_attempt("failed", e)
                self.transition(run_id, "failed", str(e))
                self._set_task(task["id"], "failed", str(e))
                return "failed"
            except RetryableError as e:
                end_attempt("retryable_failure", e, retryable=True)
                fp = fingerprint(e)
                prev = run["last_error_fingerprint"]
                self.db.execute("UPDATE runs SET last_error_fingerprint=? WHERE id=?", (fp, run_id))
                if prev == fp:
                    reason = f"stopped: repeated identical failure ({e})"
                elif n >= run["max_attempts"]:
                    reason = f"stopped: {n} attempts exhausted ({e})"
                else:
                    self.event(run_id, "retry", f"attempt {n} failed (retryable): {e}")
                    continue
                self.transition(run_id, "failed", reason)
                self._set_task(task["id"], "failed", reason)
                return "failed"
            except BaseException as e:  # non-retryable by default
                end_attempt("failed", e)
                reason = f"{type(e).__name__}: {e}"
                self.transition(run_id, "failed", reason)
                self._set_task(task["id"], "failed", reason)
                return "failed"

    def _acceptance(self, ctx: RunContext, task: dict, result: dict) -> list[dict]:
        out = []
        for c in json.loads(task["acceptance_json"] or "[]"):
            t = c.get("type")
            if t == "artifact_kind":
                n = ctx.db.one("SELECT COUNT(*) n FROM artifacts WHERE run_id=? AND kind=?",
                               (ctx.run_id, c["kind"]))["n"]
                out.append(dict(check=f"artifact:{c['kind']}", passed=n > 0, detail=f"{n} found"))
            elif t == "result_key":
                ok = c["key"] in result
                out.append(dict(check=f"result_key:{c['key']}", passed=ok,
                                detail="present" if ok else "missing"))
            elif t == "evidence_min":
                n = ctx.db.one("SELECT COUNT(*) n FROM evidence WHERE run_id=? AND kind<>'acceptance'",
                               (ctx.run_id,))["n"]
                out.append(dict(check=f"evidence_min:{c['n']}", passed=n >= c["n"], detail=f"{n} recorded"))
            else:
                out.append(dict(check=f"unknown:{t}", passed=False, detail="unknown acceptance type"))
        return out

    # ---- operator actions ----
    def cancel(self, run_id: str) -> str:
        """Two-phase cancellation. Returns 'confirmed' (run was not executing, so it stopped at once)
        or 'requested' (run is executing: it stops at the next step boundary; a step already in
        flight may still finish, and completed side effects are never reversed)."""
        run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if not run:
            raise KeyError(run_id)
        if run["state"] in TERMINAL:
            raise ValueError(f"run already {run['state']}")
        self.audit("operator", "run.cancel", {"run": run_id, "state": run["state"]})
        if run["state"] == "running":
            n = self.db.execute("UPDATE runs SET cancel_requested_at=COALESCE(cancel_requested_at, ?) "
                                "WHERE id=? AND state='running'", (now(), run_id))
            if n:
                self.event(run_id, "cancel", "cancellation requested; the run stops at the next step boundary")
                return "requested"
        for aid in self.db.query("SELECT id FROM approvals WHERE run_id=? AND status='pending'", (run_id,)):
            self.db.execute("UPDATE approvals SET status='superseded', decided_at=?, decision_note='run cancelled' "
                            "WHERE id=?", (now(), aid["id"]))
        self.transition(run_id, "cancelled", "cancelled by operator")
        self.db.execute("UPDATE runs SET cancel_requested_at=COALESCE(cancel_requested_at, ?), "
                        "cancel_confirmed_at=? WHERE id=?", (now(), now(), run_id))
        self._set_task(run["task_id"], "cancelled", "cancelled by operator")
        return "confirmed"

    def confirm_cancel(self, run_id: str) -> None:
        run = self.db.one("SELECT task_id FROM runs WHERE id=?", (run_id,))
        if self.transition(run_id, "cancelled", "cancellation confirmed at a step boundary", expect="running"):
            self.db.execute("UPDATE runs SET cancel_confirmed_at=? WHERE id=?", (now(), run_id))
            self._set_task(run["task_id"], "cancelled", "cancelled by operator")

    def resume(self, run_id: str) -> None:
        """blocked/interrupted -> queued. A run with an uncertain side effect will block again."""
        run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if run["state"] not in ("blocked", "interrupted"):
            raise ValueError(f"cannot resume a run in state {run['state']}")
        self.transition(run_id, "queued", "resumed by operator")
        self._set_task(run["task_id"], "open", None)
        self.audit("operator", "run.resume", {"run": run_id})

    def decide_approval(self, approval_id: str, approve: bool, note: str = "", **guards) -> None:
        row = approvals.decide(self.db, approval_id, approve, note, **guards)
        self.audit("operator", "approval.approve" if approve else "approval.reject",
                   {"approval": approval_id, "hash": row["action_hash"]})
        run = self.db.one("SELECT * FROM runs WHERE id=?", (row["run_id"],))
        if run and run["state"] == "awaiting_approval":
            if approve:
                self.transition(run["id"], "queued", "approval granted")
            else:
                self.transition(run["id"], "cancelled", f"approval rejected: {note}".strip())
                self._set_task(run["task_id"], "cancelled", "approval rejected")

    def import_result(self, run_id: str, text: str, source: str) -> None:
        """Manual-handoff result import. Stored as an UNVERIFIED claim with provenance."""
        run = self.db.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if not run or run["state"] != "blocked":
            raise ValueError("run is not waiting for a handoff result")
        base = self.settings.artifacts_dir / run_id
        base.mkdir(parents=True, exist_ok=True)
        data = redact(text).encode("utf-8")
        fname = f"imported-result-{int(time.time())}.md"
        (base / fname).write_bytes(data)
        self.db.execute(
            "INSERT INTO artifacts(id,run_id,kind,path,sha256,bytes,provenance,created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (new_id("art"), run_id, "imported_result", f"{run_id}/{fname}",
             hashlib.sha256(data).hexdigest(), len(data),
             f"user-imported:{source}; UNVERIFIED claim, imported {now()}", now()))
        self.audit("operator", "run.import_result", {"run": run_id, "source": source, "bytes": len(data)})
        self.transition(run_id, "queued", "handoff result imported")
        self._set_task(run["task_id"], "open", None)

    # ---- recovery ----
    def reconcile(self) -> dict:
        """Run at startup: runs left 'running' by a dead process become 'interrupted'; unfinished
        side-effect steps become 'uncertain' and are never replayed automatically."""
        summary = {"interrupted": [], "uncertain_steps": 0}
        for r in self.db.query("SELECT id FROM runs WHERE state='running'"):
            if r["id"] in self._active:
                continue
            n = self.db.execute("UPDATE steps SET state='uncertain' WHERE run_id=? AND state='started' "
                                "AND side_effect=1", (r["id"],))
            summary["uncertain_steps"] += n
            reason = "process stopped while running"
            if n:
                reason += f"; {n} side-effect step(s) have unknown outcome and will not be repeated"
            self.transition(r["id"], "interrupted", reason, expect="running")
            summary["interrupted"].append(r["id"])
        self.db.execute("DELETE FROM workspace_locks WHERE run_id NOT IN "
                        "(SELECT id FROM runs WHERE state='running')")
        return summary

    def detect_stalled(self) -> list[str]:
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=self.settings.stall_after_s)).isoformat()
        out = []
        for r in self.db.query("SELECT id FROM runs WHERE state='running' AND updated_at<?", (cutoff,)):
            if self.transition(r["id"], "interrupted", "stalled: no heartbeat", expect="running"):
                out.append(r["id"])
        return out

    # ---- background dispatch ----
    def start(self) -> None:
        self._stop.clear()
        t = threading.Thread(target=self._dispatch_loop, name="dispatcher", daemon=True)
        t.start()
        self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=5)
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _dispatch_loop(self) -> None:
        tick = 0
        while not self._stop.wait(0.5):
            try:
                with self._lock:
                    free = self.settings.max_concurrent - len(self._active)
                if free > 0 and not abilities.is_paused(self.db):       # pause-everything: nothing new starts
                    for r in self.db.query("SELECT id FROM runs WHERE state='queued' "
                                           "ORDER BY created_at LIMIT ?", (free,)):
                        with self._lock:
                            if r["id"] in self._active:
                                continue
                            self._active.add(r["id"])
                        self._pool.submit(self._run_claimed, r["id"])
                tick += 1
                if tick % 20 == 0:
                    self.detect_stalled()
            except Exception:  # dispatcher must survive anything
                time.sleep(1)

    def _run_claimed(self, run_id: str) -> None:
        with self._lock:
            self._active.discard(run_id)
        try:
            self.execute(run_id)
        except Exception as e:
            self.event(run_id, "error", f"engine error: {type(e).__name__}: {e}")
