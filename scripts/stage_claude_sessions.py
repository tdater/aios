"""Copy chosen Claude Code sessions into AIOS's approved import folder. You run this; AIOS never browses your Claude folder.

    .venv\\Scripts\\python.exe scripts\\stage_claude_sessions.py --list
    .venv\\Scripts\\python.exe scripts\\stage_claude_sessions.py --project <name> --limit 5 [--dry-run]

--list shows project folder names with file counts and sizes (it does not open any session file).
--project copies the newest N *.jsonl sessions of exactly one project into <approved>/claude-code/<project>/.
Sessions may contain secrets: AIOS redacts what it recognises and holds those files back, but start small.
Override the source with AIOS_CLAUDE_PROJECTS (default: ~/.claude/projects).
"""
import argparse
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps" / "api"))


def projects_root() -> Path:
    return Path(os.environ.get("AIOS_CLAUDE_PROJECTS") or Path.home() / ".claude" / "projects")


def _sessions(folder: Path) -> list[Path]:
    """Regular .jsonl files only (symlinks and anything else are ignored)."""
    return [p for p in folder.glob("*.jsonl") if p.is_file() and not p.is_symlink()]


def list_projects(src: Path) -> list[dict]:
    out = []
    if not src.is_dir():
        return out
    for d in sorted(p for p in src.iterdir() if p.is_dir() and not p.is_symlink()):
        files = _sessions(d)
        if files:
            out.append({"name": d.name, "files": len(files), "bytes": sum(f.stat().st_size for f in files),
                        "newest": datetime.fromtimestamp(max(f.stat().st_mtime for f in files)).strftime("%Y-%m-%d")})
    return out


def stage(src: Path, project: str, limit: int, approved: Path, dry_run: bool = False) -> list[str]:
    """Copy up to `limit` newest sessions of one project. Returns the relative paths copied (or that would be)."""
    if not project or project in (".", "..") or "/" in project or "\\" in project or os.sep in project:
        raise ValueError("project must be a single folder name from --list")
    folder = src / project
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError(f"no such project: {project}")
    if limit < 1 or limit > 200:
        raise ValueError("limit must be between 1 and 200")
    dest = approved / "claude-code" / project
    copied = []
    for f in sorted(_sessions(folder), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        target = dest / f.name
        if target.exists() and target.stat().st_size == f.stat().st_size:
            continue                                                   # already staged
        copied.append(f"claude-code/{project}/{f.name}")
        if not dry_run:
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, target)
    return copied


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list project folders (names, counts, sizes only)")
    ap.add_argument("--project", help="exact folder name from --list")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    src = projects_root()
    if args.list:
        rows = list_projects(src)
        if not rows:
            print(f"no projects with sessions under {src}")
        for r in rows:
            print(f"{r['name']}\t{r['files']} file(s)\t{r['bytes'] / 1e6:.1f} MB\tnewest {r['newest']}")
        return 0
    if not args.project:
        ap.print_usage(sys.stderr)
        return 2
    from aios.config import load_settings
    settings = load_settings()
    try:
        done = stage(src, args.project, args.limit, settings.approved_dir, args.dry_run)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(f"{'would copy' if args.dry_run else 'copied'} {len(done)} session(s) to {settings.approved_dir / 'claude-code' / args.project}")
    for d in done:
        print(f"  {d}")
    if done and not args.dry_run:
        print("Next: open AIOS, Settings > Imported history, press 'Review new sessions'.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
