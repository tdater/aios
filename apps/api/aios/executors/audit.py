"""Deterministic, read-only workspace audit. No LLM, no network, no writes to the workspace.
Only the registered workspace root is walked; symlinks/junctions are counted, never followed."""
from __future__ import annotations

import json
import os
import subprocess
from collections import Counter
from pathlib import Path

from ..engine import Blocked, RunContext, executor
from ..security import find_secret_kinds, is_within

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "build", "dist", ".gradle",
             ".idea", ".next", "target", ".pytest_cache"}
MAX_FILES = 20_000
MAX_SCAN_BYTES = 1_000_000
LARGE_FILE = 5_000_000
TEXT_EXT = {".py", ".kt", ".kts", ".java", ".js", ".ts", ".tsx", ".jsx", ".json", ".xml", ".md", ".txt",
            ".yml", ".yaml", ".toml", ".gradle", ".properties", ".sh", ".ps1", ".bat", ".cfg", ".ini",
            ".env", ".html", ".css", ".sql"}
SOURCE_EXT = {".py", ".kt", ".java", ".js", ".ts", ".tsx", ".jsx", ".cs", ".go", ".rs", ".cpp", ".c"}
MARKERS = {"README": ("readme.md", "readme", "readme.txt"), "gitignore": (".gitignore",),
           "claude_md": ("claude.md",), "agents_md": ("agents.md",),
           "gradle": ("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"),
           "android_manifest": ("androidmanifest.xml",), "package_json": ("package.json",),
           "pyproject": ("pyproject.toml", "requirements.txt"), "ci": ("jenkinsfile",)}


def _git(root: Path, *args: str) -> str | None:
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    try:
        p = subprocess.run(["git", "-c", f"safe.directory={root}", "-C", str(root), *args],
                           capture_output=True, text=True, timeout=15, env=env)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def scan(ctx: RunContext, root: Path) -> dict:
    ext, markers, todos = Counter(), {}, 0
    secrets: list[dict] = []
    large, links, files, truncated, has_tests = [], 0, 0, False, False
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dp = Path(dirpath)
        keep = []
        for d in dirnames:
            full = dp / d
            if os.path.islink(full) or _is_junction(full):
                links += 1
                continue
            if d in SKIP_DIRS:
                continue
            if d.lower() in ("test", "tests", "androidtest", "__tests__", "spec"):
                has_tests = True
            keep.append(d)
        dirnames[:] = keep
        for f in filenames:
            full = dp / f
            if os.path.islink(full):
                links += 1
                continue
            if not is_within(root, full):
                continue
            files += 1
            if files > MAX_FILES:
                truncated = True
                break
            rel = str(full.relative_to(root))
            suffix = full.suffix.lower()
            ext[suffix or "(none)"] += 1
            low = f.lower()
            for key, names in MARKERS.items():
                if low in names:
                    markers.setdefault(key, rel)
            if low.startswith("test_") or low.endswith(("_test.py", "test.kt", "tests.kt", ".spec.ts", ".test.ts")):
                has_tests = True
            try:
                size = full.stat().st_size
            except OSError:
                continue
            if size > LARGE_FILE:
                large.append({"path": rel, "bytes": size})
            if (suffix in TEXT_EXT or low in (".env", ".gitignore")) and size <= MAX_SCAN_BYTES:
                try:
                    text = full.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                todos += sum(text.count(t) for t in ("TODO", "FIXME", "HACK"))
                kinds = find_secret_kinds(text)
                if kinds:  # path + kinds only; values are never stored
                    secrets.append({"path": rel, "kinds": kinds})
        if truncated:
            break
        ctx.tick()
    return dict(files=min(files, MAX_FILES), truncated=truncated, extensions=dict(ext.most_common(12)),
                markers=markers, todo_markers=todos, potential_secrets=secrets, large_files=large,
                links_skipped=links, has_tests=has_tests,
                has_source=any(e in SOURCE_EXT for e in ext))


def _is_junction(p: Path) -> bool:
    try:
        return bool(getattr(os.path, "isjunction", lambda _: False)(p))
    except OSError:
        return False


