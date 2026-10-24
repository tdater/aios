"""Opt-in scheduled review: off by default, bounded, never loops on failure, no model calls."""
from datetime import datetime, timedelta, timezone

import pytest

from aios.history import review, schedule
from test_api import V, client, app  # noqa: F401  (fixtures)

T0 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def test_off_by_default_and_nothing_runs(db, settings, monkeypatch):
    monkeypatch.setattr(review, "review_new", lambda *a, **k: pytest.fail("must not run while disabled"))
    s = schedule.get(db)
    assert s["enabled"] is False and s["next_due"] is None and s["every_hours"] == 24
    assert schedule.tick(db, settings, now=T0) is None


def test_runs_when_due_then_waits_for_the_interval(db, settings):
    schedule.configure(db, enabled=True, every_hours=6)
    assert schedule.get(db)["next_due"] == "now"
    first = schedule.tick(db, settings, now=T0)
    assert first in ("succeeded", "no_change")                        # real deterministic review on an empty approved folder
    assert schedule.tick(db, settings, now=T0 + timedelta(hours=5, minutes=59)) is None
    assert schedule.tick(db, settings, now=T0 + timedelta(hours=6)) is not None
    s = schedule.get(db)
    assert s["last_status"] in ("succeeded", "no_change") and s["next_due"].startswith("2026-06-02T00")


def test_a_failing_review_is_recorded_and_not_retried_until_the_next_interval(db, settings, monkeypatch):
    calls = []

    def boom(*a, **k):
        calls.append(1)
        raise RuntimeError("bad file")
    monkeypatch.setattr(review, "review_new", boom)
    schedule.configure(db, enabled=True, every_hours=1)
    assert schedule.tick(db, settings, now=T0) == "failed: RuntimeError"
    assert schedule.tick(db, settings, now=T0 + timedelta(minutes=30)) is None
    assert len(calls) == 1
    assert schedule.get(db)["last_status"] == "failed: RuntimeError"


def test_a_review_already_running_is_reported_as_busy(db, settings, monkeypatch):
    def busy(*a, **k):
        raise review.ReviewBusy("running")
    monkeypatch.setattr(review, "review_new", busy)
    schedule.configure(db, enabled=True, every_hours=1)
    assert schedule.tick(db, settings, now=T0) == "busy"


def test_review_is_bounded(db, settings, monkeypatch):
    seen = {}
    monkeypatch.setattr(review, "review_new", lambda db_, st, **k: seen.update(k) or {"status": "no_change"})
    schedule.configure(db, enabled=True, every_hours=1)
    schedule.tick(db, settings, now=T0)
    assert seen["max_files"] == 200 and seen["max_seconds"] == 60


@pytest.mark.parametrize("bad", [0, -1, 169])
def test_interval_is_validated(db, bad):
    with pytest.raises(ValueError):
        schedule.configure(db, enabled=True, every_hours=bad)


def test_corrupt_saved_state_falls_back_to_safe_defaults(db):
    db.execute("INSERT INTO kv(key,value) VALUES ('review_schedule', 'not json')")
    s = schedule.get(db)
    assert s["enabled"] is False and s["every_hours"] == 24
    db.execute("UPDATE kv SET value=? WHERE key='review_schedule'", ('{"enabled": "yes", "every_hours": 99999}',))
    s = schedule.get(db)
    assert s["enabled"] is False and s["every_hours"] == 168


def test_api_get_put_validate_and_require_auth(app, client):
    from fastapi.testclient import TestClient
    assert client.get(f"{V}/history/schedule").json()["enabled"] is False
    r = client.put(f"{V}/history/schedule", json={"enabled": True, "every_hours": 12})
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["every_hours"] == 12
    assert client.put(f"{V}/history/schedule", json={"enabled": True, "every_hours": 0}).status_code == 422
    with TestClient(app) as anon:
        assert anon.get(f"{V}/history/schedule").status_code in (401, 403)
        assert anon.put(f"{V}/history/schedule", json={"enabled": True, "every_hours": 1}).status_code in (401, 403)


def test_runner_thread_runs_ticks_and_stops_cleanly(db, settings, monkeypatch):
    import threading
    ran = threading.Event()
    monkeypatch.setattr(schedule, "tick", lambda *a, **k: ran.set())
    r = schedule.Runner(db, settings, period_s=0.01)
    r.start()
    assert ran.wait(2)
    r.stop()
    assert not r._thread.is_alive()
