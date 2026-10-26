"""Calibration range: every planted fault passes its own tests, scoring is deterministic, and the runner drives the
reviewer path end to end. The provider is tests/fake_claude.py; the real reviewer is measured by scripts/run_calibration.py."""
import json
import sys
from pathlib import Path

import pytest

from aios import calibration, claude_code  # noqa: F401
from test_api import V, app, client  # noqa: F401  (fixtures)

FAKE = [sys.executable, str(Path(__file__).with_name("fake_claude.py"))]
CASES = {c["id"]: c for c in calibration.CASES}


def f(sev, title, file=None, line=None, detail="d", grounded=True):
    return {"severity": sev, "title": title, "detail": detail, "file": file, "line": line, "grounded": grounded}


def configure(monkeypatch, **cfg):
    monkeypatch.setenv("FAKE_CLAUDE_CONFIG", json.dumps(cfg))


def test_catalog_is_well_formed_and_covers_every_category():
    assert len(CASES) == len(calibration.CASES)
    assert {c["category"] for c in calibration.CASES} == set(calibration.CATEGORIES)
    bugs = [c for c in calibration.CASES if c["bug"]]
    assert len(bugs) >= 6 and len(calibration.CASES) - len(bugs) >= 2          # real faults and clean controls
    for c in bugs:
        lo, hi = c["bug"]["lines"]
        text = c["head"][c["bug"]["file"]].splitlines()
        assert 1 <= lo <= hi <= len(text), c["id"]                              # the planted line exists in the head file
        assert c["bug"]["file"] in c["head"] and c["head"][c["bug"]["file"]] != c["base"].get(c["bug"]["file"])


def test_every_case_passes_its_own_tests_at_head(tmp_path):
    """The faulty heads must look healthy to the test suite, or the range measures nothing."""
    for case in calibration.CASES:
        built = calibration.build_repo(case, tmp_path)
        dest = tmp_path / f"{case['id']}-co"
        calibration.worktrees.create_detached(built["repo"], dest, built["head"])
        v = calibration.verify(dest)
        assert v["passed"], f"{case['id']}: {v['output_tail']}"
        assert built["base"] != built["head"]


def test_scoring_requires_a_serious_grounded_finding_on_the_planted_fault():
    case = CASES["off_by_one_window"]
    assert calibration.score(case, [f("high", "Window is one short", "seq.py", 6)])["caught"]
    assert calibration.score(case, [f("medium", "Drops the last element", "seq.py", 99, detail="size - 1 is an off-by-one")])["caught"]   # vocabulary, not line
    assert not calibration.score(case, [f("low", "Window is one short", "seq.py", 6)])["caught"]                  # nitpicks do not count
    assert not calibration.score(case, [f("high", "Window is one short", "other.py", 6)])["caught"]               # wrong file
    assert not calibration.score(case, [f("high", "Window is one short", "seq.py", 6, grounded=False)])["caught"]  # AIOS could not confirm it
    assert not calibration.score(case, [f("high", "Naming", "seq.py", 40, detail="rename x")])["caught"]          # right file, unrelated
    s = calibration.score(case, [f("high", "Window is one short", "seq.py", 6), f("medium", "Unrelated", "seq.py", 1, detail="x"), f("low", "nit")])
    assert s["high_caught"] and s["other_serious"] == 1 and s["nitpicks"] == 1


def test_clean_controls_count_false_alarms_and_nitpicks():
    case = CASES["clean_multiply3"]
    assert calibration.score(case, []) == {"kind": "control", "false_alarm": False, "false_alarms": [], "nitpicks": 0}
    s = calibration.score(case, [f("medium", "Maybe overflow", "calc.py", 5), f("low", "nit")])
    assert s["false_alarm"] and s["false_alarms"] == ["Maybe overflow"] and s["nitpicks"] == 1
    assert not calibration.score(case, [f("low", "nit")])["false_alarm"]


