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
                    "headless": "documented for personal use with subscription login, but NOT "
                                "enabled by AIOS; runs are user-started sessions with a task packet."}
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


def _gemini() -> dict:
    exe = shutil.which("gemini")
    if not exe:
        return dict(provider="gemini", mode="unavailable", billing="n/a", detail={
            "reason": "Gemini CLI not installed",
            "note": "Official pages show a notice that Gemini CLI was replaced by Antigravity CLI "
                    "for some tiers (2026-06-18). Verify current status and terms before installing."})
    _, ver = _run([exe, "--version"])
    return dict(provider="gemini", mode="manual_handoff", billing="unknown", detail={
        "version": ver.strip(), "usage": "unknown",
        "note": "Installed but auth/automation compatibility is untested; treated as handoff only."})


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
    caps = [_claude(), _gemini(), _perplexity(), _mock()]
    with db.tx() as con:
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
