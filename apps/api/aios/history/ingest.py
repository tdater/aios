"""Deterministic, resumable, idempotent ingestion of approved history sources.
Reads ONLY <state>/imports/approved. Stores REDACTED text. No model calls."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ..config import Settings
from ..db import Database
from ..security import find_secret_kinds, is_within, redact
from ..util import canonical_json, new_id, now
from . import formats

QUARANTINE_SECRET_MESSAGES = 20


def _iso(ts: str | None) -> str | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).isoformat()
    except ValueError:
        return str(ts)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Ingestor:
    def __init__(self, db: Database, settings: Settings):
        self.db, self.settings = db, settings

    def list_files(self) -> list[tuple[str, Path]]:
        root = self.settings.approved_dir
        out = []
        if not root.exists():
            return out
        for dp, dns, fns in os.walk(root, followlinks=False):
            dns[:] = [d for d in dns if not os.path.islink(Path(dp) / d)]
            for fn in sorted(fns):
                p = Path(dp) / fn
                if os.path.islink(p) or not is_within(root, p):
                    continue
                out.append((p.relative_to(root).as_posix(), p))
        return sorted(out)

    def _project_for(self, cwd: str | None) -> str | None:
        if not cwd:
            return None
        for w in self.db.query("SELECT project_id, path FROM workspaces"):
            try:
                if is_within(Path(w["path"]), Path(cwd)):
                    return w["project_id"]
            except OSError:
                continue
        return None

    def run(self, max_files: int = 200, max_seconds: float = 120,
            after_file: Callable[[str], None] | None = None) -> dict:
        t0 = time.monotonic()
        rep = {"discovered": 0, "parsed": 0, "unsupported": [], "failed": [], "duplicate": 0,
               "quarantined": 0, "unchanged": 0, "skipped_deleted": 0, "new_messages": 0,
               "duplicate_messages": 0, "limit_reached": False, "processed": 0}
        files = self.list_files()
        rep["discovered"] = len(files)
        for rel, path in files:
            if rep["processed"] >= max_files or time.monotonic() - t0 > max_seconds:
                rep["limit_reached"] = True
                break
            outcome = self._ingest_one(rel, path, rep)
            if outcome != "unchanged":
                rep["processed"] += 1
            if after_file:
                after_file(rel)
        return rep

    # ------------------------------------------------------------------
    def _ingest_one(self, rel: str, path: Path, rep: dict) -> str:
        st = path.stat()
        row = self.db.one("SELECT * FROM sources WHERE rel_path=? ORDER BY imported_at DESC", (rel,))
        if (row and row["status"] != "deleted" and row["size_bytes"] == st.st_size
                and row["mtime_ns"] == st.st_mtime_ns and row["parser_version"] in (None, formats.PARSER_VERSION)):
            rep["unchanged"] += 1
            return "unchanged"
        digest = _sha256(path)
        same = self.db.one("SELECT * FROM sources WHERE rel_path=? AND content_hash=?", (rel, digest))
        if same and same["status"] == "deleted":
            rep["skipped_deleted"] += 1
            return "skipped_deleted"
        if same and same["parser_version"] in (None, formats.PARSER_VERSION):
            self.db.execute("UPDATE sources SET mtime_ns=? WHERE id=?", (st.st_mtime_ns, same["id"]))
            rep["unchanged"] += 1
            return "unchanged"
        other = self.db.one("SELECT id FROM sources WHERE content_hash=? AND rel_path<>? AND "
                            "status IN ('parsed','quarantined')", (digest, rel))
        if other and not same:
            self._upsert_source(rel, digest, st, status="duplicate", dup_of=other["id"],
                                detail=f"identical content to {other['id']}")
            rep["duplicate"] += 1
            return "duplicate"
        try:
            parsed = formats.detect_and_parse(path)
        except formats.Unsupported as e:
            self._upsert_source(rel, digest, st, status="unsupported", kind="unsupported", detail=str(e),
                                existing=same)
            rep["unsupported"].append({"path": rel, "reason": str(e)})
            return "unsupported"
        except Exception as e:  # parser bug or corrupt file: report, keep going
            self._upsert_source(rel, digest, st, status="failed", detail=redact(f"{type(e).__name__}: {e}")[:500],
                                existing=same)
            rep["failed"].append({"path": rel, "reason": f"{type(e).__name__}"})
            return "failed"
        try:
            self._store_parsed(rel, digest, st, parsed, same, rep)
        except Exception as e:
            self._upsert_source(rel, digest, st, status="failed", detail=redact(f"{type(e).__name__}: {e}")[:500],
                                existing=same)
            rep["failed"].append({"path": rel, "reason": f"{type(e).__name__}"})
            return "failed"
        return "parsed"

    def _upsert_source(self, rel, digest, st, *, status, kind="unknown", detail="", dup_of=None, existing=None) -> str:
        with self.db.tx() as con:
            if existing:
                con.execute("UPDATE sources SET status=?, status_detail=?, mtime_ns=?, size_bytes=?, kind=?, "
                            "parser_version=? WHERE id=?",
                            (status, detail, st.st_mtime_ns, st.st_size, kind, formats.PARSER_VERSION, existing["id"]))
                return existing["id"]
            sid = new_id("src")
            con.execute("INSERT INTO sources(id,rel_path,kind,content_hash,size_bytes,mtime_ns,imported_at,"
                        "parser_version,status,status_detail,dup_of) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (sid, rel, kind, digest, st.st_size, st.st_mtime_ns, now(), formats.PARSER_VERSION,
                         status, detail, dup_of))
            return sid

    def _store_parsed(self, rel, digest, st, parsed: formats.Parsed, existing, rep) -> None:
        secret_msgs, kinds_all, rows = 0, set(), []
        nth: Counter = Counter()
        for m in parsed.messages:
            ks = find_secret_kinds(m.text)
            if ks:
                secret_msgs += 1
                kinds_all.update(ks)
            key = (m.session, m.ts, m.role, formats.norm(m.text))
            nth[key] += 1
            rows.append((m, redact(m.text), formats.fingerprint(m, nth[key] - 1),
                         int(bool(formats.INJECTION.search(m.text)))))
        quarantine = "private-key" in kinds_all or secret_msgs >= QUARANTINE_SECRET_MESSAGES
        project_id = self._project_for(parsed.cwd)
        stamps = sorted(s for s in (_iso(m.ts) for m, *_ in rows) if s)
        coverage = {"format": parsed.format, "sessions": len({m.session for m, *_ in rows}),
                    "gaps": parsed.gaps, "cwd_known": bool(parsed.cwd), "project_associated": bool(project_id)}
        with self.db.tx() as con:
            if existing:
                self._purge_messages(con, existing["id"])
                sid = existing["id"]
            else:
                sid = new_id("src")
            status = "quarantined" if quarantine else "parsed"
            detail = (f"{secret_msgs} message(s) with secret patterns; withheld from analysis"
                      if quarantine else (f"{secret_msgs} message(s) redacted" if secret_msgs else ""))
            vals = (rel, parsed.format, parsed.provider, project_id, digest, st.st_size, st.st_mtime_ns,
                    stamps[0] if stamps else None, stamps[-1] if stamps else None, now(),
                    "aios.history.formats", formats.PARSER_VERSION, status, detail,
                    0 if quarantine else len(rows),
                    "secret-adjacent" if kinds_all else "private", canonical_json(sorted(kinds_all)),
                    canonical_json(coverage))
            if existing:
                con.execute("UPDATE sources SET rel_path=?,kind=?,provider=?,project_id=?,content_hash=?,"
                            "size_bytes=?,mtime_ns=?,date_start=?,date_end=?,imported_at=?,parser=?,"
                            "parser_version=?,status=?,status_detail=?,message_count=?,sensitivity=?,"
                            "secret_kinds_json=?,coverage_json=? WHERE id=?", (*vals, sid))
            else:
                con.execute("INSERT INTO sources(rel_path,kind,provider,project_id,content_hash,size_bytes,"
                            "mtime_ns,date_start,date_end,imported_at,parser,parser_version,status,"
                            "status_detail,message_count,sensitivity,secret_kinds_json,coverage_json,id) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (*vals, sid))
            if quarantine:
                rep["quarantined"] += 1
                return
            seen: dict[str, int] = {}
            for seq, (m, text, fp, inj) in enumerate(rows):
                canon = seen.get(fp)
                if canon is None:
                    r = con.execute("SELECT id FROM messages WHERE fingerprint=? AND source_id<>? ORDER BY id LIMIT 1",
                                    (fp, sid)).fetchone()
                    canon = r["id"] if r else None
                cur = con.execute(
                    "INSERT INTO messages(source_id,session_id,seq,ts,role,kind,text,ref,fingerprint,canon_id,"
                    "injection_suspect,test_outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, m.session, seq, _iso(m.ts), m.role, m.kind, text, m.ref, fp, canon, inj, m.test_outcome))
                mid = cur.lastrowid
                if canon is None:
                    con.execute("UPDATE messages SET canon_id=id WHERE id=?", (mid,))
                    con.execute("INSERT INTO messages_fts(rowid,text) VALUES (?,?)", (mid, text))
                    seen[fp] = mid
                    rep["new_messages"] += 1
                else:
                    seen[fp] = canon
                    rep["duplicate_messages"] += 1
            con.execute("UPDATE sources SET summary_json=? WHERE id=?", (canonical_json(_summary(rows)), sid))
        rep["parsed"] += 1

    @staticmethod
    def _purge_messages(con, source_id: str) -> None:
        """Remove a source's messages; re-point dependents (duplicates in other sources) to a new canon."""
        mids = [r["id"] for r in con.execute("SELECT id FROM messages WHERE source_id=?", (source_id,))]
        for mid in mids:
            deps = [r["id"] for r in con.execute(
                "SELECT id FROM messages WHERE canon_id=? AND source_id<>? ORDER BY id", (mid, source_id))]
            if deps:
                new = deps[0]
                con.execute("UPDATE messages SET canon_id=? WHERE canon_id=? AND source_id<>?", (new, mid, source_id))
                r = con.execute("SELECT text FROM messages WHERE id=?", (new,)).fetchone()
                con.execute("INSERT OR REPLACE INTO messages_fts(rowid,text) VALUES (?,?)", (new, r["text"]))
            con.execute("DELETE FROM messages_fts WHERE rowid=?", (mid,))
        con.execute("DELETE FROM candidate_evidence WHERE source_id=?", (source_id,))
        con.execute("DELETE FROM messages WHERE source_id=?", (source_id,))

    # ------------------------------------------------------------------
    def delete_source(self, source_id: str, delete_file: bool = False) -> dict:
        src = self.db.one("SELECT * FROM sources WHERE id=?", (source_id,))
        if not src:
            raise KeyError(source_id)
        with self.db.tx() as con:
            affected = [r["candidate_id"] for r in con.execute(
                "SELECT DISTINCT candidate_id FROM candidate_evidence WHERE source_id=?", (source_id,))]
            self._purge_messages(con, source_id)
            con.execute("UPDATE sources SET status='deleted', status_detail='deleted by user', message_count=0, "
                        "summary_json='{}', coverage_json='{}' WHERE id=?", (source_id,))
        from .extract import recompute_candidate  # local import: extract depends on this package
        needs_review, orphaned = [], []
        for cid in affected:
            res = recompute_candidate(self.db, cid)
            if res["orphaned"]:
                orphaned.append(cid)
            if res["memory_id"]:
                needs_review.append({"candidate": cid, "memory": res["memory_id"]})
        removed_file = False
        if delete_file:
            p = self.settings.approved_dir / src["rel_path"]
            if p.is_file() and is_within(self.settings.approved_dir, p) and not os.path.islink(p):
                p.unlink()
                removed_file = True
        return {"source": source_id, "candidates_recomputed": len(affected), "orphaned": orphaned,
                "memories_needing_review": needs_review, "file_removed": removed_file,
                "backup_note": "Existing backups are not rewritten; deletion does not reach them."}


def _summary(rows) -> dict:
    kinds = Counter(m.kind for m, *_ in rows)
    first_user = next((t for m, t, *_ in rows if m.kind == "user_statement"), "")
    cmds = Counter(re.sub(r"\s+", " ", m.text.strip())[:80] for m, *_ in rows if m.kind == "executed_command")
    outs = [m.test_outcome for m, *_ in rows if m.kind == "test_result"]
    fail_to_pass = sum(1 for a, b in zip(outs, outs[1:]) if a == "fail" and b == "pass")
    return {"messages": len(rows), "by_kind": dict(kinds), "sessions": len({m.session for m, *_ in rows}),
            "first_user_excerpt": first_user[:160], "test_fail_to_pass": fail_to_pass,
            "top_commands": [c for c, _ in cmds.most_common(3)]}
