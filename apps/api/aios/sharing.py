"""What each AI may be told. A level per AI, set by the owner and changeable at any time:

  none     the AI is told nothing from AIOS memory
  public   only memories marked public
  private  public and private memories (never anything marked secret-adjacent, at any level)

Claude, which runs through your own sign-in on this PC, starts at private. AIs reached by copy and paste leave this
computer when you paste, so they start at public. Raising one is a deliberate choice that shows exactly what would be sent."""
from __future__ import annotations

from . import abilities
from .db import Database
from .errors import ApiError

LEVELS = ("none", "public", "private")
DEFAULT_LEVEL = {"claude": "private", "gemini": "public", "perplexity": "public", "antigravity": "public"}
SENSITIVITIES = {"none": set(), "public": {"public"}, "private": {"public", "private"}}
LABEL = {"claude": "Claude", "gemini": "Gemini", "perplexity": "Perplexity", "antigravity": "Antigravity"}


def providers() -> list[str]:
    return sorted(DEFAULT_LEVEL)


def level(db: Database, provider: str) -> str:
    v = abilities.get_flag(db, f"sharing:{provider}", DEFAULT_LEVEL[provider])
    return v if v in LEVELS else DEFAULT_LEVEL[provider]


def allowed_sensitivities(db: Database, provider: str) -> set[str]:
    return set(SENSITIVITIES[level(db, provider)])


def set_level(db: Database, provider: str, new: str) -> str:
    if provider not in DEFAULT_LEVEL:
        raise ApiError(404, "unknown_provider", f"provider must be one of {providers()}")
    if new not in LEVELS:
        raise ApiError(422, "bad_level", f"level must be one of {list(LEVELS)}")
    old = level(db, provider)
    abilities.set_flag(db, f"sharing:{provider}", new)
    if new != old:
        abilities.receipt(db, actor="owner", kind="sharing.changed", changed=True,
                          summary=f"{LABEL[provider]} may now be told: {dict(none='nothing', public='public memories only', private='public and private memories')[new]}.")
    return new
