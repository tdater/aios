# Session handoff (updated 2026-10-24)

Read this first, then `docs/architecture.md`, `docs/mobile-handoff.md`, `docs/api-v1.md`.

## Course correction (2026-10-24, read first)

The product goal changed: see `docs/product-goal.md`. Steps 1 and 2 are done (`docs/integration-findings.md`):
- Claude Code is classified A (supported integrated execution). Transport: `apps/api/aios/claude_code.py`, tests:
  `tests/test_claude_code.py` (stand-in executable). **Real connection demonstrated 2026-10-25**: the owner ran
  `scripts/demo_claude_connection.py` on the Windows PC three times, all PASS (fix, scope check: only calc.py,
  AIOS's own test re-run green, resumed session). Those runs loaded the owner's user settings, and a personal
  Stop hook ran pytest in the workspace; since then no settings files load in AIOS runs (`--setting-sources ""`)
  and the demo has an isolation step. Windows run 2026-10-25 15:29 (commit `cfc0dc6`): demo PASS on all seven steps
  including isolation (only Claude Code's three built-in plugins loaded, no MCP servers); backend suite 348 passed,
  1 warning (Starlette/httpx test-client deprecation). Web, browser e2e and Android e2e were not re-run (no changes there).
- Antigravity is D for AIOS-started runs (Google consumer terms), C via manual handoff. Gemini CLI removed.
- Reviewer decided (2026-10-25): option 3, Claude reviewer by default and Antigravity on demand; design in
  `docs/integration-findings.md`.
- **Next: Step 3** (`docs/product-goal.md`), on the Windows PC: project selection, one conversation, a real Claude
  turn through `claude_code.py`, persisted attributed messages, AIOS-supplied context, the real patch artifact, real
  verification output, honest provider/session/permission status, then the Claude reviewer. Not started. Work
  moves from the cloud session to the owner's PC from here; one writer per branch.
- The Linux sandbox that wrote this ran the backend suite: 344 passed, 1 skipped, 3 failed. The 3 failures are
  Windows-path tests (`test_claude_guard` backslash case, `test_core` workspace roots and `resolve_within`) that
  cannot pass on Linux and were failing before this change. Windows CI is the reference.

## Environment (verified)
A local Windows 11 Pro PC (10.0.26200; **not** a cloud VM), 16 GB RAM, PowerShell 7.6,
Python 3.14.7, Node 26.8.1, Git 2.55, JDK 21 (Gradle uses it; Android Studio's bundled JDK 25 is not used),
Android SDK (platforms 35/37, build-tools 34/36, one AVD `Medium_Phone_API_37.0`, WHPX acceleration available),
Tailscale 1.104.1 installed but **unhealthy/unconfigured** (could not reach its coordination server),
Claude Code logged in with a subscription, Gemini CLI **not installed**, no metered API keys set.
Paths: repo `C:\aios`, private state `C:\aios-state`, sample workspace `C:\aios-workspaces\sample-project`.
The emulator needs ~3–5 GB RAM; with a browser and other apps open the host runs short (see Known issues).

## Hosting
- Remote: **GitHub, `tdater/aios`**, branch `main` (local `foundation` tracks it). Azure is not part of the plan.
- Visibility: created private; made **public on 2026-10-24 at the owner's decision** (all of the owner's repos are public and
  they will not pay for private features). Before that, the tree and the full git history were reviewed: no secrets, no email
  addresses, no account IDs, no Windows-username paths. History keeps a few mild earlier mentions (laptop model, subscription
  tier); it was deliberately **not** rewritten. **No LICENSE file** has been added (an owner decision): without one, others have
  no permission to reuse the code.
- Never commit private runtime state, imported history, tokens or keystores (all git-ignored). Defense in depth:
  `scripts/scan_secrets.py`, the pre-commit hook (`scripts/install-hooks.ps1`, run once per clone), the CI secret job, and
  GitHub's own secret scanning/push protection where enabled. Dependabot alerts are enabled.
- CI (`.github/workflows/ci.yml`) runs on push/PR and manually; it is free on a public repo. Android build/emulator tests are not in
  CI (slow, need an emulator).
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
| Gemini execution | REMOVED (owner decision 2026-10-24). Antigravity: manual handoff only, see integration-findings.md |
| Backup + restore to a separate directory | IMPLEMENTED+TESTED |
| Web/PWA client (6 screens, offline drafts, opt-in summary cache, service worker) | IMPLEMENTED+TESTED (see mobile-handoff) |
| Obsidian-style UI (v0.2.0): themes/accent/font settings, icon ribbon, tabs, status bar, Ctrl+K command palette (`>` commands, `#` tags), safe markdown notes with callouts/tasks/wiki links, vault explorer with search operators, backlinks/outline/local graph panels, whole-vault graph with list view, tags + wiki links + graph APIs | IMPLEMENTED+TESTED (vitest + real-browser e2e). Canvas drawing itself is only checked by screenshots; layout/logic are unit-tested. No physical-device pass yet |
| Android app (Capacitor 8, debug build) | IMPLEMENTED+TESTED **on an emulator** (11/11). Physical phone: **not tested** |
| Android release build / signing | Build configured; see mobile-handoff for what was verified. No signing key exists (user creates it) |
| Push notifications, SSE, background sync | PLANNED (documented, deliberately absent) |
| 9 Claude skills (`.claude/skills/*`, each with purpose/trigger, inputs, preconditions, allowed actions, verification, stop conditions, example, eval cases) + regression cases in `evals/skills/` | IMPLEMENTED; **structure** is machine-checked by `scripts/skill_eval.py` (tests). The behavioural cases are specifications and are **not executed** automatically; the skills have never been run by a model against them |
| Safety guard hook (`scripts/claude_guard.py` wired in `.claude/settings.json`, fail-closed): denies force-push, public exposure (`tailscale funnel`), Azure CLI, curl-to-shell, credential/keystore/private-state access, deleting state or `.git`; asks before GitHub repo changes, firewall changes, destructive git, and edits to the evaluator/guard/settings/CI | IMPLEMENTED+TESTED (pytest, plus a live refusal observed in-session). Pattern-based, not a sandbox |
| Improvement loop: candidate → executable evaluation + regression set → human confirmation → versioned deploy → exact rollback; evaluator/safety files untouchable; no auto-promotion; rejected ideas not re-proposed | IMPLEMENTED+TESTED (pytest + HTTP). The loop is skill-focused; workflow/memory improvements are not covered |
| Skill-change review UI (Inbox > Improvements: exact text, checks, deploy with explicit confirmation, reject with reason, rollback) | IMPLEMENTED+TESTED (vitest + pytest); never exercised with a real proposed skill |
| Imported-history screen (Settings: status, review new sessions, per-source removal, secrets by kind only) + `scripts/stage_claude_sessions.py` (user-run; tested on fake folders only; I have not read your real Claude folder) | IMPLEMENTED+TESTED on synthetic data |
| Pinned tabs, daily notes (Ctrl+Alt+D), graph colour-by-project and time-lapse, publish-tag export preview + `scripts/export_published.py` | IMPLEMENTED+TESTED |
| Accessibility | Automated axe rules (no violations) on the explorer, note view, palette, graph, tab strip, history and improvements screens. Colour contrast is now **measured from the real stylesheet** for all 6 themes (WCAG AA: text 4.5:1, status colours 4.5:1, accent 3:1; the old `--faint` token failed and was fixed). **Not** done: a screen-reader (TalkBack/NVDA) walkthrough |
| Skill review diff (deployed text vs proposal), publish export button (writes to `<state>/exports/published`, local only), opt-in scheduled review (off by default, bounded 200 files / 60 s, no model calls, records the attempt before running so failures cannot loop) | IMPLEMENTED+TESTED. The schedule runs only while the server runs; no push notifications (needs your approval) |
| Schedules / bounded scheduled review, research-import UI | PLANNED |
| Quota detection from real providers | PLANNED (state and UI exist; tested via a test executor) |

## Test status (last run 2026-10-24)
- Backend `pytest`: **326 passed**. Web `vitest` + `tsc`: **270 passed**, typecheck clean. Production
  build OK. Secret scan clean; `scripts/skill_eval.py`: all 9 skills pass structural checks (their behavioural cases are *not executed*).
- **GitHub Actions (public repo), commit 91631b5: all 4 jobs green** (secret scan, backend on Windows/py3.14, web, real-browser e2e 14/14).
  Earlier runs found real problems that are now fixed: an e2e timing race, a cancel-test race, and a service-worker first-install page
  reload that wiped the pairing form (product bug).
- Clean-room check (anonymous clone of the public repo → `scripts\setup.ps1` → tests): setup 101 s, backend + web tests pass. It also
  exposed that `start.ps1` polled an endpoint that had become authenticated; fixed and verified (start → pair → 401 without auth → stop).
- Real-browser e2e (`apps/web/e2e/mobile.e2e.mjs`, Edge, phone viewport, real server): **16/16** on the new UI (local run; CI not yet run on it).
  That run caught a real bug: an unsaved draft from one note leaked into the next note opened (fixed by keying the note view by id; regression test added).
- Android emulator e2e (`apps/web/e2e/android-emulator.e2e.mjs`, real WebView): **11/11** on the last run, after two earlier
  runs failed from emulator overload (system ANR dialogs) and a script locator bug. It is sensitive to host memory pressure.

## Acceptance checklist (original brief's 15)
1 fresh setup: scripts exist; `setup.ps1` **not** run clean from scratch | 2 restart persistence: done (live) | 3 sample
registration: done | 4 real audit: done | 5 blocked by missing provider: done | 6 approval rejection + exact binding: done |
7 limits/retries: done | 8 crash recovery: done (simulated + real restart in e2e) | 9 memory create/retrieve/correct/delete:
done (tests) | 10 skill candidate failing evaluation stays unpromoted: done (tests) | 11 versioned improvement + exact rollback: done (tests) | 12 backup restore
elsewhere: done | 13 mock provider tests: done | 14 redaction/path tests: done | 15 UI against real backend: done (browser 14/14, emulator 11/11).

## Known issues
- Provider discovery shells out to the real `claude` CLI and can take tens of seconds at startup; two backend tests used to race it and now wait for it. One web test failed once right after a heavy backend run and passed on 5 reruns (suspected load timing; not identified).
- Emulator e2e flakes if the host is low on RAM (the emulator is software-rendered). Close heavy apps or use `-memory 2560`.
- `docs/history-bootstrap.md` predates the full brief; ingestion is implemented but its real-data pilot has not happened.
- No LICENSE file (owner decision).

## Next actions (in order)
1. User decides on a LICENSE (until then all rights are reserved).
2. User approves a small real history sample (copy into `C:\aios-state\imports\approved`), then pilot `review-new` and
   validate parser assumptions against real files.
3. Physical-phone pass using the checklist in `docs/mobile-android.md`; real Tailscale Serve test (user runs the commands in
   `docs/mobile-remote-access.md`).
4. Create a release keystore (user), build/sign the release APK, install on the phone.
5. Remaining planned work: run the skills' behavioural cases with a model-driven evaluation (they are specs today), schedules, SSE, research-import UI, `setup.ps1` clean-room run,
   TalkBack/keyboard accessibility audit.

## Provider sources (checked 2026-10-24)
code.claude.com/docs/en/{legal-and-compliance,headless,skills,hooks,permissions,mcp,costs};
geminicli.com/docs/{get-started/authentication,cli/headless,resources/tos-privacy};
perplexity.ai help center (API billing, threads; export/credit details read from summaries only).
