"""Durable memory. The markdown vault file is canonical for text AND metadata (frontmatter);
SQLite rows + FTS are a rebuildable index. Nothing here treats note text as instructions."""
from __future__ import annotations

import json
import re
from pathlib import Path

from .config import Settings
from .db import Database
from .security import redact, resolve_within
from .util import new_id, now

TYPE_DIR = {"preference": "preferences", "fact": "facts", "decision": "decisions",
            "lesson": "lessons", "procedure": "procedures"}
FIELDS = ("id", "scope", "project_id", "type", "basis", "title", "confidence", "status", "sensitivity",
          "created_at", "last_reviewed_at", "superseded_by", "from_candidate", "tags")

# ---- Obsidian-style tags and [[wiki links]] (derived from the canonical markdown) ----
_FENCE = re.compile(r"```.*?```|`[^`\n]*`", re.S)
_INLINE_TAG = re.compile(r"(?<![\w&/#])#([A-Za-z][\w/-]{0,39})")
_WIKI = re.compile(r"\[\[([^\[\]|#\n]{1,120})(?:#[^\[\]|\n]*)?(?:\|[^\[\]\n]*)?\]\]")
_HEXISH = re.compile(r"^[0-9a-fA-F]{3,8}$")
MAX_TAGS = 30


def normalize_tag(t: str) -> str | None:
    t = re.sub(r"\s+", "-", str(t).strip().lstrip("#").lower())
    t = re.sub(r"[^a-z0-9_/-]", "", t).strip("/-")
    return t[:40] if re.match(r"^[a-z][a-z0-9_/-]*$", t or "") else None


def normalize_tags(tags) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        n = normalize_tag(t)
        if n and n not in out:
            out.append(n)
    return out[:MAX_TAGS]


def inline_tags(body: str) -> list[str]:
    """#tags written in the note text (not inside code, not headings, not hex colours)."""
    text = _FENCE.sub(" ", body)
    found = [m.group(1) for m in _INLINE_TAG.finditer(text) if not _HEXISH.match(m.group(1))]
    return normalize_tags(found)


def merged_tags(explicit, body: str) -> list[str]:
    return normalize_tags(list(normalize_tags(explicit)) + inline_tags(body))[:MAX_TAGS]


def extract_links(body: str) -> list[str]:
    """Targets of [[wiki links]] in order of appearance (code spans ignored), de-duplicated."""
    seen: list[str] = []
    for m in _WIKI.finditer(_FENCE.sub(" ", body)):
        t = m.group(1).strip()
        if t and t not in seen:
            seen.append(t)
    return seen


def _render(meta: dict, body: str) -> str:
    head = "\n".join(f"{k}: {json.dumps(meta.get(k), ensure_ascii=False)}" for k in FIELDS)
    return f"---\naios_memory: true\n{head}\n---\n\n{body.strip()}\n"


def _parse(text: str) -> tuple[dict, str]:
    m = re.match(r"---\n(.*?)\n---\n\n?(.*)\Z", text, re.S)
    if not m:
        raise ValueError("no frontmatter")
    meta = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(": ")
        meta[k] = json.loads(v) if v else None
    if not meta.get("aios_memory"):
        raise ValueError("not an AIOS memory file")
    return meta, m.group(2).strip()


def _path(settings: Settings, mtype: str, mid: str) -> Path:
    return resolve_within(settings.vault_dir, f"{TYPE_DIR[mtype]}/{mid}.md")


def _index(con, meta: dict, vault_rel: str, body: str) -> None:
    con.execute(
        "INSERT INTO memories(id,scope,project_id,type,basis,title,vault_path,confidence,status,sensitivity,"
        "superseded_by,created_at,last_reviewed_at,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, project_id=excluded.project_id, type=excluded.type,"
        "basis=excluded.basis, title=excluded.title, vault_path=excluded.vault_path, confidence=excluded.confidence,"
        "status=excluded.status, sensitivity=excluded.sensitivity, superseded_by=excluded.superseded_by,"
        "last_reviewed_at=excluded.last_reviewed_at, tags_json=excluded.tags_json",
        (meta["id"], meta["scope"], meta["project_id"], meta["type"], meta["basis"], meta["title"], vault_rel,
         meta["confidence"], meta["status"], meta["sensitivity"], meta["superseded_by"], meta["created_at"],
         meta["last_reviewed_at"], json.dumps(merged_tags(meta.get("tags"), body))))
    rid = con.execute("SELECT rowid r FROM memories WHERE id=?", (meta["id"],)).fetchone()["r"]
    con.execute("DELETE FROM memories_fts WHERE rowid=?", (rid,))
    con.execute("INSERT INTO memories_fts(rowid,title,body) VALUES (?,?,?)", (rid, meta["title"], body))


