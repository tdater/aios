"""Regenerate docs/openapi-v1.json (the committed API contract snapshot)."""
import json
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps" / "api"))
from aios.config import Settings  # noqa: E402
from aios.main import create_app  # noqa: E402

tmp = Path(tempfile.mkdtemp())
app = create_app(Settings(state_dir=tmp / "s", workspaces_dir=tmp / "w"))
(root / "docs" / "openapi-v1.json").write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n",
                                                 encoding="utf-8")
print("wrote docs/openapi-v1.json")
