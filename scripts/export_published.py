"""Write the owner-approved "published" notes to a folder OUTSIDE the repository, ready to curate into the website.

Only notes tagged `publish` AND status `approved` are exported (see memory.published). Each becomes <slug>.md with
frontmatter, plus index.json. Nothing is uploaded or deployed; copying the files anywhere is a separate, deliberate step.

    .venv\\Scripts\\python.exe scripts\\export_published.py [--out DIR]
"""
import argparse
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps" / "api"))
from aios import memory  # noqa: E402
from aios.config import load_settings  # noqa: E402
from aios.db import Database  # noqa: E402
from aios.publish_export import write_bundle  # noqa: E402


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=None, help="default: <state>/exports/published")
    args = ap.parse_args(argv)
    settings = load_settings()
    db = Database(settings.db_path)
    db.migrate()
    out = (args.out or settings.state_dir / "exports" / "published").resolve()
    if root in (out, *out.parents):
        print("refusing to write inside the source repository", file=sys.stderr)
        return 2
    result = memory.published(db, settings)
    files = write_bundle(result, out)
    print(f"exported {len(files)} note(s) to {out}")
    for s in result["skipped"]:
        print(f"skipped: {s['title']} - {s['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
