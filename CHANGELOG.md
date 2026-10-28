# Changelog

## 0.6.0 - 2026-10-28
- **First real reviewer scorecard.** The calibration range was run on real Claude: On the first 8 cases Opus and Sonnet each caught all 6 planted faults with no false alarm on the 2 clean changes. Two harder cases (a swallowed error and a timing-unsafe token comparison) were then added; both models caught those too, and a full 10-case Opus run caught 8 of 8 with no false alarm (0.4 nitpicks per case). The range is still too easy to tell the models apart. It is a smoke test, not a quality measurement.
- **"What does this popup mean?"** in the Rover bay: a preset Guide task that explains one window in four plain lines, including whether it *looks like* a scam (never "safe"). Same one-window opt-in, Stop and block list as every Rover task.
- **Help me decide** (Quick add, "Check a message, a document, or a decision"): a weighted comparison worked out on this computer that says plainly when it is a close call and which weight would flip it. A devil's-advocate second opinion from Claude, or a copy-and-open for Gemini or Perplexity, only happens when you press the button.
- **Fixed `scripts\phone-access.ps1` hanging.** If Tailscale Serve had never been switched on for your tailnet, `tailscale serve` waits forever for you to approve a link, so the script froze and the phone said "the server did not answer in time". The script now gives up after 20 seconds, shows the approval link, and tells you to run it again after approving.
- Housekeeping: removed the temporary release folders and an old stash.


## 0.5.0 - 2026-10-28
### Fixed
- **"Check this computer now" showed `[object Object]`** for memory, disk and temporary files. Results are now plain rows (for example "14.3 GB of 15.5 GB in use (92%)") with a tone, and older raw results are still readable.

### Added
- **A much fuller computer check**, still read-only: every fixed drive, Downloads size, programs that start with Windows (names only), the programs using the most memory (names only), time since the last restart, a pending Windows restart, and battery. New findings explain what they mean and give by-hand steps; nothing is changed or deleted for you.
- **Ideas after a check**: rule-based next steps, some with a ready-made question you can send to AIOS with one click (nothing is sent until you press Go).
- **Life missions**: goals with a target date and steps, on the Projects screen (Developer projects / Life missions switch), in My Day, and as probes in the universe.
- **Check a message or document** (Quick add menu): a local scam second opinion that says "looks like a scam" and never "safe", and a document squeezer that finds dates, amounts and tricky clauses on this computer before you choose to ask Claude for a plain-words explanation.
- **Daily dispatch and evening wrap-up** in My Day, with an optional spoken dispatch, a "a year ago today" flashback, "start tomorrow fresh", and a **brain dump** that sorts what you say into to-dos, shopping and notes and saves only what you accept.
- **Knowledge**: a card grid with filter chips, and six starter templates (appliance, vehicle, doctor visit, trip, bills, emergency card).
- **Graph**: a radial mind-map layout and frosted hover preview cards with an excerpt.
- **Inbox**: suggestions one at a time (Remember this, Not now, Ignore). One tap is only offered when no extra safeguard applies; global, flagged or suspicious ones go to the full review.
- **Runs** are grouped by day (Today, Yesterday, This week) and described in plain words.
- **Cockpit**: numbered dock with the 1 to 6 keys, optional interface sounds (off by default), a sparkle on a probe when you complete a habit, a slow "zen orbit" after 90 seconds of no input (any input stops it), and a horizon on the compass.
- **Ambient display** (Quick add, "Show on a big screen"): large type, rotating Today, Missions and Remember views, arrow keys and OK for a remote.

### Notes
- Everything above was tested with the automated suites and, for the computer check, run for real on a Windows PC. The new screens were not checked on a phone or TV.
- Not built: weather in the ambient display (it would need an online service), Android on-device engine, car mode, Rover overlay and popup explainer, 3D flight recorder.


## 0.4.0 - 2026-10-27
- **Simple mode is now four anchors plus Settings** (Home, Missions, Knowledge, Inbox), with a **Quick add (+)** menu: ask AIOS anything, quick note, new mission or project. My AIs and Insights moved to Standard mode (still reachable from the universe, Go to, and Settings).
- **Plain-English approvals**: an approval now opens with what AIOS wants to do, in everyday words, and how safe it is (for example that a check command runs on your computer and is not a sandbox). The action hash, exact target and content moved under "Technical details and proof".
- **Cockpit orientation**: a compass that faces the Sun and levels the view, and the 0 key to go back to the start view.
- Not in this release (queued in `docs/roadmap-phase6.md`): Graph mind-map and hover cards, Knowledge card grid and household templates, Life Mission projects, swipeable memory proposals, activity timeline, living probes.

## 0.3.2 - 2026-10-27
- **Fixed:** memory import now reads answers written as paragraphs, tables or with en-dash bullets, and says why when it finds nothing.
- **Added:** `scripts\phone-access.ps1` sets up private phone access over Tailscale (HTTPS in front of AIOS for your tailnet only) and prints the address for the app. The app now explains that a Tailscale IP address will not work and points at the script.

## 0.3.1 - 2026-10-27
- **Fixed:** the first-run tour's "How much should AIOS show?" choices showed an oversized empty circle with the words squeezed into a thin column (radio buttons were being stretched to full width).
- **Added:** MIT license.
- AIOS opens in its own Edge window from the AIOS icon when Edge is installed (otherwise your default browser); README explains pinning the icon to the taskbar and Start.

## 0.3.0 - 2026-10-26

### Added
- **The universe**: the home screen is a navigable 3D space (flat map fallback on software graphics) where every capability, setting, project, memory and AI is an object with a plain-words card; My Day with ready-made daily panels; Home Base findings; the Rover (look and guide only).
- **Household vault** panel: keep the facts you always lose (filter sizes, paint codes, clothing sizes) and find one by typing or speaking.
- **Voice** (opt-in): push-to-talk dictation in the prompt box with a visible "Listening" badge and Esc to stop, and "Read aloud" for a routine's last answer using the device's own voice. Listening uses the browser's speech service; AIOS never records or keeps audio.
- **Relay buttons** in Together: "Copy and open" for Gemini and Perplexity, and "Paste answer from clipboard" with a preview before anything is saved.
- **Reviewer calibration range** (`scripts/run_calibration.py`, `GET /calibration`): measures how often the independent reviewer catches planted faults that pass their own tests, and how often it raises false alarms.

- **Universe navigation**: every object in the 3D view can be clicked (not just its label), double-click flies in on it (double-click empty space moves closer), and on-screen Zoom in / Zoom out / Show everything buttons sit beside the +/- keys and the wheel.
- **Android**: installs and launches on Android TV (touchscreen optional, remote/D-pad focus rings), and the object card is a bottom sheet on phones.

### Fixed
- A timing race in the build-guard test that made CI fail intermittently.

### Notes
- Not in this release (queued in `docs/roadmap-phase6.md`): Life Stations, Decision Matrix, Document Squeezer, Daily Dispatch, plain-word label set, Rover popup explainer, Rover Ghost Overlay, 3D Flight Recorder, on-device Android engine, car head-unit mode.
- The calibration range has been tested with a stand-in Claude only; run it once on a signed-in machine to get real numbers.
- The attached APK is a debug-signed test build (package `app.aios.companion.debug`). The emulator end-to-end test was not re-run for 0.3.0; the APK manifest was checked with aapt. No signed release APK exists yet.
- AIOS is local-first and uses no paid APIs. See `docs/architecture.md` for the safety model.
