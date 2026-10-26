"""Isolated git worktrees for provider edits.

Every conversation that edits code gets its own worktree and branch under AIOS's private state
directory. The registered project folder is never written to by an AIOS-started provider run, two
conversations can never overwrite each other's files, and the owner's uncommitted work is untouched.
Everything a provider produces is a commit on an `aios/...` branch that AIOS can diff, verify,
review, and (later, with approval) apply.

All git calls are argument lists (no shell), time-limited, non-interactive, and run without
external diff drivers or text conversion filters.
"""
from __future__ import annotations

import fnmatch
import os
import subprocess
from pathlib import Path

GIT_TIMEOUT_S = 90
MAX_DIFF_BYTES = 2_000_000

# Paths whose change deserves extra review before a patch is applied to the real project: they
# run code or change tool behaviour without being "the feature".
SENSITIVE_PATTERNS = (
    ".git", ".git/*", ".gitattributes", ".gitmodules", ".gitignore", ".github/*", ".gitlab-ci.yml",
    ".claude/*", ".cursor/*", ".vscode/*", ".idea/*", ".husky/*", ".pre-commit-config.yaml",
    "Jenkinsfile", "azure-pipelines.yml", ".circleci/*", "CLAUDE.md", "AGENTS.md",
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "*.keystore", "*.jks",
    "package.json", "pyproject.toml", "setup.py", "requirements*.txt", "Makefile",
    "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradlew",
    "gradlew.bat", "*.ps1", "*.bat", "*.cmd", "*.sh",
)


class GitError(RuntimeError):
    pass


HARDENING = ("core.fsmonitor=false", "core.sshCommand=", "diff.external=")


def _pin_file(wt: Path) -> Path:
    """Where AIOS records a worktree's real git dir. A sibling of the worktree, outside the
    folder the provider is allowed to write in."""
    wt = Path(wt)
    return wt.with_name(wt.name + ".aios-gitdir")


def _record_pin(wt: Path) -> None:
    link = (Path(wt) / ".git").read_text(encoding="utf-8", errors="replace").strip()
    if not link.startswith("gitdir:"):
        raise GitError("a new worktree has an unexpected .git link")
    _pin_file(wt).write_text(link[len("gitdir:"):].strip(), encoding="utf-8")


def _pinned_env(repo: Path) -> dict[str, str]:
    """Git finds a linked worktree's repository through its `.git` file, which the provider can
    rewrite. For worktrees AIOS created, refuse if that file changed and pass the recorded git dir
    explicitly, so provider-written files can never choose which config git reads."""
    pin = _pin_file(repo)
    if not pin.is_file():
        # A linked worktree has a `.git` *file* (a normal repository has a directory). Without a
        # recorded git dir there is nothing to compare it with, so do not trust it.
        if (Path(repo) / ".git").is_file():
            raise GitError("this linked worktree has no recorded git dir, so AIOS will not run git in it")
        return {}
    gitdir = pin.read_text(encoding="utf-8").strip()
    try:
        link = (Path(repo) / ".git").read_text(encoding="utf-8", errors="replace").strip()
    except OSError as e:
        raise GitError(f"worktree .git link is unreadable: {e}") from e
    if link != f"gitdir: {gitdir}":
        raise GitError("the worktree's .git link was changed after AIOS created it; refusing to run git there")
    return {"GIT_DIR": gitdir, "GIT_WORK_TREE": str(repo)}


def _git(repo: Path, *args: str, timeout: int = GIT_TIMEOUT_S, check: bool = True,
         extra_config: tuple[str, ...] = ()) -> str:
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", **_pinned_env(repo)}
    cfg: list[str] = []
    for c in (f"safe.directory={repo}", *HARDENING, *extra_config):
        cfg += ["-c", c]
    cmd = ["git", *cfg, "-C", str(repo), *args]
    try:
        # Bytes, not text mode: text mode would turn CRLF into LF and a patch of a CRLF file
        # would no longer apply.
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise GitError(f"git {args[0] if args else ''} timed out after {timeout}s") from e
    except OSError as e:
        raise GitError(f"git could not be started: {e}") from e
    out = p.stdout.decode("utf-8", errors="replace")
    err = p.stderr.decode("utf-8", errors="replace")
    if check and p.returncode != 0:
        raise GitError(f"git {args[0] if args else ''} failed: {(err or out).strip()[:500]}")
    return out


