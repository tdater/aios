# Session handoff (updated 2026-10-26)

Read this first, then `docs/universe-spec.md`, `docs/architecture.md`, `docs/mobile-handoff.md`, `docs/api-v1.md`.

## Checkpoint (2026-10-26, branch `phase6-roadmap`; newest, read this first)

Queue and order: `docs/roadmap-phase6.md`. Release steps: `docs/release-checklist.md`, `CHANGELOG.md`.

Built on this branch (all committed): Together "Copy and open" and "Paste answer from clipboard" (click-to-read, never background); the reviewer calibration range
(`apps/api/aios/calibration.py`, `scripts/run_calibration.py`, read-only `GET /calibration`; 8 cases: 6 planted faults that pass their own tests and 2 clean controls,
deterministic scoring); voice (`core/voice.ts`, `ui/useVoiceInput.ts`, `ui/VoiceButton.tsx`: opt-in push-to-talk in the prompt box, Esc stops, "Read aloud" on routine widgets);
the Household vault panel (widget kind `facts`, migration 0012, catalog entry `household`).

Verified: backend `pytest` 631 passed (includes the calibration range and the vault); web `vitest` 601 passed (50 files), `tsc` clean, build OK.
Not verified: the calibration range on real Claude (stand-in only, so it has produced no real scorecard yet); voice in a real browser or on Android (jsdom fakes only; Chrome/Edge send
dictation audio to the browser maker's service, which the opt-in notice says); e2e suites were not re-run for this branch.

Not built yet from the owner's lists: Life Stations, Decision Matrix, Document Squeezer, Rover scam/popup explainer and spoken steps, Daily Dispatch page, plain-word label
translation, Rover Ghost Overlay, 3D Flight Recorder, Universal Android (TV, car, autonomy). A release is prepared but not published.

## Earlier checkpoint (2026-10-26, branch `phase5-universe`)

State: the universe is the app. Home is a full-screen universe (photoreal procedural WebGL, with a flat SVG fallback) with a travel dock, Go to, radar, breadcrumb,
list view, deep links (`#/home/o/<object id>`), a plain-words card with Basics/More/Expert settings for every object, arrival animations, My Day (19 ready-made daily
widgets), Home Base findings and the Rover (Look and Guide only). The older screens (Projects, Runs, Inbox, My AIs, Insights, Knowledge, Settings, Workspace) are unchanged and
reached from the dock, the left menu and card links; the old Home content is at `#/home/details`. Spec: `docs/universe-spec.md` (merged in PR #7).

Built (see `docs/universe.md`, `docs/api-v1.md`): `core/scene.ts` (one scene description for every renderer), `core/arrival.ts`, `core/travel.ts`, `core/hud.ts`, `core/objects.ts`
(`SETTING_HOME` and `LOCAL_DEFS`: every device setting has a home on an object, tested), `gl/**` (renderer), `ui/Cockpit.tsx`, `ObjectCard.tsx`, `ObjectField.tsx`, `Hud.tsx`, `MyDay.tsx`,
`WidgetGallery.tsx`, `FirstLaunch.tsx`, `RoverPanel.tsx`, `CheckUp.tsx`; backend `objects.py`, `objects_api.py`, `widgets.py` (+ migration 0010), `routines.py`, `homebase.py`,
`rover.py` (+ migration 0011). Design references the owner supplied (mission-control glass, HUD corners, status tiles) are applied in `styles.css` and `Hud.tsx`.

Verified results (2026-10-26): backend `pytest` 620 passed; web `vitest` 589 passed (49 files), `tsc` clean, build OK; real-browser `mobile.e2e.mjs` 19/19; renderer `gl.e2e.mjs`
8/8 (labels within 0.43 px of the projection, frame times in the agent's notes: about 16.7 ms at vsync on a real Intel Arc GPU); Android emulator e2e 11/11 (rebuild the APK with
`VITE_DEV_LOOPBACK_PORT=8791` first). Real Claude: `scripts/demo_routine.py` PASS (Morning briefing widget run through the single prompt); the earlier `demo_assist.py` /
`demo_workflow.py` / `demo_workspace.py` results below were not re-run for this checkpoint.

Honest limits: the 3D view needs WebGL 2 on a real graphics chip. Software graphics (SwiftShader, llvmpipe: the Android emulator) now get the flat universe, because 3D froze the
screen there; `localStorage["aios.gl.force"]="1"` forces 3D on. The Rover has never been tried against a real window capture in an automated test (that test skips without a
desktop session) and Claude is tested only through `tests/fake_claude.py`; it takes no input actions. Levels 3 (Browser) and 4 (Screen) are not built and need spikes S2/S3 from the
spec. Scheduled routines are tested with a fake clock and fake Claude; only a manual routine run was shown on real Claude. `test_assist` has one timing-dependent test
(`test_a_build_keeps_every_guard_and_ends_with_a_plain_result`) that sometimes misses a short-lived state. Arrival animations are unit-tested and wired to the renderer, but no
automated check watches one play in a real browser. The pictures in `docs/assets/` come from `apps/web/e2e/readme-shots.mjs` (invented sample data).

Next ideas: spikes S2/S3 for browser and screen control; an approval step for the Home Base "open Windows page" action; a Windows installer; weekly check-up results shown as a belt
history; a real clock-driven e2e for scheduled routines.

---

## Earlier checkpoint (2026-10-26, `main` before the universe work)


State: everything from PRs #2, #3 and #4 is on `main` (PR #4: 3D universe, everyday use, companion windows, start-to-finish
workflow; CI green). See `docs/product-direction.md` for what is proven and what is not.

Objective: AIOS is the primary interactive workspace for capable AI agents; AIOS owns durable state, provider sessions are
replaceable; ordinary users and developers share one execution foundation. Requirements that stay in force: no paid API use by
default; never read or store tokens/keys; Claude only through the unmodified CLI; never start `agy`; safety controls are code and
are not weakened; imported/retrieved text is untrusted data; mocks are labelled; the repo is public (no private state).
Antigravity: automatic participation is a target that needs a verified supported integration and explicit billing approval; a
manual handoff or another provider is never reported as completing it. Gemini CLI unsupported; Perplexity manual.

Done on this branch (all committed): launcher + desktop/Start-menu shortcuts + `Install AIOS.cmd`; pairing link fills the code only;
per-AI sharing levels, memory import-by-paste, learning switch, `/universe` `/sharing` `/learning` `/import/*` `/everyday` APIs;
Universe home (flat map + 3D space with orbit/zoom/pan/fly-to, keyboard and buttons), My AIs hub, first-run tour (re-runnable),
Together tab, Everyday project.

Also built since the first checkpoint: companion windows (`companion.py`, `GET /companion/{provider}`, `ui/Companion.tsx`; gemini.google.com
and perplexity.ai send `X-Frame-Options: DENY`, so it is a separate popup and AIOS never reads it); the start-to-finish workflow
(`workflow.py`, migration 0008, `engine.ticker`, Start to finish tab, `scripts/demo_workflow.py`); `docs/universe.md`,
`docs/product-direction.md`; README, `expansion-plan.md`, `api-v1.md`, OpenAPI snapshot updated.

Last verified results (2026-10-26, on `main`): backend `pytest` 489 passed; web `vitest` 477 passed (37 files), `tsc` clean, build OK;
GitHub CI green on PR #4 (backend, web, secrets, e2e); real-browser `mobile.e2e.mjs` 18/18, with and without the `claude` CLI on PATH;
real-Claude `workspace.e2e.mjs` 13/13; Android emulator e2e 11/11 (API 37). Real Claude `scripts/demo_workflow.py`: `notes` PASS 11/11
(0 corrections), `duration` PASS (0 corrections, Haiku writer), `duration_rules` PASS 13/13 with 1 correction round (the check failed,
AIOS wrote the correction, the re-check and a clean review followed). Claude is the only AI AIOS runs; the stand-in in
`tests/fake_claude.py` is a test double.

Dashboard (branch `phase4-dashboard`, 2026-10-26): Home is now a dashboard of the agents with ONE prompt box for any task. `triage.py` (fixed rules,
no model) turns a request into a plan (kind, reasons, steps that will happen / need you / are offered / are skipped with a reason),
`assist.py` starts the real work through the existing guarded paths (read-only Claude turn, or the start-to-finish workflow for a build),
`GET /dashboard`, `GET/POST /assist*`, `ui/Ask.tsx`, `ui/PlanView.tsx`, `ui/Agents.tsx`, `screens/Task.tsx`, tour text updated. Spec: `docs/dashboard-design.md`.
Verified: backend 525, web 496 (38 files), `tsc` clean, browser e2e 19/19, Android emulator e2e 11/11 (rebuild the APK with
`VITE_DEV_LOOPBACK_PORT=8791` first), real Claude `scripts/demo_assist.py` 12/12 (question, letter, web question, project change). Limits: triage is rules, so
odd wording can be misrouted (the plan is shown first and one click changes it); Gemini and Perplexity steps are copy and paste; non-coding tasks get an
offered second look, not an automatic independent review.

Not done, by design or blocked:
- Automatic Antigravity participation: needs a verified supported integration and your explicit billing approval. Manual handoff only.
- No real reviewer finding has been observed yet (every real review so far was clean); the correction that happened came from the check.
  A calibration set of known-bad changes would measure that.
- Two writers at once is untried; the new screens have not been run on a physical phone; no testers until you say the project is done.

Gotchas: Git-Bash heredocs mangle backslash escapes (use Write/Edit); never capture launcher output through pipes (use files);
run `npm run build` before real-browser e2e; a real AIOS server may be on port 8765, do not kill it; protected files
(`scripts/claude_guard.py`, `scripts/skill_eval.py`, scan scripts, `.secret-allowlist`, CI, settings) need the owner's approval.
No testers until the owner says the project is done.

## Expansion work (branch `phase1-delight`, 2026-10-25, newest first)

Plan, status table and what is deliberately not built: `docs/expansion-plan.md`. Not merged to `main`; `step3-workspace` (PR #2)
is still unmerged and this branch sits on top of it.

- **Apply a READY change to the real project (built, real-Claude e2e 13/13):** Outcome tab, then an approval bound to the exact revision, branch and project HEAD; refuses on uncommitted work, a moved project or branch, or anything not READY; hooks off; conflicts aborted. Not yet: automatic re-verify after a merge into a changed branch (the result says when it differs from what was tested).
- **Built:** Proof Seal, Vault Door, Flight Recorder, Bench, Constellation + Skyline (Insights screen), modes and Today,
  memory capture and per-AI briefings, other AIs by copy and paste, abilities with opt-in + pause + receipts, read-only system
  scan, validated widgets. Migration `0007_abilities.sql` adds `abilities`, `flags`, `receipts`, `widgets`.
- **Security fixes from automated review (both real):** linked worktrees are pinned to the git dir AIOS recorded at creation;
  AIOS refuses to run git in one whose `.git` link changed or has no record (worktrees from before this branch are refused: start a
  new conversation).
- **Tests (Windows):** backend `pytest` 425 passed; web `vitest` 376 passed, `tsc` clean; real-browser `mobile.e2e.mjs` 16/16
  against a rebuilt bundle (an old `dist` hid the new screens in the first run: rebuild with `npm run build` before e2e).
- **Not run this round:** the real-Claude demos and `workspace.e2e.mjs` after these changes; the Android emulator e2e; GitHub CI on this branch.
- **Not built:** computer control, quarantine cleanup, habit suggestions, "What AIOS knows", earned autonomy, onboarding,
  optional API keys. Owner decisions still open are listed in `docs/expansion-plan.md`.

## Course correction (updated 2026-10-25, read first)

Product goal and order of work: `docs/product-goal.md`. Provider rules, official sources and everything learned from
real runs: `docs/integration-findings.md`. Branch `step3-workspace` carries Step 3 (not yet merged to `main`).

| Step | State |
|---|---|
| 1 Verify the findings | Done |
| 2 Resolve the integration blocker | Done. Claude Code is category A; Antigravity D for AIOS-started runs, C by hand; Gemini removed |
| 3 First real workspace | **Done and demonstrated** (below) |
| 3 Second independent reviewer | **Done and demonstrated** (below) |
| 4 Real collaboration | **Partly.** Exists: one isolated worktree and branch per conversation, writer then independent reviewer at a pinned revision, findings in the same workspace, verification of the resulting revision, AIOS-decided readiness, a draft-a-fix-request flow a person sends. **Not done:** applying an accepted revision to the project folder (the owner merges the `aios/...` branch with git), automatic re-verify and re-review after a fix, concurrent writers (separate conversations have separate worktrees, but running two at once has not been tried) |
| 5 Memory useful to execution | **Partly.** Exists: only owner-approved notes are supplied per run and recorded with version and hash (`context_supplied`); the demo proves a rule from an approved note reaches Claude. **Not done:** retrieving preferences, provider operating notes and skills, proposing a lesson after verified work, demonstrating retrieval in a fresh session |
| Perplexity | Manual handoff, unchanged |

### What is real and what is a stand-in
- **Real, on this Windows PC, with your Claude subscription:** `scripts/demo_workspace.py` (engine, real Claude Code,
  real git worktrees, real approval, real review; `--calibrate` also shows the reviewer flagging a lazy patch that passes
  its tests) and `apps/web/e2e/workspace.e2e.mjs` (the same flow through the real UI, server dispatcher and Edge, 12/12).
  `scripts/demo_claude_connection.py` still passes.
- **Stand-in:** `tests/fake_claude.py` is a fake `claude` executable used by the backend tests. It proves AIOS's side of
  the contract (flags, environment, parsing, isolation checks, approvals, readiness), not Claude. It mirrors shapes seen on
  the real CLI, and two real-run findings exist because it did not (the `StructuredOutput` tool, the missing tool allowlist).
- **Not exercised:** a physical or emulated Android device with the new screens; the existing mobile browser e2e and
  Android emulator e2e were not re-run; GitHub CI has not run on the Step 3 branch; two simultaneous writers; Antigravity
  (never started by AIOS by design).

### Tests (Windows, 2026-10-25)
Backend `pytest`: **394 passed** (3 new modules of conversation tests plus HTTP-level route tests). Web `vitest`: **307 passed**,
`tsc` clean, production build OK. Secret scan clean. Real UI e2e: 12/12.

### How to run things
```
.venv\Scripts\python.exe scripts\demo_workspace.py --auto-approve --model sonnet --calibrate   # real Claude, ~6 runs
$env:AIOS_E2E_REAL_CLAUDE = "1"; node apps\web\e2e\workspace.e2e.mjs                              # real Claude through the UI
```
Both use your Claude subscription (a few short turns) and never an API key. The first is interactive unless
`--auto-approve` is given (use that only for the disposable repo it creates).

### Decisions to know about
- Reviewer: Claude by default on a different model from the writer; Antigravity only by manual handoff.
- Claude Code runs with an allowlist of tools (`--tools`), no settings files, no CLAUDE.md or auto memory, and AIOS
  checks what Claude Code reports about itself after every run and fails the run if anything unexpected was there.
- Verification (the owner's test command) runs AI-written code with your Windows rights. It is approval-gated per
  exact command and revision, credentials are stripped from its environment, but it is **not a sandbox**.
- The Workspace is the main screen; Knowledge and Graph are kept but demoted. No note-taking features were added.

### Next actions (in order)
1. Merge `step3-workspace` into `main` (PR) once you have looked at it; let CI run.
2. Step 4 remainder: an approval-gated "apply this revision to my project" (merge the branch safely), then re-verify
   and re-review automatically after a fix, then try two conversations at once.
3. Step 5 remainder: lessons proposed from verified work, preference and procedure retrieval, fresh-session demo.
4. Run the mobile browser e2e and the Android emulator e2e against the new Workspace screens.
5. Ideas are listed at the end of the conversation that produced this branch; none were implemented unasked.

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
| Provider discovery + honest billing/mode reporting | IMPLEMENTED (claude tested live; Antigravity is detected by presence only and never started; mock provider is MOCKED by design) |
| Claude handoff (task packet → your own session → import as UNVERIFIED) | IMPLEMENTED+TESTED with a faked `interactive` mode; never exercised with a real Claude session. No longer the main path: Claude now runs for real through conversations (next rows) |
| Conversations: real Claude Code turns, isolated git worktree per conversation, patch at a pinned revision, approval-gated verification, attributed messages, context supplied from approved notes, honest status | IMPLEMENTED+TESTED (stand-in executable) **and demonstrated with the real CLI** (`scripts/demo_workspace.py`, `apps/web/e2e/workspace.e2e.mjs`) |
| Independent reviewer (fresh read-only session, different model, pinned revision, AIOS-grounded findings, AIOS-decided readiness) | IMPLEMENTED+TESTED and demonstrated with the real CLI, including a calibration run (one example, not a quality measurement) |
| Workspace UI (Ask / Make changes, activity, diff, tests and approval, outcome and review, status with real quota) | IMPLEMENTED+TESTED (28 component tests incl. axe; real-browser e2e 12/12 with real Claude; screenshots checked on desktop and phone width). Not run on the Android shell |
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

## Test status (older detail from 2026-10-24; the current numbers are in the Course correction section above)
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

## Earlier next actions (2026-10-24; still open unless the Course correction section says otherwise)
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
