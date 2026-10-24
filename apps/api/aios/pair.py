"""Print a one-time pairing code (run on the trusted desktop): python -m aios.pair"""
from __future__ import annotations

from . import auth
from .config import load_settings
from .db import Database


def main() -> None:
    s = load_settings()
    s.ensure_dirs()
    db = Database(s.db_path)
    db.migrate(s.backups_dir)
    c = auth.new_pairing_code(db)
    print(f"Pairing code: {c['code']}   (valid until {c['expires_at']}, single use)")


if __name__ == "__main__":
    main()
