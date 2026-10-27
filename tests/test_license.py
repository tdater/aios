"""The project is MIT licensed: the file, the package metadata and the README agree."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_the_license_is_mit_and_every_place_that_names_it_agrees():
    text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert text.startswith("MIT License") and "Copyright (c) 2026" in text and "WITHOUT WARRANTY OF ANY KIND" in text
    assert 'license = "MIT"' in (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "MIT, see `LICENSE`" in (ROOT / "README.md").read_text(encoding="utf-8")
