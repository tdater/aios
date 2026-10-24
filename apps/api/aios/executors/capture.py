"""Quick capture: a note/idea submitted from any client becomes a real server-side task."""
from __future__ import annotations

from ..engine import RunContext, executor


@executor("capture.note")
def capture_note(ctx: RunContext) -> dict:
    text = str(ctx.spec.get("text", "")).strip()
    ctx.add_artifact("note", "note.md", text, provenance="user-captured")
    ctx.add_evidence("capture", f"captured {len(text)} characters")
    return {"summary": "note captured", "chars": len(text)}
