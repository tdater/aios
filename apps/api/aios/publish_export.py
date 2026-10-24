"""Write the published-notes bundle (see memory.published) to a folder. Never uploads or deploys anything."""
from __future__ import annotations

import json
from pathlib import Path


def write_bundle(result: dict, out: Path) -> list[Path]:
    """<slug>.md with frontmatter for each note plus index.json. The folder mirrors the current published set exactly."""
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.md"):
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
