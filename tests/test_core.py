import json
import os
import sqlite3
from pathlib import Path

import pytest

from aios import approvals, backup, providers, security, services
from aios.config import REPO_ROOT, Settings, load_settings
from aios.db import Database
from aios.engine import Engine, TRANSITIONS
from conftest import run_task

AUDIT_ACCEPT = [{"type": "artifact_kind", "kind": "audit_report"}, {"type": "evidence_min", "n": 2}]


# ---- 1/3/4: audit with evidence, no unrelated scanning ----
def test_audit_runs_with_evidence_and_never_leaks_secret_values(engine, db, settings, project):
    t, r, state = run_task(engine, db, "audit.workspace", project=project, acceptance=AUDIT_ACCEPT)
    assert state == "succeeded"
    d = services.run_detail(db, r["id"])
    assert {a["kind"] for a in d["artifacts"]} == {"audit_report", "audit_summary"}
    assert any(e["kind"] == "acceptance" and e["summary"].startswith("PASS") for e in d["evidence"])
    report = next(a for a in d["artifacts"] if a["kind"] == "audit_report")
    body = services.read_artifact(db, settings, report["id"])["content"]
    assert "abcdefghijklmnop1234" not in body
    codes = {f["code"] for f in json.loads(body)["findings"]}
    assert {"secrets-in-tree", "no-tests"} <= codes
    assert db.one("SELECT status FROM tasks WHERE id=?", (t["id"],))["status"] == "done"


