"""Single-user device sessions. Pairing code (shown only on the trusted desktop) -> session.

Browser: HttpOnly SameSite=Strict cookie + double-submit CSRF token (never returned in a body-readable
long-lived form beyond the CSRF value itself). Native: opaque bearer token returned once, stored by the
client in Keystore-backed storage. The server stores only sha256(token). Rate-limited pairing."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request

from .db import Database
from .errors import ApiError
from .util import new_id, now

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I
PAIR_TTL = timedelta(minutes=10)
SESSION_TTL = timedelta(days=30)
IDLE_TTL = timedelta(days=14)
MAX_FAILS, FAIL_WINDOW = 5, timedelta(minutes=15)
COOKIE, CSRF_COOKIE = "aios_session", "aios_csrf"
SAFE = {"GET", "HEAD", "OPTIONS"}


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds")


def _utc() -> datetime:
    return datetime.now(timezone.utc)


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _norm(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", code.upper())


def new_pairing_code(db: Database) -> dict:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    exp = _iso(_utc() + PAIR_TTL)
    with db.tx() as con:
        con.execute("DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL", (now(),))
        con.execute("INSERT INTO pairing_codes(id,code_hash,created_at,expires_at) VALUES (?,?,?,?)",
                    (new_id("pcd"), _h(raw), now(), exp))
    return {"code": f"{raw[:4]}-{raw[4:]}", "expires_at": exp}


def pair(db: Database, code: str, device_name: str, kind: str) -> dict:
    cutoff = _iso(_utc() - FAIL_WINDOW)
    fails = db.one("SELECT COUNT(*) n FROM auth_failures WHERE ts > ?", (cutoff,))["n"]
    if fails >= MAX_FAILS:
        raise ApiError(429, "pairing_locked", "Too many failed pairing attempts. Try again in 15 minutes.",
                       headers={"Retry-After": "900"})
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    sid = new_id("ses")
    with db.tx() as con:
        n = con.execute("UPDATE pairing_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL "
                        "AND expires_at > ?", (now(), _h(_norm(code)), now())).rowcount
        if n != 1:  # record the failure and COMMIT it; raising inside the tx would roll the record back
            con.execute("INSERT INTO auth_failures(ts,kind) VALUES (?,?)", (now(), "pairing"))
        else:
            con.execute("INSERT INTO auth_sessions(id,device_name,kind,token_hash,csrf_hash,created_at,"
                        "last_seen_at,expires_at) VALUES (?,?,?,?,?,?,?,?)",
                        (sid, device_name[:80], kind, _h(token), _h(csrf) if kind == "browser" else None,
                         now(), now(), _iso(_utc() + SESSION_TTL)))
            con.execute("INSERT INTO audit_log(ts,actor,action,detail_json) VALUES (?,?,?,?)",
                        (now(), "device", "auth.pair", f'{{"session":"{sid}","kind":"{kind}"}}'))
    if n != 1:
        raise ApiError(401, "invalid_pairing_code", "Pairing code is wrong, expired, or already used.")
    return {"session_id": sid, "token": token, "csrf": csrf, "kind": kind,
            "expires_at": _iso(_utc() + SESSION_TTL)}


def lookup(db: Database, token: str) -> dict | None:
    row = db.one("SELECT * FROM auth_sessions WHERE token_hash=?", (_h(token),))
    if not row or row["revoked_at"]:
        return None
    t = _utc()
    if row["expires_at"] <= _iso(t) or row["last_seen_at"] <= _iso(t - IDLE_TTL):
        return None
    if row["last_seen_at"] <= _iso(t - timedelta(seconds=60)):
        db.execute("UPDATE auth_sessions SET last_seen_at=? WHERE id=?", (now(), row["id"]))
    return row


def session_from_request(db: Database, request: Request) -> tuple[dict | None, str | None]:
    authz = request.headers.get("authorization", "")
    if authz.lower().startswith("bearer "):
        return lookup(db, authz[7:].strip()), "bearer"
    c = request.cookies.get(COOKIE)
    if c:
        return lookup(db, c), "cookie"
    return None, None


def check_csrf(session: dict, request: Request) -> None:
    sent, cookie = request.headers.get("x-csrf-token", ""), request.cookies.get(CSRF_COOKIE, "")
    if not sent or not session.get("csrf_hash") or not hmac.compare_digest(sent, cookie) \
            or not hmac.compare_digest(_h(sent), session["csrf_hash"]):
        raise ApiError(403, "csrf_failed", "Missing or invalid CSRF token.")
    origin = request.headers.get("origin")
    if origin and origin.split("://", 1)[-1] != request.headers.get("host", ""):
        raise ApiError(403, "origin_mismatch", "Cross-origin request refused for cookie session.")


def revoke(db: Database, session_id: str, reason: str = "revoked") -> bool:
    n = db.execute("UPDATE auth_sessions SET revoked_at=?, revoke_reason=? WHERE id=? AND revoked_at IS NULL",
                   (now(), reason, session_id))
    return n == 1


def list_sessions(db: Database) -> list[dict]:
    return db.query("SELECT id, device_name, kind, created_at, last_seen_at, expires_at, revoked_at "
                    "FROM auth_sessions ORDER BY created_at DESC")
