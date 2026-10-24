"""Runtime settings. Source, private state, and managed workspaces are separate trees."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    workspaces_dir: Path
    host: str = "127.0.0.1"
    port: int = 8765
    max_concurrent: int = 2
    default_deadline_s: int = 300
    stall_after_s: int = 120

    @property
    def db_path(self) -> Path:
        return self.state_dir / "db" / "aios.sqlite"

    @property
    def artifacts_dir(self) -> Path:
        return self.state_dir / "artifacts"

    @property
    def vault_dir(self) -> Path:
        return self.state_dir / "vault"

    @property
    def backups_dir(self) -> Path:
        return self.state_dir / "backups"

    @property
    def runs_dir(self) -> Path:
        return self.state_dir / "runs"

    def ensure_dirs(self) -> None:
        for d in (self.state_dir / "db", self.artifacts_dir, self.backups_dir, self.runs_dir,
                  *(self.vault_dir / s for s in
                    ("projects", "decisions", "lessons", "procedures", "research", "inbox"))):
            d.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    host = os.environ.get("AIOS_HOST", "127.0.0.1")
    if host not in LOOPBACK_HOSTS:
        raise RuntimeError(
            f"AIOS_HOST={host!r} is not loopback. Remote access requires a separately "
            "approved authenticated setup; refusing to bind.")
    state = Path(os.environ.get("AIOS_STATE_DIR", REPO_ROOT.parent / "aios-state")).resolve()
    ws = Path(os.environ.get("AIOS_WORKSPACES_DIR", REPO_ROOT.parent / "aios-workspaces")).resolve()
    if REPO_ROOT in (state, *state.parents) or state in (REPO_ROOT, *REPO_ROOT.parents):
        raise RuntimeError("AIOS_STATE_DIR must be outside the source repository.")
    return Settings(
        state_dir=state, workspaces_dir=ws, host=host,
        port=int(os.environ.get("AIOS_PORT", "8765")),
        max_concurrent=int(os.environ.get("AIOS_MAX_CONCURRENT", "2")),
    )
