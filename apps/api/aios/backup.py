"""Backups of private runtime state (DB snapshot + vault + artifacts). Restore targets a
caller-chosen directory and never overwrites the live state directory."""
from __future__ import annotations

import json
import shutil
import sqlite3
import zipfile
from pathlib import Path

from .config import Settings
from .db import Database
from .security import is_within
from .util import now, sha256_file


def create_backup(settings: Settings, db: Database) -> dict:
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = now().replace(":", "").replace(".", "-").replace("+0000", "Z")[:19]
    out = settings.backups_dir / f"aios-backup-{stamp}.zip"
    snap = settings.backups_dir / f".snap-{stamp}.sqlite"
    src = db.connect()
    try:
        dst = sqlite3.connect(snap)
        src.backup(dst)  # consistent online snapshot, WAL-safe
        dst.close()
    finally:
        src.close()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(snap, "db/aios.sqlite")
        for sub in ("vault", "artifacts"):
            base = settings.state_dir / sub
            for p in base.rglob("*") if base.exists() else []:
                if p.is_file() and not p.is_symlink():
                    z.write(p, f"{sub}/{p.relative_to(base).as_posix()}")
        z.writestr("MANIFEST.json", json.dumps({"created": now(), "format": 1}))
    snap.unlink(missing_ok=True)
    return {"path": str(out), "bytes": out.stat().st_size, "sha256": sha256_file(out)}


def latest_backup(settings: Settings) -> dict | None:
    files = sorted(settings.backups_dir.glob("aios-backup-*.zip")) if settings.backups_dir.exists() else []
    if not files:
        return None
    f = files[-1]
    return {"path": str(f), "bytes": f.stat().st_size, "modified": f.stat().st_mtime}


def restore_backup(zip_path: Path, target: Path, settings: Settings) -> Path:
    target = Path(target).resolve()
    if is_within(settings.state_dir, target) or is_within(target, settings.state_dir):
        raise ValueError("restore target must be separate from the live state directory")
    if target.exists() and any(target.iterdir()):
        raise ValueError("restore target must be empty")
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            dest = (target / name).resolve()
            if not is_within(target, dest):
                raise ValueError(f"unsafe path in archive: {name}")
        z.extractall(target)
    return target
