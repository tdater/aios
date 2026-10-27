"""The widget catalog: ready-made daily widgets people pick and change, and routines that run a saved request. Everything here works on
what the owner types in; nothing needs a calendar, an email account or a bank, and nothing runs by itself unless they allow it."""
from datetime import date, datetime, timedelta, timezone

import pytest

from aios import abilities, assist, routines, widgets
from aios.errors import ApiError
from test_api import V, app, client, native, pair  # noqa: F401
from test_conversations_api import fake, repo, wait_idle  # noqa: F401


def on(client, name="widgets"):
    assert client.put(f"{V}/abilities/{name}", json={"enabled": True, "confirm": True}).status_code == 200


def test_the_catalog_is_plain_complete_and_every_entry_is_valid():
    cat = widgets.CATALOG
    assert len(cat) >= 16 and len({t["id"] for t in cat}) == len(cat)
    assert {t["group"] for t in cat} == set(widgets.GROUPS)
    for t in cat:
        widgets.validate(t["kind"], t["title"], t["config"])                                   # the starting point is itself valid
        assert t["name"] and t["blurb"] and t["space"] and t["you_can_change"] and t["who"] in ("Everyone", "Technical")
        assert not any(w in (t["name"] + t["blurb"]).lower() for w in ("json", "api", "sqlite", "argv", "cron"))
        assert t["needs_claude"] == (t["kind"] == "routine")                                    # only routines use an AI, and they say so
    assert {t["kind"] for t in cat} == set(widgets.KINDS)                                       # every kind of panel has a ready-made example
    assert any(t["who"] == "Technical" for t in cat) and sum(t["who"] == "Everyone" for t in cat) > 10


def test_nothing_in_the_catalog_needs_an_account_or_leaves_the_computer():
    text = " ".join(t["blurb"] + t["you_can_change"] + str(t["config"].get("prompt", "")) for t in widgets.CATALOG).lower()
    for word in ("calendar", "gmail", "inbox zero", "bank sync", "oauth", "token", "password"):
        assert word not in text, word


def test_picking_from_the_catalog_needs_your_yes_then_makes_a_panel_you_can_change(client):
    assert client.get(f"{V}/widgets/catalog").json()["groups"][0] == "Plan your day"
    assert client.post(f"{V}/widgets/from-catalog", json={"template": "top3"}).status_code == 403             # small panels are off until you turn them on
    on(client)
    w = client.post(f"{V}/widgets/from-catalog", json={"template": "top3", "title": "My three"})
    assert w.status_code == 201 and w.json()["title"] == "My three" and len(w.json()["config"]["items"]) == 3
    changed = client.put(f"{V}/widgets/{w.json()['id']}", json={"title": "Big three", "config": {"items": [{"text": "Call Mum", "done": True}]}})
    assert changed.status_code == 200 and changed.json()["title"] == "Big three" and changed.json()["config"]["items"][0]["done"] is True
    assert client.post(f"{V}/widgets/from-catalog", json={"template": "nope"}).json()["error"]["code"] == "no_such_template"
    assert client.get(f"{V}/universe/objects").json()["items"][0]["id"] == "sun"
    probe = next(o for o in client.get(f"{V}/universe/objects").json()["items"] if o["id"] == f"probe:{w.json()['id']}")
    assert probe["name"] == "Big three" and probe["state"]["text"] == "1 of 1 done" and probe["region"] == "yards"


def test_every_catalog_entry_can_be_added(client):
    on(client)
    ids = []
    for t in widgets.CATALOG[:widgets.MAX_WIDGETS]:
        r = client.post(f"{V}/widgets/from-catalog", json={"template": t["id"]})
        assert r.status_code == 201, (t["id"], r.text)
        ids.append(r.json()["id"])
    assert len(client.get(f"{V}/widgets").json()["items"]) == len(ids)


def test_habits_keep_a_streak_and_reject_nonsense():
    today = date(2026, 10, 26)
    days = [(today - timedelta(days=i)).isoformat() for i in (0, 1, 2, 4)]
    assert widgets.streak(days, today) == 3
    assert widgets.streak(days[1:], today) == 2                                                 # not yet checked today: yesterday still counts
    assert widgets.streak([], today) == 0 and widgets.streak([(today - timedelta(days=3)).isoformat()], today) == 0
    t, c = widgets.validate("habit", "Walk", {"days": ["2026-10-02", "2026-10-01", "2026-10-02"], "per_week": 5})
    assert c == {"days": ["2026-10-01", "2026-10-02"], "per_week": 5}
    for bad in ({"days": ["tomorrow"]}, {"days": ["2026-13-45"]}, {"days": "x"}, {"per_week": 9}, {"surprise": 1}):
        with pytest.raises(ApiError):
            widgets.validate("habit", "Walk", bad)


def test_timers_and_routines_are_validated_too():
    assert widgets.validate("timer", "Focus", {})[1] == {"focus": 25, "rest": 5, "sessions": 0}
    for bad in ({"focus": 0}, {"focus": 500}, {"rest": -1}, {"sessions": "many"}):
        with pytest.raises(ApiError):
            widgets.validate("timer", "Focus", bad)
    good = {"prompt": "Plan my day", "when": "weekdays", "at": "07:45"}
    assert widgets.validate("routine", "Plan", good)[1]["when"] == "weekdays"
    for bad in ({"prompt": ""}, {"prompt": "x" * 1600}, {**good, "when": "hourly"}, {**good, "at": "25:00"}, {**good, "at": "8am"}, {**good, "day": 9}, {**good, "run": "rm -rf"}):
        with pytest.raises(ApiError):
            widgets.validate("routine", "Plan", bad)


