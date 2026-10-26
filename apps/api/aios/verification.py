"""Runs the owner-configured verification command against a provider's patch.

The command is an argv list the owner set on the project (never chosen by a provider). It runs
with no shell, in the isolated worktree, with a timeout, with credentials stripped from its
environment, and only after the owner approves this exact command against this exact revision.

This is NOT a sandbox. The command executes code an AI just wrote, with the owner's Windows
rights. That is why the run is approval-gated and why the approval names the command and revision.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .claude_code import kill_tree
from .security import is_within, redact

MAX_ARGV, MAX_ARG_LEN = 24, 500
MAX_CAPTURE = 1_000_000          # bytes kept while running
OUTPUT_TAIL = 60_000             # characters returned
_SECRET_NAME = re.compile(r"(?i)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)")
_BILLING_PREFIXES = ("ANTHROPIC_", "CLAUDE_CODE_", "OPENAI_", "GEMINI_", "GOOGLE_", "PERPLEXITY_")


class VerifyError(RuntimeError):
    pass


def validate_argv(argv) -> list[str]:
    """Raises ValueError with a plain message if the owner's command is not a usable argv."""
    if not isinstance(argv, list) or not argv:
        raise ValueError("the verification command must be a non-empty list of arguments")
    if len(argv) > MAX_ARGV:
        raise ValueError(f"at most {MAX_ARGV} arguments")
    out = []
    for a in argv:
        if not isinstance(a, str):
            raise ValueError("every argument must be text")
        if len(a) > MAX_ARG_LEN or "\x00" in a:
            raise ValueError("an argument is too long or contains a NUL character")
        out.append(a)
    if not out[0].strip():
        raise ValueError("the first argument must name the program to run")
    return out


def sanitized_env(base: dict | None = None) -> dict:
    """The owner's environment minus anything that looks like a credential or provider billing
    switch, so AI-written code cannot read them from the process environment."""
    env = {}
    for k, v in (os.environ if base is None else base).items():
        if _SECRET_NAME.search(k) or k.upper().startswith(_BILLING_PREFIXES):
            continue
        env[k] = v
    env["PYTHONDONTWRITEBYTECODE"] = "1"   # stale bytecode once made a re-run verify old code
    env["PYTHONUTF8"] = "1"
    env["CI"] = "true"
    return env


def resolve_program(argv0: str, cwd: Path, env: dict) -> str:
    """Absolute path of the program, refusing one that lives inside the worktree (a provider could
    plant `python.exe` or `pytest.cmd` there)."""
    p = argv0 if os.path.isabs(argv0) else shutil.which(argv0, path=env.get("PATH"))
    if not p or not Path(p).exists():
        raise VerifyError(f"program not found: {argv0}")
    if is_within(Path(cwd), Path(p)):
        raise VerifyError(f"refusing to run {p}: it is inside the worktree being verified")
    return os.path.abspath(p)   # not resolve(): a venv python.exe must stay the venv's python


def run_command(argv: list[str], cwd: Path, *, timeout_s: int = 600, env: dict | None = None) -> dict:
    argv = validate_argv(argv)
    cwd = Path(cwd)
    if not cwd.is_dir():
        raise VerifyError(f"worktree does not exist: {cwd}")
    env = env if env is not None else sanitized_env()
    exe = resolve_program(argv[0], cwd, env)
    chunks: list[str] = []
    size = [0]
    start = time.monotonic()
    proc = subprocess.Popen([exe, *argv[1:]], cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace")

    def drain() -> None:
        for line in proc.stdout:           # keeps draining after the cap so the child never blocks
            if size[0] < MAX_CAPTURE:
                chunks.append(line)
                size[0] += len(line)
    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_tree(proc)
        proc.wait()
    reader.join(timeout=10)
    text = redact("".join(chunks))
    truncated = size[0] >= MAX_CAPTURE or len(text) > OUTPUT_TAIL
    return {"argv": argv, "program": exe, "cwd": str(cwd), "exit_code": proc.returncode,
            "passed": proc.returncode == 0 and not timed_out, "timed_out": timed_out,
            "duration_s": round(time.monotonic() - start, 2),
            "output": text[-OUTPUT_TAIL:], "output_truncated": truncated}
