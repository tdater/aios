# Changelog

## Unreleased (planned as 0.3.0)

### Added
- **The universe**: the home screen is a navigable 3D space (flat map fallback on software graphics) where every capability, setting, project, memory and AI is an object with a plain-words card; My Day with ready-made daily panels; Home Base findings; the Rover (look and guide only).
- **Household vault** panel: keep the facts you always lose (filter sizes, paint codes, clothing sizes) and find one by typing or speaking.
- **Voice** (opt-in): push-to-talk dictation in the prompt box with a visible "Listening" badge and Esc to stop, and "Read aloud" for a routine's last answer using the device's own voice. Listening uses the browser's speech service; AIOS never records or keeps audio.
- **Relay buttons** in Together: "Copy and open" for Gemini and Perplexity, and "Paste answer from clipboard" with a preview before anything is saved.
- **Reviewer calibration range** (`scripts/run_calibration.py`, `GET /calibration`): measures how often the independent reviewer catches planted faults that pass their own tests, and how often it raises false alarms.

### Notes
- The calibration range has been tested with a stand-in Claude only; run it once on a signed-in machine to get real numbers.
- Android is a debug build tested on an emulator; no signed release APK is attached to this release.
- AIOS is local-first and uses no paid APIs. See `docs/architecture.md` for the safety model.
