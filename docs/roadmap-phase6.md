# Phase 6 roadmap (queued work)

Order of work is top to bottom. Each item keeps the standing rules: local first, no paid API use, loopback only, irreversible actions need an
explicit on-screen approval, imported or spoken text is untrusted data. Status is updated in `docs/HANDOFF.md`.

| # | Item | State |
|---|---|---|
| 1 | Diplomatic Relay: "Copy and open" and "Paste answer from clipboard" in Together (click-to-read, preview before saving; no background clipboard watcher) | Done |
| 2 | Firing Range: reviewer calibration (`calibration.py`, `scripts/run_calibration.py`, `GET /calibration`) | Built and tested with a stand-in; **not yet run on real Claude** |
| 3 | Voice, phases 1 and 2: push-to-talk in the single prompt box, Read Aloud for the Morning briefing, one Stop control | Next |
| 4 | Everyday set: Household Vault, Daily Dispatch and evening wrap-up, plain-word labels, Life Stations, Decision Matrix, Document Squeezer | Queued |
| 5 | Voice phase 3 (voice brain dump into memory and lists), Rover spoken steps | Queued |
| 6 | Rover Ghost Overlay (needs a spike first), 3D Flight Recorder | Queued, riskier |
| 7 | Universal Android: bottom-sheet card, haptics, tilt, TV D-pad and leanback manifest, drive-safe screen (spec: owner-supplied blueprint) | Queued after the above |
| 8 | First GitHub release (see `docs/release-checklist.md`) | Prepared; publishing needs the owner's go-ahead |

## Notes that change the design

- **Speech is not automatically private.** Chrome and Edge's `webkitSpeechRecognition` sends audio to the browser vendor's speech service; the
  Android WebView may do the same. Voice input therefore ships with a visible "uses your browser's speech service" notice and stays off until the
  owner turns it on. A fully on-device recogniser (offline Whisper) is a later, optional phase. Spoken output (`speechSynthesis`) is local.
- **No always-on listening.** Push-to-talk only; any future wake-word mode must show a permanent LIVE badge.
- **Android autonomy** (running the Python backend on the phone) is a large spike, not a polish task: Chaquopy packaging, background limits, and
  claude CLI availability are unverified. Android TV and car work follows the project's rules: detect the real target, never mark an arbitrary
  activity driver-distraction-optimised, and use the official car-app templates for Android Auto or AAOS.
- **Rover on Android** (Accessibility Service, MediaProjection) has Play Store policy and safety implications; it needs a spike and an explicit owner decision.
- **Scam detector wording** must say "looks like" and never promise safety.