def _git_rc(repo: Path, *args: str, timeout: int = GIT_TIMEOUT_S) -> int:
    """Return code of a git command whose exit status is the answer (e.g. diff --quiet)."""
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", **_pinned_env(repo)}
    cfg = [x for c in HARDENING for x in ("-c", c)]
    try:
        return subprocess.run(["git", "-c", f"safe.directory={repo}", *cfg, "-C", str(repo), *args],
                              capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout,
                              env=env).returncode
    except (OSError, subprocess.TimeoutExpired) as e:
        raise GitError(f"git {args[0] if args else ''} could not run: {e}") from e


def _same_path(a: Path | str, b: Path | str) -> bool:
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


def repo_state(root: Path) -> dict:
    """Facts about the registered project folder. `usable` means a worktree can be made from it."""
    root = Path(root)
    out = {"usable": False, "reason": None, "head": None, "branch": None, "dirty": False}
    try:
        top = _git(root, "rev-parse", "--show-toplevel").strip()
    except GitError:
        out["reason"] = ("This folder is not a git repository. Edits need one so AIOS can keep "
                         "them in an isolated branch. Run `git init` and make a first commit.")
        return out
    if not _same_path(top, root):
        out["reason"] = (f"The registered folder is inside a larger git repository ({top}). "
                         "Register the repository root so AIOS can isolate edits correctly.")
        return out
    try:
        out["head"] = _git(root, "rev-parse", "--verify", "HEAD").strip()
    except GitError:
        out["reason"] = "The repository has no commits yet. Make a first commit so AIOS has a base."
        return out
    out["branch"] = _git(root, "symbolic-ref", "--short", "-q", "HEAD", check=False).strip() or None
    out["dirty"] = bool(_git(root, "status", "--porcelain", check=False).strip())
    out["usable"] = True
    return out


