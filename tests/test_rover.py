"""The Rover, levels 1 and 2. The window lookup, the picture capture and the guide are MOCKS here (labelled as such): no real screen is read and no
real Claude is called, except guide_with_claude, which is driven against tests/fake_claude.py (a stand-in executable, not Claude).
What is proven: the opt-in, the block list, the refusals, Stop at every point (including mid-step), the receipts, and that there is no input injection."""
import json
import re
import sys
from pathlib import Path

import pytest

from aios import abilities, claude_code, rover
from aios.errors import ApiError
from test_api import V, app, client, native, pair  # noqa: F401

FAKE = [sys.executable, str(Path(__file__).with_name("fake_claude.py"))]
PNG = b"\x89PNG\r\n\x1a\nMOCK-PICTURE"


class MockBackends(rover.Backends):
    """MOCK: a pretend foreground window, a pretend picture, a pretend guide. `on_capture` / `on_guide` let a test press Stop in the middle of a step."""

    def __init__(self, title="Notepad - notes.txt", process="notepad.exe", steps=("Click File.", "Click Save."), on_capture=None, on_guide=None):
        self.cur = {"title": title, "process": process}
        self.captured, self.guided = [], []
        self.on_capture, self.on_guide, self.steps = on_capture, on_guide, list(steps)
        super().__init__(foreground=lambda: dict(self.cur), capture=self._capture, guide=self._guide, is_mock=True)

    def _capture(self, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(PNG)
        self.captured.append(dest)
        if self.on_capture:
            self.on_capture()
        return dest

    def _guide(self, picture, goal, should_cancel=None):
        self.guided.append((picture, goal))
        if self.on_guide:
            self.on_guide()
        return None if should_cancel and should_cancel() else self.steps


def on(db):
    abilities.set_enabled(db, "rover", True, True)


def start(db, level=1, **kw):
    args = dict(goal="Explain this error", level=level, target="Notepad", opt_in=True)
    args.update(kw)
    return rover.start(db, args.pop("goal"), args.pop("level"), args.pop("target"), args.pop("opt_in"), args.pop("minutes", None))


def err(fn, *a, **k):
    with pytest.raises(ApiError) as e:
        fn(*a, **k)
    return e.value.status, e.value.code


def kinds(db):
    return [r["kind"] for r in abilities.receipts(db)]


def pics(settings):
    d = rover.pictures_dir(settings)
    return [p for p in d.rglob("*") if p.is_file()] if d.is_dir() else []


# ---------------------------------------------------------------- off by default, opt-in per task
def test_the_rover_is_off_by_default_and_nothing_can_start(db, settings):
    assert {a["name"]: a["enabled"] for a in abilities.status(db)["abilities"]}["rover"] is False
    assert err(start, db) == (403, "ability_off")
    assert rover.state(db, settings)["status"] == "idle"


def test_every_task_needs_its_own_explicit_yes_and_sane_limits(db):
    on(db)
    assert err(start, db, opt_in=False) == (422, "opt_in_required")
    assert err(start, db, goal="  ") == (422, "missing_fields")
    assert err(start, db, target="") == (422, "missing_fields")
    assert err(start, db, minutes=0) == (422, "bad_time_limit")
    assert err(start, db, minutes=61) == (422, "bad_time_limit")
    assert err(start, db, level=0) == (422, "bad_level")
    t = start(db)
    assert t["status"] == "armed" and t["level"] == 1 and "rover.armed" in kinds(db)
    assert err(start, db) == (409, "task_active")                                            # one task at a time


@pytest.mark.parametrize("level,word", [(3, "Chrome"), (4, "Claude Desktop")])
def test_levels_3_and_4_are_listed_as_not_available_and_never_attempted(db, level, word):
    on(db)
    status, c = err(start, db, level=level)
    assert (status, c) == (422, "level_not_available")
    assert rover.active_task(db) is None and "rover.refused" in kinds(db)
    assert [lv["available"] for lv in rover.LEVELS] == [True, True, False, False]
    assert word in rover.LEVELS[level - 1]["reason"] and "spike S" in rover.LEVELS[level - 1]["reason"]


def test_levels_3_and_4_are_refused_even_with_the_ability_off(db):
    assert err(start, db, level=3) == (422, "level_not_available")


# ---------------------------------------------------------------- the block list
@pytest.mark.parametrize("goal,target", [
    ("Check my balance", "Chase Online Banking"), ("Explain this", "Wells Fargo"), ("Find a password", "1Password"),
    ("Open my vault", "Bitwarden"), ("Pay the invoice", "Checkout - Stripe"), ("Send money", "PayPal"),
    ("Change a setting", "Azure Portal"), ("Edit it", "Registry Editor"), ("Change something", "Settings"),
    ("Sign in for me", "Edge"), ("Type my password", "Notepad"), ("Pay with credit card", "Notepad"),
])
def test_the_block_list_refuses_a_task_before_it_exists(db, goal, target):
    on(db)
    assert err(start, db, goal=goal, target=target) == (403, "rover_blocked")
    assert rover.active_task(db) is None
    assert any(r["kind"] == "rover.refused" and "block list" in r["summary"] for r in abilities.receipts(db))


@pytest.mark.parametrize("title,process", [
    ("Chase - Online Banking - Edge", "msedge.exe"), ("Bitwarden", "bitwarden.exe"), ("Anything", "regedit.exe"),
    ("Anything", "systemsettings.exe"), ("Sign in to your account", "chrome.exe"), ("Checkout", "chrome.exe"),
])
def test_a_blocked_window_in_front_refuses_the_step_and_nothing_is_captured(db, settings, title, process):
    on(db)
    t = start(db)                                                                           # target Notepad; the window in front is something else
    be = MockBackends(title=title, process=process)
    assert err(rover.step, db, settings, t["id"], be) == (403, "rover_blocked")
    assert be.captured == [] and pics(settings) == []
    assert rover._view(db, rover._row(db, t["id"]))["steps"][0]["outcome"] == "refused"
    assert "rover.refused" in kinds(db)


def test_a_window_that_changes_to_a_blocked_one_during_the_step_loses_its_picture(db, settings):
    on(db)
    t = start(db)
    be = MockBackends()
    be.on_capture = lambda: be.cur.update(title="Bank of Somewhere - Online Banking", process="notepad.exe")
    assert err(rover.step, db, settings, t["id"], be) == (403, "rover_blocked")
    assert pics(settings) == []


def test_the_wrong_window_is_refused(db, settings):
    on(db)
    t = start(db, target="Notepad")
    be = MockBackends(title="Calculator", process="calculatorapp.exe")
    assert err(rover.step, db, settings, t["id"], be) == (409, "wrong_window")
    assert be.captured == []


# ---------------------------------------------------------------- Look and Guide
def test_look_takes_a_picture_under_the_state_folder_and_injects_nothing(db, settings):
    on(db)
    t = start(db, level=1)
    be = MockBackends()
    res = rover.step(db, settings, t["id"], be)
    assert res["outcome"] == "done" and res["instructions"] is None and res["task"]["status"] == "looking"
    [p] = pics(settings)
    assert p.read_bytes() == PNG and p.resolve().is_relative_to((settings.state_dir / "rover" / "pictures").resolve())
    assert be.guided == []                                                                  # Look never asks Claude
    assert "rover.look" in kinds(db)
    assert res["task"]["steps"][0]["picture"] == p.name


def test_guide_returns_numbered_instructions_from_claude_and_logs_them(db, settings):
    on(db)
    t = start(db, level=2, goal="Save my file")
    be = MockBackends(steps=["Click File.", "Click Save As.", "Press Save."])
    res = rover.step(db, settings, t["id"], be)
    assert res["outcome"] == "done" and res["instructions"] == ["Click File.", "Click Save As.", "Press Save."] and res["task"]["status"] == "guiding"
    assert be.guided[0][1] == "Save my file" and be.guided[0][0].read_bytes() == PNG
    assert "rover.guide" in kinds(db)
    assert rover.state(db, settings)["task"]["steps"][0]["instructions"][0] == "Click File."


def test_a_failing_guide_keeps_the_task_but_leaves_no_picture(db, settings):
    on(db)
    t = start(db, level=2)

    class Boom(MockBackends):
        def _guide(self, *a, **k):
            raise RuntimeError("boom")
    assert err(rover.step, db, settings, t["id"], Boom()) == (502, "step_failed")
    assert pics(settings) == [] and rover.active_task(db)["id"] == t["id"] and "rover.failed" in kinds(db)


def test_finishing_deletes_the_pictures_and_ends_the_task(db, settings):
    on(db)
    t = start(db)
    rover.step(db, settings, t["id"], MockBackends())
    assert pics(settings)
    assert rover.finish(db, settings, t["id"])["status"] == "finished"
    assert pics(settings) == [] and rover.active_task(db) is None
    assert err(rover.finish, db, settings, t["id"]) == (409, "task_not_active")
    assert err(rover.step, db, settings, t["id"], MockBackends()) == (409, "task_not_active")


def test_there_is_no_input_injection_anywhere_in_the_rover():
    src = Path(rover.__file__).read_text(encoding="utf-8").lower()
    code_only = "\n".join(re.sub(r"#.*", "", ln) for ln in src.splitlines())
    for banned in ("sendinput", "mouse_event", "keybd_event", "setcursorpos", "pyautogui", "pynput", "postmessage", "sendmessage", "sendkeys", "subprocess", "webbrowser", "os.system"):
        assert banned not in code_only, banned


# ---------------------------------------------------------------- Stop
def test_stop_ends_an_armed_task_even_with_the_ability_off(db, settings):
    on(db)
    t = start(db)
    abilities.set_enabled(db, "rover", False, False)                                        # turning it off stops the task by itself
    assert rover._row(db, t["id"])["status"] == "stopped"
    assert rover.stop(db, settings)["stopped"] == 0                                         # and Stop twice is harmless
    assert err(rover.step, db, settings, t["id"], MockBackends()) == (409, "task_not_active")


def test_stop_in_the_middle_of_a_capture_throws_the_picture_away(db, settings):
    on(db)
    t = start(db)
    be = MockBackends(on_capture=lambda: rover.stop(db))
    res = rover.step(db, settings, t["id"], be)
    assert res["outcome"] == "stopped" and res["task"]["status"] == "stopped" and res["task"]["stop_reason"] == "you pressed Stop"
    assert pics(settings) == [] and be.guided == []
    assert "rover.stopped_mid_step" in kinds(db) and "rover.stopped" in kinds(db)


def test_stop_in_the_middle_of_the_guide_keeps_nothing(db, settings):
    on(db)
    t = start(db, level=2)
    be = MockBackends(on_guide=lambda: rover.stop(db))
    res = rover.step(db, settings, t["id"], be)
    assert res["outcome"] == "stopped" and res["instructions"] is None and res["task"]["status"] == "stopped"
    assert pics(settings) == []
    assert all(s["instructions"] is None for s in res["task"]["steps"])


def test_all_stop_stops_a_running_task_and_blocks_the_next_step(db, settings):
    on(db)
    t = start(db, level=2)
    be = MockBackends(on_guide=lambda: abilities.set_paused(db, True))
    res = rover.step(db, settings, t["id"], be)
    assert res["outcome"] == "stopped" and rover._row(db, t["id"])["stop_reason"] == "All Stop was pressed"
    assert pics(settings) == []
    abilities.set_paused(db, False)
    assert err(rover.step, db, settings, t["id"], MockBackends()) == (409, "task_not_active")   # resuming does not revive it
    assert start(db, level=1)["status"] == "armed"                                              # a new, explicit task is fine


def test_pausing_while_armed_stops_the_task(db):
    on(db)
    t = start(db)
    abilities.set_paused(db, True)
    assert rover._row(db, t["id"])["status"] == "stopped"


def test_the_time_limit_ends_a_task(db, settings):
    on(db)
    t = start(db, minutes=1)
    db.execute("UPDATE rover_tasks SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?", (t["id"],))
    assert err(rover.step, db, settings, t["id"], MockBackends()) == (409, "task_not_active")
    assert rover._row(db, t["id"])["stop_reason"] == "the time limit ran out"


def test_stop_reaches_a_hung_claude_process(tmp_path, monkeypatch):
    pic = tmp_path / "1.png"
    pic.write_bytes(PNG)
    monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps({"outcome": "hang"}))
    assert rover.guide_with_claude(pic, "anything", should_cancel=lambda: True, exe=FAKE) is None      # cancelled: the child is killed, nothing returned


