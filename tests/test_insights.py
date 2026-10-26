"""Constellation and Skyline: every number comes from a stored fact (memories, context_supplied, AIOS-run verification)."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from aios import constellation, memory, overview
from test_api import V, app, client, native, pair  # noqa: F401

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
ISO = lambda d: (NOW - timedelta(days=d)).isoformat()   # noqa: E731


def seed(db, settings):
    db.execute("INSERT INTO projects(id,slug,name,status,created_at,updated_at) VALUES ('p1','calc','Calc','active',?,?)", (ISO(9), ISO(9)))
    db.execute("INSERT INTO projects(id,slug,name,status,created_at,updated_at) VALUES ('p2','blog','Blog','active',?,?)", (ISO(9), ISO(9)))
    db.execute("INSERT INTO workspaces(id,project_id,path,registered_at) VALUES ('w1','p1','/x/calc',?)", (ISO(9),))
    db.execute("INSERT INTO conversations(id,project_id,workspace_id,title,created_at,updated_at) VALUES ('c1','p1','w1','Fix add',?,?)", (ISO(5), ISO(5)))
    for rid, state in (("r1", "succeeded"), ("r2", "succeeded"), ("r3", "running"), ("r4", "awaiting_approval")):
        db.execute("INSERT INTO tasks(id,project_id,title,kind,created_at,updated_at) VALUES (?,?,?,?,?,?)", ("t" + rid, "p1", "x", "claude.turn", ISO(5), ISO(5)))
        db.execute("INSERT INTO runs(id,task_id,state,created_at,updated_at) VALUES (?,?,?,?,?)", (rid, "t" + rid, state, ISO(5), ISO(5)))
    for seq, (rid, passed, head) in enumerate((("r1", True, "aaa111"), ("r2", False, "bbb222")), 1):
        db.execute("INSERT INTO conversation_messages(id,conversation_id,seq,role,author_kind,author,kind,content,run_id,meta_json,created_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (f"m{seq}", "c1", seq, "system", "aios", "aios", "verification", "v", rid,
                                                       json.dumps({"passed": passed, "head_revision": head}), ISO(4)))
    mk = lambda title, **kw: memory.create(db, settings, scope="global", type="lesson", title=title, body="b", status="approved", **kw)  # noqa: E731
    ids = {"bright": mk("Use pytest -x"), "hollow": mk("Prefer small diffs"), "unused": mk("Never touch .env"),
           "secret": mk("Server password hint", sensitivity="secret-adjacent")}
    for mid, rid, days in ((ids["bright"], "r1", 3), (ids["hollow"], "r2", 3)):
        db.execute("INSERT INTO context_supplied(id,conversation_id,run_id,item_kind,item_ref,item_version,item_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)",
                   (f"x{mid}", "c1", rid, "memory", mid, "1", "h", ISO(days)))
    return ids


def test_stars_are_derived_from_use_and_verification(db, settings):
    ids = seed(db, settings)
    c = constellation.build(db, now=NOW)
    s = {x["id"]: x for x in c["stars"]}
    assert (s[ids["bright"]]["uses"], s[ids["bright"]]["verified_uses"], s[ids["bright"]]["hollow"]) == (1, 1, False)
    assert (s[ids["hollow"]]["uses"], s[ids["hollow"]]["verified_uses"], s[ids["hollow"]]["hollow"]) == (1, 0, True)
    assert s[ids["unused"]]["uses"] == 0 and not s[ids["unused"]]["hollow"]
    assert s[ids["bright"]]["brightness"] > s[ids["hollow"]]["brightness"] > s[ids["unused"]]["brightness"]
    assert s[ids["secret"]]["title"] == "(private item)"
    assert c["totals"] == {"stars": 4, "verified": 1, "hollow": 1, "stale": 0}


def test_brightness_decays_with_time_and_returns_on_a_new_verified_use():
    fresh, old = constellation.brightness(1, 1, 0), constellation.brightness(1, 1, 120)
    assert fresh > old >= 0.2
    assert old > constellation.brightness(0, 1, None)             # a long-faded verified star still outshines a never-verified one
    assert constellation.brightness(3, 3, 0) > fresh
    assert constellation.brightness(0, 0, None) < constellation.brightness(0, 2, None) < fresh


def test_states_stale_candidate_and_superseded(db, settings):
    old = memory.create(db, settings, scope="global", type="fact", title="Old", body="b", status="approved")
    new = memory.create(db, settings, scope="global", type="fact", title="New", body="b", status="approved")
    cand = memory.create(db, settings, scope="global", type="fact", title="Maybe", body="b", status="candidate")
    db.execute("UPDATE memories SET last_reviewed_at=? WHERE id=?", (ISO(200), new))
    db.execute("UPDATE memories SET status='superseded', superseded_by=? WHERE id=?", (new, old))
    c = constellation.build(db, now=NOW)
    st = {x["id"]: x["state"] for x in c["stars"]}
    assert st == {old: "superseded", new: "stale", cand: "candidate"}
    assert c["links"] == [{"kind": "supersedes", "from": new, "to": old}]
    assert next(x for x in c["stars"] if x["id"] == cand)["brightness"] <= 0.1


def test_evidence_lists_each_use_and_whether_it_was_verified(db, settings):
    ids = seed(db, settings)
    ev = constellation.evidence(db, ids["bright"])
    assert ev["total_uses"] == 1 and ev["verified_uses"] == 1
    assert ev["uses"][0]["conversation"] == "Fix add" and ev["uses"][0]["verified"] is True
    assert constellation.evidence(db, ids["hollow"])["uses"][0]["verified"] is False
    assert constellation.evidence(db, "mem_nope") is None


def test_skyline_counts_verified_floors_and_who_is_busy(db, settings):
    seed(db, settings)
    sky = overview.skyline(db)
    by = {b["name"]: b for b in sky["projects"]}
    assert (by["Calc"]["floors"], by["Calc"]["working"], by["Calc"]["waiting"], by["Calc"]["conversations"]) == (1, 1, 1, 1)
    assert (by["Blog"]["floors"], by["Blog"]["working"], by["Blog"]["waiting"]) == (0, 0, 0)
    assert sky["totals"] == {"projects": 2, "floors": 1, "waiting": 1}


def test_the_same_revision_verified_twice_is_one_floor(db, settings):
    seed(db, settings)
    db.execute("INSERT INTO conversation_messages(id,conversation_id,seq,role,author_kind,author,kind,content,run_id,meta_json,created_at) "
               "VALUES ('m9','c1',9,'system','aios','aios','verification','v','r1',?,?)", (json.dumps({"passed": True, "head_revision": "aaa111"}), ISO(1)))
    assert {b["name"]: b["floors"] for b in overview.skyline(db)["projects"]}["Calc"] == 1


def test_http_routes_answer_for_a_paired_device(client):
    assert client.get(f"{V}/constellation").status_code == 200
    assert client.get(f"{V}/skyline").json()["projects"] == []
    assert client.get(f"{V}/constellation/mem_missing").status_code == 404