def create_worktree(repo: Path, dest: Path, branch: str) -> dict:
    """New branch `branch` at the repository HEAD, checked out in `dest`. Uncommitted work in the
    project folder is not included (reported as `dirty_source`)."""
    repo, dest = Path(repo), Path(dest)
    st = repo_state(repo)
    if not st["usable"]:
        raise GitError(st["reason"])
    if dest.exists():
        raise GitError(f"worktree path already exists: {dest}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    _git(repo, "worktree", "add", "--quiet", "-b", branch, str(dest), st["head"])
    _record_pin(dest)
    return {"path": str(dest), "branch": branch, "base_revision": st["head"],
            "dirty_source": st["dirty"], "source_branch": st["branch"]}


def create_detached(repo: Path, dest: Path, rev: str) -> str:
    """A read-only-by-convention checkout of exactly `rev` (no branch), for an independent reviewer.
    Returns the revision actually checked out."""
    repo, dest = Path(repo), Path(dest)
    if dest.exists():
        raise GitError(f"review path already exists: {dest}")
    _git(repo, "cat-file", "-e", f"{rev}^{{commit}}")          # the revision must exist
    dest.parent.mkdir(parents=True, exist_ok=True)
    _git(repo, "worktree", "add", "--quiet", "--detach", str(dest), rev)
    _record_pin(dest)
    return head(dest)


def remove_worktree(repo: Path, dest: Path) -> bool:
    """Best-effort removal of a temporary worktree. Returns False (never raises) if it lingers."""
    try:
        _git(Path(repo), "worktree", "remove", "--force", str(dest))
        _git(Path(repo), "worktree", "prune", check=False)
        if not Path(dest).exists():
            _pin_file(dest).unlink(missing_ok=True)
        return not Path(dest).exists()
    except GitError:
        return False


def worktree_ok(path: str | Path | None) -> bool:
    if not path or not Path(path).is_dir():
        return False
    try:
        return _git(Path(path), "rev-parse", "--is-inside-work-tree").strip() == "true"
    except GitError:
        return False


def head(wt: Path) -> str:
    return _git(wt, "rev-parse", "--verify", "HEAD").strip()


def commit_all(wt: Path, message: str, hooks_dir: Path) -> str | None:
    """Record everything the provider changed as one commit on the conversation branch. Returns
    the new HEAD, or None when nothing changed. Git hooks are disabled for AIOS's own commits."""
    _git(wt, "add", "-A")
    if _git_rc(wt, "diff", "--cached", "--quiet") == 0:  # exit 0 = nothing staged
        return None
    _git(wt, "commit", "--quiet", "--no-verify", "-m", message,
         extra_config=("user.name=AIOS", "user.email=aios@localhost", "commit.gpgsign=false",
                       f"core.hooksPath={hooks_dir}"))
    return head(wt)


def branch_tip(repo: Path, branch: str) -> str | None:
    out = _git(repo, "rev-parse", "--verify", "-q", f"refs/heads/{branch}", check=False).strip()
    return out or None


def apply_revision(repo: Path, *, revision: str, expected_branch: str, expected_head: str,
                   message: str, hooks_dir: Path) -> dict:
    """Merge one exact, already-reviewed revision into the owner's real project, as a new merge commit.

    Refuses (raises GitError) unless the project is exactly where the owner approved: same branch, same HEAD, no
    uncommitted work. The owner's own repository hooks are switched off (the merged files are provider-written).
    A conflict is aborted and reported, never left half-done."""
    st = repo_state(repo)
    if not st["usable"]:
        raise GitError(st["reason"])
    if st["dirty"]:
        raise GitError("your project folder has uncommitted changes; commit or stash them, then ask again")
    if st["branch"] != expected_branch or st["head"] != expected_head:
        raise GitError("your project moved after you approved this (a different branch or a new commit); ask again so you approve the current state")
    _git(repo, "cat-file", "-e", f"{revision}^{{commit}}")
    cfg = [f"core.hooksPath={hooks_dir}", "commit.gpgsign=false", "merge.verifySignatures=false"]
    if not _git(repo, "config", "user.name", check=False).strip():          # a fresh git install has no identity
        cfg += ["user.name=AIOS", "user.email=aios@localhost"]
    try:
        _git(repo, "merge", "--no-ff", "--no-verify", "-m", message, revision, extra_config=tuple(cfg))
    except GitError as e:
        _git(repo, "merge", "--abort", check=False)
        return {"applied": False, "reason": f"git could not merge it cleanly ({e}); your project was left as it was"}
    new_head = _git(repo, "rev-parse", "--verify", "HEAD").strip()
    if new_head == expected_head:
        return {"applied": False, "reason": "your project already contains this revision; nothing was added"}
    same = _git(repo, "rev-parse", "HEAD^{tree}").strip() == _git(repo, "rev-parse", f"{revision}^{{tree}}").strip()
    return {"applied": True, "commit": new_head, "previous_head": expected_head, "tree_matches_reviewed": same}


def restore(wt: Path, revision: str) -> None:
    """Throw away everything in the worktree that is not in `revision`: edits, new files and ignored files.
    Used when a turn did not finish or failed its isolation check, so its half-done work cannot leak into a later patch."""
    _git(wt, "reset", "--hard", "-q", revision)
    _git(wt, "clean", "-ffdxq")


def is_clean_at(wt: Path, revision: str) -> bool:
    """True when the worktree is exactly `revision`: same commit, no edits, no untracked or ignored files."""
    return head(wt) == revision and not _git(wt, "status", "--porcelain", "--ignored").strip()


def prepare_clean_checkout(wt: Path, expected_head: str) -> None:
    """Make the worktree contain exactly the revision that was reviewed and approved, and nothing else.
    The patch an owner approves holds tracked and added files only; ignored or untracked files would
    otherwise run during verification without ever appearing in it."""
    if head(wt) != expected_head:
        raise GitError("the worktree is no longer at the approved revision; refusing to run tests on it")
    _git(wt, "clean", "-ffdxq")
    if _git(wt, "status", "--porcelain", "--ignored").strip():
        raise GitError("the worktree still holds files that are not part of the approved revision")


def diff_text(wt: Path, base: str, tip: str) -> tuple[str, bool]:
    """Unified diff base..tip without external drivers. Returns (text, truncated)."""
    text = _git(wt, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", base, tip)
    if len(text.encode("utf-8", errors="replace")) > MAX_DIFF_BYTES:
        return text.encode("utf-8", errors="replace")[:MAX_DIFF_BYTES].decode("utf-8", errors="replace"), True
    return text, False


def changed_files(wt: Path, base: str, tip: str) -> list[dict]:
    out = []
    for line in _git(wt, "diff", "--name-status", "--no-renames", "--no-ext-diff", base, tip).splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            out.append({"status": parts[0].strip()[:1], "path": parts[1].strip().strip('"')})
    return out


def numstat(wt: Path, base: str, tip: str) -> tuple[int, int]:
    added = removed = 0
    for line in _git(wt, "diff", "--numstat", "--no-renames", "--no-ext-diff", base, tip).splitlines():
        a, r, *_ = line.split("\t")
        added += int(a) if a.isdigit() else 0
        removed += int(r) if r.isdigit() else 0
    return added, removed


def sensitive_paths(files: list[dict] | list[str]) -> list[str]:
    hits = []
    for f in files:
        p = (f["path"] if isinstance(f, dict) else str(f)).replace("\\", "/")
        name = p.rsplit("/", 1)[-1]
        if any(fnmatch.fnmatch(p, pat) or fnmatch.fnmatch(name, pat) for pat in SENSITIVE_PATTERNS):
            hits.append(p)
    return sorted(set(hits))