# ---------------------------------------------------------------- the Claude call (driven against the stand-in executable, not Claude)
def test_guide_with_claude_uses_the_wrapper_read_only_and_parses_numbered_steps(tmp_path, monkeypatch):
    pic = tmp_path / "1.png"
    pic.write_bytes(PNG)
    log = tmp_path / "log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps({"log": str(log), "reply": "Sure.\n1. Click the File menu.\n2) Choose Save.\n3. Press Enter."}))
    steps = rover.guide_with_claude(pic, "save the file", exe=FAKE)
    assert steps == ["Click the File menu.", "Choose Save.", "Press Enter."]
    argv = [json.loads(ln)["argv"] for ln in log.read_text().splitlines() if "-p" in json.loads(ln)["argv"]][0]
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep" and "1.png" in argv[-1] and "save the file" in argv[-1]
    assert "Bash" in argv[argv.index("--disallowedTools") + 1]
    assert "cannot click" in argv[argv.index("--append-system-prompt") + 1].replace("can not", "cannot")


def test_guide_with_claude_refuses_untrustworthy_or_empty_answers(tmp_path, monkeypatch):
    pic = tmp_path / "1.png"
    pic.write_bytes(PNG)
    for cfg, expect in (({"reply": "No steps here."}, "guide_failed"), ({"outcome": "error"}, "guide_failed"), ({"extra_tools": ["Bash"], "reply": "1. Do it."}, "guide_failed"),
                        ({"auth": {"loggedIn": False}}, "claude_unavailable")):
        monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps(cfg))
        with pytest.raises(ApiError) as e:
            rover.guide_with_claude(pic, "x", exe=FAKE)
        assert e.value.code == expect, cfg


