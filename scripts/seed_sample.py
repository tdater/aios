"""Create a small sample workspace OUTSIDE the repo (default: ../aios-workspaces/sample-project).
Contains a fake secret and a TODO on purpose so the audit has something real to find.
Registering it with AIOS is a separate, explicit step (UI or POST /api/projects)."""
import os
import subprocess
import sys
from pathlib import Path

root = Path(os.environ.get("AIOS_WORKSPACES_DIR", Path(__file__).resolve().parents[2] / "aios-workspaces")) / "sample-project"
(root / "app").mkdir(parents=True, exist_ok=True)
(root / "README.md").write_text("# Sample project\n\nSeed workspace for AIOS audits.\n", encoding="utf-8")
(root / "app" / "main.py").write_text("# TODO: add tests\ndef add(a, b):\n    return a + b\n", encoding="utf-8")
(root / "settings.ini").write_text("api_key = FAKE-not-a-real-key-123456\n", encoding="utf-8")
if not (root / ".git").exists():
    subprocess.run(["git", "init", "-q", "-b", "main", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(["git", "-C", str(root), "-c", "user.name=aios-seed", "-c", "user.email=seed@localhost",
                    "commit", "-q", "-m", "seed"], check=True)
print(root)
sys.exit(0)
