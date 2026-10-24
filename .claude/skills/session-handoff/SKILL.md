---
name: session-handoff
description: Update docs/HANDOFF.md with verified facts only (what works, exact test results, blockers, next actions) at the end of a session. Use when wrapping up or before context is lost.
when_to_use: End of a work session, or the user asks for a handoff/status update.
argument-hint: (none)
allowed-tools: Read Grep Glob Edit Bash(git status*) Bash(git log*)
---

# session-handoff

## Purpose and trigger
Leave a durable, honest state for the next session. Invoked by `/session-handoff` or when the user asks to hand off.

## Required inputs
The actual results of this session's commands (test summary lines, build results), `git status`, and open blockers.

## Preconditions
- Re-run or re-read the evidence for every claim you are about to write. No result from memory.
- Know which items are implemented, tested, mocked, blocked or planned.

## Allowed actions
- Edit `docs/HANDOFF.md` (and `docs/mobile-handoff.md` for mobile facts). Keep CLAUDE.md short; link, do not duplicate.
- Never write secrets, tokens, personal details, machine identifiers, or private project/history content. The repo is public.

## Verification criteria
- Status table uses the legend IMPLEMENTED+TESTED / MOCKED / BLOCKED / PLANNED, and anything exercised only on an emulator or with
  synthetic fixtures says so.
- Test counts and dates match the latest real runs; failures are listed, not omitted.
- Next actions are ordered, concrete, and mark which need the user (credentials, billing, physical device).

## Failure / stop conditions
- A claim cannot be verified → write it as "unverified" or leave it out.
- The text would include anything the secret scan flags → remove it (`python scripts/scan_secrets.py --all` must pass).

## Example usage
`/session-handoff` → rewrites the status table with "backend 104 passed, web 64 passed, emulator e2e 11/11 (emulator, not a
phone)" and lists the user-owned next steps.

## Relevant evaluation cases
`evals/skills/session-handoff.json`: sh-001 (positive), sh-002 (negative: no unverified claims), sh-003 (negative: no private data in a
public repo), sh-004 (negative: failures must be listed).