def test_audit_does_not_follow_symlinks_out_of_workspace(engine, db, settings, project, sample_ws, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("token = zzzzzzzzzzzzzzzzzzzz\n")
    try:
        os.symlink(outside, sample_ws / "link", target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation not permitted")
    _, r, state = run_task(engine, db, "audit.workspace", project=project)
    assert state == "succeeded"
    rep = next(a for a in services.run_detail(db, r["id"])["artifacts"] if a["kind"] == "audit_report")
    scan = json.loads(services.read_artifact(db, settings, rep["id"])["content"])["scan"]
    assert scan["links_skipped"] >= 1
    assert all("outside" not in s["path"] and "link" not in s["path"] for s in scan["potential_secrets"])


def test_workspace_registration_rejects_broad_and_overlapping_roots(db, settings, tmp_path):
    for bad in (Path(Path.home().anchor), Path.home(), settings.state_dir, REPO_ROOT, tmp_path / "nope"):
        with pytest.raises(security.PathViolation):
            services.register_project(db, settings, "x", str(bad))
    with pytest.raises(security.PathViolation):
        services.register_project(db, settings, "x", "relative/path")


# ---- 5: provider blocked, no fake result ----
def test_unavailable_provider_blocks_without_fabricating(engine, db, project):
    providers.discover(db)
    db.execute("UPDATE provider_caps SET mode='unavailable' WHERE provider='gemini'")
    t, r, state = run_task(engine, db, "provider.task", project=project,
                           spec={"provider": "gemini", "prompt": "summarize"},
                           acceptance=[{"type": "artifact_kind", "kind": "imported_result"}])
    assert state == "blocked"
    d = services.run_detail(db, r["id"])
    assert "unavailable" in d["run"]["state_reason"]
    assert d["artifacts"] == []
    assert db.one("SELECT status FROM tasks WHERE id=?", (t["id"],))["status"] == "blocked"


def test_handoff_packet_import_flow_marks_unverified(engine, db, project):
    providers.discover(db)
    db.execute("UPDATE provider_caps SET mode='interactive' WHERE provider='claude'")
    acc = [{"type": "artifact_kind", "kind": "imported_result"}]
    t, r, state = run_task(engine, db, "provider.task", project=project,
                           spec={"provider": "claude", "prompt": "do thing"}, acceptance=acc)
    assert state == "blocked"
    assert [a["kind"] for a in services.run_detail(db, r["id"])["artifacts"]] == ["task_packet"]
    engine.import_result(r["id"], "I did it. key=sk-ant-abcdefghijklmnop", "claude-code session")
    assert engine.execute(r["id"]) == "succeeded"
    imp = [a for a in services.run_detail(db, r["id"])["artifacts"] if a["kind"] == "imported_result"][0]
    assert "UNVERIFIED" in imp["provenance"]


def test_mock_provider_needs_no_paid_api(engine, db, project):
    providers.discover(db)
    _, r, state = run_task(engine, db, "provider.task", project=project,
                           spec={"provider": "mock", "prompt": "x"},
                           acceptance=[{"type": "artifact_kind", "kind": "provider_result"}])
    assert state == "succeeded"


def test_provider_capabilities_report_honestly(db, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-notarealkeynotarealkey")
    caps = {c["provider"]: c for c in providers.discover(db)}
    assert "sk-ant" not in json.dumps(caps)
    if caps["claude"]["mode"] != "unavailable":
        assert caps["claude"]["billing"] == "metered_api_possible"
    assert caps["perplexity"]["mode"] == "manual_handoff"
    assert caps["mock"]["mode"] == "automated"
    assert providers.billable_env_present()["claude"] == ["ANTHROPIC_API_KEY"]


# ---- 6: approvals ----
def _guarded(engine, db, content="hello", **kw):
    t = services.create_task(db, title="g", kind="demo.guarded_write",
                             spec={"filename": "x.txt", "content": content})
    r = engine.create_run(t["id"], **kw)
    return t, r, engine.execute(r["id"])


def test_approval_rejection_cancels_and_never_writes(engine, db, settings):
    t, r, state = _guarded(engine, db)
    assert state == "awaiting_approval"
    apr = approvals.status_for(db, r["id"], json.loads(db.one("SELECT action_json a FROM approvals")["a"]))[1]
    engine.decide_approval(apr, False, "no")
    assert db.one("SELECT state FROM runs WHERE id=?", (r["id"],))["state"] == "cancelled"
    assert not (settings.artifacts_dir / "guarded" / "x.txt").exists()


def test_approval_is_bound_to_exact_action_and_single_use(engine, db, settings):
    t, r, state = _guarded(engine, db, "hello")
    aid = db.one("SELECT id FROM approvals")["id"]
    engine.decide_approval(aid, True)
    # tamper: the task spec changes after approval -> approval must not apply
    db.execute("UPDATE tasks SET spec_json=? WHERE id=?",
               (json.dumps({"filename": "x.txt", "content": "EVIL"}), t["id"]))
    assert engine.execute(r["id"]) == "awaiting_approval"
    assert not (settings.artifacts_dir / "guarded" / "x.txt").exists()
    assert db.one("SELECT status FROM approvals WHERE id=?", (aid,))["status"] == "approved"  # unspent
    rows = db.query("SELECT status FROM approvals ORDER BY requested_at")
    assert [x["status"] for x in rows] == ["approved", "pending"]
    # direct reuse of the old approval for a different action is refused
    with pytest.raises(PermissionError):
        approvals.consume(db, aid, r["id"], {"type": "write_file", "content": "EVIL"})


def test_approved_action_runs_once(engine, db, settings):
    t, r, _ = _guarded(engine, db)
    aid = db.one("SELECT id FROM approvals")["id"]
    engine.decide_approval(aid, True)
    assert engine.execute(r["id"]) == "succeeded"
    assert (settings.artifacts_dir / "guarded" / "x.txt").read_text() == "hello"
    assert db.one("SELECT status FROM approvals WHERE id=?", (aid,))["status"] == "consumed"
    with pytest.raises(PermissionError):
        approvals.consume(db, aid, r["id"], json.loads(db.one("SELECT action_json a FROM approvals")["a"]))


# ---- 7: limits / retries ----
def test_iteration_limit_stops_run(engine, db):
    _, r, state = run_task(engine, db, "demo.loop", spec={"iterations": 50}, max_iterations=5)
    assert state == "failed"
    assert "iteration limit" in db.one("SELECT state_reason s FROM runs WHERE id=?", (r["id"],))["s"]


def test_deadline_stops_run(engine, db):
    _, r, state = run_task(engine, db, "demo.loop", spec={"iterations": 100, "sleep": 0.05}, deadline_s=1)
    assert state == "failed"
    assert "deadline" in db.one("SELECT state_reason s FROM runs WHERE id=?", (r["id"],))["s"]


def test_retryable_failure_retries_then_succeeds(engine, db):
    _, r, state = run_task(engine, db, "demo.flaky", spec={"fail_times": 1})
    assert state == "succeeded"
    assert db.one("SELECT attempt FROM runs WHERE id=?", (r["id"],))["attempt"] == 2


def test_repeated_identical_failure_stops_early(engine, db):
    _, r, state = run_task(engine, db, "demo.flaky", spec={"fail_times": 9}, max_attempts=5)
    row = db.one("SELECT attempt, state_reason FROM runs WHERE id=?", (r["id"],))
    assert state == "failed" and row["attempt"] == 2 and "identical" in row["state_reason"]


def test_non_retryable_error_is_not_retried(engine, db):
    _, r, state = run_task(engine, db, "does.not.exist")
    assert state == "failed"
    assert db.one("SELECT attempt FROM runs WHERE id=?", (r["id"],))["attempt"] == 0


def test_failed_acceptance_means_failed_not_done(engine, db):
    t, r, state = run_task(engine, db, "demo.loop", acceptance=[{"type": "artifact_kind", "kind": "nope"}])
    assert state == "failed"
    assert db.one("SELECT status FROM tasks WHERE id=?", (t["id"],))["status"] == "failed"


def test_idempotency_key_returns_same_run(engine, db):
    t = services.create_task(db, title="t", kind="demo.loop")
    a = engine.create_run(t["id"], idempotency_key="k1")
    b = engine.create_run(t["id"], idempotency_key="k1")
    assert a["id"] == b["id"]


def test_illegal_transitions_rejected(engine, db):
    t = services.create_task(db, title="t", kind="demo.loop")
    r = engine.create_run(t["id"])
    with pytest.raises(ValueError):
        engine.transition(r["id"], "succeeded")
    assert all("queued" not in TRANSITIONS[s] or s in ("running", "awaiting_approval", "blocked", "interrupted")
               for s in TRANSITIONS)


def test_task_dependencies_block_until_done(engine, db):
    a = services.create_task(db, title="a", kind="demo.loop")
    b = services.create_task(db, title="b", kind="demo.loop", depends_on=[a["id"]])
    assert engine.execute(engine.create_run(b["id"])["id"]) == "blocked"
    assert engine.execute(engine.create_run(a["id"])["id"]) == "succeeded"
    r2 = engine.create_run(b["id"])
    assert engine.execute(r2["id"]) == "succeeded"


# ---- 8: crash recovery without duplicate effects ----
def test_crash_after_effect_is_never_repeated(engine, db, settings):
    t, r, _ = _guarded(engine, db)
    aid = db.one("SELECT id FROM approvals")["id"]
    engine.decide_approval(aid, True)
    # Simulate a process dying after the effect started: run 'running', side-effect step 'started'.
    rid = r["id"]
    db.execute("UPDATE runs SET state='running' WHERE id=?", (rid,))
    h = approvals.action_hash(json.loads(db.one("SELECT action_json a FROM approvals")["a"]))[:12]
    db.execute("INSERT INTO steps(id,run_id,seq,name,state,side_effect,started_at) "
               "VALUES ('stp_x',?,1,?,'started',1,'t')", (rid, f"action:{h}"))
    fresh = Engine(settings, db)  # "restart"
    summary = fresh.reconcile()
    assert summary["interrupted"] == [rid] and summary["uncertain_steps"] == 1
    fresh.resume(rid)
    assert fresh.execute(rid) == "blocked"
    assert not (settings.artifacts_dir / "guarded" / "x.txt").exists()  # effect NOT replayed
    assert "unknown outcome" in db.one("SELECT state_reason s FROM runs WHERE id=?", (rid,))["s"]


def test_reconcile_requeues_nothing_automatically(engine, settings, db):
    t = services.create_task(db, title="t", kind="demo.loop")
    r = engine.create_run(t["id"])
    db.execute("UPDATE runs SET state='running' WHERE id=?", (r["id"],))
    Engine(settings, db).reconcile()
    assert db.one("SELECT state FROM runs WHERE id=?", (r["id"],))["state"] == "interrupted"


# ---- restart persistence ----
def test_state_survives_restart(settings, project):
    d1 = Database(settings.db_path)
    e1 = Engine(settings, d1)
    _, r, st = run_task(e1, d1, "audit.workspace", project=project, acceptance=AUDIT_ACCEPT)
    d2 = Database(settings.db_path)  # new connection objects = new process
    d2.migrate()
    e2 = Engine(settings, d2)
    assert e2.reconcile()["interrupted"] == []
    d = services.run_detail(d2, r["id"])
    assert d["run"]["state"] == "succeeded" and len(d["artifacts"]) == 2
    for a in d["artifacts"]:
        p = settings.artifacts_dir / a["path"]
        assert security.is_within(settings.artifacts_dir, p) and p.exists()


# ---- migrations ----
def test_migrations_idempotent_and_immutable(db, settings):
    assert db.migrate() == []
    db.execute("UPDATE schema_migrations SET checksum='tampered'")
    with pytest.raises(RuntimeError):
        db.migrate()


# ---- 12: backup restore into separate dir ----
def test_backup_restores_to_separate_location(engine, db, settings, project, tmp_path):
    run_task(engine, db, "audit.workspace", project=project)
    b = backup.create_backup(settings, db)
    out = backup.restore_backup(Path(b["path"]), tmp_path / "restored", settings)
    con = sqlite3.connect(out / "db" / "aios.sqlite")
    assert con.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 1
    assert con.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2
    assert list((out / "artifacts").rglob("audit.json"))
    with pytest.raises(ValueError):
        backup.restore_backup(Path(b["path"]), settings.state_dir / "x", settings)


# ---- 14: redaction and path restrictions ----
@pytest.mark.parametrize("secret", [
    "sk-ant-api03-abcdefghijklmnop", "AKIAIOSFODNN7EXAMPLE", "ghp_" + "a" * 36,
    "AIza" + "b" * 35, "-----BEGIN RSA PRIVATE KEY-----", "Bearer abcdefghijklmnopqrstuv",
    "password = hunter2hunter2", "eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4"])
def test_redaction_removes_secret_material(secret):
    out = security.redact(f"before {secret} after")
    assert "REDACTED" in out
    for frag in ("abcdefghijklmnop", "IOSFODNN7", "hunter2hunter2", "SflKxwRJ"):
        assert frag not in out


def test_resolve_within_blocks_traversal_and_absolute(tmp_path):
    root = tmp_path / "r"
    root.mkdir()
    assert security.resolve_within(root, "a/b.txt").parent.name == "a"
    for bad in ("../x", "a/../../x", str(tmp_path / "abs"), "C:\\Windows\\win.ini"):
        with pytest.raises(security.PathViolation):
            security.resolve_within(root, bad)


def test_load_settings_refuses_non_loopback(monkeypatch):
    monkeypatch.setenv("AIOS_HOST", "0.0.0.0")
    with pytest.raises(RuntimeError):
        load_settings()


def test_state_dir_inside_repo_refused(monkeypatch):
    monkeypatch.setenv("AIOS_HOST", "127.0.0.1")
    monkeypatch.setenv("AIOS_STATE_DIR", str(REPO_ROOT / "state"))
    with pytest.raises(RuntimeError):
        load_settings()


def test_step_outputs_and_events_are_redacted(engine, db):
    t = services.create_task(db, title="t", kind="demo.loop")
    r = engine.create_run(t["id"])
    engine.event(r["id"], "x", "leak sk-ant-abcdefghijklmnop here")
    assert "sk-ant" not in json.dumps(services.run_detail(db, r["id"])["events"])
