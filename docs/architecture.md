# AIOS architecture, ownership, and threat model

AIOS is an application layer on top of Windows: one FastAPI process, one SQLite file, a markdown vault,
and a React UI served by the same process on loopback. No microservices, Redis, vector DB, or agent framework.

## Three separate trees

| Tree | Default location | Contains | In Git? |
|---|---|---|---|
| Source | `C:\aios` | code, migrations, config templates, approved skill definitions, docs | yes |
| Private state | `C:\aios-state` (`AIOS_STATE_DIR`) | `db/`, `vault/`, `artifacts/`, `runs/`, `backups/`, `logs/` | **never** (startup refuses a state dir inside the repo) |
| Managed workspaces | anywhere you register | your projects | their own repos |

## Canonical owner per data type

| Data | Owner | Notes |
|---|---|---|
| Tasks, runs, steps, attempts, approvals, schedules, provider caps, audit log | SQLite | forward-only checksummed migrations (`apps/api/aios/migrations`); a tampered applied migration aborts startup |
| Durable knowledge, decisions, lessons, procedures | Markdown vault | Phase 2. DB `memories` rows are an index/review record and must be rebuildable from the vault |
| Artifacts (audit reports, task packets, imported results) | files under `state/artifacts/<run_id>/` | DB row stores relative path + sha256 + provenance |
| Code, config templates, skill definitions | Git | |
| Backups | `state/backups/*.zip` | online SQLite snapshot + vault + artifacts |

No fact has two authoritative copies. Search indexes are derived data.

## Run engine

`queued -> running -> awaiting_approval | blocked | interrupted -> queued ... -> succeeded | failed | cancelled`.
Transitions are table-validated and atomic. Per-run deadline, iteration cap, bounded attempts, retry only for
`RetryableError`, identical-failure detection (error fingerprint), workspace locks, concurrency cap, stall
watchdog. A task is `done` only when its acceptance checks pass.

Crash rule: steps flagged `side_effect` that were `started` when the process died become `uncertain`.
`reconcile()` (run at every startup) marks the run `interrupted`; resuming it blocks again with a
"verify manually" reason. AIOS never replays an uncertain external effect.

Approvals bind to `sha256(canonical action JSON)`, are single use, are spent *before* the effect, and stop
matching if the action changes.

## Conversations, worktrees and verification

| Data | Owner | Notes |
|---|---|---|
| Conversations, messages (`author_kind` user, provider or aios), context supplied per run | SQLite (`0006_conversations.sql`) | Provider and AIOS text is redacted on write |
| Per-conversation git worktree and branch `aios/<conversation id>` | `state/worktrees/` (private state, never in Git) | The project folder is never written by a provider run |
| Patch, verification report, transcripts, reviewer input | artifacts, like every other run output | The patch is stored byte-faithful so it still applies |
| The project's verification command | `projects.verify_json`, set only by the owner's explicit API call | Providers cannot set or change it |

A turn is a `claude.turn` run made of resume-safe steps (worktree, context, claude, patch, verification). The provider step
and the verification step have side effects, so after a crash they are never replayed automatically. A review is a
`claude.review` run in its own detached checkout. Routes are in `docs/api-v1.md`.

Added to the threat model: running the verification command executes code an AI just wrote, with the owner's Windows
rights. It is gated by an approval bound to the exact command, worktree, revision and patch hash, it runs without a shell
and without credentials in its environment, and a program found inside the worktree is refused, but it is **not an OS
sandbox**. Claude Code itself is not sandboxed by AIOS either: its read and edit tools are limited to the working directory
by Claude Code's own permission system and by the tool allowlist AIOS passes it.

## Threat model (what is and is not protected)

Protected, with tests:
- Binding to non-loopback hosts is refused at startup; requests with a foreign `Host` or `Origin`, or a
  non-JSON content type on writes, are rejected (blocks DNS-rebinding and cross-site form posts).
- Workspace registration refuses drive roots, user-profile/system dirs (and their ancestors), AIOS state, AIOS source.
- Audit never follows symlinks/junctions and reads only inside the registered root; artifact reads are
  path-confined to `state/artifacts`.
- Secret patterns are redacted from events, step output, artifacts, and API responses; audits report
  secret *locations and kinds only*.
- API exposes no shell, no arbitrary path read/write, and only registered executor kinds.

Not protected (be honest):
- These are application-level checks, **not an OS sandbox**. Anything running as your Windows user (including
  a Claude Code session you start) can touch whatever you can. Real isolation would need a separate Windows
  user, container, or VM.
- No authentication on the local API: any local process (or user on this machine) can call it. Acceptable for a
  single-user loopback tool; remote access needs a separately approved authenticated setup (not built).
- Secret detection is pattern-based and will miss novel formats.

## Provider constraints (checked 2026-10-24; details and sources in `docs/integration-findings.md`)

- **Claude Code**: supported integrated execution (A). `apps/api/aios/claude_code.py` starts the unmodified CLI
  in print mode with your own claude.ai login, read or edit tools only, no shell, no repository hooks or MCP
  servers, bounded turns and time. AIOS never reads credentials and removes API-billing variables from the child
  environment. Not yet wired into the run engine; proven by `scripts/demo_claude_connection.py`.
- **Antigravity CLI**: AIOS never starts `agy` (Google's FAQ: wrapping it in third-party applications is not
  supported on consumer plans and risks suspension). Manual handoff only (C).
- **Gemini CLI**: removed.
- **Perplexity**: manual handoff only. Pro does not include API credits; AIOS makes no Perplexity calls.
- Usage/quota: no documented non-interactive way to read Claude subscription usage, so it is reported `unknown`;
  print mode reports a client-side cost estimate per run.
