# Product goal (course correction, 2026-10-24)

AIOS is one project workspace where the owner can interact with available official AI tools, coordinate
implementation and review, inspect actual changes and verification, and carry relevant knowledge into future
sessions.

Manual handoffs are fallback modes, not the product's identity. Existing infrastructure (run engine, approvals,
vault, history review) is kept; note-taking features are demoted, not expanded.

## Order of work

Status on 2026-10-25: steps 1 and 2 done; step 3 and the second reviewer done and demonstrated with the real Claude
Code CLI; steps 4 and 5 partly done. Exact state and what is still open: `docs/HANDOFF.md`.

1. Verify what the repository really does (done: `docs/integration-findings.md`).
2. Resolve the integration blocker before adding UI: official docs and terms, then the smallest real supported
   connection outside the UI. No token extraction, no unofficial subscription proxy, no paid API use without
   approval. Classify every provider as A supported integrated execution, B user-started official session
   connected through supported tools, C manual packet handoff, or D unsupported/blocked. Never ship C and call it A.
3. First real workspace on a disposable repository: project selection, one conversation, a real provider turn,
   persisted attributed messages, context from AIOS, a real patch artifact, real verification output, honest
   provider/session/permission status. One provider first, then a second independent reviewer.
4. Real collaboration: provider A proposes a small change, provider B reviews the patch at a known revision,
   findings land in the same workspace, accepted revisions are applied safely, verification runs on the integrated
   result, the outcome links to evidence. One writer per worktree; isolated worktrees for parallel changes. The
   coordinator is deterministic; no paid coordinator model by default.
5. Memory that serves execution: per task, retrieve approved preferences, project decisions, verified lessons,
   provider operating notes, skills and verification procedures; record which versions were supplied. After
   verified work, propose a lesson with evidence and uncertainty, evaluate executable changes, require approval,
   and demonstrate retrieval in a fresh session. Rule-based history candidates are never described as
   comprehensive understanding of history.

Perplexity stays a manual research handoff unless a programmatic integration is separately authorized; Perplexity
Pro is not assumed to include API access.

## UI priority

Main: Projects, Conversation, Agent activity, Changes, Tests, Outcomes.
Secondary: Knowledge, History review, Skills, Configuration.
Existing notes and private state are never removed.

## Milestone rule

The milestone is not complete until at least one real provider participates through a demonstrated supported
connection.
