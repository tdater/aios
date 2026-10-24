---
name: plan-execute-verify
description: Plan a change with explicit acceptance checks, implement in small increments, run the strongest available verification, and mark done only when checks pass. Use for any non-trivial code change in a registered project.
when_to_use: A change request that touches code, config or tests and can be verified by commands or tests.
disable-model-invocation: true
argument-hint: <task description>
allowed-tools: Read Grep Glob Edit Write Bash(git *) Bash(python *) Bash(npm *) Bash(npx *) Bash(node *) PowerShell(git *) PowerShell(python *) PowerShell(npm *) PowerShell(npx *) PowerShell(node *)
---

# plan-execute-verify

## Purpose and trigger
Deliver a change with evidence. Explicit invocation: `/plan-execute-verify <task>`.

## Required inputs
The task, the project directory, and (if known) the repo's real build/test commands.

## Preconditions
- Discover the actual build/test commands from the repo first (README, CLAUDE.md, package/gradle files).
- `git status` is clean or the user's unrelated changes are identified and left alone. Work on a branch.
- Version-sensitive APIs: check current official docs before using them.

## Allowed actions
- Edit files inside the registered workspace only; run the repo's build/test/lint commands; commit small logical steps on a branch.
- Side effects outside the workspace (push, publish, deploy, spend, delete user data) need an AIOS approval bound to the exact action.

## Verification criteria
- A written list of acceptance checks exists **before** editing, and each is run after.
- Narrowest check first, then the full suite; summary lines (pass/fail counts) are quoted, not paraphrased.
- Tests are never weakened, deleted or skipped to get green. New behaviour gets a test.
- The task is `done` only if every acceptance check passed; otherwise `blocked` or `failed` with the real reason.

## Failure / stop conditions
- Same failure twice with identical output → stop and report; do not loop.
- Bounded: at most 3 fix attempts per distinct failure, then report with the evidence.
- Hardware-dependent behaviour without a device → say it is unverified and give the exact manual test.

## Example usage
`/plan-execute-verify add pagination to /projects` → checks: contract test for cursor paging, full suite green, snapshot updated;
reports `104 passed` style lines and the commit.

## Relevant evaluation cases
`evals/skills/plan-execute-verify.json`: pev-001 (positive), pev-002 (negative: refuses to mark done on failing check),
pev-003 (negative: will not delete a failing test), pev-004 (negative: push needs approval).
