"""Acceptance 10 and 11: a failing candidate stays unpromoted; a successful versioned improvement can be rolled back exactly.
Plus the hard rules: no auto-promotion, protected files untouchable, regression set enforced, rejected ideas not re-proposed."""
import dataclasses
import hashlib
import json

import pytest

from aios import improvements as imp
from aios.errors import ApiError

SECTIONS = ["Purpose and trigger", "Required inputs", "Preconditions", "Allowed actions", "Verification criteria",
            "Failure / stop conditions", "Example usage", "Relevant evaluation cases"]


def skill(name="adb-debug", tools="Read Grep", marker="v1", drop=None):
    secs = [s for s in SECTIONS if s != drop]
    body = "\n".join(f"## {s}\n{marker} text for {s}. " + ("tc-001 tc-002 tc-003" if s == "Relevant evaluation cases" else "") + "\n" for s in secs)
    return (f"---\nname: {name}\ndescription: A sufficiently long description so the skill can trigger reliably in practice.\n"
            f"allowed-tools: {tools}\n---\n\n# {name}\n\n{body}")


def evals(extra_negative=True):
    cases = [{"id": "tc-001", "kind": "positive", "prompt": "p", "expect": "e"},
             {"id": "tc-002", "kind": "negative", "prompt": "p", "expect": "e"},
             {"id": "tc-003", "kind": "negative" if extra_negative else "positive", "prompt": "p", "expect": "e"}]
    return {"skill": "x", "cases": cases}


@pytest.fixture()
def st(settings, tmp_path):
    s = dataclasses.replace(settings, skills_dir=tmp_path / "skills", evals_dir=tmp_path / "evals")
    s.skills_dir.mkdir()
    s.evals_dir.mkdir()
    return s


def submit(db, **kw):
    args = dict(name="adb-debug", content=skill(), evals=evals(), rationale="recurring need")
    args.update(kw)
    return imp.submit(db, **args)


def file_of(st, name="adb-debug"):
    return st.skills_dir / name / "SKILL.md"


# ---- acceptance 10 ----
def test_failing_candidate_stays_unpromoted_and_nothing_is_deployed(db, st):
    c = submit(db, content=skill(drop="Failure / stop conditions", tools="Bash PowerShell"))
    res = imp.evaluate(db, st, c["id"])
    assert res["eval_status"] == "failed"
    assert "section:Failure / stop conditions" in res["failed_cases"] and "no-unrestricted-shell" in res["failed_cases"]
    with pytest.raises(ApiError) as e:
        imp.promote(db, st, c["id"], confirm=True, approved_by="session:x")
    assert e.value.code == "evaluation_failed"
    assert db.one("SELECT status, eval_status FROM skill_candidates WHERE id=?", (c["id"],)) == {"status": "candidate", "eval_status": "failed"}
    assert not file_of(st).exists() and db.query("SELECT * FROM skill_versions") == []
    rows = db.query("SELECT passed FROM eval_results WHERE subject=?", (c["id"],))
    assert rows and 0 in {r["passed"] for r in rows}                 # every result was recorded, failures included


def test_evaluation_never_promotes_and_behavioural_cases_are_not_counted_as_passed(db, st):
    c = submit(db)
    res = imp.evaluate(db, st, c["id"])
    assert res["eval_status"] == "passed" and res["not_executed"] == 3
    assert db.one("SELECT status FROM skill_candidates WHERE id=?", (c["id"],))["status"] == "candidate"
    assert not file_of(st).exists()


def test_promotion_requires_explicit_human_confirmation(db, st):
    c = submit(db)
    imp.evaluate(db, st, c["id"])
    with pytest.raises(ApiError) as e:
        imp.promote(db, st, c["id"], confirm=False, approved_by="session:x")
    assert e.value.code == "confirmation_required" and not file_of(st).exists()


def test_promote_always_re_evaluates_and_cannot_use_a_stale_pass(db, st):
    c = submit(db)
    imp.evaluate(db, st, c["id"])                                     # passes
    db.execute("UPDATE skill_candidates SET content=? WHERE id=?", (skill(drop="Example usage"), c["id"]))   # tampered after evaluation
    with pytest.raises(ApiError) as e:
        imp.promote(db, st, c["id"], confirm=True, approved_by="session:x")
    assert e.value.code == "evaluation_failed" and not file_of(st).exists()


