import json
import subprocess
from pathlib import Path

import pytest

from aios import services
from aios.config import Settings
from aios.db import Database
from aios.engine import Engine
from aios.executors import audit, capture, claude_turn, demo, provider_task  # noqa: F401


@pytest.fixture()
def settings(tmp_path):
    s = Settings(state_dir=tmp_path / "state", workspaces_dir=tmp_path / "ws")
    s.ensure_dirs()
    return s


@pytest.fixture()
def db(settings):
    d = Database(settings.db_path)
    d.migrate()
    return d


@pytest.fixture()
def engine(settings, db):
    return Engine(settings, db)


@pytest.fixture()
def sample_ws(tmp_path):
    root = tmp_path / "ws" / "sample"
    (root / "src").mkdir(parents=True)
    (root / "src" / "app.py").write_text("# TODO fix\nprint('hi')\n")
    (root / "config.txt").write_text("api_key = abcdefghijklmnop1234\n")
    (root / "README.md").write_text("# sample\n")
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    return root


@pytest.fixture()
def project(db, settings, sample_ws):
    return services.register_project(db, settings, "Sample", str(sample_ws))


def run_task(engine, db, kind, *, project=None, spec=None, acceptance=None, **run_kw):
    t = services.create_task(db, title=kind, kind=kind, project_id=project["id"] if project else None,
                             spec=spec, acceptance=acceptance)
    r = engine.create_run(t["id"], **run_kw)
    return t, r, engine.execute(r["id"])
