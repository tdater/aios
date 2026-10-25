"""Claude Code transport: AIOS starts the official, unmodified `claude` CLI in print mode.

Supported execution model (category A in docs/integration-findings.md):
- The user installs Claude Code and signs in through Anthropic's own flow. AIOS never reads,
  copies, stores, or forwards credentials; the CLI authenticates itself.
- Each run is started by the user from AIOS and works only inside one registered workspace.
- Variables that would switch Claude Code to metered API billing are removed from the child
  environment, and a run is refused unless `claude auth status` reports a claude.ai login.
- No settings files are loaded (`--setting-sources ""`): not the workspace's, so an untrusted repo
  cannot run code through hooks or MCP servers, and not the user's, so personal hooks, plugins,
  permission rules, and `env` blocks (which could reintroduce an API key) do not leak into AIOS
  runs. Managed policy still applies. `disableAllHooks` is passed as a backstop, and
  `--strict-mcp-config` with no servers keeps MCP off.
- Claude may read and edit files; shell, web, and MCP tools are denied. AIOS runs verification
  itself, so the verdict never comes from the model.

Nothing here is a mock. Tests drive it with a stand-in executable passed as `exe`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .security import redact

# --permission-prompts needs v2.1.259 (docs/integration-findings.md, sources there).
MIN_VERSION = (2, 1, 259)

# Env vars that route Claude Code to metered or third-party billing. Never passed to the child.
BILLING_ENV = (
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
)

READ_TOOLS = ["Read", "Glob", "Grep"]
EDIT_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"]
DENIED_TOOLS = ["Bash", "WebFetch", "WebSearch", "NotebookEdit", "Agent", "Task"]

MODES = {"read": READ_TOOLS, "edit": EDIT_TOOLS}


# Empty value = load no user/project/local settings. Verified against the Claude Code 2.1.310
# argument parser (an empty string returns no sources); older builds may reject it, which run()
# reports as ClaudeUnavailable instead of a silent failure.
NO_SETTING_SOURCES = ""
ISOLATION_SETTINGS = json.dumps({"disableAllHooks": True}, separators=(",", ":"))


class ClaudeUnavailable(RuntimeError):
    """The official client is missing, too old, signed out, or set to metered billing."""


@dataclass
class Preflight:
    exe: list[str]
    version: str
    version_tuple: tuple[int, ...]
    logged_in: bool
    auth_method: str | None
    plan: str | None

    def public(self) -> dict:
        """Non-secret fields only, safe to log and show."""
        return {"version": self.version, "logged_in": self.logged_in,
                "auth_method": self.auth_method, "plan": self.plan}


@dataclass
class RunResult:
    ok: bool
    exit_code: int
    session_id: str | None
    subtype: str | None
    result_text: str
    num_turns: int | None
    duration_ms: int | None
    cost_estimate_usd: float | None
    permission_denials: list
    model: str | None
    plugins: list = field(default_factory=list)
    mcp_servers: list = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    stderr: str = ""
    timed_out: bool = False

    def summary(self) -> dict:
        return {"ok": self.ok, "exit_code": self.exit_code, "session_id": self.session_id,
                "subtype": self.subtype, "num_turns": self.num_turns,
                "duration_ms": self.duration_ms, "model": self.model,
                "cost_estimate_usd": self.cost_estimate_usd,
                "cost_note": "client-side estimate printed by Claude Code; billed to the "
                             "subscription, not the API, because API variables are removed",
                "permission_denials": self.permission_denials, "timed_out": self.timed_out,
                "plugins_loaded": [p.get("name") if isinstance(p, dict) else p for p in self.plugins],
                "mcp_servers": [m.get("name") if isinstance(m, dict) else m for m in self.mcp_servers],
                "result": redact(self.result_text)[:4000]}


def parse_version(text: str) -> tuple[int, ...]:
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else ()


def child_env(base: dict | None = None) -> dict:
    env = dict(os.environ if base is None else base)
    for var in BILLING_ENV:
        env.pop(var, None)
    return env


def default_exe() -> list[str]:
    path = shutil.which("claude")
    if not path:
        raise ClaudeUnavailable("Claude Code is not installed or not on PATH. Install it from "
                                "https://code.claude.com and sign in once by running `claude`.")
    if path.lower().endswith((".cmd", ".bat")):
        # Batch shims re-parse arguments through cmd.exe; prompt text could break out of them.
        raise ClaudeUnavailable(f"{path} is a batch shim. Install the native Claude Code binary "
                                "(`claude install stable`) so AIOS can pass prompts safely.")
    return [path]


def _run(cmd: list[str], env: dict, timeout: int = 30) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env,
                           stdin=subprocess.DEVNULL, encoding="utf-8", errors="replace")
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, str(e)


def preflight(exe: list[str] | None = None, env: dict | None = None) -> Preflight:
    exe = exe or default_exe()
    env = child_env(env)
    rc, ver = _run([*exe, "--version"], env)
    if rc != 0:
        raise ClaudeUnavailable(f"`claude --version` failed: {ver.strip()[:300]}")
    vt = parse_version(ver)
    if not vt or vt < MIN_VERSION:
        need = ".".join(map(str, MIN_VERSION))
        raise ClaudeUnavailable(f"Claude Code {ver.strip()} is too old; AIOS needs {need} or "
                                "newer. Run `claude update`.")
    _, out = _run([*exe, "auth", "status"], env)
    try:
        j = json.loads(out[out.index("{"):out.rindex("}") + 1])
    except ValueError:
        raise ClaudeUnavailable("could not read `claude auth status` output") from None
    pf = Preflight(exe=exe, version=ver.strip(), version_tuple=vt,
                   logged_in=bool(j.get("loggedIn")), auth_method=j.get("authMethod"),
                   plan=j.get("subscriptionType"))
    if not pf.logged_in:
        raise ClaudeUnavailable("Claude Code is not signed in. Run `claude` once and sign in "
                                "with your Claude account.")
    if pf.auth_method != "claude.ai":
        raise ClaudeUnavailable(f"Claude Code is using '{pf.auth_method}' authentication. AIOS "
                                "only runs on a claude.ai subscription login, so nothing is "
                                "billed to an API key without your approval.")
    return pf


def build_command(exe: list[str], prompt: str, *, mode: str = "read", max_turns: int = 10,
                  resume: str | None = None, append_system_prompt: str | None = None,
                  model: str | None = None) -> list[str]:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {sorted(MODES)}")
    if not prompt.strip():
        raise ValueError("prompt is empty")
    cmd = [*exe, "-p",
           "--output-format", "stream-json", "--verbose",
           "--permission-mode", "acceptEdits" if mode == "edit" else "dontAsk",
           "--permission-prompts", "none",
           "--allowedTools", ",".join(MODES[mode]),
           "--disallowedTools", ",".join(DENIED_TOOLS),
           "--setting-sources", NO_SETTING_SOURCES,
           "--settings", ISOLATION_SETTINGS,
           "--strict-mcp-config",
           "--max-turns", str(int(max_turns))]
    if resume:
        cmd += ["--resume", resume]
    if model:
        cmd += ["--model", model]
    if append_system_prompt:
        cmd += ["--append-system-prompt", append_system_prompt]
    # "--" ends options so a prompt that starts with "-" is never read as a flag.
    cmd += ["--", prompt]
    return cmd


def parse_events(lines: list[str]) -> tuple[list[dict], dict, dict]:
    """Returns (events, init_event, result_event). Non-JSON lines are kept as raw text events."""
    events, init, result = [], {}, {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            ev = {"type": "raw", "text": line[:2000]}
        if not isinstance(ev, dict):
            ev = {"type": "raw", "text": str(ev)[:2000]}
        events.append(ev)
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            init = ev
        elif ev.get("type") == "result":
            result = ev
    return events, init, result


def run(workspace: Path, prompt: str, *, exe: list[str] | None = None, mode: str = "read",
        max_turns: int = 10, timeout_s: int = 900, resume: str | None = None,
        append_system_prompt: str | None = None, model: str | None = None,
        env: dict | None = None, on_event: Callable[[dict], None] | None = None,
        transcript: Path | None = None) -> RunResult:
    """Runs one Claude Code turn in `workspace`. Call preflight() first and pass its exe."""
    workspace = Path(workspace).resolve()
    if not workspace.is_dir():
        raise ValueError(f"workspace does not exist: {workspace}")
    cmd = build_command(exe or default_exe(), prompt, mode=mode, max_turns=max_turns,
                        resume=resume, append_system_prompt=append_system_prompt, model=model)
    proc = subprocess.Popen(cmd, cwd=workspace, env=child_env(env), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            encoding="utf-8", errors="replace")
    lines: list[str] = []
    err_chunks: list[str] = []
    t_err = threading.Thread(target=lambda: err_chunks.append(proc.stderr.read()), daemon=True)
    t_err.start()
    out_f = transcript.open("w", encoding="utf-8") if transcript else None
    expired = threading.Event()

    def _expire() -> None:
        expired.set()
        proc.kill()
    killer = threading.Timer(timeout_s, _expire)
    killer.start()
    try:
        for line in proc.stdout:
            lines.append(line)
            if out_f:
                out_f.write(redact(line))
            if on_event and line.strip():
                try:
                    on_event(json.loads(line))
                except json.JSONDecodeError:
                    pass
        proc.wait()
    finally:
        killer.cancel()
        if out_f:
            out_f.close()
    timed_out = expired.is_set()
    t_err.join(timeout=5)
    stderr = "".join(err_chunks)
    if proc.returncode != 0 and "setting source" in stderr.lower():
        raise ClaudeUnavailable("This Claude Code version rejects running without settings files "
                                "(--setting-sources \"\"). Run `claude update` and try again.")
    events, init, res = parse_events(lines)
    is_error = bool(res.get("is_error", True)) if res else True
    return RunResult(
        ok=proc.returncode == 0 and bool(res) and not is_error and not timed_out,
        exit_code=proc.returncode,
        session_id=res.get("session_id") or init.get("session_id"),
        subtype=res.get("subtype"),
        result_text=str(res.get("result") or ""),
        num_turns=res.get("num_turns"),
        duration_ms=res.get("duration_ms"),
        cost_estimate_usd=res.get("total_cost_usd"),
        permission_denials=list(res.get("permission_denials") or []),
        model=init.get("model"),
        plugins=list(init.get("plugins") or []),
        mcp_servers=list(init.get("mcp_servers") or []),
        events=events,
        stderr=redact(stderr)[-4000:],
        timed_out=timed_out,
    )
