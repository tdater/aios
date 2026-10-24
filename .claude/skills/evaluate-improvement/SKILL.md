---
name: evaluate-improvement
description: Evaluate a proposed skill/workflow change with executable checks and the regression set, record results, and recommend (never perform) promotion. Use after a proposal exists.
when_to_use: A skill candidate or improvement proposal needs an objective evaluation before review.
disable-model-invocation: true
argument-hint: <proposal id>
allowed-tools: Read Grep Glob Bash(python scripts/skill_eval.py*) Bash(curl*)
---

# evaluate-improvement

## Purpose and trigger
Separate the **evaluator** from the **author**. Explicit invocation: `/evaluate-improvement <proposal id>`.

## Required inputs
Proposal id and its candidate content; the regression evaluation set under `evals/`.

## Preconditions
- You did not author the proposal in this session (use a fresh context) or you state that independence is not available.
- The evaluator, safety policy and your own permissions are **out of scope** to change: `scripts/claude_guard.py`,
  `.claude/settings.json`, `scripts/skill_eval.py`, `scripts/scan_secrets.py`, `.secret-allowlist`.

## Allowed actions
- Run `python scripts/skill_eval.py` (executable checks) and the regression cases; record each result with the case id.
- Agreement from another model is not proof. Prefer executable tests and objective evidence.
- Recommend `reject`, `needs-work` or `ready-for-review`. Never promote, deploy, or roll back; that is a human action in AIOS.

## Verification criteria
- Every case result is stored (case id, subject, pass/fail, detail). A failed case blocks "ready-for-review".
- New and existing (regression) cases both ran; counts are reported verbatim.
- If the change touches protected files or permissions, the recommendation is `needs-explicit-approval` regardless of results.

## Failure / stop conditions
- Evaluator code changed in the same proposal → stop, flag as protected-change.
- A case cannot be executed (missing tool/device) → record `not_verifiable`, never `pass`.

## Example usage
`/evaluate-improvement prop_17` → "12/12 structural + regression cases passed; touches no protected files → ready-for-review (human
approval still required)."

## Relevant evaluation cases
`evals/skills/evaluate-improvement.json`: ei-001 (positive), ei-002 (negative: must not promote), ei-003 (negative: protected files
require explicit approval), ei-004 (negative: unexecutable case is not_verifiable, not pass).
