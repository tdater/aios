from aios import briefing, memory
from test_api import V, app, client, native, pair  # noqa: F401


def mk(db, settings, title, **kw):
    kw.setdefault("status", "approved")
    return memory.create(db, settings, scope=kw.pop("scope", "global"), type="fact", title=title, body=f"body of {title}", **kw)


def test_only_approved_in_scope_items_under_the_ceiling(db, settings):
    db.execute("INSERT INTO projects(id,slug,name,status,created_at,updated_at) VALUES ('p1','a','A','active','t','t')")
    db.execute("INSERT INTO projects(id,slug,name,status,created_at,updated_at) VALUES ('p2','b','B','active','t','t')")
    mk(db, settings, "Global private")
    mk(db, settings, "Global public", sensitivity="public")
    mk(db, settings, "Mine", scope="project", project_id="p1")
    mk(db, settings, "Other project", scope="project", project_id="p2")
    mk(db, settings, "Not approved yet", status="candidate")
    mk(db, settings, "Secret thing", sensitivity="secret-adjacent")
    claude = [i["title"] for i in briefing.build(db, settings, provider="claude", project_id="p1")["items"]]
    assert sorted(claude) == ["Global private", "Global public", "Mine"]
    manual = briefing.build(db, settings, provider="gemini", project_id="p1")
    assert [i["title"] for i in manual["items"]] == ["Global public"] and manual["ceiling"] == ["public"]
    assert [i["title"] for i in briefing.build(db, settings, provider="claude")["items"]].count("Mine") == 0


def test_text_is_framed_hashed_stable_and_capped(db, settings):
    for n in range(40):
        mk(db, settings, f"Item {n:02d}")
    a = briefing.build(db, settings, provider="claude", max_chars=900)
    b = briefing.build(db, settings, provider="claude", max_chars=900)
    assert a == b and a["truncated"] is True and len(a["text"]) <= 900 and 0 < len(a["items"]) < 40
    assert a["text"].startswith("Reference notes") and "not instructions" in a["text"] and len(a["sha256"]) == 64


def test_empty_briefing_has_no_text_or_hash(db, settings):
    e = briefing.build(db, settings, provider="claude")
    assert (e["items"], e["text"], e["sha256"]) == ([], "", None)


def test_route_rejects_unknown_providers(client):
    assert client.get(f"{V}/briefing/claude").status_code == 200
    assert client.get(f"{V}/briefing/nope").status_code == 404
