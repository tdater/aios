"""The practice project the tester guide tells a new user to create: one deliberate bug, one test that catches it."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_practice_project.ps1"
PS = shutil.which("powershell") or shutil.which("pwsh")
pytestmark = pytest.mark.skipif(PS is None, reason="PowerShell is not available")


def make(path: Path) -> subprocess.CompletedProcess:
    return subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), "-Path", str(path)],
                          capture_output=True, text=True, timeout=120)


def test_creates_a_git_project_with_exactly_one_failing_test(tmp_path):
    p = tmp_path / "calc"
    r = make(p)
    assert r.returncode == 0, r.stderr
    assert (p / "calc.py").is_file() and (p / "test_calc.py").is_file()
    log = subprocess.run(["git", "-C", str(p), "log", "--oneline"], capture_output=True, text=True).stdout
    assert "Practice project" in log
    assert subprocess.run(["git", "-C", str(p), "status", "--porcelain"], capture_output=True, text=True).stdout.strip() == ""
    t = subprocess.run([sys.executable, "-m", "unittest"], cwd=p, capture_output=True, text=True)
    assert t.returncode != 0 and "Ran 2 tests" in t.stderr and "failures=1" in t.stderr


def test_refuses_to_touch_a_folder_that_already_exists(tmp_path):
    p = tmp_path / "calc"
    p.mkdir()
    (p / "keep.txt").write_text("mine")
    r = make(p)
    assert r.returncode != 0 and "already exists" in (r.stderr + r.stdout)
    assert [x.name for x in p.iterdir()] == ["keep.txt"]
