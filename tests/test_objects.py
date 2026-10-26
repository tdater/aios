"""The universe's object model over HTTP: every piece of AIOS as one object with a plain card and its own settings. Changes go
through the functions that already guard them, so these tests check routing and honesty, not new powers."""
import pytest

from aios import memory, system_scan
from test_api import V, app, client, native, pair  # noqa: F401

REGIONS = {"sun", "fleet", "stars", "yards", "home", "control"}
TONES = {"ok", "info", "warn", "bad", "muted"}


def objs(client):
    return {o["id"]: o for o in client.get(f"{V}/universe/objects").json()["items"]}


def card(client, oid):
    return client.get(f"{V}/universe/objects/{oid}/card").json()


def fields(c):
    return {f["key"]: f for tier in c["panels"].values() for f in tier}


def test_every_piece_of_aios_is_an_object_with_a_plain_name_and_a_job(client):
    o = objs(client)
    assert {"sun", "planet:claude", "planet:gemini", "planet:perplexity", "planet:antigravity", "nebula:history", "wormhole:import", "beacon:publish",
            "log", "allstop", "home", "home:engine", "home:cargo", "home:launch", "home:rover", "home:port"} <= set(o)
    for x in o.values():
        assert x["region"] in REGIONS and x["state"]["tone"] in TONES and x["name"].strip() and x["job"].strip() and x["state"]["text"].strip()
        assert not any(w in (x["name"] + x["job"]).lower() for w in ("json", "api", "sqlite", "argv"))      # plain words, no jargon
    assert o["planet:antigravity"]["job"].startswith("Big coding jobs you hand over yourself")
    assert o["home:rover"]["state"]["text"].startswith("Off")                                               # honest: not built, and off
    assert o["sun"]["region"] == "sun" and o["planet:claude"]["region"] == "fleet" and o["home"]["region"] == "home"
    assert any(x["type"] == "moon" and x["meta"]["parent"] == "planet:claude" for x in o.values())          # the skills are Claude's moons


def test_the_server_says_it_has_the_object_model_so_an_older_one_can_be_noticed(client):
    caps = client.get(f"{V}/meta").json()["capabilities"]
    assert caps["universe_objects"] is True and caps["assist"] is True


def test_projects_become_stations_and_the_chat_space_does_not(client, tmp_path):
    root = tmp_path / "ws" / "calc"
    root.mkdir(parents=True)
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(root)}).json()
    client.post(f"{V}/everyday")
    o = objs(client)
    assert f"station:{p['id']}" in o and o[f"station:{p['id']}"]["region"] == "yards"
    assert not any(x["type"] == "station" and x["name"] == "Everyday" for x in o.values())


def test_a_planet_card_shows_what_each_choice_would_share_and_changing_it_moves_the_ring(client, app, settings):
    db = app.state.db
    memory.create(db, settings, scope="global", type="fact", title="Public one", body="b", sensitivity="public", status="approved")
    memory.create(db, settings, scope="global", type="fact", title="Private one", body="b", sensitivity="private", status="approved")
    memory.create(db, settings, scope="global", type="fact", title="Secret one", body="b", sensitivity="secret-adjacent", status="approved")
    c = card(client, "planet:gemini")
    f = fields(c)["sharing"]
    assert f["kind"] == "choice" and f["value"] == "public"
    previews = {o["value"]: o["preview"] for o in f["options"]}
    assert previews == {"private": "2 memories would be shared", "public": "1 memory would be shared", "none": "0 memories would be shared"}   # never the secret one
    assert "ever shared" in f["help"] and "secret" in f["help"]
    r = client.put(f"{V}/universe/objects/planet:gemini/config", json={"values": {"sharing": "private"}})
    assert r.status_code == 200 and fields(r.json())["sharing"]["value"] == "private"
    assert objs(client)["planet:gemini"]["meta"]["level"] == "private"
    assert any("Gemini may now be told" in x["summary"] for x in client.get(f"{V}/receipts").json()["items"])
    assert client.put(f"{V}/universe/objects/planet:gemini/config", json={"values": {"sharing": "everything"}}).status_code == 422


def test_what_a_planet_would_be_told_can_be_read_before_you_decide(client):
    r = client.post(f"{V}/universe/objects/planet:claude/actions/show_briefing")
    assert r.status_code == 200 and {"title", "count", "text"} <= set(r.json())


def test_the_sun_holds_the_learning_switch(client):
    assert fields(card(client, "sun"))["learning"]["value"] is True
    client.put(f"{V}/universe/objects/sun/config", json={"values": {"learning": False}})
    assert fields(card(client, "sun"))["learning"]["value"] is False and client.get(f"{V}/learning").json()["enabled"] is False
    assert client.put(f"{V}/universe/objects/sun/config", json={"values": {"learning": "maybe"}}).status_code == 422


def test_all_stop_is_the_pause_switch(client):
    assert objs(client)["allstop"]["state"]["text"] == "Running normally"
    client.put(f"{V}/universe/objects/allstop/config", json={"values": {"paused": True}})
    assert objs(client)["allstop"]["state"] == {"tone": "bad", "text": "Paused"} and client.get(f"{V}/abilities").json()["paused"] is True
    client.put(f"{V}/universe/objects/allstop/config", json={"values": {"paused": False}})
    assert client.get(f"{V}/abilities").json()["paused"] is False


