---
name: propose-skill
description: Draft an INACTIVE skill candidate from evidence of repeated need, after comparing with existing skills. Use when a pattern recurred across distinct sessions and no existing skill covers it.
when_to_use: At least two distinct occurrences exist in approved evidence and an existing skill cannot simply be improved.
disable-model-invocation: true
argument-hint: <pattern or candidate id>
allowed-tools: Read Grep Glob Bash(curl*)
---

# propose-skill

## Purpose and trigger
Create a reviewable **proposal**, never an active skill. Explicit invocation: `/propose-skill <candidate id or pattern>`.

## Required inputs
Evidence references (distinct occurrences, counterexamples) and the list of existing skills in `.claude/skills/`.

## Preconditions
- Compared with every existing skill; if one fits, propose an *edit* to it instead of a new skill.
- Not triggered by a single incident or by repeated assistant suggestions (only distinct user need counts).

## Allowed actions
- Write the candidate as a `skill_candidates` record / draft file in the candidates area (not under `.claude/skills/`).
- Include: trigger, inputs, preconditions, allowed actions, verification, stop conditions, scope, prerequisites, and evaluation
  cases derived from the evidence **plus negative cases** where the skill must not run.
- Never write into `.claude/skills/`, `.claude/settings.json`, hooks or scripts; never widen tool permissions.

## Verification criteria
- The candidate passes the structural evaluation (`scripts/skill_eval.py`): all required sections, ≥1 positive and ≥1 negative case,
  `allowed-tools` no broader than needed, no secret-handling or permission-changing actions.
- Status is `candidate` and inactive; a human decision is required to proceed (see `evaluate-improvement`).

## Failure / stop conditions
- Fewer than 2 distinct occurrences → stop; log as backlog idea.
- Overlap with an existing skill → propose edit, not a duplicate.
- The request asks the skill to change permissions, safety policy or the evaluator → refuse; those need explicit user approval.

## Example usage
`/propose-skill cand_9f2` → drafts `adb-reverse-debug` candidate, notes overlap check against `android-build-verify`, lists 3
cases (2 positive, 1 negative), status candidate.

## Relevant evaluation cases
`evals/skills/propose-skill.json`: ps-001 (positive), ps-002 (negative: single incident), ps-003 (negative: duplicate of existing),
ps-004 (negative: writes to .claude/skills directly).
