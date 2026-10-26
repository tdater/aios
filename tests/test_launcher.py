"""The clickable launcher: icons are created correctly, a first launch signs the browser in with a one-time code,
later launches do not mint a new device each time, and stopping really stops it. Runs the real scripts on a spare
port with a throwaway state folder. Windows only (the scripts drive the Windows shell)."""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
PS = shutil.which("powershell")
pytestmark = pytest.mark.skipif(sys.platform != "win32" or PS is None, reason="Windows PowerShell only")


def run_to_files(cmd: list[str], env: dict | None = None, timeout: int = 120) -> subprocess.CompletedProcess:
    """Capture output through files, not pipes: the launcher leaves a background server running, and that server would
    inherit a pipe and keep a pipe-reading parent waiting forever."""
    import tempfile
    with tempfile.TemporaryFile("w+") as out, tempfile.TemporaryFile("w+") as err:
        r = subprocess.run(cmd, stdout=out, stderr=err, stdin=subprocess.DEVNULL, text=True, timeout=timeout, env={**os.environ, **(env or {})})
        out.seek(0), err.seek(0)
        return subprocess.CompletedProcess(cmd, r.returncode, out.read(), err.read())


def ps(script: str, *args: str, env: dict | None = None, timeout: int = 120) -> subprocess.CompletedProcess:
    return run_to_files([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS / script), *args], env, timeout)


def link(path: Path) -> dict:
    out = subprocess.run([PS, "-NoProfile", "-Command",
                          f"$l=(New-Object -ComObject WScript.Shell).CreateShortcut('{path}'); "
                          "@{t=$l.TargetPath;a=$l.Arguments;i=$l.IconLocation;w=$l.WorkingDirectory} | ConvertTo-Json -Compress"],
                         capture_output=True, text=True, timeout=60).stdout
    return json.loads(out)


def test_shortcuts_point_at_the_launcher_with_the_aios_icon(tmp_path):
    state, dest = tmp_path / "state", tmp_path / "icons"
    r = ps("create_shortcuts.ps1", "-Folder", str(dest), env={"AIOS_STATE_DIR": str(state)})
    assert r.returncode == 0, r.stderr
    assert sorted(p.name for p in dest.iterdir()) == ["AIOS import folder.lnk", "AIOS sign-in code.lnk", "AIOS.lnk", "Stop AIOS.lnk"]
    main = link(dest / "AIOS.lnk")
    assert main["t"].lower().endswith("powershell.exe") and "launch.ps1" in main["a"] and "-WindowStyle Hidden" in main["a"]
    assert main["i"].lower().startswith(str(ROOT / "assets" / "aios.ico").lower()) and Path(main["w"]) == ROOT
    assert "-NewCode" in link(dest / "AIOS sign-in code.lnk")["a"]
    assert "stop.ps1" in link(dest / "Stop AIOS.lnk")["a"]
    imp = link(dest / "AIOS import folder.lnk")
    assert imp["t"].lower().endswith("explorer.exe") and (state / "imports" / "approved").is_dir()
    assert str(state / "imports" / "approved").lower() in imp["a"].lower()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def call(port: int, path: str, body: dict | None = None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}


@pytest.mark.skipif(not (ROOT / ".venv" / "Scripts" / "python.exe").exists(), reason="needs the installed virtual environment")
def test_first_launch_signs_in_with_a_one_time_code_and_later_launches_do_not(tmp_path):
    port = free_port()
    env = {"AIOS_STATE_DIR": str(tmp_path / "state"), "AIOS_PORT": str(port)}
    try:
        first = ps("launch.ps1", "-NoBrowser", env=env, timeout=180)
        assert first.returncode == 0, first.stderr
        url = first.stdout.strip().splitlines()[-1]
        m = re.fullmatch(rf"http://127\.0\.0\.1:{port}/#pair=([A-Z0-9-]{{8,12}})", url)
        assert m, url
        assert call(port, "/api/v1/meta")[0] == 200
        assert call(port, "/api/v1/home")[0] == 401                                  # nothing is reachable without signing in
        code = m.group(1)
        assert call(port, "/api/v1/auth/pair", {"code": code, "device_name": "launcher test", "kind": "browser"})[0] == 200
        assert call(port, "/api/v1/auth/pair", {"code": code, "device_name": "again", "kind": "browser"})[0] == 401   # single use

        again = ps("launch.ps1", "-NoBrowser", env=env)
        assert again.returncode == 0 and again.stdout.strip().splitlines()[-1] == f"http://127.0.0.1:{port}/"     # no new code, no new device

        fresh = ps("launch.ps1", "-NoBrowser", "-NewCode", env=env)
        assert "#pair=" in fresh.stdout and fresh.stdout.strip().splitlines()[-1] != url
    finally:
        ps("stop.ps1", env=env)
    with pytest.raises(Exception):
        call(port, "/api/v1/meta")                                                   # really stopped


def test_launching_without_an_install_says_what_to_do(tmp_path):
    # Run the launcher from a copy of the scripts in a folder that has no virtual environment.
    fake_root = tmp_path / "root"
    shutil.copytree(SCRIPTS, fake_root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
    r = run_to_files([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(fake_root / "scripts" / "launch.ps1"), "-NoBrowser"], timeout=60)
    assert r.returncode != 0 and "not installed yet" in (r.stderr + r.stdout)
