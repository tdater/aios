# Historical knowledge bootstrap (design + status)

Status: **planned, not implemented.** Only discovery is done, per the "don't delay the vertical slice" rule.
The request text was truncated mid-sentence ("Do not ..." in the evidence/confidence section); re-send the rest
before implementation so no requirement is guessed.

## Approved import location
`C:\aios-state\imports\approved` (originals, treated read-only) and `...\quarantine` (secret-bearing or unparseable).
Private state: excluded from Git. Nothing outside this folder is read for history review.

## Source types identified (none ingested, none read)
| Type | Where | Access | Gap / note |
|---|---|---|---|
| Claude.ai / ChatGPT / Gemini conversation exports | you export them, drop in `approved\` | user-provided files | none exist yet; formats must be detected from real files, not assumed |
| Claude Code session records | `%USERPROFILE%\.claude\projects` exists on this machine | needs your explicit approval per project; copy selected sessions into `approved\` | not read; only existence checked. This VM's history may not cover earlier machines |
| Project docs / CLAUDE.md / AGENTS.md | registered workspaces only | via workspace registration | |
| Repo history | registered workspaces, `git log` read-only | selected repos | |
| Build/test logs | user-provided | `approved\` | |
| Perplexity threads | manual export (PDF/Markdown) | `approved\` | no API |

Coverage cannot be claimed until the source inventory table exists (Phase 2).

## Planned pipeline (matches the brief)
inventory (id, type, project, date range, import date, sha256, parse status, gaps, sensitivity) -> detect format ->
parse (order + source refs preserved) -> redact/quarantine secrets (`security.redact`) -> dedupe by content hash
-> per-session evidence summaries with speaker/evidence-kind labels (user statement, assistant suggestion, tool
output, executed command, test result, user-confirmed outcome) -> retrieval of excerpts via SQLite FTS5 ->
candidate memories/skills (status `candidate`, never auto-approved, scope project unless explicitly promoted) ->
evaluation + review. Idempotent via (content hash, parser version). Imported text is data, never instructions.
Pilot on a small sample before processing the rest.
