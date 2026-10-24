"""SQLite access with forward-only, checksummed migrations."""
from __future__ import annotations

import hashlib
import shutil
import sqlite3
from contextlib import contextmanager
from importlib import resources
from pathlib import Path

from .util import now


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA busy_timeout=30000")
        return con

    @contextmanager
    def tx(self):
        con = self.connect()
        try:
            con.execute("BEGIN IMMEDIATE")
            yield con
            con.execute("COMMIT")
        except BaseException:
            con.execute("ROLLBACK")
            raise
        finally:
            con.close()

    def query(self, sql: str, params=()) -> list[dict]:
        con = self.connect()
        try:
            return [dict(r) for r in con.execute(sql, params).fetchall()]
        finally:
            con.close()

    def one(self, sql: str, params=()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params=()) -> int:
        with self.tx() as con:
            return con.execute(sql, params).rowcount

    # ---- migrations ----
    def migrate(self, backup_dir: Path | None = None) -> list[str]:
        migrations = sorted(
            (p for p in resources.files("aios.migrations").iterdir() if p.name.endswith(".sql")),
            key=lambda p: p.name)
        con = self.connect()
        try:
            con.execute("CREATE TABLE IF NOT EXISTS schema_migrations ("
                        "version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)")
            applied = {r["version"]: r["checksum"] for r in
                       con.execute("SELECT version, checksum FROM schema_migrations")}
        finally:
            con.close()
        pending, done = [], []
        for m in migrations:
            sql = m.read_text(encoding="utf-8")
            ver, ck = m.name[:-4], hashlib.sha256(sql.encode()).hexdigest()
            if ver in applied:
                if applied[ver] != ck:
                    raise RuntimeError(f"Migration {ver} was modified after being applied. "
                                       "Migrations are immutable; add a new one.")
                continue
            pending.append((ver, sql, ck))
        if pending and applied and backup_dir:
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.path, backup_dir / f"pre-migrate-{now().replace(':', '')}.sqlite")
        for ver, sql, ck in pending:
            con = self.connect()
            try:
                con.execute("BEGIN IMMEDIATE")
                for stmt in _split(sql):
                    con.execute(stmt)
                con.execute("INSERT INTO schema_migrations VALUES (?,?,?)", (ver, ck, now()))
                con.execute("COMMIT")
            except BaseException:
                con.execute("ROLLBACK")
                raise
            finally:
                con.close()
            done.append(ver)
        return done


def _split(sql: str) -> list[str]:
    out, buf = [], ""
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        buf += line + "\n"
        if sqlite3.complete_statement(buf):
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out