def test_parse_steps_caps_and_redacts():
    text = "\n".join(f"{i}. step {i}" for i in range(1, 30)) + "\n"
    assert len(rover.parse_steps(text)) == rover.MAX_STEPS_SHOWN
    assert "sk-ant" not in rover.parse_steps("1. use sk-ant-" + "x" * 30)[0]


def test_the_real_capture_helper_writes_a_png_on_windows(tmp_path):
    if sys.platform != "win32":
        pytest.skip("Windows only")
    try:
        out = rover.capture_foreground(tmp_path / "shot.png")
    except ApiError as e:                                                                    # no desktop session (service or CI)
        pytest.skip(f"no usable foreground window: {e.code}")
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" and out.stat().st_size > 100


# ---------------------------------------------------------------- over HTTP
@pytest.fixture()
def mock_rover(monkeypatch):
    be = MockBackends()
    monkeypatch.setattr(rover, "BACKENDS", be)
    return be


def test_the_state_endpoint_is_visible_and_honest(client):
    s = client.get(f"{V}/rover").json()
    assert s["status"] == "idle" and s["ring"] is False and s["ability_enabled"] is False and s["input_injection"] is False
    assert [lv["available"] for lv in s["levels"]] == [True, True, False, False] and s["stop"]["path"] == "/api/v1/rover/stop"
    assert s["mock"] is False