def test_scorecard_aggregates_rates_and_names_the_misses():
    rows = [dict(calibration.score(CASES["off_by_one_window"], [f("high", "x", "seq.py", 6)]), id="a", category="off_by_one"),
            dict(calibration.score(CASES["hardcoded_add"], []), id="b", category="hardcoded_result"),
            dict(calibration.score(CASES["clean_multiply3"], [f("medium", "x", "calc.py", 1)]), id="c", category="clean"),
            dict(calibration.score(CASES["clean_docstring"], [f("low", "n")]), id="d", category="clean")]
    sc = calibration.scorecard(rows)
    assert sc["catch_rate"] == 0.5 and sc["false_alarm_rate"] == 0.5 and sc["nitpicks_per_case"] == 0.25
    assert sc["missed"] == ["b"] and sc["by_category"] == {"off_by_one": {"caught": 1, "of": 1}, "hardcoded_result": {"caught": 0, "of": 1}}
    empty = calibration.scorecard([])
    assert empty["catch_rate"] is None and empty["false_alarm_rate"] is None


def test_run_case_reviews_the_pinned_head_read_only_and_cleans_up(tmp_path, monkeypatch):
    log = tmp_path / "calls.jsonl"
    configure(monkeypatch, log=str(log), review={"summary": "bad", "findings": [
        {"severity": "high", "title": "Window is one short", "detail": "size - 1 drops an item", "file": "seq.py", "line": 6}]})
    (tmp_path / "range").mkdir()
    r = calibration.run_case(CASES["off_by_one_window"], tmp_path / "range", model="sonnet", exe=FAKE)
    assert r["caught"] and r["high_caught"] and r["category"] == "off_by_one"
    call = [json.loads(x) for x in log.read_text().splitlines() if '"--json-schema"' in x][-1]
    argv = call["argv"]
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep" and "--resume" not in argv
    assert "independent code reviewer" in argv[argv.index("--append-system-prompt") + 1]
    assert argv[argv.index("--model") + 1] == "sonnet"
    assert not Path(call["cwd"]).exists()                                       # the pinned checkout is removed afterwards


def test_run_case_marks_an_unusable_review_instead_of_scoring_it_as_a_miss_silently(tmp_path, monkeypatch):
    configure(monkeypatch, review=None)
    (tmp_path / "r").mkdir()
    r = calibration.run_case(CASES["clean_docstring"], tmp_path / "r", model=None, exe=FAKE)
    sc = calibration.scorecard([r])
    assert r["error"] and sc["incomplete"] == [r["id"]]
    assert sc["controls"] == 0 and sc["false_alarm_rate"] is None             # an unfinished review is not counted either way


def test_run_range_runs_every_case_and_reports_a_scorecard(monkeypatch):
    configure(monkeypatch, review={"summary": "fine", "findings": []})
    seen = []
    out = calibration.run_range("opus", exe=FAKE, on_result=seen.append)
    assert len(out["results"]) == len(seen) == len(calibration.CASES)
    sc = out["scorecard"]
    assert sc["catch_rate"] == 0.0 and sc["false_alarm_rate"] == 0.0           # an empty reviewer misses every bug and never cries wolf
    assert len(sc["missed"]) == sc["bugs"] and out["model"] == "opus"


def test_api_serves_the_saved_scorecard_and_never_starts_a_review(client, app, monkeypatch):
    calls = []
    monkeypatch.setattr(calibration, "run_range", lambda *a, **k: calls.append(1))
    empty = client.get(f"{V}/calibration").json()
    assert empty["available"] is False and empty["cases"] == len(calibration.CASES) and "run_calibration.py" in empty["how"]
    settings = app.state.settings
    calibration.save(settings, {"model": "opus", "at": "t", "results": [], "scorecard": {"catch_rate": 0.5}})
    got = client.get(f"{V}/calibration").json()
    assert got["available"] is True and got["scorecard"]["catch_rate"] == 0.5 and got["model"] == "opus"
    assert calls == []                                                          # reading a scorecard costs nothing
    assert client.post(f"{V}/calibration").status_code in (404, 405)            # there is no way to start one over HTTP
