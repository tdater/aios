"""Home Base: findings with Explain and Show me how, the open-a-Windows-page action, refusal of everything in the never class, and the weekly check-up.
Nothing here touches the real computer: the health check is fed fixed numbers."""
from datetime import datetime, timedelta, timezone

import pytest

from aios import abilities, homebase
from aios.errors import ApiError
from test_api import V, app, client, native, pair  # noqa: F401

GB = 1024 ** 3
BAD = {"memory": {"total_bytes": 16 * GB, "available_bytes": 1 * GB}, "disk": {"total_bytes": 500 * GB, "free_bytes": 400 * GB},
       "temp": {"bytes": 5 * GB, "files": 900, "complete": True}, "startup_items": 20}
BAD_DISK = {**BAD, "disk": {"total_bytes": 500 * GB, "free_bytes": 10 * GB}}
FINE = {"memory": {"total_bytes": 16 * GB, "available_bytes": 12 * GB}, "disk": {"total_bytes": 500 * GB, "free_bytes": 400 * GB},
        "temp": {"bytes": 1 * GB, "files": 10, "complete": True}, "startup_items": 5}


def on(db, name="system_scan"):
    abilities.set_enabled(db, name, True, True)


def code(fn, *a, **k):
    with pytest.raises(ApiError) as e:
        fn(*a, **k)
    return e.value.status, e.value.code


def kinds(db):
    return [r["kind"] for r in abilities.receipts(db)]


def test_every_finding_explains_shows_how_and_has_a_safety_class():
    sugg = homebase.system_scan.suggest(BAD_DISK)
    got = {f["id"]: f for f in homebase.findings_from(sugg)}
    assert set(got) == {"memory", "disk", "temp", "startup"}
    for f in got.values():
        assert f["title"] and f["explain"] and len(f["how_to"]) >= 3 and f["action_class"] in homebase.CLASSES
        assert isinstance(f["safe_to_automate"], bool)
    assert "Startup" in " ".join(got["startup"]["how_to"]) and got["startup"]["open_uri"] == "ms-settings:startupapps"
    assert "Storage" in " ".join(got["temp"]["how_to"]) and "Disk Cleanup" in " ".join(got["temp"]["how_to"])
    assert got["memory"]["action_class"] == "read_only" and got["memory"]["open_uri"] is None and got["memory"]["safe_to_automate"] is False
    assert all(f["action_class"] != "never" for f in got.values())                    # nothing AIOS would do for you is in the never class
    assert homebase.findings_from(homebase.system_scan.suggest(FINE)) == []             # "all fine" is not a finding


def test_findings_need_the_ability_and_all_stop_blocks_them(db):
    assert code(homebase.current_findings, db) == (403, "ability_off")
    on(db)
    assert homebase.current_findings(db) == []
    homebase.run_scan(db, lambda: BAD)
    assert {f["id"] for f in homebase.current_findings(db)} == {"memory", "temp", "startup"}
    abilities.set_paused(db, True)
    assert code(homebase.current_findings, db) == (423, "paused")


def test_open_windows_page_returns_a_settings_address_and_changes_nothing(db):
    on(db)
    for fid, uri in (("temp", "ms-settings:storagesense"), ("startup", "ms-settings:startupapps"), ("disk", "ms-settings:storagesense")):
        res = homebase.act(db, "open_windows_page", fid)
        assert res["open_uri"] == uri and res["open_uri"].startswith("ms-settings:") and res["changed_anything"] is False
    assert code(homebase.act, db, "open_windows_page", "memory") == (422, "no_page")          # nothing to open for memory
    assert code(homebase.act, db, "open_windows_page", "not-a-finding") == (422, "no_page")
    assert "home.open_page" in kinds(db)


def test_open_windows_page_is_off_without_the_ability(db):
    assert code(homebase.act, db, "open_windows_page", "temp") == (403, "ability_off")


@pytest.mark.parametrize("action", sorted(homebase.NEVER))
def test_never_class_actions_are_refused_with_a_receipt(db, action):
    on(db)                                                                                  # even with everything switched on
    assert code(homebase.act, db, action) == (403, "action_refused")
    r = [x for x in abilities.receipts(db) if x["kind"] == "home.refused"]
    assert r and r[0]["changed"] == 0 and "Refused" in r[0]["summary"]


@pytest.mark.parametrize("action", ["", "format_disk", "run_command", "DELETE_USER_FILES", "registry_edit "])
def test_unknown_actions_are_refused_too(db, action):
    on(db)
    assert code(homebase.act, db, action) == (403, "action_refused")                         # an allow-list: not listed means not allowed
    assert "home.refused" in kinds(db)


