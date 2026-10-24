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
          "created_at", "last_reviewed_at", "superseded_by", "from_candidate")


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
        "superseded_by,created_at,last_reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET scope=excluded.scope, project_id=excluded.project_id, type=excluded.type,"
        "basis=excluded.basis, title=excluded.title, vault_path=excluded.vault_path, confidence=excluded.confidence,"
        "status=excluded.status, sensitivity=excluded.sensitivity, superseded_by=excluded.superseded_by,"
        "last_reviewed_at=excluded.last_reviewed_at",
        (meta["id"], meta["scope"], meta["project_id"], meta["type"], meta["basis"], meta["title"], vault_rel,
         meta["confidence"], meta["status"], meta["sensitivity"], meta["superseded_by"], meta["created_at"],
         meta["last_reviewed_at"]))
    rid = con.execute("SELECT rowid r FROM memories WHERE id=?", (meta["id"],)).fetchone()["r"]
    con.execute("DELETE FROM memories_fts WHERE rowid=?", (rid,))
    con.execute("INSERT INTO memories_fts(rowid,title,body) VALUES (?,?,?)", (rid, meta["title"], body))


def create(db: Database, settings: Settings, *, scope: str, type: str, title: str, body: str,
           project_id: str | None = None, basis: str = "observation", confidence: float = 0.5,
           sensitivity: str = "private", status: str = "candidate", sources: list[str] | None = None,
           from_candidate: str | None = None) -> str:
    if scope == "project" and not project_id:
        pass  # allowed: unassigned project scope, flagged by the caller
    mid = new_id("mem")
    meta = dict(id=mid, scope=scope, project_id=project_id, type=type, basis=basis, title=redact(title),
                confidence=confidence, status=status, sensitivity=sensitivity, created_at=now(),
                last_reviewed_at=now() if status == "approved" else None, superseded_by=None,
                from_candidate=from_candidate)
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
    row["evidence"] = db.query("SELECT source, created_at FROM memory_evidence WHERE memory_id=?", (mid,))
    return row


def update(db: Database, settings: Settings, mid: str, **changes) -> dict:
    """Correct a memory. Frontmatter + body are rewritten, index follows, review date is bumped."""
    cur = get(db, settings, mid)
    if not cur:
        raise KeyError(mid)
    allowed = {"title", "body", "confidence", "status", "sensitivity", "scope", "project_id", "basis"}
    bad = set(changes) - allowed
    if bad:
        raise ValueError(f"cannot change: {sorted(bad)}")
    meta = {k: cur.get(k) for k in FIELDS}
    meta["from_candidate"] = _parse(resolve_within(settings.vault_dir, cur["vault_path"])
                                    .read_text(encoding="utf-8"))[0].get("from_candidate")
    body = redact(changes.pop("body", cur["body"]))
    meta.update({k: (redact(v) if k == "title" else v) for k, v in changes.items()})
    meta["last_reviewed_at"] = now()
    path = resolve_within(settings.vault_dir, cur["vault_path"])
    path.write_text(_render(meta, body), encoding="utf-8")
    with db.tx() as con:
        _index(con, meta, cur["vault_path"], body)
    return get(db, settings, mid)


def search(db: Database, q: str, *, scope: str | None = None, project_id: str | None = None,
           type: str | None = None, status: str | None = None, limit: int = 20) -> list[dict]:
    terms = re.findall(r"[A-Za-z0-9_]{2,}", q)
    if not terms:
        return []
    match = " OR ".join(f'"{t}"' for t in terms)
    sql = ("SELECT m.id, m.title, m.scope, m.project_id, m.type, m.status, m.confidence, "
           "snippet(memories_fts, 1, '[', ']', '…', 12) AS excerpt "
           "FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ?")
    params: list = [match]
    for col, val in (("scope", scope), ("project_id", project_id), ("type", type), ("status", status)):
        if val:
            sql += f" AND m.{col}=?"
            params.append(val)
    sql += " ORDER BY bm25(memories_fts) LIMIT ?"
    params.append(limit)
    return db.query(sql, tuple(params))


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
