"""Claude Code PreToolUse guard: deterministic safety controls (prompts and agent judgement are not a security boundary).

Reads the hook JSON on stdin ({tool_name, tool_input, cwd}) and answers on stdout with a permission decision:
  deny  - blocked outright (secrets, history rewrite, public exposure, deleting private state, unreviewed remote code, Azure)
  ask   - the user must confirm (outward-facing GitHub changes, firewall, policy/evaluator files, destructive local git)
  (no output, exit 0) - not this guard's business; normal permission flow applies.
FAIL CLOSED: unreadable input or any internal error exits 2, which blocks the tool call.

This file is part of the safety boundary. Self-improvement may not modify it without explicit user approval
(scripts/skill_eval.py and .claude/settings.json are protected the same way)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PROTECTED_POLICY = [  # editing these changes what is enforced or how it is evaluated -> user must confirm
    "scripts/claude_guard.py", "scripts/skill_eval.py", "scripts/scan_secrets.py", ".secret-allowlist",
    ".claude/settings.json", ".claude/settings.local.json", "tests/test_claude_guard.py", "tests/test_skill_eval.py",
    "tests/test_scan_secrets.py", ".github/workflows/ci.yml",
]
NEVER_WRITE = [  # private runtime state, git internals, secrets
    r"(^|/)aios-state(/|$)", r"(^|/)\.git(/|$)", r"keystore\.properties$", r"\.jks$", r"\.keystore$",
    r"(^|/)\.env(\.|$)", r"(^|/)local\.properties$", r"(^|/)\.ssh(/|$)", r"\.credentials",
]

# (regex, decision, reason) evaluated against the command with quoted strings neutralised, so a commit message that
# merely *mentions* "git push --force" does not trigger a rule.
CMD_RULES: list[tuple[str, str, str]] = [
    (r"\bgit\s+push\b[^|;&\n]*(--force\b|--force-with-lease\b|\s-f\b|\s\+[\w./-]+)", "deny", "force-push is not allowed"),
    (r"\bgit\s+(reset\s+--hard\b|clean\s+-[a-z]*f|checkout\s+--\s+\.|restore\s+--source\b|branch\s+-D\b|filter-branch\b|filter-repo\b)",
     "ask", "destructive or history-rewriting git command"),
    (r"\bgh\s+repo\s+(delete|edit|create|rename|archive|transfer|fork)\b", "ask", "changes a GitHub repository"),
    (r"\bgh\s+api\b[^|;&\n]*(-X|--method)\s*(DELETE|PATCH|PUT|POST)\b", "ask", "state-changing GitHub API call"),
    (r"\bgh\s+(auth\s+(token|refresh|logout)|secret\s+(set|delete)|ssh-key|gpg-key|release\s+(create|delete))\b", "ask",
     "GitHub credential/secret/release operation"),
    (r"\btailscale\s+(funnel|up\b[^|;&\n]*--advertise|ssh)\b", "deny", "this would expose the machine publicly or change the tailnet"),
    (r"\b(New-NetFirewallRule|Set-NetFirewall\w*|Remove-NetFirewallRule|netsh\s+advfirewall|netsh\s+interface\s+portproxy)\b", "ask",
     "firewall / port-forward change"),
    (r"(^|[\s;&|(])az(\.cmd)?\s+\w", "deny", "Azure is not part of this project's plan"),
    (r"\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|python\d*)\b",
     "deny", "piping a download into an interpreter"),
    (r"\b(Invoke-Expression|iex)\b", "ask", "dynamic code execution"),
    (r"\$env:\w*(ANTHROPIC|GEMINI|GOOGLE|PERPLEXITY|OPENAI|GITHUB|GH)_?\w*(KEY|TOKEN|SECRET)\w*", "deny", "reading a credential from the environment"),
    (r"\b(printenv|Get-ChildItem\s+(env:|Env:)|gci\s+env:|\bset\s*$)", "ask", "dumping the environment may reveal secrets"),
]
# Rules that must see quoted paths (the thing being touched is often quoted).
PATH_RULES: list[tuple[str, str, str]] = [
    (r"(Remove-Item|\brm\b|\bdel\b|\berase\b|\brmdir\b|\brd\b)[^|;&\n]*(aios-state|(^|[\s\\/\"'])\.git([\\/\s\"']|$))", "deny",
     "deleting private AIOS state or git internals"),
    (r"(\.claude[\\/]\.credentials|[\\/]\.ssh[\\/]|\.config[\\/]gh[\\/]hosts|keystore\.properties|\.jks\b|\.keystore\b|aios-state[\\/]db)", "deny",
     "touching credentials, signing material or the private database"),
]


def neutralise_quotes(cmd: str) -> str:
    cmd = re.sub(r"@'.*?'@", '""', cmd, flags=re.S)      # PowerShell single-quoted here-string
    cmd = re.sub(r'@".*?"@', '""', cmd, flags=re.S)
    cmd = re.sub(r'"(?:[^"\\]|\\.)*"', '""', cmd, flags=re.S)
    return re.sub(r"'[^']*'", "''", cmd, flags=re.S)


def check_command(cmd: str) -> tuple[str, str] | None:
    plain = neutralise_quotes(cmd)
    for rx, decision, reason in CMD_RULES:
        if re.search(rx, plain, re.I):
            return decision, reason
    for rx, decision, reason in PATH_RULES:
        if re.search(rx, cmd, re.I):
            return decision, reason
    return None


def norm_path(p: str, cwd: str) -> str:
    """Resolve symlinks/junctions (realpath), so a link inside the repo cannot smuggle a write to a protected file."""
    q = Path(p)
    if not q.is_absolute():
        q = Path(cwd) / q
    return os.path.normcase(os.path.realpath(q)).replace("\\", "/")


def check_path(p: str, cwd: str) -> tuple[str, str] | None:
    full = norm_path(p, cwd)
    for rx in NEVER_WRITE:
        if re.search(rx, full, re.I):
            return "deny", f"writing to a protected location ({rx})"
    root = norm_path(str(ROOT), str(ROOT))
    for rel in PROTECTED_POLICY:
        if full == f"{root}/{rel}".lower() or full == os.path.normcase(f"{root}/{rel}"):
            return "ask", f"{rel} is part of the safety/evaluation boundary; the user must approve changes"
    return None


SHELL_TOOLS = ("Bash", "PowerShell")
FILE_WRITE_TOOLS = ("Edit", "MultiEdit", "Write", "NotebookEdit")
GUARDED_TOOLS = SHELL_TOOLS + FILE_WRITE_TOOLS   # .claude/settings.json's matcher MUST list every one (a test enforces it)


def decide(payload: dict) -> tuple[str, str] | None:
    tool = payload.get("tool_name", "")
    inp = payload.get("tool_input") or {}
    cwd = payload.get("cwd") or os.getcwd()
    if tool in SHELL_TOOLS:
        return check_command(str(inp.get("command", "")))
    if tool in FILE_WRITE_TOOLS:
        p = inp.get("file_path") or inp.get("notebook_path")
        return check_path(str(p), cwd) if p else None
    return None


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        if not isinstance(payload, dict):
            raise ValueError("hook input is not an object")
        result = decide(payload)
    except Exception as e:  # fail closed
        print(f"claude_guard: cannot evaluate this call ({type(e).__name__}); blocking.", file=sys.stderr)
        return 2
    if result:
        decision, reason = result
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision,
                                                 "permissionDecisionReason": f"AIOS guard: {reason}"}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