def test_never_actions_are_refused_even_when_the_ability_is_off(db):
    assert code(homebase.act, db, "install_software") == (403, "action_refused")
    assert "home.refused" in kinds(db)


def test_the_routes_refuse_and_explain(client, monkeypatch):
    monkeypatch.setattr(homebase.system_scan, "collect", lambda: BAD)
    assert client.get(f"{V}/home/findings").status_code == 403
    client.put(f"{V}/abilities/system_scan", json={"enabled": True, "confirm": True})
    assert client.get(f"{V}/home/findings").json() == {"items": []}
    r = client.post(f"{V}/home/actions", json={"action": "check_health"})
    assert r.status_code == 200 and {f["id"] for f in r.json()["result"]["findings"]} == {"memory", "temp", "startup"}
    items = client.get(f"{V}/home/findings").json()["items"]
    assert all(i["how_to"] and i["explain"] for i in items)
    r = client.post(f"{V}/home/actions", json={"action": "open_windows_page", "finding_id": "startup"})
    assert r.json()["open_uri"] == "ms-settings:startupapps"
    for bad in ("registry_edit", "delete_user_files", "uninstall_software", "driver_change", "service_change", "antivirus_change"):
        r = client.post(f"{V}/home/actions", json={"action": bad})
        assert r.status_code == 403 and r.json()["error"]["code"] == "action_refused", bad
    assert "home.refused" in [x["kind"] for x in client.get(f"{V}/receipts").json()["items"]]


def test_a_rock_card_gets_explain_and_show_me_how(client, monkeypatch):
    monkeypatch.setattr(homebase.system_scan, "collect", lambda: BAD)
    client.put(f"{V}/abilities/system_scan", json={"enabled": True, "confirm": True})
    client.post(f"{V}/home/actions", json={"action": "check_health"})
    c = client.get(f"{V}/universe/objects/rock:startup/card").json()
    f = {x["key"]: x for x in c["panels"]["basics"]}
    assert "start with Windows" in f["explain"]["value"] and f["how_to"]["value"].startswith("1. ") and "Startup" in f["how_to"]["value"]
    assert any(link.get("uri") == "ms-settings:startupapps" for link in c["links"])


# ---------------------------------------------------------------- weekly check-up
def test_the_checkup_is_off_until_turned_on_and_needs_the_scan_ability(db):
    assert homebase.is_due(db) is False and homebase.last_run(db) is None
    homebase.set_checkup(db, True)
    assert homebase.is_due(db) is False                                                     # ability still off
    on(db)
    assert homebase.is_due(db) is True                                                      # never run
    assert homebase.tick(db, lambda: BAD) is not None
    assert homebase.is_due(db) is False and homebase.last_run(db)
    assert homebase.tick(db, lambda: BAD) is None                                           # not due again


def test_the_checkup_comes_back_after_a_week_and_never_while_paused_or_off(db):
    on(db)
    homebase.set_checkup(db, True)
    card = homebase.run_checkup(db, lambda: BAD)
    assert card["title"] == "Your computer this week" and card["lines"] and "checkup.ran" in kinds(db)
    later = datetime.now(timezone.utc) + timedelta(days=8)
    assert homebase.is_due(db, later) is True
    assert homebase.is_due(db, datetime.now(timezone.utc) + timedelta(days=6)) is False
    abilities.set_paused(db, True)
    assert homebase.is_due(db, later) is False and homebase.tick(db, lambda: BAD, later) is None
    abilities.set_paused(db, False)
    abilities.set_enabled(db, "system_scan", False, False)
    assert homebase.is_due(db, later) is False and homebase.tick(db, lambda: BAD, later) is None
    homebase.set_checkup(db, False)
    abilities.set_enabled(db, "system_scan", True, True)
    assert homebase.is_due(db, later) is False


def test_the_checkup_routes(client, monkeypatch):
    monkeypatch.setattr(homebase.system_scan, "collect", lambda: FINE)
    assert client.get(f"{V}/home/check-up").json() == {"enabled": False, "last_run": None, "due": False, "every_days": 7}
    assert client.post(f"{V}/home/check-up/run").status_code == 403
    client.put(f"{V}/abilities/system_scan", json={"enabled": True, "confirm": True})
    assert client.put(f"{V}/home/check-up", json={"enabled": True}).json()["due"] is True
    res = client.post(f"{V}/home/check-up/run").json()
    assert res["lines"] == ["Nothing stands out."]
    st = client.get(f"{V}/home/check-up").json()
    assert st["last_run"] and st["due"] is False
