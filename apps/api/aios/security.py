"""Application-level guards. These are NOT an OS sandbox: a process running as this
user can still touch anything this user can. They stop AIOS code paths from wandering,
catch traversal/symlink tricks, and keep secrets out of logs and exports."""
from __future__ import annotations

import os
import re
from pathlib import Path


class PathViolation(Exception):
    pass


def _norm(p: Path) -> str:
    return os.path.normcase(os.path.realpath(p))


def is_within(root: Path, candidate: Path) -> bool:
    r, c = _norm(root), _norm(candidate)
    return c == r or c.startswith(r.rstrip("\\/") + os.sep)


def resolve_within(root: Path, rel: str | Path) -> Path:
    """Resolve rel under root; reject absolute paths, traversal, and links escaping root."""
    rel = Path(rel)
    if rel.is_absolute() or rel.drive:
        raise PathViolation(f"absolute path not allowed: {rel}")
    target = Path(root) / rel
    if not is_within(root, target):
        raise PathViolation(f"path escapes workspace root: {rel}")
    return target


def _forbidden_roots() -> list[str]:
    keys = ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData",
            "USERPROFILE", "APPDATA", "LOCALAPPDATA")
    return [v for v in (os.environ.get(k) for k in keys) if v]


def validate_workspace_root(path: str | Path, *, state_dir: Path, repo_root: Path) -> Path:
    """A workspace must be an existing, specific directory: not a drive root, not a broad
    system/profile directory (or an ancestor of one), not the state dir, not AIOS source."""
    p = Path(path)
    if not p.is_absolute():
        raise PathViolation("workspace path must be absolute")
    if not p.is_dir():
        raise PathViolation(f"workspace path is not an existing directory: {p}")
    real = Path(os.path.realpath(p))
    if real == Path(real.anchor):
        raise PathViolation("a drive root cannot be a workspace")
    for f in _forbidden_roots():
        if _norm(real) == _norm(Path(f)) or is_within(real, Path(f)):
            raise PathViolation(f"workspace is a broad system/profile directory (or contains one): {f}")
    for protected, label in ((state_dir, "AIOS private state"), (repo_root, "AIOS source")):
        if is_within(protected, real) or is_within(real, protected):
            raise PathViolation(f"workspace overlaps {label}")
    return real


# ---- secret handling: kinds are reported, values are never kept ----
SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("anthropic-key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{10,}")),
    ("openai-style-key", re.compile(r"\bsk-[A-Za-z0-9]{20,}")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("aws-access-key", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("slack-token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")),
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}")),
    ("assigned-secret", re.compile(
        r"(?i)\b(api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*['\"]?[^\s'\",;]{8,}")),
]


def find_secret_kinds(text: str) -> list[str]:
    return sorted({k for k, rx in SECRET_PATTERNS if rx.search(text)})


def redact(text: str) -> str:
    for kind, rx in SECRET_PATTERNS:
        if kind == "assigned-secret":
            text = rx.sub(lambda m: f"{m.group(1)}=[REDACTED:assigned-secret]", text)
        else:
            text = rx.sub(f"[REDACTED:{kind}]", text)
    return text


def redact_obj(obj):
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [redact_obj(v) for v in obj]
    return obj
