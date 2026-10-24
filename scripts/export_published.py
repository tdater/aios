"""Write the owner-approved "published" notes to a folder OUTSIDE the repository, ready to curate into the website.

Only notes tagged `publish` AND status `approved` are exported (see memory.published). Each becomes <slug>.md with
frontmatter, plus index.json. Nothing is uploaded or deployed; copying the files anywhere is a separate, deliberate step.

    .venv\\Scripts\\python.exe scripts\\export_published.py [--out DIR]
"""
import argparse
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps" / "api"))
from aios import memory  # noqa: E402
from aios.config import load_settings  # noqa: E402
from aios.db import Database  # noqa: E402


def write_bundle(result: dict, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.md"):                       # the folder mirrors the current published set exactly
        old.unlink()
    written = []
    for it in result["items"]:
        front = ["---", f"title: {json.dumps(it['title'])}", f"type: {it['type']}", f"date: {it['created_at'][:10]}",
                 f"tags: {json.dumps(it['tags'])}", "---", ""]
        path = out / f"{it['slug']}.md"
        path.write_text("\n".join(front) + it["body"].rstrip() + "\n", encoding="utf-8")
        written.append(path)
    index = [{k: it[k] for k in ("slug", "title", "type", "tags", "created_at")} for it in result["items"]]
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return written


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
