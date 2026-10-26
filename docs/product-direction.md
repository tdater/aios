# Product direction

AIOS is the primary interactive workspace for capable AI agents. It keeps their official, supported capabilities, coordinates
implementation, independent review, corrections, verification and knowledge sharing, and keeps the durable state itself.
Provider sessions are replaceable. This page says what is built toward that, what is proven, and what is not.

## Principles (each is enforced in code, not in a prompt)

- **AIOS owns durable state.** Conversations, runs, approvals, receipts, memories and workflow steps live in AIOS's database and
  vault. A provider session can be dropped and replaced; the next one is given what AIOS decides to tell it (`context_pack.py`,
  `briefing.py`).
- **Official integrations only.** Claude runs through the unmodified Claude Code CLI with your own sign-in. No API keys are read
  or stored. Gemini and Perplexity are used by copy and paste, in windows you open yourself. Antigravity is a manual handoff until a
  supported integration exists and you approve any billing; AIOS never starts it, and no manual handoff is presented as equivalent
  to an automated one.
- **Existing safety controls are preserved.** Nothing here weakens a path guard, an approval or a limit. A new capability must come
  with a reviewed replacement before an old control can change.
- **One execution foundation, progressive disclosure.** Developers and everyday users run the same engine. Simple, Standard and
  Power modes only change what is shown.

## Start to finish (the workflow)

`apps/api/aios/workflow.py`, `POST /conversations/{id}/workflow`, and the **Start to finish** tab.

One request goes through: **implement** (Claude, isolated worktree) → **verify** (your check, run by AIOS after you approve the
exact command) → **independent review** (a separate read-only Claude session on a different model) → **correct** (AIOS writes the
correction request from the recorded facts) → **re-verify** (you approve again) → **re-review** → **result** (AIOS decides READY) →
**knowledge candidates**.

How it is built:
- Every step is an ordinary run created through the same functions the buttons use. The workflow has no power of its own: it cannot
  approve a check, cannot merge (Apply stays a separate approval) and cannot start while AIOS is paused.
- State is in the database (`workflows`, `workflow_steps`). A step function, called by the engine's dispatch loop, advances it from
  recorded facts only, so it is safe to call repeatedly and survives a restart. An interrupted or blocked run hands the workflow back to
  you instead of being repeated.
- A correction that changes nothing ends the run with the reason, instead of spending more rounds. The number of rounds is capped
  (default 2, hard maximum 3).
- The reviewer judges the owner's original request, not the earlier reviewer's findings and not the correction note.
- Correction requests are AIOS-authored (`author_kind: aios`), clearly framed as reports to check rather than orders, redacted, and
  never mined for memories. Only facts AIOS observed itself become memory candidates (a check that passed, the number of rounds a reviewed
  change needed). Nothing is approved automatically.

### Capability profiles

A profile is the list of step kinds a workflow may take; `advance()` refuses any step the profile omits. Profiles are shown in the
interface with their plain-language permissions.

| Profile | Steps | Corrections |
|---|---|---|
| `build_and_check` (default) | implement, review, correct | up to 2 |
| `build_and_test` | implement, correct | up to 1, no review |

Fixed for every profile: Claude edits only an isolated copy; no shell and no network for Claude; the check needs your approval
every time; the review is a separate read-only session; AIOS decides readiness; merging is never part of a workflow.

## Proof

| Claim | Evidence | Status |
|---|---|---|
| The full loop works with correction, re-verify and re-review | `tests/test_workflow.py` (stand-in Claude whose behaviour changes per call): a reviewer finding triggers a correction, both checks are approved, the second reviewer sees only the original request, readiness is computed by AIOS, candidates are proposed, nothing is merged | Passing |
| A failed check is sent back and the fix is re-checked | same file | Passing |
| It stops honestly: corrections used up, a correction that changes nothing, no change made, cancel, pause, no check command, double start | same file | Passing |
| The straight path works on real Claude | `scripts/demo_workflow.py` on 2026-10-26, Claude Code 2.1.310, sonnet writing and opus reviewing: request, 1 approval, check passed, separate review session, READY, 0 corrections, project folder untouched, candidates proposed and none approved. 11 of 11 checks | Passed |
| A correction round works on real Claude | `scripts/demo_workflow.py --scenario duration_rules --model haiku` on 2026-10-26: Haiku implemented `parse_duration`, missed a house rule enforced by a test file the request did not mention (`__all__`), the check FAILED, AIOS wrote correction round 1 from the recorded failure, Haiku fixed it, the check was approved again and passed, a separate Sonnet review found no high-severity problems, READY after 1 of 2 corrections. 13 of 13 checks. Earlier attempts: a request saying "fix only `add`" made Claude correctly refuse to widen scope in two rounds (the workflow handed the decision back and exposed a no-op-correction bug, since fixed); a path-traversal request and a plain `parse_duration` request needed no correction | Passed once. One run is an existence proof, not a measurement of how often a correction fixes things |

The stand-in is a test double, not an integration. What the real runs prove is the straight path, one correction round and the
guardrails; they do not show that a real reviewer finds real problems (in every real run so far the reviewer found none, and the one
correction came from the check, not from a review finding) or how often a correction works. Measuring that needs a calibration set of
known-bad changes (the existing `--calibrate` mode of `scripts/demo_workspace.py` starts this for the reviewer alone).

## Not built yet

- Automatic Antigravity participation. It needs a verified supported integration and your explicit billing approval; until then it
  stays a manual handoff and is shown as one.
- Workflow steps outside coding (writing, research, household tasks) that reuse the same verify-and-review machinery.
- A calibration set that measures reviewer and corrector quality over many known cases.
- Sharing one workflow across two writers at once.
