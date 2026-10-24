"""Keyset pagination. Cursors are opaque to clients: base64(json([sort_value, id]))."""
from __future__ import annotations

import base64
import json

from .db import Database
from .errors import ApiError

DEFAULT_LIMIT, MAX_LIMIT = 50, 200


def _enc(sort_value, id_) -> str:
    return base64.urlsafe_b64encode(json.dumps([sort_value, id_]).encode()).decode()


def _dec(cursor: str):
    try:
        v = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        if isinstance(v, list) and len(v) == 2:
            return v
    except (ValueError, json.JSONDecodeError):
        pass
    raise ApiError(400, "bad_cursor", "Invalid pagination cursor")


def page(db: Database, select: str, where: list[str], params: list, *, sort: str, id_col: str = "id",
         desc: bool = True, limit: int | None = None, cursor: str | None = None) -> dict:
    """select: 'SELECT ... FROM ...' without WHERE/ORDER. sort/id_col must be trusted column names."""
    limit = max(1, min(limit or DEFAULT_LIMIT, MAX_LIMIT))
    where, params = list(where), list(params)
    if cursor:
        sv, iv = _dec(cursor)
        op = "<" if desc else ">"
        where.append(f"({sort}, {id_col}) {op} (?, ?)")
        params += [sv, iv]
    sql = select + (" WHERE " + " AND ".join(where) if where else "")
    sql += f" ORDER BY {sort} {'DESC' if desc else 'ASC'}, {id_col} {'DESC' if desc else 'ASC'} LIMIT ?"
    rows = db.query(sql, tuple(params + [limit + 1]))
    more = len(rows) > limit
    rows = rows[:limit]
    sort_key = sort.split(".")[-1]
    id_key = id_col.split(".")[-1]
    nxt = _enc(rows[-1][sort_key], rows[-1][id_key]) if more and rows else None
    return {"items": rows, "next_cursor": nxt, "limit": limit}
