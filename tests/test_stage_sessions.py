"""scripts/stage_claude_sessions.py against FAKE directories only (the real Claude folder is never touched by tests)."""
import importlib.util
import os
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("stage_claude_sessions", Path(__file__).resolve().parents[1] / "scripts" / "stage_claude_sessions.py")
stage_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage_mod)


def make(tmp_path):
    src = tmp_path / "projects"
    for name, n in (("proj-a", 3), ("proj-b", 1)):
        (src / name).mkdir(parents=True)
        for i in range(n):
            f = src / name / f"s{i}.jsonl"
            f.write_text(f'{{"i": {i}}}\n', encoding="utf-8")
            os.utime(f, (1_700_000_000 + i * 100, 1_700_000_000 + i * 100))
    (src / "empty").mkdir()
    (src / "proj-a" / "notes.txt").write_text("not a session", encoding="utf-8")
    return src


def test_list_shows_names_counts_and_sizes_only(tmp_path):
    rows = stage_mod.list_projects(make(tmp_path))
    assert [(r["name"], r["files"]) for r in rows] == [("proj-a", 3), ("proj-b", 1)]
    assert set(rows[0]) == {"name", "files", "bytes", "newest"}                  # no content


def test_stage_copies_newest_n_into_the_approved_folder_and_is_idempotent(tmp_path):
    src, approved = make(tmp_path), tmp_path / "approved"
    done = stage_mod.stage(src, "proj-a", 2, approved)
    assert done == ["claude-code/proj-a/s2.jsonl", "claude-code/proj-a/s1.jsonl"]
    assert sorted(p.name for p in (approved / "claude-code" / "proj-a").iterdir()) == ["s1.jsonl", "s2.jsonl"]
    assert stage_mod.stage(src, "proj-a", 2, approved) == []                      # nothing new on the second run
    assert len(stage_mod.stage(src, "proj-a", 3, approved)) == 1                  # only the missing one


def test_dry_run_copies_nothing(tmp_path):
    src, approved = make(tmp_path), tmp_path / "approved"
    assert len(stage_mod.stage(src, "proj-b", 5, approved, dry_run=True)) == 1
    assert not approved.exists()


@pytest.mark.parametrize("bad", ["", ".", "..", "../proj-a", "proj-a/..", "proj-a\\x", "missing"])
def test_project_must_be_one_existing_folder_name(tmp_path, bad):
    with pytest.raises(ValueError):
        stage_mod.stage(make(tmp_path), bad, 1, tmp_path / "approved")


def test_limit_is_bounded(tmp_path):
    src = make(tmp_path)
    for bad in (0, 201):
        with pytest.raises(ValueError):
            stage_mod.stage(src, "proj-a", bad, tmp_path / "approved")


def test_symlinked_sessions_are_not_followed(tmp_path):
    src, approved = make(tmp_path), tmp_path / "approved"
    secret = tmp_path / "secret.txt"
    secret.write_text("do not copy", encoding="utf-8")
    try:
        (src / "proj-b" / "link.jsonl").symlink_to(secret)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not permitted here")
    stage_mod.stage(src, "proj-b", 10, approved)
    assert not (approved / "claude-code" / "proj-b" / "link.jsonl").exists()