def findings(s: dict, git: dict) -> list[dict]:
    out = []

    def add(sev, code, msg):
        out.append({"severity": sev, "code": code, "message": msg})
    if s["potential_secrets"]:
        add("high", "secrets-in-tree", f"{len(s['potential_secrets'])} file(s) match secret patterns "
            "(paths only; values not stored). Move them to env vars or a credential store.")
    if s["has_source"] and not s["has_tests"]:
        add("medium", "no-tests", "Source files found but no test directory or test-named files.")
    if "README" not in s["markers"]:
        add("low", "no-readme", "No README found.")
    if "gitignore" not in s["markers"] and git["is_repo"]:
        add("low", "no-gitignore", "Git repository without .gitignore.")
    if not git["is_repo"]:
        add("medium", "not-git", "Workspace is not a git repository (or git is unavailable); no history/rollback.")
    elif git["dirty_files"]:
        add("low", "uncommitted", f"{git['dirty_files']} uncommitted change(s).")
    if "claude_md" not in s["markers"]:
        add("low", "no-claude-md", "No CLAUDE.md; Claude Code sessions start without project context.")
    if "gradle" in s["markers"] and "android_manifest" not in s["markers"]:
        add("low", "gradle-no-manifest", "Gradle build found without an AndroidManifest.xml (non-Android?).")
    if s["todo_markers"] > 25:
        add("low", "todo-debt", f"{s['todo_markers']} TODO/FIXME/HACK markers.")
    if s["large_files"]:
        add("low", "large-files", f"{len(s['large_files'])} file(s) over 5 MB in the tree.")
    if s["truncated"]:
        add("info", "truncated", f"Scan stopped at {MAX_FILES} files; results are partial.")
    return out


def markdown(name: str, root: str, s: dict, git: dict, fnd: list[dict]) -> str:
    lines = [f"# Workspace audit: {name}", "", f"- Root: `{root}`", f"- Files scanned: {s['files']}"
             + (" (TRUNCATED)" if s["truncated"] else ""),
             f"- Git: {'repo, ' + str(git['dirty_files']) + ' uncommitted' if git['is_repo'] else 'not a repo / unavailable'}",
             f"- Symlinks/junctions skipped: {s['links_skipped']}", "", "## Findings", ""]
    lines += [f"- **{f['severity']}** `{f['code']}`: {f['message']}" for f in fnd] or ["- none"]
    lines += ["", "## Extensions", ""] + [f"- `{k}`: {v}" for k, v in s["extensions"].items()]
    if git["recent_commits"]:
        lines += ["", "## Recent commits", ""] + [f"- {c}" for c in git["recent_commits"]]
    lines += ["", "_Deterministic read-only audit. Findings are heuristics, not verified defects._"]
    return "\n".join(lines) + "\n"


@executor("audit.workspace")
def audit_workspace(ctx: RunContext) -> dict:
    if not ctx.workspace:
        raise Blocked("task has no registered workspace")
    root = Path(ctx.workspace["path"])
    if not root.is_dir():
        raise Blocked(f"registered workspace no longer exists: {root}")
    s = ctx.step("scan", lambda: scan(ctx, root))
    ctx.add_evidence("scan", f"scanned {s['files']} files, {len(s['potential_secrets'])} with secret patterns",
                     ctx.workspace["path"])

    def git_info():
        inside = _git(root, "rev-parse", "--is-inside-work-tree") == "true"
        if not inside:
            return {"is_repo": False, "dirty_files": 0, "recent_commits": []}
        porcelain = _git(root, "status", "--porcelain") or ""
        log = _git(root, "log", "-5", "--pretty=%h %s") or ""
        return {"is_repo": True, "dirty_files": len([l for l in porcelain.splitlines() if l.strip()]),
                "recent_commits": log.splitlines()}
    git = ctx.step("git", git_info)
    ctx.add_evidence("git", "git repo" if git["is_repo"] else "no git repo detected", ctx.workspace["path"])
    fnd = findings(s, git)
    report = {"workspace": ctx.workspace["path"], "scan": s, "git": git, "findings": fnd}
    ctx.add_artifact("audit_report", "audit.json", json.dumps(report, indent=2, sort_keys=True))
    name = Path(ctx.workspace["path"]).name
    ctx.add_artifact("audit_summary", "audit.md", markdown(name, ctx.workspace["path"], s, git, fnd))
    return {"summary": f"{len(fnd)} finding(s) across {s['files']} files", "findings": len(fnd)}