def test_a_routine_runs_through_the_single_prompt_in_one_click(client, fake, monkeypatch):
    monkeypatch.setattr(assist, "claude_ready", lambda d: True)      # CI has no real claude on PATH; turns run on the stand-in
    on(client)
    w = client.post(f"{V}/widgets/from-catalog", json={"template": "briefing"}).json()
    r = client.post(f"{V}/widgets/{w['id']}/run")
    assert r.status_code == 201 and r.json()["kind"] in ("answer", "plan", "write") and r.json()["prompt"].startswith("Give me a short plan for today")
    after = next(x for x in client.get(f"{V}/widgets").json()["items"] if x["id"] == w["id"])
    assert after["config"]["last_task"] == r.json()["id"] and after["config"]["last_run"]
    assert any(x["kind"] == "routine.ran" for x in client.get(f"{V}/receipts").json()["items"])
    top = client.post(f"{V}/widgets/from-catalog", json={"template": "top3"}).json()
    assert client.post(f"{V}/widgets/{top['id']}/run").json()["error"]["code"] == "not_a_routine"
    client.post(f"{V}/pause")
    assert client.post(f"{V}/widgets/{w['id']}/run").status_code == 423                       # All Stop stops this too


def test_the_schedule_rules():
    mon = datetime(2026, 10, 26, 9, 0).astimezone()          # a Monday
    sat = datetime(2026, 10, 31, 9, 0).astimezone()
    sun = datetime(2026, 11, 1, 18, 0).astimezone()
    assert routines.is_due({"when": "manual", "at": "08:00"}, mon) is False
    assert routines.is_due({"when": "daily", "at": "08:00"}, mon) is True
    assert routines.is_due({"when": "daily", "at": "09:30"}, mon) is False                    # not yet
    assert routines.is_due({"when": "weekdays", "at": "08:00"}, sat) is False
    assert routines.is_due({"when": "weekly", "at": "17:00", "day": 6}, sun) is True
    assert routines.is_due({"when": "weekly", "at": "17:00", "day": 6}, mon) is False


def test_scheduled_runs_need_their_own_yes_and_happen_once_a_day(client, app, settings, fake, monkeypatch):
    db, engine = app.state.db, app.state.engine
    monkeypatch.setattr(assist, "claude_ready", lambda d: True)
    on(client)
    w = client.post(f"{V}/widgets/from-catalog", json={"template": "briefing", "config": {"when": "daily", "at": "00:00"}}).json()
    now = datetime.now().astimezone().replace(hour=12, minute=0)
    assert routines.tick(db, engine, settings, now) == []                                      # the routines ability is off
    on(client, "routines")
    client.post(f"{V}/pause")
    assert routines.tick(db, engine, settings, now) == []                                      # paused
    client.post(f"{V}/resume")
    monkeypatch.setattr(assist, "claude_ready", lambda d: False)
    assert routines.tick(db, engine, settings, now) == []                                      # Claude is not signed in
    monkeypatch.setattr(assist, "claude_ready", lambda d: True)
    assert routines.tick(db, engine, settings, now) == [w["id"]]
    assert routines.tick(db, engine, settings, now) == []                                      # already ran today
    assert any(x["kind"] == "routine.scheduled" for x in client.get(f"{V}/receipts").json()["items"])
    manual = client.post(f"{V}/widgets/from-catalog", json={"template": "weekly"}).json()
    assert manual["config"]["when"] == "manual" and routines.tick(db, engine, settings, now) == []   # manual routines never start by themselves


def test_the_routines_ability_says_what_it_does_and_cannot_do(client):
    a = next(x for x in client.get(f"{V}/abilities").json()["abilities"] if x["name"] == "routines")
    assert a["enabled"] is False and "your own Claude plan" in a["can_do"][0] and any("more than once a day" in c for c in a["cannot"])
    assert client.put(f"{V}/abilities/routines", json={"enabled": True}).status_code == 422     # needs the explicit confirmation like every ability


def test_the_household_vault_keeps_labelled_facts_and_rejects_nonsense():
    t, c = widgets.validate("facts", "Household vault", {"items": [{"label": " Furnace filter ", "value": "16x25x4"}]})
    assert c == {"items": [{"label": "Furnace filter", "value": "16x25x4"}]}
    assert any(x["id"] == "household" and x["kind"] == "facts" and not x["needs_claude"] for x in widgets.CATALOG)
    assert "Home" in widgets.GROUPS
    bad = [{"items": [{"label": "x"}]}, {"items": [{"label": "", "value": "y"}]}, {"items": [{"label": "a", "value": "b", "extra": 1}]},
           {"items": [{"label": "a", "value": "b" * 201}]}, {"items": "no"}, {"items": [{"label": "a", "value": "b"}] * (widgets.MAX_FACTS + 1)}, {"surprise": 1}]
    for b in bad:
        with pytest.raises(ApiError):
            widgets.validate("facts", "Household vault", b)


def test_the_household_vault_survives_a_round_trip_through_the_api(client):
    on(client)
    w = client.post(f"{V}/widgets/from-catalog", json={"template": "household", "confirm": True})
    assert w.status_code == 201 and w.json()["kind"] == "facts"
    new = {"items": [{"label": "AC filter", "value": "20x25x1"}]}
    assert client.put(f"{V}/widgets/{w.json()['id']}", json={"config": new}).json()["config"] == new
