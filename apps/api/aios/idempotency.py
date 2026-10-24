"""Idempotent POSTs. A retry with the same key and same payload replays the stored response; the same
key with a different payload is rejected; a concurrent duplicate gets a retryable 409."""
from __future__ import annotations

import json
import re
from typing import Callable

from .db import Database
from .errors import ApiError
from .util import canonical_json, now, sha256_text

KEY_RX = re.compile(r"^[A-Za-z0-9_\-:.]{8,128}$")


def run_idempotent(db: Database, scope: str, key: str | None, payload: dict,
                   fn: Callable[[], tuple[int, dict]]) -> tuple[int, dict, bool]:
    """Returns (status, body, replayed)."""
    if key is None:
        status, body = fn()
        return status, body, False
    if not KEY_RX.match(key):
        raise ApiError(400, "bad_idempotency_key", "Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-:.]")
    rh = sha256_text(canonical_json(payload))
    with db.tx() as con:
        n = con.execute("INSERT OR IGNORE INTO idempotency_keys(scope,key,request_hash,created_at) "
                        "VALUES (?,?,?,?)", (scope, key, rh, now())).rowcount
        row = None if n else dict(con.execute("SELECT * FROM idempotency_keys WHERE scope=? AND key=?",
                                              (scope, key)).fetchone())
    if row:
        if row["request_hash"] != rh:
            raise ApiError(422, "idempotency_key_reuse", "This Idempotency-Key was used with a different request.")
        if row["response_json"] is None:
            raise ApiError(409, "idempotency_in_progress", "The first request with this key is still running.",
                           headers={"Retry-After": "1"})
        return row["status_code"], json.loads(row["response_json"]), True
    try:
        status, body = fn()
    except BaseException:
        db.execute("DELETE FROM idempotency_keys WHERE scope=? AND key=?", (scope, key))
        raise
    db.execute("UPDATE idempotency_keys SET status_code=?, response_json=? WHERE scope=? AND key=?",
               (status, canonical_json(body), scope, key))
    return status, body, False


def purge_old(db: Database, days: int = 7) -> None:
    db.execute("DELETE FROM idempotency_keys WHERE created_at < strftime('%Y-%m-%dT%H:%M:%f+00:00','now',?)",
               (f"-{days} days",))
