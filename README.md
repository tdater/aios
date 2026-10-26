# AIOS

A **personal, local-first project workspace for working with official AI coding tools**: pick a project, have Claude Code propose or make a change, inspect the real patch, and verify it with tests AIOS runs itself, on top of a durable run engine with exact-action approvals and a markdown knowledge vault. It runs on your own machine; it is not a hosted service and not an operating system. Product goal and roadmap: `docs/product-goal.md`.

> **Status: early personal project (v0.2, one author).** Built for one user on Windows 11. It has not had an external
> security review. Do **not** expose it to the public internet. See "Safety model" and "Known limitations".

## What works today (tested)

- **Workspace (main screen)**: pick a project and talk to **real Claude Code** (your own subscription login, never an API
  key). *Ask* is read-only; *Make changes* edits an isolated git worktree, never your project folder. You get the change as
  a readable diff, AIOS runs your tests only after you approve that exact command, an **independent reviewer** (a fresh
  read-only Claude session on a different model) can check the exact revision, and **AIOS**, not a model, decides READY or
  NOT READY. Status shows the real provider facts and your real 5-hour and 7-day usage. Shown working on real Claude Code by
  `scripts/demo_workspace.py` and `apps/web/e2e/workspace.e2e.mjs`. Antigravity and Perplexity remain manual handoffs; see
  `docs/integration-findings.md` for why.
- **Start to finish** (branch `phase2-everyday`): give one request and AIOS carries it through build, your check (you approve it
  every time), a separate Claude's review, automatic corrections, re-check and re-review, then a plain-words result and a few
  memory candidates. It adds no power: Claude still edits only an isolated copy, nothing is merged without a separate approval, and
  AIOS decides readiness. Shown on real Claude by `scripts/demo_workflow.py`. See `docs/product-direction.md`.
- **Everyday use** (branch `phase2-everyday`): Home is a 3D map of you, your AIs and your memories (`docs/universe.md`); you choose
  what each AI may be told; you can bring in memories from other AIs; a guided tour re-runs from Settings; a desktop icon starts
  AIOS. Gemini and Perplexity subscriptions can be used from a separate window with prompts AIOS writes for you to paste. AIOS
  never reads or controls those windows.
- **A calmer daily interface** (branch `phase1-delight`, see `docs/expansion-plan.md`): Today cards, Simple / Standard / Power
  menus, a proof seal on every checked change, a replay of what Claude did, a writer-and-reviewer view, a constellation of what
  AIOS remembers (bright only when a memory was used and the tests then passed), a skyline of projects, other AIs by copy and
  paste, and opt-in extras (a read-only PC check, small panels) behind a pause-everything switch and a plain-language receipts
  list. Computer control is not built.
- **Run engine**: queued → running → awaiting approval / blocked / interrupted → succeeded / failed / cancelled, with deadlines,
  iteration limits, bounded retries, workspace locks, idempotent submission, restart reconciliation, and a rule that
  side effects with unknown outcome are **never** replayed automatically.
- **Approvals bound to the exact action** (hash of the payload), single use, expiring, race-safe, with explicit confirmation for
  destructive actions.
- **Read-only workspace audit** with recorded evidence; **memory** in a markdown vault (canonical) with a rebuildable SQLite/FTS index.
- **History review pipeline** (deterministic, no model calls): parse approved exports/sessions → redact → dedupe → extract
  candidate preferences/lessons/scripts with evidence and chronology → human review queue. Tested on synthetic fixtures only.
- **Authenticated API v1** (device pairing; HttpOnly cookie + CSRF for browsers, bearer token for the Android app), structured
  errors, pagination, record versions, idempotency keys, reconnectable run monitoring.
- **Client**: responsive React/TypeScript app, installable PWA, and a Capacitor 8 Android shell (tested on an emulator).
  Obsidian-inspired UI: themes and accent colours, tabs (pin with Alt+P), Ctrl+K command palette, safe markdown notes with
  `[[wiki links]]`, `#tags`, callouts and backlinks, a vault explorer with search operators, a force-directed graph (colour by
  type or project, time-lapse of how the vault grew), daily notes (Ctrl+Alt+D), skill-change review, and an imported-history screen.
- **Publishing**: only notes you tag `#publish` and approve can be exported (Settings button or `scripts/export_published.py`;
  files are written locally; nothing is uploaded).
- **Nine Claude skills** with a deterministic structural evaluator, a **fail-closed PreToolUse safety hook**, and an
  **evaluation-gated, versioned, reversible improvement loop** (no auto-promotion; the evaluator and safety files cannot be
  changed by the loop). The skills' behavioural cases are specifications; they are not executed automatically.
- Tests: Python `pytest`, web `vitest`, plus real-browser and Android-emulator end-to-end scripts (exact counts in `docs/HANDOFF.md`).

## Safety model (read this)
- The server binds to **loopback only** and refuses anything else. Remote use is intended through a private network path
  (for example Tailscale Serve) **plus HTTPS plus the app's own device login**. `docs/mobile-remote-access.md` explains it.
- AIOS never reads, copies or stores provider OAuth tokens and makes no paid API calls by default. Claude runs through the
  unmodified Claude Code CLI with your own sign-in, and AIOS strips API-billing variables before starting it. Antigravity and
  Perplexity work happens in sessions **you** start, using a task packet; those results come back as unverified claims.
- Private runtime state (database, vault, imported history, backups) lives **outside** this repository and is git-ignored.
- Imported text (history, research, repo contents) is treated as untrusted data, never as instructions.
- Path checks are application-level guards, **not an OS sandbox**.

## Quick start (Windows, PowerShell)
```powershell
scripts\setup.ps1              # Python venv, dependencies, web build
scripts\start.ps1              # http://127.0.0.1:8765  (state in ..\aios-state by default)
scripts\pair.ps1               # one-time code to sign a browser/phone in
.\.venv\Scripts\python.exe -m pytest        # backend tests
cd apps\web; npm test; npm run build        # web tests and production build
```
Android: `scripts\android-build.ps1 -Variant debug` (see `docs/mobile-android.md`). Release signing keys are yours to create
and are never committed.

## Layout
`apps/api` FastAPI app and SQLite migrations · `apps/web` React client, PWA, Capacitor Android project, e2e scripts ·
`tests` backend tests · `scripts` setup/run/build/scan helpers · `docs` architecture, API, mobile and handoff notes.
Start with `docs/architecture.md`, `docs/api-v1.md` and `docs/HANDOFF.md` (current state, honest about what is untested).

## Known limitations
No push notifications or SSE yet; no scheduled jobs; Gemini CLI is removed; Antigravity is manual handoff only; applying a READY change to your project is an approval-gated merge (Outcome tab), with undo shown; two writers at once is untried; the new Workspace screens have not been run on the Android shell;
the Android app has not been tested on a physical phone; Windows is the only supported host; the history parsers are unvalidated
against real exports.

## License
No license has been chosen yet, so by default **all rights are reserved**: you may read the code but have no permission to reuse
or redistribute it until a license is added.