def test_the_whole_flow_over_http_with_stop_and_receipts(client, mock_rover, settings):
    body = {"goal": "What is this error?", "level": 2, "target": "Notepad", "opt_in": True}
    assert client.post(f"{V}/rover/tasks", json=body).status_code == 403                    # ability off
    assert client.put(f"{V}/abilities/rover", json={"enabled": True}).status_code == 422     # turning it on needs confirmation
    assert client.put(f"{V}/abilities/rover", json={"enabled": True, "confirm": True}).status_code == 200
    assert client.post(f"{V}/rover/tasks", json={**body, "opt_in": False}).json()["error"]["code"] == "opt_in_required"
    t = client.post(f"{V}/rover/tasks", json=body).json()
    s = client.get(f"{V}/rover").json()
    assert s["ring"] is True and s["status"] == "armed" and s["mock"] is True and s["task"]["id"] == t["id"]
    r = client.post(f"{V}/rover/tasks/{t['id']}/step").json()
    assert r["outcome"] == "done" and r["instructions"] == ["Click File.", "Click Save."]
    assert client.get(f"{V}/rover").json()["status"] == "guiding"
    assert client.post(f"{V}/rover/stop").json() == {"stopped": 1, "status": "idle", "active": False}
    after = client.get(f"{V}/rover").json()
    assert after["status"] == "idle" and after["ring"] is False and after["last_task"]["status"] == "stopped"
    assert client.post(f"{V}/rover/tasks/{t['id']}/step").json()["error"]["code"] == "task_not_active"
    assert pics(settings) == []
    got = {x["kind"] for x in client.get(f"{V}/receipts").json()["items"]}
    assert {"rover.armed", "rover.guide", "rover.stopped"} <= got
    assert client.get(f"{V}/rover/tasks/nope").status_code == 404