def create(db: Database, settings: Settings, *, scope: str, type: str, title: str, body: str,
           project_id: str | None = None, basis: str = "observation", confidence: float = 0.5,
           sensitivity: str = "private", status: str = "candidate", sources: list[str] | None = None,
           from_candidate: str | None = None, tags: list[str] | None = None) -> str:
    if scope == "project" and not project_id:
        pass  # allowed: unassigned project scope, flagged by the caller
    mid = new_id("mem")
    meta = dict(id=mid, scope=scope, project_id=project_id, type=type, basis=basis, title=redact(title),
                confidence=confidence, status=status, sensitivity=sensitivity, created_at=now(),
                last_reviewed_at=now() if status == "approved" else None, superseded_by=None,
                from_candidate=from_candidate, tags=normalize_tags(tags))
    body = redact(body)
    path = _path(settings, type, mid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_render(meta, body), encoding="utf-8")
    with db.tx() as con:
        _index(con, meta, path.relative_to(settings.vault_dir).as_posix(), body)
        for s in sources or []:
            con.execute("INSERT INTO memory_evidence(id,memory_id,source,created_at) VALUES (?,?,?,?)",
                        (new_id("mev"), mid, s, now()))
    return mid


def get(db: Database, settings: Settings, mid: str) -> dict | None:
    row = db.one("SELECT * FROM memories WHERE id=?", (mid,))
    if not row:
        return None
    meta, body = _parse(resolve_within(settings.vault_dir, row["vault_path"]).read_text(encoding="utf-8"))
    row["body"] = body
    row["tags"] = json.loads(row.pop("tags_json", "[]") or "[]")          # explicit + inline, for filtering/display
    row["explicit_tags"] = normalize_tags(meta.get("tags"))               # what the frontmatter really holds
    row["evidence"] = db.query("SELECT source, created_at FROM memory_evidence WHERE memory_id=?", (mid,))
    return row


def update(db: Database, settings: Settings, mid: str, **changes) -> dict:
    """Correct a memory. Frontmatter + body are rewritten, index follows, review date is bumped."""
    cur = get(db, settings, mid)
    if not cur:
        raise KeyError(mid)
    allowed = {"title", "body", "confidence", "status", "sensitivity", "scope", "project_id", "basis", "tags"}
    bad = set(changes) - allowed
    if bad:
        raise ValueError(f"cannot change: {sorted(bad)}")
    meta = {k: cur.get(k) for k in FIELDS}
    meta["tags"] = cur["explicit_tags"]
    meta["from_candidate"] = _parse(resolve_within(settings.vault_dir, cur["vault_path"])
                                    .read_text(encoding="utf-8"))[0].get("from_candidate")
    body = redact(changes.pop("body", cur["body"]))
    if "tags" in changes:
        changes["tags"] = normalize_tags(changes["tags"])
    meta.update({k: (redact(v) if k == "title" else v) for k, v in changes.items()})
    meta["last_reviewed_at"] = now()
    path = resolve_within(settings.vault_dir, cur["vault_path"])
    path.write_text(_render(meta, body), encoding="utf-8")
    with db.tx() as con:
        _index(con, meta, cur["vault_path"], body)
    return get(db, settings, mid)


def search(db: Database, q: str, *, scope: str | None = None, project_id: str | None = None,
           type: str | None = None, status: str | None = None, tag: str | None = None, limit: int = 20) -> list[dict]:
    terms = re.findall(r"[A-Za-z0-9_]{2,}", q)
    if not terms:
        return []
    match = " OR ".join(f'"{t}"' for t in terms)
    sql = ("SELECT m.id, m.title, m.scope, m.project_id, m.type, m.status, m.confidence, m.tags_json, "
           "snippet(memories_fts, 1, '[', ']', '…', 12) AS excerpt "
           "FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ?")
    params: list = [match]
    for col, val in (("scope", scope), ("project_id", project_id), ("type", type), ("status", status)):
        if val:
            sql += f" AND m.{col}=?"
            params.append(val)
    t = normalize_tag(tag) if tag else None
    if t:
        sql += " AND m.tags_json LIKE ?"
        params.append(f'%"{t}"%')
    sql += " ORDER BY bm25(memories_fts) LIMIT ?"
    params.append(limit)
    rows = db.query(sql, tuple(params))
    for r in rows:
        r["tags"] = json.loads(r.pop("tags_json", "[]") or "[]")
    return rows


