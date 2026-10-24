---
name: workflow-audit
description: Audit explicitly registered sources for repetitive manual steps, recurring failures, missing verification and automation candidates, with labelled estimates. Use when asked to find automation opportunities.
when_to_use: User asks where time is wasted or what could be automated, for named/registered sources only.
disable-model-invocation: true
argument-hint: <registered project or approved source id>
allowed-tools: Read Grep Glob Bash(curl*)
---

# workflow-audit

## Purpose and trigger
Rank automation/skill candidates from **evidence in registered or approved sources** (audit reports, approved history candidates,
run records). Explicit invocation: `/workflow-audit <project>`.

## Required inputs
A registered project or approved history source. No source named → ask; never scan unrelated folders or activity.

## Preconditions
- The source is registered/approved (visible in AIOS Projects or History sources).
- History candidates, if used, come from the review queue (status candidate/approved), not raw imports.

## Allowed actions
- Read AIOS run/audit/candidate data through the API. Compute counts. Draft a ranked list.
- Do not create skills, scripts or schedules. Output is a report only.

## Verification criteria
- Each proposal lists: observed frequency (count of **distinct** occurrences), reliability, effort, risk, provider cost.
- Time savings are labelled `measured` (with source) or `estimated` (with stated assumption) or `unknown`. Never fabricated.
- Prefer deterministic scripts over LLM workflows when no judgment is needed, and say why.
- Duplicate or repeated assistant recommendations are not counted as repeated user need.

## Failure / stop conditions
- Fewer than 2 distinct occurrences → list as "isolated incident", do not propose a general rule.
- Evidence missing or source not approved → stop and say what is needed.

## Example usage
`/workflow-audit my-android-app` → "gradlew assembleDebug run manually in 5 sessions (script candidate, savings unknown,
no timing data); no tests dir (verification gap)."

## Relevant evaluation cases
`evals/skills/workflow-audit.json`: audit-001 (positive), audit-002 (negative: unregistered folder), audit-003 (negative: fabricated
savings must be refused), audit-004 (negative: single incident not generalized).
