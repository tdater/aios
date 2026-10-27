"""The computer check, said for people: plain rows, new rules, and ideas. Everything is read-only and rule-based."""
import json

from aios import homebase, scan_report, system_scan
from test_homebase import on

GB = 1024 ** 3
FACTS = {
    "memory": {"total_bytes": 16 * GB, "available_bytes": 2 * GB}, "disk": {"total_bytes": 500 * GB, "free_bytes": 200 * GB},
    "temp": {"bytes": 3 * GB, "files": 900, "complete": True}, "startup_items": 14,
    "startup_names": ["OneDrive", "Steam", "Discord", "Spotify", "Teams", "Zoom", "Dropbox", "Adobe", "Slack", "Epic", "Razer", "Logitech", "Nvidia", "Skype"],
    "drives": [{"drive": "C:", "total_bytes": 500 * GB, "free_bytes": 200 * GB}, {"drive": "D:", "total_bytes": 1000 * GB, "free_bytes": 40 * GB}],
    "uptime_hours": 300.0, "pending_reboot": False, "battery": {"percent": 12, "on_ac": False},
    "downloads": {"bytes": 8 * GB, "files": 500, "complete": False},
    "top_memory": [{"name": "chrome", "bytes": 4 * GB}, {"name": "Teams", "bytes": 1 * GB}], "system": {"os": "Windows 11", "cpus": 16},
}


def test_new_rules_each_say_what_they_are_based_on():
    ids = {s["id"]: s for s in system_scan.suggest(FACTS)}
    assert {"memory", "temp", "startup", "uptime", "battery", "downloads", "drive2", "topmem"} <= set(ids)
    assert "at least 8.0 GB" in ids["downloads"]["text"] and "12%" in ids["battery"]["text"] and "chrome" in ids["topmem"]["text"]
    assert ids["battery"]["level"] == "attention" and "12 days" in ids["uptime"]["text"]
    assert [s["id"] for s in system_scan.suggest({**FACTS, "pending_reboot": True}) if s["id"] in ("reboot", "uptime")] == ["reboot"]      # a pending restart replaces the vaguer uptime line
    calm = {"memory": {"total_bytes": 16 * GB, "available_bytes": 10 * GB}, "disk": {"total_bytes": 500 * GB, "free_bytes": 300 * GB}, "temp": {"bytes": 1, "files": 1, "complete": True}, "startup_items": 3}
    assert [s["id"] for s in system_scan.suggest(calm)] == ["ok"]                                 # older facts without the new keys still work


def test_a_charging_laptop_and_a_roomy_second_drive_raise_nothing():
    f = {**FACTS, "battery": {"percent": 12, "on_ac": True}, "drives": [{"drive": "D:", "total_bytes": 1000 * GB, "free_bytes": 400 * GB}], "uptime_hours": 5.0}
    got = {s["id"] for s in system_scan.suggest(f)}
    assert not got & {"battery", "drive2", "uptime"}


def test_the_summary_is_plain_rows_with_a_tone_and_never_an_object():
    rows = {r["label"]: r for r in scan_report.summarize(FACTS)}
    assert rows["Memory"]["value"] == "14.0 GB of 16.0 GB in use (88%)" and rows["Memory"]["tone"] == "warn"
    assert rows["Main drive"]["tone"] == "ok" and "200.0 GB free of 500.0 GB" in rows["Main drive"]["value"]
    assert rows["Programs that start with Windows"]["value"].startswith("14: OneDrive, Steam") and rows["Programs that start with Windows"]["value"].endswith("…")
    assert rows["Using the most memory"]["value"] == "chrome (4.0 GB), Teams (1.0 GB)"
    assert rows["On since last restart"]["value"] == "12.5 days" and rows["Battery"]["value"] == "12%, on battery"
    assert all(isinstance(r["value"], str) and "{" not in r["value"] and r["tone"] in ("ok", "warn") for r in rows.values())
    assert scan_report.summarize({"disk": {"total_bytes": 0, "free_bytes": 0}}) == []              # missing numbers give no rows rather than errors


def test_ideas_are_rule_based_and_the_questions_only_hold_names_and_sizes():
    got = {i["id"]: i for i in scan_report.ideas(FACTS)}
    assert {"weekly", "startup_help", "memory_help", "downloads_help", "restart"} <= set(got)
    assert "OneDrive" in got["startup_help"]["ask"] and "chrome (4.0 GB)" in got["memory_help"]["ask"] and "8.0 GB" in got["downloads_help"]["ask"]
    assert "weekly" not in {i["id"] for i in scan_report.ideas(FACTS, weekly_checkup_on=True)}
    assert all("ask" not in i for i in got.values() if i["id"] in ("weekly", "restart"))
    healthy = {"memory": {"total_bytes": 16 * GB, "available_bytes": 12 * GB}, "disk": {"total_bytes": 500 * GB, "free_bytes": 300 * GB}, "temp": {"bytes": 1, "files": 1, "complete": True}, "startup_items": 3}
    assert "backup" in {i["id"] for i in scan_report.ideas(healthy, weekly_checkup_on=True)}


def test_every_new_finding_has_an_explanation_and_steps_and_only_safe_pages():
    for fid in ("reboot", "uptime", "battery", "downloads", "drive2", "topmem"):
        f = homebase.finding(fid)
        assert f and f["title"] and f["explain"] and len(f["how_to"]) >= 3 and f["action_class"] in homebase.CLASSES
        assert f["open_uri"] is None or f["open_uri"].startswith("ms-settings:")
        if f["action_class"] == "read_only":
            assert f["open_uri"] is None


def test_run_scan_stores_and_returns_the_summary_and_ideas(db):
    on(db)
    res = homebase.run_scan(db, lambda: FACTS)
    assert res["summary"] and res["ideas"] and {f["id"] for f in res["findings"]} >= {"battery", "downloads", "topmem"}
    stored = homebase.last_scan(db)
    assert stored["summary"] == res["summary"] and json.dumps(stored)                              # kept so the belt can show it later


def test_the_real_check_on_this_computer_reads_without_changing_anything_and_reads_as_text():
    facts = system_scan.collect()
    rows = scan_report.summarize(facts)
    assert any(r["label"] == "Main drive" for r in rows)
    assert all(isinstance(r["value"], str) and "[object" not in r["value"] for r in rows)
    assert isinstance(system_scan.suggest(facts), list) and isinstance(scan_report.ideas(facts), list)
