"""The secret scanner guards the repo, so it gets tested too (including: it never prints the secret)."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "scan_secrets.py"


def run(*args, cwd=ROOT):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), *args], cwd=cwd, capture_output=True, text=True)


def test_repository_is_currently_clean():
    r = run("--all")
    assert r.returncode == 0, r.stdout + r.stderr


def make_repo(tmp_path, files: dict[str, str]):
    """A scratch repo that reuses the real scanner by copying it plus the detector module."""
    import shutil
    (tmp_path / "scripts").mkdir()
    shutil.copy(SCRIPT, tmp_path / "scripts" / "scan_secrets.py")
    (tmp_path / "apps" / "api" / "aios").mkdir(parents=True)
    shutil.copy(ROOT / "apps" / "api" / "aios" / "security.py", tmp_path / "apps" / "api" / "aios" / "security.py")
    (tmp_path / "apps" / "api" / "aios" / "__init__.py").write_text("")
    for name, body in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)


def scan(tmp_path, *args):
    return subprocess.run([sys.executable, "-I", str(tmp_path / "scripts" / "scan_secrets.py"), *args],
                          cwd=tmp_path, capture_output=True, text=True)


def test_detects_a_planted_secret_and_never_prints_it(tmp_path):
    secret = "ghp_" + "Z9" * 18
    make_repo(tmp_path, {"config/prod.ini": f"token = {secret}\n", "src/ok.py": "x = 1\n"})
    r = scan(tmp_path, "--all")
    assert r.returncode == 1
    assert "config/prod.ini" in r.stdout and "github-token" in r.stdout
    assert secret not in r.stdout + r.stderr


def test_allowlist_is_path_and_kind_specific(tmp_path):
    key = "sk-ant-api03-" + "q" * 20
    make_repo(tmp_path, {"tests/t.py": f'K = "{key}"\n', "src/leak.py": f'K = "{key}"\n',
                         ".secret-allowlist": "tests/t.py::anthropic-key  # synthetic\n"})
    r = scan(tmp_path, "--all")
    assert r.returncode == 1
    assert "src/leak.py" in r.stdout and "tests/t.py" not in r.stdout          # only the unlisted file fails
    assert key not in r.stdout + r.stderr


def test_staged_mode_checks_the_index_not_the_working_copy(tmp_path):
    key = "AKIA" + "ABCDEFGHIJKLMNOP"
    make_repo(tmp_path, {"a.txt": f"id {key}\n"})
    assert scan(tmp_path, "--staged").returncode == 1
    (tmp_path / "a.txt").write_text("clean\n")                                   # working copy fixed, index still dirty
    assert scan(tmp_path, "--staged").returncode == 1
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    assert scan(tmp_path, "--staged").returncode == 0


def test_installed_pre_commit_hook_blocks_a_real_commit_and_allows_a_clean_one(tmp_path):
    hook_text = (ROOT / ".git" / "hooks" / "pre-commit").read_text() if (ROOT / ".git" / "hooks" / "pre-commit").exists() else None
    if hook_text is None:
        import pytest
        pytest.skip("hook not installed in this clone (run scripts/install-hooks.ps1)")
    make_repo(tmp_path, {"notes.txt": "ghp_" + "Y4" * 18 + "\n"})
    hook = tmp_path / ".git" / "hooks" / "pre-commit"
    hook.write_text(hook_text, encoding="ascii", newline="\n")
    commit = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "x"]
    blocked = subprocess.run(commit, cwd=tmp_path, capture_output=True, text=True)
    assert blocked.returncode != 0 and "SECRET?" in blocked.stdout + blocked.stderr
    (tmp_path / "notes.txt").write_text("nothing secret\n")
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    assert subprocess.run(commit, cwd=tmp_path, capture_output=True, text=True).returncode == 0


def test_source_code_assignments_are_not_noise_but_config_files_are_checked(tmp_path):
    make_repo(tmp_path, {"app.ts": "const token = computeSomethingLong(x)\n", "settings.properties": "password = hunter2hunter2\n"})
    r = scan(tmp_path, "--all")
    assert "app.ts" not in r.stdout and "settings.properties" in r.stdout
