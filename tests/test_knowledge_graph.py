"""Obsidian-style knowledge features: tags, [[wiki links]], backlinks, unlinked mentions, graph. All derived from the vault."""
import json

import pytest

from aios import memory
from test_api import V, client, app, pair  # noqa: F401  (fixtures)


def mk(db, settings, title, body="", **kw):
    args = dict(scope="global", type="fact", title=title, body=body or f"About {title}.", status="approved")
    args.update(kw)
    return memory.create(db, settings, **args)


# ------------------------------------------------------------------ tags
def test_tags_are_normalised_and_inline_tags_are_found(db, settings):
    mid = mk(db, settings, "Build", "Use #gradle and #Android/Build. # Not a tag heading\n#ff00aa is a colour. "
             "`#in-code` stays out.\n```\n#fenced\n```\nIssue #1234 is not a tag.", tags=["Android", "build tools", "#x", "bad!!", ""])
    m = memory.get(db, settings, mid)
    assert m["explicit_tags"] == ["android", "build-tools", "x", "bad"]
    assert set(m["tags"]) == {"android", "build-tools", "x", "bad", "gradle", "android/build"}
    assert "in-code" not in m["tags"] and "fenced" not in m["tags"] and "ff00aa" not in m["tags"] and "1234" not in m["tags"]


def test_tag_changes_are_saved_in_the_vault_and_survive_an_index_rebuild(db, settings):
    mid = mk(db, settings, "Note", "Body with #inline", tags=["alpha"])
    memory.update(db, settings, mid, tags=["Beta", "alpha"])
    assert memory.get(db, settings, mid)["explicit_tags"] == ["beta", "alpha"]
    memory.rebuild_index(db, settings)                         # vault is canonical; the index is rebuilt from it
    m = memory.get(db, settings, mid)
    assert set(m["tags"]) == {"beta", "alpha", "inline"} and m["explicit_tags"] == ["beta", "alpha"]
    assert "tags:" in next((settings.vault_dir / "facts").glob("*.md")).read_text(encoding="utf-8")


def test_tag_index_counts_and_filtering(db, settings):
    mk(db, settings, "A", "alpha text", tags=["shared", "only-a"])
    mk(db, settings, "B", "beta text #shared")
    rejected = mk(db, settings, "C", "gamma text", tags=["shared"])
    memory.update(db, settings, rejected, status="rejected")
    assert memory.all_tags(db) == [{"tag": "shared", "count": 2}, {"tag": "only-a", "count": 1}]   # rejected notes don't count
    hits = memory.search(db, "text", tag="#Shared")
    assert {h["title"] for h in hits} == {"A", "B", "C"} and all("shared" in h["tags"] for h in hits)
    assert {h["title"] for h in memory.search(db, "text", tag="only-a")} == {"A"}
    assert memory.search(db, "text", tag="no-such-tag") == []


# ------------------------------------------------------------------ links
def test_links_backlinks_unresolved_and_unlinked_mentions(db, settings):
    b = mk(db, settings, "Gradle caching", "How the build cache works.")
    a = mk(db, settings, "Android build", f"See [[Gradle caching]] and [[{b}]] and [[gradle CACHING|alias]] and "
           "[[Gradle caching#Heading]] and [[Missing note]]. `[[in code]]` is ignored.")
    c = mk(db, settings, "Aside", "Mentions Gradle caching in passing but does not link it.")
    out = memory.links(db, settings, a)
    assert [o["id"] for o in out["outgoing"]] == [b]                    # all four spellings resolve to the same note, once
    assert out["unresolved"] == ["Missing note"]
    back = memory.links(db, settings, b)
    assert [x["id"] for x in back["backlinks"]] == [a] and "[[Gradle caching" in back["backlinks"][0]["excerpt"]
    assert [x["id"] for x in back["unlinked_mentions"]] == [c]          # mentioned by title, not linked yet
    with pytest.raises(KeyError):
        memory.links(db, settings, "mem_nope")


def test_self_links_are_ignored_and_duplicate_titles_resolve_to_the_oldest(db, settings):
    first = mk(db, settings, "Same title", "first")
    mk(db, settings, "Same title", "second")
    src = mk(db, settings, "Source", "[[Same title]] and [[Source]]")
    out = memory.links(db, settings, src)
    assert [o["id"] for o in out["outgoing"]] == [first]


# ------------------------------------------------------------------ graph
def test_graph_nodes_edges_ghosts_projects_supersession_tags_candidates(db, settings, project):
    old = mk(db, settings, "Old rule", "old", scope="project", project_id=project["id"])
    new = mk(db, settings, "New rule", "see [[Old rule]] and [[Ghost page]] #policy")
    memory.update(db, settings, old, status="superseded")
    db.execute("UPDATE memories SET superseded_by=? WHERE id=?", (new, old))
    db.execute("INSERT INTO candidates(id,fingerprint,type,title,scope,problem,status,memory_id,created_at,updated_at) "
               "VALUES ('cnd_1','fp','preference','A candidate','global','p','approved',?,'2026-01-01','2026-01-01')", (new,))
    g = memory.graph(db, settings)
    kinds = {n["kind"] for n in g["nodes"]}
    assert kinds == {"memory", "project", "unresolved"}
    ek = {(e["source"], e["target"], e["kind"]) for e in g["edges"]}
    assert (new, old, "link") in ek and (new, old, "supersedes") in ek
    assert (old, f"project:{project['id']}", "scope") in ek and (new, "ghost:ghost page", "link") in ek
    assert all(n["degree"] >= 1 for n in g["nodes"] if n["id"] == new)
    with_tags = memory.graph(db, settings, include_tags=True, include_candidates=True, include_unresolved=False)
    assert {"tag", "candidate"} <= {n["kind"] for n in with_tags["nodes"]} and "unresolved" not in {n["kind"] for n in with_tags["nodes"]}
    assert ("cnd_1".join(["cand:", ""]), new, "promoted_to") in {(e["source"], e["target"], e["kind"]) for e in with_tags["edges"]}
    assert memory.graph(db, settings) == g                              # deterministic: same input, same output


