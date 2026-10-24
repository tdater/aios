---
name: capture-lesson
description: Record a lesson, decision or procedure from completed work as a CANDIDATE memory with evidence references. Use after a problem was resolved or a durable decision was made.
when_to_use: A fix, workaround, decision or preference was confirmed by evidence (test result, user statement) and should be remembered.
argument-hint: <what was learned>
allowed-tools: Read Grep Bash(curl*)
---

# capture-lesson

## Purpose and trigger
Turn a verified outcome into a reviewable memory. Invoked by `/capture-lesson <text>` or when the user says "remember this".

## Required inputs
The lesson text, its scope (default: **project**; global only if the user says so), the type
(preference | fact | decision | lesson | procedure), and the evidence (run id, test output, user quote).

## Preconditions
- Evidence exists. An assistant claiming "that fixed it" is not evidence; a passing test or a user confirmation is.
- No secrets in the text; redact before saving.

## Allowed actions
- Create a memory with status `candidate` via the AIOS memory API (POST /memories). Link its evidence.
- Never set status `approved`, never supersede or delete an existing memory, never promote to global scope on your own.

## Verification criteria
- Saved record has: id, scope, type, basis (`observation` for what happened, `inference` for conclusions), evidence refs,
  confidence, sensitivity, created date.
- Observations and inferences are written separately.
- A search for the title finds exactly one record (no duplicate of an existing memory; update instead).

## Failure / stop conditions
- No evidence → do not save; say what evidence is missing.
- Contradicts an approved memory → save as candidate with a conflict note; never overwrite.
- Isolated single incident → label `single occurrence`, scope project, low confidence.

## Example usage
`/capture-lesson pytest failure "N failed" was fixed by re-running migrations (run_abc, 104 passed)` → candidate lesson,
project scope, evidence run_abc.

## Relevant evaluation cases
`evals/skills/capture-lesson.json`: cl-001 (positive), cl-002 (negative: assistant claim without evidence), cl-003 (negative:
must not approve), cl-004 (negative: no global scope from one incident).