def test_a_station_holds_its_projects_check_command(client, tmp_path):
    root = tmp_path / "ws" / "calc"
    root.mkdir(parents=True)
    p = client.post(f"{V}/projects", json={"name": "Calc", "path": str(root)}).json()
    oid = f"station:{p['id']}"
    assert fields(card(client, oid))["check_command"]["value"] == ""
    r = client.put(f"{V}/universe/objects/{oid}/config", json={"values": {"check_command": "python -m unittest test_calc"}})
    assert r.status_code == 200 and fields(r.json())["check_command"]["value"] == "python -m unittest test_calc"
    assert client.get(f"{V}/projects/{p['id']}/verify-command").json()["argv"] == ["python", "-m", "unittest", "test_calc"]
    client.put(f"{V}/universe/objects/{oid}/config", json={"values": {"check_command": ""}})
    assert client.get(f"{V}/projects/{p['id']}/verify-command").json()["argv"] is None


def test_the_health_check_needs_your_yes_then_fills_the_asteroid_belt(client, monkeypatch):
    facts = {"memory": {"total_bytes": 16 * 1024 ** 3, "available_bytes": 1 * 1024 ** 3}, "disk": {"total_bytes": 500 * 1024 ** 3, "free_bytes": 400 * 1024 ** 3},
             "temp": {"bytes": 5 * 1024 ** 3, "files": 900, "complete": True}, "startup_items": 20}
    monkeypatch.setattr(system_scan, "collect", lambda: facts)
    assert client.post(f"{V}/universe/objects/home:engine/actions/run_health_check").status_code == 403           # off until you turn it on
    assert client.put(f"{V}/universe/objects/home:engine/config", json={"values": {"ability_system_scan": True}}).json()["error"]["code"] == "confirmation_required"
    ok = client.put(f"{V}/universe/objects/home:engine/config", json={"values": {"ability_system_scan": True}, "confirm": True})
    assert ok.status_code == 200 and fields(ok.json())["ability_system_scan"]["value"] is True
    res = client.post(f"{V}/universe/objects/home:engine/actions/run_health_check").json()
    assert {s["id"] for s in res["suggestions"]} == {"memory", "temp", "startup"}
    o = objs(client)
    assert {"rock:memory", "rock:temp", "rock:startup"} <= set(o) and all(o[k]["region"] == "home" for k in ("rock:memory", "rock:temp"))
    assert o["rock:memory"]["meta"]["size"] > o["rock:startup"]["meta"]["size"]                                   # attention is bigger than information
    assert o["home:engine"]["state"]["text"] == "Memory 94% in use" and o["home:cargo"]["state"]["text"] == "Temporary files 5.0 GB"
    assert o["home"]["state"]["text"] == "Needs attention"
    assert client.post(f"{V}/pause").status_code == 200
    assert client.post(f"{V}/universe/objects/home:engine/actions/run_health_check").status_code == 423          # All Stop stops it too


def test_pairing_and_backup_live_at_the_docking_port(client):
    code = client.post(f"{V}/universe/objects/home:port/actions/pair_device").json()
    assert len(code["code"]) >= 8 and "once" in code["note"]
    assert client.post(f"{V}/universe/objects/home:port/actions/backup_now").json()["ok"] is True
    kinds = {x["kind"] for x in client.get(f"{V}/receipts").json()["items"]}
    assert {"pairing.code", "backup.created"} <= kinds


def test_what_cannot_be_changed_says_so_and_nothing_is_invented(client):
    assert client.put(f"{V}/universe/objects/planet:claude/config", json={"values": {"model": "x"}}).json()["error"]["code"] == "unknown_setting"
    assert client.put(f"{V}/universe/objects/home:rover/config", json={"values": {"enabled": True}}).status_code == 422
    assert client.put(f"{V}/universe/objects/sun/config", json={"values": {}}).json()["error"]["code"] == "no_change"
    assert client.post(f"{V}/universe/objects/home:engine/actions/rm_rf").status_code == 404
    assert client.get(f"{V}/universe/objects/nothing/card").status_code == 404
    assert "not built" in fields(card(client, "home:rover"))["about"]["value"].lower()


def test_every_card_explains_itself_in_plain_words(client):
    for oid, o in objs(client).items():
        c = card(client, oid)
        assert c["explain"], oid
        assert set(c["panels"]) == {"basics", "more", "expert"}
        assert len(c["panels"]["basics"]) <= 4                                                                      # the basics stay few


def test_it_needs_a_signed_in_device(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        for method, path in (("get", "/universe/objects"), ("get", "/universe/objects/sun/card"), ("put", "/universe/objects/sun/config"), ("post", "/universe/objects/sun/actions/x")):
            r = getattr(anon, method)(f"{V}{path}", **({"json": {"values": {}}} if method == "put" else {}))
            assert r.status_code == 401, (method, path)
