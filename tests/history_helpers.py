"""Synthetic Claude-Code-style session fixtures. No real history is ever used in tests."""
import json
from pathlib import Path


def write_session(path: Path, sess: str, events, cwd: str = "C:\\nowhere", day: int = 1) -> Path:
    """events: ('user', text) | ('assistant', text) | ('cmd', command, output)"""
    lines, n = [], 0

    def ts():
        return f"2026-01-{day:02d}T10:{n // 60:02d}:{n % 60:02d}Z"

    for ev in events:
        n += 1
        base = {"sessionId": sess, "cwd": cwd, "timestamp": ts()}
        if ev[0] == "user":
            lines.append({**base, "type": "user", "uuid": f"{sess}-{n}",
                          "message": {"role": "user", "content": ev[1]}})
        elif ev[0] == "assistant":
            lines.append({**base, "type": "assistant", "uuid": f"{sess}-{n}",
                          "message": {"role": "assistant", "content": [{"type": "text", "text": ev[1]}]}})
        elif ev[0] == "cmd":
            lines.append({**base, "type": "assistant", "uuid": f"{sess}-{n}a",
                          "message": {"role": "assistant", "content": [
                              {"type": "tool_use", "id": f"t{n}", "name": "Bash", "input": {"command": ev[1]}}]}})
            n += 1
            lines.append({**base, "timestamp": ts(), "type": "user", "uuid": f"{sess}-{n}r",
                          "message": {"role": "user", "content": [
                              {"type": "tool_result", "tool_use_id": f"t{n - 1}", "content": ev[2]}]}})
    path.write_text("\n".join(json.dumps(l) for l in lines) + "\n", encoding="utf-8")
    return path


FAIL_OUT = "FAILED tests/test_x.py::test_a - AssertionError: expected 3 got 4\n1 failed, 4 passed in 0.4s"
PASS_OUT = "5 passed in 0.3s"
PREF = "Always use Kotlin coroutines instead of RxJava."


def dump_db_text(db) -> str:
    """Every value in every table (incl. FTS shadow tables), for leak assertions."""
    out = []
    for t in db.query("SELECT name FROM sqlite_master WHERE type='table'"):
        for row in db.query(f'SELECT * FROM "{t["name"]}"'):
            out.append(json.dumps(row, default=str))
    return "\n".join(out)
