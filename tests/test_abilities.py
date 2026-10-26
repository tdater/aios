"""Abilities are off until confirmed, pause blocks everything, widgets are validated data, and every change leaves a receipt."""
import pytest

from aios import abilities, system_scan, widgets
from aios.errors import ApiError
from test_api import V, app, client, native, pair  # noqa: F401


def code(fn, *a, **k):
    with pytest.raises(ApiError) as e:
        fn(*a, **k)
    return e.value.code


def test_everything_is_off_by_default_and_enabling_needs_confirmation(db):
    st = abilities.status(db)
    assert st["paused"] is False and {a["name"]: a["enabled"] for a in st["abilities"]} == {"system_scan": False, "widgets": False}
    assert [p["name"] for p in st["planned"]] == ["computer_look", "browser_control", "app_control"]
    assert code(abilities.require, db, "system_scan") == "ability_off"
    assert code(abilities.set_enabled, db, "system_scan", True, False) == "confirmation_required"
    assert code(abilities.set_enabled, db, "computer_look", True, True) == "unknown_ability"      # planned, not built
    abilities.set_enabled(db, "system_scan", True, True)
    abilities.require(db, "system_scan")
    abilities.set_enabled(db, "system_scan", False, False)                                           # turning off never needs confirmation
    assert code(abilities.require, db, "system_scan") == "ability_off"


def test_pause_blocks_enabled_abilities_until_resumed(db):
    abilities.set_enabled(db, "system_scan", True, True)
    abilities.set_paused(db, True)
    assert abilities.is_paused(db) and code(abilities.require, db, "system_scan") == "paused"
    abilities.set_paused(db, False)
    abilities.require(db, "system_scan")


def test_receipts_say_what_happened_in_plain_words(db):
    abilities.set_enabled(db, "widgets", True, True)
    abilities.set_paused(db, True)
    abilities.receipt(db, actor="aios", kind="note", summary="Looked at something.")
    all_ = abilities.receipts(db)
    assert [r["kind"] for r in all_] == ["note", "pause", "ability.enabled"]
    assert [r["kind"] for r in abilities.receipts(db, changed_only=True)] == ["pause", "ability.enabled"]
    assert all_[2]["summary"] == "Turned on: Small panels on Today."


def test_widgets_are_validated_data_with_a_closed_set_of_kinds(db):
    assert code(widgets.create, db, "note", "Hi", {"text": "x"}) == "ability_off"
    abilities.set_enabled(db, "widgets", True, True)
    w = widgets.create(db, "checklist", "Groceries", {"items": [{"text": "Milk", "done": False}]})
    assert widgets.list_all(db)[0]["config"] == {"items": [{"text": "Milk", "done": False}]}
    assert widgets.update(db, w["id"], {"items": [{"text": "Milk", "done": True}]})["config"]["items"][0]["done"] is True
    for bad in (("script", "x", {}), ("note", "x", {"text": "a", "url": "http://x"}), ("note", "", {"text": "a"}), ("note", "x", {"text": "z" * 501}),
                ("counter", "x", {"value": "1"}), ("counter", "x", {"value": True}), ("counter", "x", {"step": 0}),
                ("checklist", "x", {"items": [{"text": "a", "run": "calc.exe"}]}), ("checklist", "x", {"items": [{"text": "a"}] * 21}), ("note", "x", "text")):
        assert code(widgets.create, db, *bad) == "bad_widget", bad
    assert widgets.propose("note", "Hi", {"text": "ok"}) == {"kind": "note", "title": "Hi", "config": {"text": "ok"}}


def test_widget_text_has_control_characters_removed_and_a_limit_on_how_many(db):
    abilities.set_enabled(db, "widgets", True, True)
    assert widgets.create(db, "note", "T\x00itle", {"text": "a\x07b"})["title"] == "Title"
    for n in range(widgets.MAX_WIDGETS - 1):
        widgets.create(db, "note", f"n{n}", {"text": "x"})
    assert code(widgets.create, db, "note", "one too many", {"text": "x"}) == "too_many_widgets"


