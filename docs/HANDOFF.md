# Session handoff (updated 2026-10-24)

Read this first, then `docs/architecture.md`, `docs/mobile-handoff.md`, `docs/api-v1.md`.

## Environment (verified)
Lenovo 83JT laptop/desktop (a local PC, **not** an Azure VM), 16 GB RAM, Windows 11 Pro 10.0.26200, PowerShell 7.6,
Python 3.14.7, Node 26.8.1, Git 2.55, JDK 21 (Gradle uses it; Android Studio's bundled JDK 25 is not used),
Android SDK (platforms 35/37, build-tools 34/36, one AVD `Medium_Phone_API_37.0`, WHPX acceleration available),
Tailscale 1.104.1 installed but **unhealthy/unconfigured** (could not reach its coordination server),
Claude Code logged in (Pro), Gemini CLI **not installed**, no metered API keys set.
Paths: repo `C:\aios`, private state `C:\aios-state`, sample workspace `C:\aios-workspaces\sample-project`.
The emulator needs ~3–5 GB RAM; with a browser and other apps open the host runs short (see Known issues).

## Hosting
- Remote: **GitHub, private repo `tdater/aios`**, branch `main` (local `foundation` tracks it). Azure is not part of the plan.
- GitHub secret scanning is **not available** for this private free-plan repo; substitutes: `scripts/scan_secrets.py`,
  pre-commit hook (`scripts/install-hooks.ps1`, run once per clone) and the CI secret job. Dependabot alerts are enabled.
- **CI (`.github/workflows/ci.yml`) is manual-only and has never run.** GitHub refused to start jobs ("recent account payments
  have failed or your spending limit needs to be increased"). That is a billing item on the user's account; nothing was
  changed there. When fixed: restore the `push`/`pull_request` triggers, run it, fix any real failures.
- At first release AIOS becomes page(s) on the user's **signal-workshop** site. Publish only a curated selection.

## Status legend: IMPLEMENTED+TESTED / MOCKED / BLOCKED / PLANNED

| Area | Status |
|---|---|
| Run engine (states, deadlines, iteration caps, bounded retries, identical-failure stop, workspace locks, idempotency, reconcile on start, never replay uncertain side effects) | IMPLEMENTED+TESTED. Crash recovery is *simulated* (DB state), not by killing a process. The browser e2e does restart the real server mid-run (run becomes `interrupted`) |
| Exact-action approvals (hash-bound, single use, expiring, race-safe, destructive confirmation) | IMPLEMENTED+TESTED (pytest, UI tests, real-browser e2e, emulator e2e) |
| Two-phase cancellation, reconnectable run events + snapshot/resync | IMPLEMENTED+TESTED |
| Device auth (pairing code, cookie+CSRF / bearer, revocation, rate limit), structured errors, pagination, record versions, idempotent submit, capability + compatibility discovery | IMPLEMENTED+TESTED |
| Deterministic workspace audit | IMPLEMENTED+TESTED |
| Memory service (vault canonical, FTS5 index, edit/forget/export/rebuild) | IMPLEMENTED+TESTED |
| History ingestion → candidates → review queue (parsers, dedupe, redaction/quarantine, chronology, incremental, deletion) | IMPLEMENTED+TESTED on **synthetic fixtures only**. Parsers follow public knowledge of Claude Code / claude.ai / ChatGPT formats and are **unvalidated against real exports**. No real history has been read |
| Provider discovery + honest billing/mode reporting | IMPLEMENTED (claude/gemini tested live; mock provider is MOCKED by design) |
| Claude handoff (task packet → your own session → import as UNVERIFIED) | IMPLEMENTED+TESTED with a faked `interactive` mode; never exercised with a real Claude session |
| Gemini execution | BLOCKED (not installed; official status uncertain, see architecture.md) |
| Backup + restore to a separate directory | IMPLEMENTED+TESTED |
| Web/PWA client (6 screens, offline drafts, opt-in summary cache, service worker) | IMPLEMENTED+TESTED (see mobile-handoff) |
| Android app (Capacitor 8, debug build) | IMPLEMENTED+TESTED **on an emulator** (11/11). Physical phone: **not tested** |
| Android release build / signing | Build configured; see mobile-handoff for what was verified. No signing key exists (user creates it) |
| Push notifications, SSE, background sync | PLANNED (documented, deliberately absent) |
| 9 Claude skills, hooks/deny rules, schedules, evaluation + rollback, improvement proposals, research-import UI | PLANNED |
| Quota detection from real providers | PLANNED (state and UI exist; tested via a test executor) |

## Test status (last run 2026-10-24)
- Backend `pytest`: **104 passed**. Web `vitest` + `tsc`: **64 passed**, typecheck clean. Production build OK.
- Real-browser e2e (`apps/web/e2e/mobile.e2e.mjs`, Edge, phone viewport, real server): **14/14**.
- Android emulator e2e (`apps/web/e2e/android-emulator.e2e.mjs`, real WebView): **11/11** on the last run, after two earlier
  runs failed from emulator overload (system ANR dialogs) and a script locator bug. It is sensitive to host memory pressure.

## Acceptance checklist (original brief's 15)
1 fresh setup: scripts exist; `setup.ps1` **not** run clean from scratch | 2 restart persistence: done (live) | 3 sample
registration: done | 4 real audit: done | 5 blocked by missing provider: done | 6 approval rejection + exact binding: done |
7 limits/retries: done | 8 crash recovery: done (simulated + real restart in e2e) | 9 memory create/retrieve/correct/delete:
done (tests) | 10 skill candidate failing evaluation: **TODO** | 11 versioned improvement + rollback: **TODO** | 12 backup restore
elsewhere: done | 13 mock provider tests: done | 14 redaction/path tests: done | 15 UI against real backend: done (browser 14/14, emulator 11/11).

## Known issues
- Emulator e2e flakes if the host is low on RAM (the emulator is software-rendered). Close heavy apps or use `-memory 2560`.
- CI blocked by GitHub billing (above).
- `docs/history-bootstrap.md` predates the full brief; ingestion is implemented but its real-data pilot has not happened.

## Next actions (in order)
1. User: fix the GitHub billing item (or decide to stay manual-only), then re-enable CI triggers and run it.
2. User approves a small real history sample (copy into `C:\aios-state\imports\approved`), then pilot `review-new` and
   validate parser assumptions against real files.
3. Physical-phone pass using the checklist in `docs/mobile-android.md`; real Tailscale Serve test (user runs the commands in
   `docs/mobile-remote-access.md`).
4. Create a release keystore (user), build/sign the release APK, install on the phone.
5. Remaining planned work: 9 skills + hooks/deny rules, schedules, evaluation/rollback loop, SSE, research-import UI, `setup.ps1`
   clean-room run, TalkBack/keyboard accessibility audit.

## Provider sources (checked 2026-10-24)
code.claude.com/docs/en/{legal-and-compliance,headless,skills,hooks,permissions,mcp,costs};
geminicli.com/docs/{get-started/authentication,cli/headless,resources/tos-privacy};
perplexity.ai help center (API billing, threads; export/credit details read from summaries only).
