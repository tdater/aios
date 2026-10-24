"""Deterministic STRUCTURAL evaluator for skill definitions (the evaluator for AIOS skill proposals).

It checks things that can be checked by code: required sections, frontmatter, evaluation-case coverage (positive AND negative),
tool-permission breadth, and forbidden self-modification. It does NOT judge behaviour; behavioural cases in evals/skills/*.json
are specifications for a human/model-run evaluation and are reported as `not_executed`, never as passed.

  python scripts/skill_eval.py                 # evaluate every skill in .claude/skills
  python scripts/skill_eval.py path/SKILL.md   # evaluate one file (used for proposals)

This file is part of the safety boundary: self-improvement may not modify it without explicit user approval."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_SECTIONS = ["Purpose and trigger", "Required inputs", "Preconditions", "Allowed actions", "Verification criteria",
                     "Failure / stop conditions", "Example usage", "Relevant evaluation cases"]
REQUIRED_FRONTMATTER = ["name", "description"]
PROTECTED = ["scripts/claude_guard.py", ".claude/settings.json", "scripts/skill_eval.py", "scripts/scan_secrets.py",
             ".secret-allowlist"]
# Tools a skill may never request: unrestricted shells and anything that edits permissions/policy.
BROAD_TOOLS = re.compile(r"(^|\s)(Bash|PowerShell)(\s|$)")


def parse(text: str) -> tuple[dict, str]:
    m = re.match(r"---\n(.*?)\n---\n(.*)\Z", text, re.S)
    if not m:
        return {}, text
    fm = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        if v:
            fm[k.strip()] = v.strip()
    return fm, m.group(2)


def evaluate_text(text: str, name_hint: str, evals: dict | None, allow_broad_tools: set[str] | None = None) -> list[dict]:
    """Return a list of {case, status: pass|fail|not_executed, detail}."""
    res: list[dict] = []

    def add(case, ok, detail=""):
        res.append({"case": case, "status": "pass" if ok else "fail", "detail": detail})
    fm, body = parse(text)
    add("frontmatter-present", bool(fm), "SKILL.md must start with --- frontmatter")
    for k in REQUIRED_FRONTMATTER:
        add(f"frontmatter-{k}", bool(fm.get(k)), f"missing '{k}'")
    add("name-matches-directory", fm.get("name") == name_hint, f"name={fm.get('name')!r} dir={name_hint!r}")
    add("description-substantive", len(fm.get("description", "")) >= 40, "description too short to trigger reliably")
    for s in REQUIRED_SECTIONS:
        add(f"section:{s}", bool(re.search(rf"^##\s+{re.escape(s)}\s*$", body, re.M)), f"missing section '{s}'")
    tools = fm.get("allowed-tools", "")
    broad = bool(BROAD_TOOLS.search(tools))
    add("no-unrestricted-shell", not broad or name_hint in (allow_broad_tools or set()),
        "allowed-tools grants an unrestricted shell; scope it (e.g. Bash(git status*)) or get explicit approval")
    for p in PROTECTED:
        # Mentioning protected files as OUT OF SCOPE is fine; editing them is not.
        pat = rf"(Edit|Write)\([^)]*{re.escape(p)}"
        add(f"no-protected-write:{p}", not re.search(pat, tools), f"allowed-tools lets the skill write {p}")
    add("no-permission-changes", not re.search(r"(?i)(update-config|settings\.json.*(write|edit)|chmod|icacls)", tools),
        "skills may not change permissions")
    ref = re.search(r"##\s+Relevant evaluation cases\s*\n(.*)\Z", body, re.S)
    ids = set(re.findall(r"\b([a-z]{2,12}-\d{3})\b", ref.group(1))) if ref else set()
    add("cases-referenced", len(ids) >= 3, f"found {sorted(ids)}")
    if evals is None:
        add("eval-file-exists", False, f"evals/skills/{name_hint}.json missing")
        return res
    cases = evals.get("cases", [])
    kinds = {c.get("kind") for c in cases}
    add("eval-has-positive", "positive" in kinds)
    add("eval-has-negative", "negative" in kinds, "a skill needs cases where it must NOT run")
    add("eval-ids-match-skill", {c["id"] for c in cases} == ids, f"skill refs {sorted(ids)} vs file {sorted(c['id'] for c in cases)}")
    add("eval-cases-complete", all(c.get("prompt") and c.get("expect") for c in cases), "every case needs prompt and expect")
    for c in cases:   # behavioural execution is out of scope here: never report as passed
        res.append({"case": f"behaviour:{c['id']}", "status": "not_executed", "detail": "needs a human/model-run evaluation"})
    return res


def load_evals(skill: str, evals_dir: Path) -> dict | None:
    p = evals_dir / f"{skill}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv] or sorted((ROOT / ".claude" / "skills").glob("*/SKILL.md"))
    failed = 0
    for t in targets:
        name = t.parent.name
        results = evaluate_text(t.read_text(encoding="utf-8"), name, load_evals(name, ROOT / "evals" / "skills"))
        bad = [r for r in results if r["status"] == "fail"]
        ne = sum(1 for r in results if r["status"] == "not_executed")
        print(f"{name}: {len(results) - len(bad) - ne} passed, {len(bad)} failed, {ne} behavioural cases not executed")
        for r in bad:
            print(f"   FAIL {r['case']}: {r['detail']}")
        failed += len(bad)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
