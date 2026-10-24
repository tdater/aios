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
    approval_ttl_s: int = 24 * 3600
    # Where approved skills are deployed (git-tracked) and where their regression cases live.
    skills_dir: Path = REPO_ROOT / ".claude" / "skills"
    evals_dir: Path = REPO_ROOT / "evals" / "skills"
    # Extra Host names the server answers to (e.g. a Tailscale name). Binding stays on loopback;
    # a reverse proxy such as `tailscale serve` terminates TLS in front of it.
    allowed_hosts: tuple[str, ...] = ()
    # Origins allowed to call the API with a Bearer token from a WebView/other site (no cookies).
    cors_origins: tuple[str, ...] = ("https://localhost", "capacitor://localhost", "http://localhost")

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
    def approved_dir(self) -> Path:
        """The only place history sources are ever read from. Private state, never in Git."""
        return self.state_dir / "imports" / "approved"

    @property
    def runs_dir(self) -> Path:
        return self.state_dir / "runs"

    def ensure_dirs(self) -> None:
        for d in (self.state_dir / "db", self.artifacts_dir, self.backups_dir, self.runs_dir,
                  self.approved_dir, self.state_dir / "imports" / "quarantine",
                  *(self.vault_dir / s for s in
                    ("projects", "decisions", "lessons", "procedures", "preferences", "facts",
                     "research", "inbox"))):
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
        approval_ttl_s=int(os.environ.get("AIOS_APPROVAL_TTL_S", str(24 * 3600))),
        allowed_hosts=tuple(h.strip().lower() for h in os.environ.get("AIOS_ALLOWED_HOSTS", "").split(",")
                            if h.strip()),
        cors_origins=tuple(o.strip() for o in os.environ.get(
            "AIOS_CORS_ORIGINS", "https://localhost,capacitor://localhost,http://localhost").split(",")
            if o.strip()),
    )
