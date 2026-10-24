"""Secret scanner for this repo (substitute for GitHub push protection, which is unavailable on private
free-plan repos). Uses AIOS's own detectors. Prints path:line:kind ONLY, never the matched value.

  python scripts/scan_secrets.py --staged        # files in the git index (pre-commit hook)
  python scripts/scan_secrets.py --all           # every tracked file (CI)
  python scripts/scan_secrets.py --emit-allowlist  # print entries for current findings (then review by hand)

Known-synthetic fixtures are listed in .secret-allowlist as `path::kind  # reason`. Anything else fails."""
from __future__ import annotations

import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
from aios.security import SECRET_PATTERNS  # noqa: E402  (stdlib-only module)

CODE_EXT = {".py", ".ts", ".tsx", ".js", ".mjs", ".kt", ".java", ".gradle", ".ps1", ".sql", ".css", ".html"}
SKIP = re.compile(r"(package-lock\.json|requirements\.lock\.txt|gradle-wrapper\.jar|\.png$|\.jar$|openapi-v1\.json)")


def tracked(mode: str) -> list[str]:
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"] if mode == "staged" else ["git", "ls-files"]
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()


def read(path: str, mode: str) -> str | None:
    try:
        if mode == "staged":   # scan the staged blob, not the working copy
            return subprocess.run(["git", "show", f":{path}"], cwd=ROOT, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace").stdout
        return (ROOT / path).read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeDecodeError):
        return None


def findings(mode: str) -> list[tuple[str, int, str]]:
    out = []
    for f in tracked(mode):
        if SKIP.search(f):
            continue
        text = read(f, mode)
        if text is None:
            continue
        is_code = Path(f).suffix.lower() in CODE_EXT
        for kind, rx in SECRET_PATTERNS:
            if is_code and kind in ("assigned-secret", "bearer"):
                continue    # too noisy in source (variable assignments); still checked in config/docs/text
            for m in rx.finditer(text):
                out.append((f, text.count("\n", 0, m.start()) + 1, kind))
    return out


def load_allowlist() -> list[tuple[str, str]]:
    p = ROOT / ".secret-allowlist"
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if "::" in line:
            g, k = line.split("::", 1)
            rows.append((g.strip(), k.strip()))
    return rows


def allowed(f: str, kind: str, allow: list[tuple[str, str]]) -> bool:
    return any(fnmatch.fnmatch(f, g) and k in ("*", kind) for g, k in allow)


def main() -> int:
    args = set(sys.argv[1:])
    mode = "staged" if "--staged" in args else "all"
    found = findings(mode)
    if "--emit-allowlist" in args:
        for f, k in sorted({(f, k) for f, _, k in found}):
            print(f"{f}::{k}")
        return 0
    allow = load_allowlist()
    bad = [(f, ln, k) for f, ln, k in found if not allowed(f, k, allow)]
    for f, ln, k in bad:
        print(f"SECRET? {f}:{ln}: {k}")
    if bad:
        print(f"\n{len(bad)} possible secret(s) in {mode} files. Remove them, or if they are deliberate synthetic "
              "fixtures add `path::kind  # reason` to .secret-allowlist.", file=sys.stderr)
        return 1
    print(f"secret scan ok ({mode}: {len(found)} allowlisted synthetic match(es), 0 unexpected)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