def test_removing_a_widget_works_even_when_paused_and_leaves_a_receipt(db):
    abilities.set_enabled(db, "widgets", True, True)
    w = widgets.create(db, "note", "Bye", {"text": "x"})
    abilities.set_paused(db, True)
    widgets.delete(db, w["id"])
    assert widgets.list_all(db) == [] and abilities.receipts(db)[0]["kind"] == "widget.deleted"


def test_system_scan_suggestions_are_rules_over_numbers():
    ok = {"memory": {"total_bytes": 16 * 1024 ** 3, "available_bytes": 8 * 1024 ** 3}, "disk": {"total_bytes": 500 * 1024 ** 3, "free_bytes": 300 * 1024 ** 3},
          "temp": {"bytes": 10, "files": 1, "complete": True}, "startup_items": 5}
    assert [s["id"] for s in system_scan.suggest(ok)] == ["ok"]
    bad = {**ok, "memory": {"total_bytes": 100, "available_bytes": 5}, "disk": {"total_bytes": 1000 * 1024 ** 3, "free_bytes": 5 * 1024 ** 3},
           "temp": {"bytes": 3 * 1024 ** 3, "files": 99, "complete": False}, "startup_items": 30}
    got = {s["id"]: s for s in system_scan.suggest(bad)}
    assert set(got) == {"memory", "disk", "temp", "startup"} and "at least 3.0 GB" in got["temp"]["text"] and "95%" in got["memory"]["text"]
    assert all("delete" not in s["text"].lower() or "does not delete" in s["text"].lower() for s in got.values())


def test_system_scan_really_runs_here_and_reports_changing_nothing():
    f = system_scan.collect()
    assert f["disk"]["total_bytes"] > 0 and f["temp"]["files"] >= 0 and system_scan.suggest(f)


def test_http_flow_requires_the_ability_then_works_and_pause_wins(client):
    assert client.post(f"{V}/system-scan").status_code == 403
    assert client.put(f"{V}/abilities/system_scan", json={"enabled": True}).status_code == 422
    assert client.put(f"{V}/abilities/system_scan", json={"enabled": True, "confirm": True}).status_code == 200
    r = client.post(f"{V}/system-scan")
    assert r.status_code == 200 and r.json()["changed_anything"] is False and r.json()["suggestions"]
    assert client.post(f"{V}/pause").json() == {"paused": True}
    assert client.post(f"{V}/system-scan").status_code == 423
    client.post(f"{V}/resume")
    kinds = [x["kind"] for x in client.get(f"{V}/receipts").json()["items"]]
    assert {"ability.enabled", "system_scan.run", "pause", "resume"} <= set(kinds)
    assert client.put(f"{V}/abilities/app_control", json={"enabled": True, "confirm": True}).status_code == 404
    assert client.post(f"{V}/widgets/preview", json={"kind": "note", "title": "t", "config": {"text": "x"}}).status_code == 200


def test_pause_stops_the_dispatcher_from_starting_queued_runs(db, engine):
    import time

    from aios import services
    task = services.create_task(db, title="t", kind="no.such.executor")
    run = engine.create_run(task["id"] if isinstance(task, dict) else task)
    rid = run["id"] if isinstance(run, dict) else run
    abilities.set_paused(db, True)
    engine.start()
    try:
        time.sleep(1.6)
        assert db.one("SELECT state FROM runs WHERE id=?", (rid,))["state"] == "queued"        # nothing new starts while paused
        abilities.set_paused(db, False)
        end = time.time() + 10
        while time.time() < end and db.one("SELECT state FROM runs WHERE id=?", (rid,))["state"] == "queued":
            time.sleep(0.2)
        assert db.one("SELECT state FROM runs WHERE id=?", (rid,))["state"] != "queued"       # resuming lets it go
    finally:
        engine.stop()
