# Session handoff (updated 2026-10-24)

## Environment (verified)
Windows 11 Pro 10.0.26200, PowerShell 7.6, Python 3.14.7, Node 26.8.1 / npm 11.19, Git 2.55, JDK 21,
Android SDK at `%LOCALAPPDATA%\Android\Sdk` (adb present, not on PATH). Claude Code 2.1.310 logged in (Pro, claude.ai login).
Gemini CLI **not installed**. No metered API keys set. Repo `C:\aios`, state `C:\aios-state`, sample workspace `C:\aios-workspaces\sample-project`.
Last `claude doctor`: no issues, but auto-update failed once (`install_failed`).

## Status legend: IMPLEMENTED+TESTED / MOCKED / BLOCKED / PLANNED

| Area | Status |
|---|---|
| FastAPI app, loopback bind, Host/Origin/content-type guards | IMPLEMENTED+TESTED (pytest) |
| SQLite schema (all core models), checksummed migrations | IMPLEMENTED+TESTED; only projects/workspaces/tasks/deps/runs/steps/attempts/checkpoints/events/artifacts/evidence/approvals/locks/provider_caps/audit_log have behavior. memories, skills, evals, schedules, proposals, workflows are **schema only** |
| Run state machine, deadlines, iteration caps, bounded retries, identical-failure stop, workspace locks, idempotency keys, reconcile-on-start, no replay of uncertain side effects | IMPLEMENTED+TESTED (crash is *simulated* by writing DB state, not by killing a process) |
| Exact-action single-use approvals | IMPLEMENTED+TESTED |
| Deterministic read-only workspace audit with evidence | IMPLEMENTED+TESTED; run live against sample workspace |
| Provider discovery (claude/gemini/perplexity/mock), billing-mode flags, env-key detection | IMPLEMENTED; claude/gemini detection tested live, unit tests cover env-key flagging |
| Claude handoff (task packet -> user session -> import as UNVERIFIED) | IMPLEMENTED+TESTED with a faked `interactive` mode; never exercised with a real Claude session |
| Mock provider | MOCKED (by design) |
| Gemini execution | BLOCKED (not installed; official status uncertain, see architecture.md) |
| Perplexity | handoff mode reported; research import UI/flow PLANNED |
| Backup + restore to separate dir | IMPLEMENTED+TESTED |
| Redaction + path restrictions | IMPLEMENTED+TESTED |
| React UI: health, projects, tasks, runs/timeline/artifacts, approvals, providers, theme/density | IMPLEMENTED; verified by typecheck, build, 2 vitest tests, and one headless-Edge screenshot of Health against the live backend. Other screens were exercised via API only, not clicked through |
| Workflow registry, skills registry, memory browser, research, proposals screens | PLANNED (UI shows honest "not implemented") |
| Memory/FTS retrieval, vault, skills (9 initial), PreToolUse hooks/deny rules, schedules, evaluation + rollback, onboarding | PLANNED (Phase 2/3) |
| Historical bootstrap | PLANNED; see `docs/history-bootstrap.md` (request was truncated) |

## Acceptance checklist (brief's 15)
1 fresh setup commands: scripts written, `setup.ps1` NOT run end-to-end from scratch (venv/npm done manually) |
2 restart persistence: DONE live |
3 sample registration, no unrelated scan: DONE |
4 real audit with evidence: DONE |
5 blocked by missing provider: DONE live (gemini) |
6 approval rejection + exact binding: DONE (tests) |
7 limits/retry: DONE (tests) |
8 crash recovery: DONE (simulated) |
9 memory create/retrieve/correct/delete: TODO |
10 skill candidate fails eval: TODO |
11 versioned improvement + rollback: TODO |
12 backup restore elsewhere: DONE (tests) |
13 mock provider tests: DONE |
14 redaction + path tests: DONE |
15 UI against real backend: PARTIAL (see above)

## Next actions (in order)
1. Run `scripts\setup.ps1` clean in a temp clone to prove acceptance 1.
2. Click through the UI (tasks -> run -> approvals) with a real browser pass; fix what breaks.
3. Phase 2: vault + `memories` behavior + FTS5 search, 9 skills under `.claude/skills`, hooks/deny rules, research import.
4. Get the rest of the history-bootstrap request, then pilot ingestion on a small approved sample.
5. Phase 3: schedules, evaluator-gated improvements, rollback.

## Provider sources (checked 2026-10-24)
code.claude.com/docs/en/{legal-and-compliance,headless,skills,hooks,permissions,mcp,costs};
geminicli.com/docs/{get-started/authentication,cli/headless,resources/tos-privacy};
perplexity.ai help center (API billing, threads). Perplexity export/credit details were read from summaries only.