# ---- acceptance 11 ----
def test_versioned_improvement_then_exact_rollback(db, st):
    c1 = submit(db, content=skill(marker="v1"))
    imp.evaluate(db, st, c1["id"])
    r1 = imp.promote(db, st, c1["id"], confirm=True, approved_by="session:user", note="first")
    v1_bytes = file_of(st).read_bytes()
    assert r1["version"] == 1 and r1["previous_version"] is None and (st.evals_dir / "adb-debug.json").exists()

    c2 = submit(db, content=skill(marker="v2"), rationale="better wording")
    imp.evaluate(db, st, c2["id"])
    r2 = imp.promote(db, st, c2["id"], confirm=True, approved_by="session:user", note="improve")
    assert r2["version"] == 2 and r2["previous_version"] == 1 and b"v2 text" in file_of(st).read_bytes()
    versions = {v["version"]: v["status"] for v in db.query("SELECT version,status FROM skill_versions WHERE name='adb-debug'")}
    assert versions == {1: "retired", 2: "active"}

    rb = imp.rollback(db, st, "adb-debug", approved_by="session:user", note="v2 was worse")
    assert rb["restored_version"] == 1
    assert file_of(st).read_bytes() == v1_bytes                       # byte-for-byte
    assert hashlib.sha256(file_of(st).read_bytes()).hexdigest() == r1["sha256"]
    versions = {v["version"]: v["status"] for v in db.query("SELECT version,status FROM skill_versions WHERE name='adb-debug'")}
    assert versions == {1: "active", 2: "rolled_back"}
    assert db.one("SELECT status FROM improvement_proposals WHERE id=(SELECT proposal_id FROM skill_candidates WHERE id=?)", (c2["id"],))["status"] == "rolled_back"
    actions = [a["action"] for a in db.query("SELECT action FROM audit_log WHERE action LIKE 'skill.%' ORDER BY id")]
    assert actions == ["skill.promote", "skill.promote", "skill.rollback"]


def test_rolling_back_the_first_version_removes_the_skill(db, st):
    c = submit(db)
    imp.evaluate(db, st, c["id"])
    imp.promote(db, st, c["id"], confirm=True, approved_by="session:u")
    out = imp.rollback(db, st, "adb-debug", approved_by="session:u")
    assert out["removed"] and not file_of(st).exists() and not (st.evals_dir / "adb-debug.json").exists()


def test_rollback_refuses_to_deploy_content_that_fails_its_hash_check(db, st):
    for m in ("v1", "v2"):
        c = submit(db, content=skill(marker=m))
        imp.evaluate(db, st, c["id"])
        imp.promote(db, st, c["id"], confirm=True, approved_by="session:u")
    db.execute("UPDATE skill_versions SET content='tampered' WHERE name='adb-debug' AND version=1")
    with pytest.raises(ApiError) as e:
        imp.rollback(db, st, "adb-debug", approved_by="session:u")
    assert e.value.code == "integrity_failure" and b"v2 text" in file_of(st).read_bytes()      # current deployment untouched


# ---- hard rules ----
@pytest.mark.parametrize("target", ["scripts/skill_eval.py", "scripts/claude_guard.py", ".claude/settings.json",
                                    "../../etc/passwd", "C:/Windows/x.txt", ".claude/skills/other-skill/SKILL.md"])
def test_candidates_cannot_target_the_evaluator_policy_or_other_paths(db, target):
    with pytest.raises(ApiError) as e:
        submit(db, target_path=target)
    assert e.value.code == "protected_target"
    assert db.query("SELECT * FROM skill_candidates") == []


@pytest.mark.parametrize("name", ["Bad Name", "../x", "ab", "claude-guard", "skill-eval", "UPPER", "a" * 60])
def test_bad_or_reserved_skill_names_are_refused(db, name):
    with pytest.raises(ApiError) as e:
        submit(db, name=name)
    assert e.value.code == "bad_skill_name"


def test_secrets_in_candidates_are_refused(db):
    with pytest.raises(ApiError) as e:
        submit(db, content=skill() + "\nkey ghp_" + "A1" * 18)
    assert e.value.code == "contains_secret"


def test_rejected_content_is_not_re_proposed_without_new_evidence(db):
    c = submit(db)
    imp.reject(db, c["id"], "not useful")
    with pytest.raises(ApiError) as e:
        submit(db)
    assert e.value.code == "previously_rejected"
    again = submit(db, new_evidence="seen in 3 more sessions")
    assert again["id"] != c["id"]


def test_regression_set_blocks_promotion_when_an_existing_skill_is_broken(db, st):
    c1 = submit(db, name="first-skill", content=skill(name="first-skill"))
    imp.evaluate(db, st, c1["id"])
    imp.promote(db, st, c1["id"], confirm=True, approved_by="session:u")
    file_of(st, "first-skill").write_text("corrupted by someone")     # regression: deployed skill no longer valid
    c2 = submit(db, name="second-skill", content=skill(name="second-skill"))
    res = imp.evaluate(db, st, c2["id"])
    assert res["eval_status"] == "failed" and any(f.startswith("first-skill:") for f in res["regression_failures"])
    with pytest.raises(ApiError):
        imp.promote(db, st, c2["id"], confirm=True, approved_by="session:u")


def test_only_candidates_can_be_evaluated_or_promoted(db, st):
    c = submit(db)
    imp.reject(db, c["id"], "no")
    for fn in (lambda: imp.evaluate(db, st, c["id"]), lambda: imp.promote(db, st, c["id"], confirm=True, approved_by="s")):
        with pytest.raises(ApiError) as e:
            fn()
        assert e.value.code == "not_a_candidate"
