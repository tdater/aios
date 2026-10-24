import dataclasses

import pytest
from fastapi.testclient import TestClient

from aios.main import create_app
from test_api import V, pair
from test_improvements import evals, skill


@pytest.fixture()
def env(settings, tmp_path):
    """App whose skill deployment target is a TEMP dir: tests must never write into the repo's real .claude/skills."""
    s = dataclasses.replace(settings, skills_dir=tmp_path / "skills", evals_dir=tmp_path / "evals")
    s.skills_dir.mkdir()
    s.evals_dir.mkdir()
    app = create_app(s)
    with TestClient(app) as c:
        c.headers["X-CSRF-Token"] = pair(app, c)["csrf"]
        yield app, c, s


def body(**kw):
    d = {"name": "adb-debug", "content": skill(), "evals": evals(), "rationale": "recurring need"}
    d.update(kw)
    return d


def test_skill_endpoints_require_a_device_session(settings):
    with TestClient(create_app(settings)) as c:
        for m, p in [("get", "/skills"), ("post", "/skills/candidates"), ("post", "/skills/candidates/x/promote"), ("post", "/skills/x/rollback")]:
            assert getattr(c, m)(V + p, **({"json": {}} if m == "post" else {})).status_code == 401


def test_full_http_lifecycle_failing_then_passing_then_rollback(env):
    app, c, s = env
    bad = c.post(f"{V}/skills/candidates", json=body(content=skill(tools="Bash PowerShell"))).json()
    ev = c.post(f"{V}/skills/candidates/{bad['id']}/evaluate").json()
    assert ev["eval_status"] == "failed"
    r = c.post(f"{V}/skills/candidates/{bad['id']}/promote", json={"confirm": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "evaluation_failed"
    assert not (s.skills_dir / "adb-debug").exists()

    good = c.post(f"{V}/skills/candidates", json=body(rationale="fixed wording")).json()
    assert c.post(f"{V}/skills/candidates/{good['id']}/evaluate").json()["eval_status"] == "passed"
    assert not (s.skills_dir / "adb-debug").exists()                       # evaluating deploys nothing
    r = c.post(f"{V}/skills/candidates/{good['id']}/promote", json={"confirm": False})
    assert r.status_code == 409 and r.json()["error"]["code"] == "confirmation_required"
    ok = c.post(f"{V}/skills/candidates/{good['id']}/promote", json={"confirm": True, "note": "ship"})
    assert ok.status_code == 200 and ok.json()["version"] == 1 and (s.skills_dir / "adb-debug" / "SKILL.md").exists()
    ov = c.get(f"{V}/skills").json()
    assert [v["status"] for v in ov["versions"]] == ["active"]
    assert {x["status"] for x in ov["candidates"]} == {"candidate", "approved"}
    audit = app.state.db.one("SELECT actor FROM audit_log WHERE action='skill.promote'")
    assert audit["actor"].startswith("session:")                            # the human session is on the record

    rb = c.post(f"{V}/skills/adb-debug/rollback", json={"note": "oops"})
    assert rb.status_code == 200 and rb.json()["removed"] is True and not (s.skills_dir / "adb-debug" / "SKILL.md").exists()


def test_protected_targets_and_bad_names_are_refused_over_http(env):
    _, c, _ = env
    r = c.post(f"{V}/skills/candidates", json=body(target_path="scripts/skill_eval.py"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "protected_target"
    r = c.post(f"{V}/skills/candidates", json=body(name="claude-guard"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_skill_name"


def test_reject_is_remembered_over_http(env):
    _, c, _ = env
    cand = c.post(f"{V}/skills/candidates", json=body()).json()
    assert c.post(f"{V}/skills/candidates/{cand['id']}/reject", json={"note": "no"}).status_code == 200
    again = c.post(f"{V}/skills/candidates", json=body())
    assert again.status_code == 409 and again.json()["error"]["code"] == "previously_rejected"
