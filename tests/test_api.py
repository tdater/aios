import time

import pytest
from fastapi.testclient import TestClient

from aios.main import create_app


@pytest.fixture()
def client(settings, sample_ws):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def wait_state(c, run_id, states, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        st = c.get(f"/api/runs/{run_id}").json()["run"]["state"]
        if st in states:
            return st
        time.sleep(0.2)
    raise AssertionError(f"run stuck in {st}")


def test_end_to_end_audit_over_http(client, sample_ws):
    p = client.post("/api/projects", json={"name": "Sample", "path": str(sample_ws)}).json()
    t = client.post("/api/tasks", json={"title": "audit", "kind": "audit.workspace", "project_id": p["id"],
                                        "acceptance": [{"type": "artifact_kind", "kind": "audit_report"}]}).json()
    r = client.post("/api/runs", json={"task_id": t["id"]}).json()
    assert wait_state(client, r["id"], {"succeeded", "failed"}) == "succeeded"
    d = client.get(f"/api/runs/{r['id']}").json()
    art = client.get(f"/api/artifacts/{d['artifacts'][0]['id']}").json()
    assert art["sha256"] and "abcdefghijklmnop1234" not in art["content"]
    h = client.get("/api/health").json()
    assert h["db"] == "ok" and h["run_counts"]["succeeded"] == 1 and h["backup_status"] == "never run"


def test_api_rejects_foreign_host_origin_and_bad_paths(client, tmp_path):
    assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 403
    r = client.post("/api/projects", json={"name": "x", "path": str(tmp_path)},
                    headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/projects", json={"name": "x", "path": "C:\\"})
    assert r.status_code == 400
    assert client.post("/api/projects", content="a=b",
                       headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 415


def test_approval_flow_over_http(client):
    t = client.post("/api/tasks", json={"title": "g", "kind": "demo.guarded_write",
                                        "spec": {"filename": "a.txt", "content": "z"}}).json()
    r = client.post("/api/runs", json={"task_id": t["id"]}).json()
    assert wait_state(client, r["id"], {"awaiting_approval"}) == "awaiting_approval"
    pend = client.get("/api/approvals?status=pending").json()
    assert len(pend) == 1 and pend[0]["action"]["content"] == "z"
    assert client.post(f"/api/approvals/{pend[0]['id']}/decide", json={"approve": True}).status_code == 200
    assert wait_state(client, r["id"], {"succeeded", "failed"}) == "succeeded"
    assert client.post(f"/api/approvals/{pend[0]['id']}/decide", json={"approve": True}).status_code == 409


def test_unknown_task_kind_rejected(client):
    assert client.post("/api/tasks", json={"title": "x", "kind": "rm.rf"}).status_code == 422
