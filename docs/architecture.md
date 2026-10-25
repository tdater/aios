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