def forget(db: Database, settings: Settings, mid: str) -> None:
    row = db.one("SELECT vault_path FROM memories WHERE id=?", (mid,))
    if not row:
        raise KeyError(mid)
    resolve_within(settings.vault_dir, row["vault_path"]).unlink(missing_ok=True)
    with db.tx() as con:
        rid = con.execute("SELECT rowid r FROM memories WHERE id=?", (mid,)).fetchone()["r"]
        con.execute("DELETE FROM memories_fts WHERE rowid=?", (rid,))
        con.execute("DELETE FROM memory_evidence WHERE memory_id=?", (mid,))
        con.execute("UPDATE candidates SET memory_id=NULL WHERE memory_id=?", (mid,))
        con.execute("UPDATE memories SET superseded_by=NULL WHERE superseded_by=?", (mid,))
        con.execute("DELETE FROM memories WHERE id=?", (mid,))


def export_all(db: Database, settings: Settings) -> list[dict]:
    return [get(db, settings, r["id"]) for r in db.query("SELECT id FROM memories ORDER BY created_at")]


def rebuild_index(db: Database, settings: Settings) -> dict:
    """The vault is canonical: wipe the index and rebuild it from the markdown files."""
    with db.tx() as con:
        con.execute("DELETE FROM memories_fts")
        con.execute("UPDATE candidates SET memory_id=NULL")
        con.execute("DELETE FROM memory_evidence")
        con.execute("DELETE FROM memories")
    n, skipped = 0, []
    for d in TYPE_DIR.values():
        for f in sorted((settings.vault_dir / d).glob("*.md")):
            try:
                meta, body = _parse(f.read_text(encoding="utf-8"))
            except (ValueError, json.JSONDecodeError):
                skipped.append(f.name)
                continue
            with db.tx() as con:
                _index(con, meta, f.relative_to(settings.vault_dir).as_posix(), body)
                if meta.get("from_candidate"):
                    con.execute("UPDATE candidates SET memory_id=? WHERE id=?", (meta["id"], meta["from_candidate"]))
            n += 1
    return {"indexed": n, "skipped_not_memory_files": skipped}


# ---------------------------------------------------------------- tags, links, graph (all derived from the vault)
def all_tags(db: Database) -> list[dict]:
    counts: dict[str, int] = {}
    for r in db.query("SELECT tags_json FROM memories WHERE status<>'rejected'"):
        for t in json.loads(r["tags_json"] or "[]"):
            counts[t] = counts.get(t, 0) + 1
    return [{"tag": t, "count": c} for t, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]


