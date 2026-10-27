# Changelog

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