def test_stop_over_http_works_while_paused_and_with_the_ability_off(client, mock_rover):
    client.put(f"{V}/abilities/rover", json={"enabled": True, "confirm": True})
    client.post(f"{V}/rover/tasks", json={"goal": "Look", "level": 1, "target": "Notepad", "opt_in": True})
    assert client.post(f"{V}/pause").status_code == 200                                     # All Stop
    assert client.get(f"{V}/rover").json()["status"] == "idle"
    assert client.post(f"{V}/rover/stop").status_code == 200
    client.post(f"{V}/resume")
    client.put(f"{V}/abilities/rover", json={"enabled": False})
    assert client.post(f"{V}/rover/stop").json()["stopped"] == 0


def test_blocked_and_unavailable_levels_over_http(client, mock_rover):
    client.put(f"{V}/abilities/rover", json={"enabled": True, "confirm": True})
    r = client.post(f"{V}/rover/tasks", json={"goal": "Pay", "level": 1, "target": "PayPal", "opt_in": True})
    assert r.status_code == 403 and r.json()["error"]["code"] == "rover_blocked"
    for lv in (3, 4):
        r = client.post(f"{V}/rover/tasks", json={"goal": "x", "level": lv, "target": "Edge", "opt_in": True})
        assert r.status_code == 422 and r.json()["error"]["code"] == "level_not_available"
    mock_rover.cur = {"title": "Notepad", "process": "notepad.exe"}
    t = client.post(f"{V}/rover/tasks", json={"goal": "Look", "level": 1, "target": "Notepad", "opt_in": True}).json()
    mock_rover.cur = {"title": "LastPass Vault", "process": "chrome.exe"}
    r = client.post(f"{V}/rover/tasks/{t['id']}/step")
    assert r.status_code == 403 and r.json()["error"]["code"] == "rover_blocked"


def test_the_rover_bay_object_and_card(client):
    o = {x["id"]: x for x in client.get(f"{V}/universe/objects").json()["items"]}
    assert o["home:rover"]["state"]["text"].startswith("Off")
    client.put(f"{V}/universe/objects/home:rover/config", json={"values": {"ability_rover": True}, "confirm": True})
    assert client.get(f"{V}/universe/objects").json()["items"] and \
        {x["id"]: x for x in client.get(f"{V}/universe/objects").json()["items"]}["home:rover"]["state"]["text"].startswith("On")
    c = client.get(f"{V}/universe/objects/home:rover/card").json()
    f = {x["key"]: x for tier in c["panels"].values() for x in tier}
    assert f["ability_rover"]["value"] is True and "spike S2" in f["about"]["value"] and "spike S3" in f["about"]["value"] and "not built" in f["about"]["value"].lower()
    assert client.post(f"{V}/universe/objects/home:rover/actions/stop").json()["stopped"] == 0