def test_graph_is_truncated_to_the_best_connected_nodes(db, settings):
    hub = mk(db, settings, "Hub", "x")
    for i in range(14):
        mk(db, settings, f"Leaf {i}", f"[[Hub]] #t{i}")
    g = memory.graph(db, settings, limit=10)
    assert g["truncated"] and len(g["nodes"]) == 10 and any(n["id"] == hub for n in g["nodes"])
    assert all(e["source"] in {n["id"] for n in g["nodes"]} and e["target"] in {n["id"] for n in g["nodes"]} for e in g["edges"])


# ------------------------------------------------------------------ HTTP
def test_knowledge_endpoints_over_http(client):
    a = client.post(f"{V}/memories", json={"scope": "global", "type": "fact", "title": "Alpha", "body": "links [[Beta]] #topic/sub", "tags": ["Core"]}).json()
    b = client.post(f"{V}/memories", json={"scope": "global", "type": "fact", "title": "Beta", "body": "plain"}).json()
    assert a["tags"] == ["core", "topic/sub"]
    tags = client.get(f"{V}/memories/tags").json()["items"]
    assert {t["tag"] for t in tags} == {"core", "topic/sub"}
    lk = client.get(f"{V}/memories/{b['id']}/links").json()
    assert [x["id"] for x in lk["backlinks"]] == [a["id"]]
    assert client.get(f"{V}/memories/mem_nope/links").status_code == 404
    g = client.get(f"{V}/graph", params={"tags": "true"}).json()
    assert {n["kind"] for n in g["nodes"]} == {"memory", "tag"} and g["truncated"] is False
    listed = client.get(f"{V}/memories", params={"tag": "core"}).json()["items"]
    assert [m["id"] for m in listed] == [a["id"]] and listed[0]["tags"] == ["core", "topic/sub"]
    found = client.get(f"{V}/memories", params={"q": "links", "tag": "#CORE"}).json()["items"]
    assert [m["id"] for m in found] == [a["id"]]
    patched = client.patch(f"{V}/memories/{b['id']}", json={"tags": ["New Tag"], "expected_version": b["version"]})
    assert patched.status_code == 200 and patched.json()["explicit_tags"] == ["new-tag"]


def test_knowledge_endpoints_need_a_session_and_text_stays_text(app, client):
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        for p in ("/memories/tags", "/graph", "/memories/mem_x/links"):
            assert anon.get(V + p).status_code == 401
    evil = "<img src=x onerror=alert(1)>"
    m = client.post(f"{V}/memories", json={"scope": "global", "type": "fact", "title": evil, "body": f"[[{evil}]]"}).json()
    g = client.get(f"{V}/graph").json()
    assert evil in {n["label"] for n in g["nodes"]}                     # returned verbatim as data; the client renders text only
    assert client.get(f"{V}/graph").headers["content-type"].startswith("application/json")


# ------------------------------------------------------------------ graph metadata + publishing
def test_graph_memory_nodes_carry_project_and_creation_time(db, settings):
    mk(db, settings, "Solo")
    node = next(n for n in memory.graph(db, settings)["nodes"] if n["label"] == "Solo")
    assert node["project_id"] is None and node["created_at"]


def test_only_tagged_and_approved_notes_are_published_and_links_are_flattened(db, settings):
    pub = mk(db, settings, "Public Post", "See [[Other Public]], [[Secret Plans|my plans]] and [[Secret Plans#h]].", tags=["publish", "web"])
    mk(db, settings, "Other Public", "hello", tags=["publish"])
    mk(db, settings, "Secret Plans", "do not leak", tags=["private"])
    mk(db, settings, "Draft", "unfinished", tags=["publish"], status="candidate")
    mk(db, settings, "Leaky", "token ghp_" + "a" * 36, tags=["publish"])
    out = memory.published(db, settings)
    titles = {i["title"] for i in out["items"]}
    assert titles == {"Public Post", "Other Public"}
    body = next(i for i in out["items"] if i["id"] == pub)["body"]
    assert "[[Other Public]]" in body and "[[Secret" not in body and "my plans" in body
    assert "publish" not in next(i for i in out["items"] if i["id"] == pub)["tags"]
    reasons = {s["title"]: s["reason"] for s in out["skipped"]}
    assert "not approved" in reasons["Draft"] and "secret" in reasons["(withheld)"]
    assert "Secret Plans" not in json.dumps(out["skipped"])                  # unpublished notes are not even named


def test_publish_endpoint_requires_auth_and_script_writes_bundle(app, client, tmp_path):
    from fastapi.testclient import TestClient
    with TestClient(app) as anon:
        assert anon.get(f"{V}/published").status_code in (401, 403)
    r = client.post(f"{V}/memories", json={"scope": "global", "type": "fact", "title": "Hello World", "body": "hi #publish"})
    assert r.status_code == 201
    got = client.get(f"{V}/published").json()
    assert [i["slug"] for i in got["items"]] == ["hello-world"]
    import importlib.util
    spec = importlib.util.spec_from_file_location("export_published", "scripts/export_published.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    files = mod.write_bundle(got, tmp_path / "out")
    assert files[0].read_text(encoding="utf-8").startswith('---\ntitle: "Hello World"')
    assert json.loads((tmp_path / "out" / "index.json").read_text())[0]["slug"] == "hello-world"