def _notes(db: Database, settings: Settings) -> dict[str, dict]:
    """id -> row + body. Reads the vault files; fine at personal scale (hundreds of notes)."""
    out: dict[str, dict] = {}
    for r in db.query("SELECT id,title,vault_path,status,type,scope,project_id,tags_json,superseded_by,created_at "
                      "FROM memories ORDER BY created_at, id"):
        try:
            _, body = _parse(resolve_within(settings.vault_dir, r["vault_path"]).read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            body = ""
        out[r["id"]] = {**r, "body": body}
    return out


def _title_index(notes: dict[str, dict]) -> dict[str, str]:
    idx: dict[str, str] = {}
    for nid, n in notes.items():
        idx.setdefault(n["title"].casefold(), nid)           # first (oldest) note wins on duplicate titles
    return idx


def _resolve(target: str, notes: dict[str, dict], titles: dict[str, str]) -> str | None:
    return target if target in notes else titles.get(target.casefold())


def _context(body: str, target: str) -> str:
    for line in body.splitlines():
        if f"[[{target}" in line:
            return re.sub(r"\s+", " ", line).strip()[:160]
    return ""


def links(db: Database, settings: Settings, mid: str) -> dict:
    """Outgoing [[links]], backlinks, unresolved links and unlinked mentions for one note."""
    notes = _notes(db, settings)
    if mid not in notes:
        raise KeyError(mid)
    titles = _title_index(notes)
    me = notes[mid]
    outgoing, unresolved, seen_ids = [], [], set()
    for t in extract_links(me["body"]):
        rid = _resolve(t, notes, titles)
        if rid and rid != mid and rid not in seen_ids:      # several spellings of one link are one connection
            seen_ids.add(rid)
            outgoing.append({"target": t, "id": rid, "title": notes[rid]["title"]})
        elif not rid:
            unresolved.append(t)
    backlinks, linked = [], set()
    for oid, n in notes.items():
        if oid == mid:
            continue
        for t in extract_links(n["body"]):
            if _resolve(t, notes, titles) == mid:
                backlinks.append({"id": oid, "title": n["title"], "excerpt": _context(n["body"], t)})
                linked.add(oid)
                break
    mentions = []
    needle = me["title"].casefold()
    if len(needle) >= 4:
        for oid, n in notes.items():
            if oid != mid and oid not in linked and needle in _FENCE.sub(" ", n["body"]).casefold():
                mentions.append({"id": oid, "title": n["title"]})
    return {"id": mid, "outgoing": outgoing, "backlinks": backlinks, "unresolved": unresolved,
            "unlinked_mentions": mentions}


def graph(db: Database, settings: Settings, *, include_tags: bool = False, include_candidates: bool = False,
          include_unresolved: bool = True, limit: int = 400) -> dict:
    """Nodes/edges for the graph view. Deterministic order so layouts are reproducible."""
    notes = _notes(db, settings)
    titles = _title_index(notes)
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def node(nid, kind, label, **extra):
        nodes.setdefault(nid, {"id": nid, "kind": kind, "label": label, **extra})

    projects = {p["id"]: p["name"] for p in db.query("SELECT id, name FROM projects")}
    for nid, n in notes.items():
        node(nid, "memory", n["title"], type=n["type"], status=n["status"], scope=n["scope"])
        if n["project_id"] in projects:
            node(f"project:{n['project_id']}", "project", projects[n["project_id"]])
            edges.append({"source": nid, "target": f"project:{n['project_id']}", "kind": "scope"})
        if n["superseded_by"] in notes:
            edges.append({"source": n["superseded_by"], "target": nid, "kind": "supersedes"})
        linked: set[str] = set()
        for t in extract_links(n["body"]):
            rid = _resolve(t, notes, titles)
            if rid and rid != nid and rid not in linked:
                linked.add(rid)
                edges.append({"source": nid, "target": rid, "kind": "link"})
            elif not rid and include_unresolved and f"ghost:{t.casefold()}" not in linked:
                gid = f"ghost:{t.casefold()}"
                linked.add(gid)
                node(gid, "unresolved", t)
                edges.append({"source": nid, "target": gid, "kind": "link"})
        if include_tags:
            for t in json.loads(n["tags_json"] or "[]"):
                node(f"tag:{t}", "tag", f"#{t}")
                edges.append({"source": nid, "target": f"tag:{t}", "kind": "tagged"})
    if include_candidates:
        for c in db.query("SELECT id,title,status,type,memory_id FROM candidates "
                          "WHERE status IN ('candidate','approved','deferred') ORDER BY created_at LIMIT 200"):
            node(f"cand:{c['id']}", "candidate", c["title"], type=c["type"], status=c["status"])
            if c["memory_id"] in notes:
                edges.append({"source": f"cand:{c['id']}", "target": c["memory_id"], "kind": "promoted_to"})
    degree: dict[str, int] = {}
    for e in edges:
        for k in ("source", "target"):
            degree[e[k]] = degree.get(e[k], 0) + 1
    truncated = len(nodes) > limit
    if truncated:
        keep = {nid for nid, _ in sorted(nodes.items(), key=lambda kv: (-degree.get(kv[0], 0), kv[0]))[:limit]}
        nodes = {k: v for k, v in nodes.items() if k in keep}
        edges = [e for e in edges if e["source"] in keep and e["target"] in keep]
    for nid, n in nodes.items():
        n["degree"] = degree.get(nid, 0)
    return {"nodes": sorted(nodes.values(), key=lambda n: n["id"]), "edges": edges, "truncated": truncated}
