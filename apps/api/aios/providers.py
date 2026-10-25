"""Provider capability discovery. Modes: interactive | manual_handoff | automated | unavailable.
Nothing here reads, copies, or stores OAuth tokens or API keys; env vars are checked for
presence only. Unknown usage is reported as 'unknown', never zero."""
from __future__ import annotations

import json
import os
import shutil
import subprocess

from .db import Database
from .util import canonical_json, now

METERED_ENV = {
    "ANTHROPIC_API_KEY": "claude", "ANTHROPIC_AUTH_TOKEN": "claude",
    "GEMINI_API_KEY": "gemini", "GOOGLE_API_KEY": "gemini", "GOOGLE_GENAI_USE_VERTEXAI": "gemini",
    "PERPLEXITY_API_KEY": "perplexity", "OPENAI_API_KEY": "other",
}


def billable_env_present() -> dict[str, list[str]]:
    """Names (never values) of env vars that could route work to metered billing."""
    out: dict[str, list[str]] = {}
    for var, prov in METERED_ENV.items():
        if os.environ.get(var):
            out.setdefault(prov, []).append(var)
    return out


def _run(cmd: list[str], timeout: int = 20) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, str(e)


def _claude() -> dict:
    exe = shutil.which("claude")
    if not exe:
        return dict(provider="claude", mode="unavailable", billing="n/a",
                    detail={"reason": "claude CLI not found on PATH"})
    _, ver = _run([exe, "--version"])
    detail: dict = {"version": ver.strip(), "usage": "unknown",
                    "integration": "aios/claude_code.py starts the official CLI in print mode with "
                                   "your own subscription login (supported: see "
                                   "docs/integration-findings.md). Not yet wired into the run "
                                   "engine; proven only by scripts/demo_claude_connection.py."}
    rc, out = _run([exe, "auth", "status"])
    logged_in, plan = None, None
    try:  # keep only non-secret fields
        j = json.loads(out[out.index("{"):])
        logged_in, plan = j.get("loggedIn"), j.get("subscriptionType")
        detail.update(logged_in=logged_in, auth_method=j.get("authMethod"), plan=plan)
    except (ValueError, json.JSONDecodeError):
        detail["auth_check"] = "could not parse `claude auth status`"
    billing = "subscription" if logged_in else "unknown"
    keys = billable_env_present().get("claude", [])
    if keys:
        billing = "metered_api_possible"
        detail["warning"] = (f"{', '.join(keys)} is set; Claude Code may bill the API instead of "
                             "your subscription. Unset it unless you opted in.")
    mode = "interactive" if logged_in else "unavailable"
    if not logged_in:
        detail["reason"] = "not logged in to the official client"
    return dict(provider="claude", mode=mode, billing=billing, detail=detail)


ANTIGRAVITY_NOTE = ("Manual handoff only. Google's Antigravity FAQ says wrapping agy inside "
                    "third-party applications is not supported on consumer plans and can lead to "
                    "account suspension, so AIOS never starts agy itself. Run the task packet in "
                    "an agy session you start, then import the result. "
                    "See docs/integration-findings.md.")


def _antigravity() -> dict:
    exe = shutil.which("agy")
    if not exe:
        return dict(provider="antigravity", mode="unavailable", billing="n/a", detail={
            "reason": "Antigravity CLI (agy) not found on PATH", "note": ANTIGRAVITY_NOTE})
    _, ver = _run([exe, "--version"])
    return dict(provider="antigravity", mode="manual_handoff", billing="unknown (manual)",
                detail={"version": ver.strip(), "usage": "unknown", "note": ANTIGRAVITY_NOTE})


def _perplexity() -> dict:
    keys = billable_env_present().get("perplexity", [])
    d = {"note": "Manual research handoff only. Pro subscription does not include API access; "
                 "AIOS makes no Perplexity API calls."}
    if keys:
        d["warning"] = f"{', '.join(keys)} is set but AIOS will not use it."
    return dict(provider="perplexity", mode="manual_handoff", billing="none (manual)", detail=d)


def _mock() -> dict:
    return dict(provider="mock", mode="automated", billing="none",
                detail={"note": "Deterministic test provider; produces canned output."})


def discover(db: Database) -> list[dict]:
    caps = [_claude(), _antigravity(), _perplexity(), _mock()]
    with db.tx() as con:
        # Drop providers AIOS no longer supports (Gemini CLI) so stale rows never show as options.
        names = [c["provider"] for c in caps]
        con.execute(f"DELETE FROM provider_caps WHERE provider NOT IN ({','.join('?' * len(names))})",
                    names)
        for c in caps:
            con.execute("INSERT INTO provider_caps(provider,mode,billing,detail_json,checked_at) "
                        "VALUES (?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET mode=excluded.mode, "
                        "billing=excluded.billing, detail_json=excluded.detail_json, "
                        "checked_at=excluded.checked_at",
                        (c["provider"], c["mode"], c["billing"], canonical_json(c["detail"]), now()))
    return list_caps(db)


def list_caps(db: Database) -> list[dict]:
    rows = db.query("SELECT * FROM provider_caps ORDER BY provider")
    for r in rows:
        r["detail"] = json.loads(r.pop("detail_json"))
    return rows


def capability(db: Database, provider: str) -> dict | None:
    for r in list_caps(db):
        if r["provider"] == provider:
            return r
    return None
