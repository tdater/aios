# Mobile companion: handoff

One backend, one UI codebase. The phone is a **client**: it never touches SQLite, project folders, the vault or provider
credentials, and it executes nothing. Authorization, approvals, state transitions, execution policy and provider access all
live on the server.

- Web/PWA: same React app, served by the AIOS server (same origin).
- Android: the same production bundle packaged with Capacitor 8 (`apps/web/android`). No React Native, no second backend.
- API contract: `docs/api-v1.md` (+ `docs/openapi-v1.json`). Remote access and auth: `docs/mobile-remote-access.md`.
  Build, signing, device checklist: `docs/mobile-android.md`.

## Gap assessment (what existed vs what had to be built)
Existed: engine with approvals and idempotency keys on runs, run events, a desktop-only unauthenticated UI on loopback.
Built for mobile: device authentication, `/api/v1` with structured errors, pagination, record versions, idempotent task
submission, hardened approvals (expiry, supersede, destructive confirmation, race safety), two-phase cancellation, event cursor +
snapshot resync, capability/compatibility discovery, server identity, a responsive client with offline drafts, PWA, Android shell.
Not built: push, SSE, background sync, native plugins beyond secure storage and the back button.

## Status
| Item | State |
|---|---|
| Server API v1, auth, errors, pagination, versions, idempotency, approvals, cancel, events | IMPLEMENTED+TESTED (pytest: `tests/test_mobile_api.py`, 33 tests incl. concurrency) |
| 6 screens: Home, Projects, Runs, Inbox (approvals, proposals), Knowledge, Settings | IMPLEMENTED+TESTED (vitest app tests; real-browser e2e) |
| First vertical slice: choose server → pair → real project data → submit task with idempotency key → live status → disconnect/reconnect/resync | IMPLEMENTED+TESTED in a real browser (14/14) **and in the Android emulator** (11/11) |
| Offline: local drafts, explicit send, preserved idempotency keys, opt-in non-secret summary cache, partitioned by server identity | IMPLEMENTED+TESTED (unit, UI, real browser, emulator for the online path) |
| PWA: manifest, service worker (shell only, never `/api`), user-applied updates, 426 → cache reset | IMPLEMENTED+TESTED (vm-sandbox tests; real browser confirms shell cache holds no API responses). Update-flow UI not exercised in a real browser |
| Android: hardened manifest (INTERNET only, no backups, no cleartext), Keystore-backed token, restricted navigation, back button, rotation | IMPLEMENTED; static tests + emulator e2e |
| Android release build | See "Release build" below |
| Push notifications | **PLANNED**, intentionally absent (see below) |
| Server-Sent Events | **PLANNED** (polling with cursor + resync is implemented) |
| Physical phone, real Tailscale/HTTPS, TalkBack, foldables | **NOT TESTED** |

## Security rules (all enforced server-side unless noted)
1. No endpoint except `/meta` and `/auth/pair` works without a device session; tests assert this for every list/detail route.
2. Pairing code: single use, 10-minute expiry, hashed at rest, 5 failures → 15-minute lockout. Tokens hashed at rest.
3. Browser: HttpOnly + SameSite=Strict cookie, CSRF header and Origin check on writes. Native: bearer token in
   Keystore-backed storage, excluded from backup; verified not stored in plaintext in the app's SharedPreferences.
4. Approvals bind to the exact action hash and record version, are single use and expire; resolved/expired/superseded/tampered →
   409 with a specific code; destructive/unknown actions need explicit confirmation; offline approvals are impossible by design
   (the buttons are disabled and nothing is queued).
5. Cancellation: *requested* ≠ *confirmed*; a step in flight may finish; completed side effects are never reversed.
6. Provider reality: the phone cannot run subscription-backed providers differently from the desktop. Claude/Antigravity work is a
   user-started session using a task packet; quota stops never fall back to paid access.
7. All imported/served text is rendered as inert text (no raw HTML); tests inject markup and assert nothing is created.
8. Server addresses must be HTTPS. Cleartext exists only in the debug build, only to `localhost`/`127.0.0.1`, for `adb reverse`.
9. No credentials in frontend code, bundled config, localStorage, source or Git; `keystore.properties`/`*.jks` are git-ignored.
10. A different server at the same address is detected (`server_id`) and requires confirmation; its cache is never shown.

## Test results (2026-10-24)
- Backend: 288 tests passing at the last full run (33 of them are mobile-contract tests). Web: 66 passed, typecheck clean.
  GitHub Actions also ran the real-browser e2e (14/14) green on a Windows runner.
- Real browser (Edge, phone viewport, real server + SQLite, isolated temp state): 14/14, including a dropped response on task
  submit (exactly one task after retry), cancel requested→confirmed, server killed and restarted mid-run (UI shows stale data
  honestly, then resyncs to `interrupted`), approve-once/reject, version-conflict edit, offline draft → reconnect → explicit send.
- Android **emulator** (API 37, WebView over DevTools, real server through `adb reverse`): 11/11 — cleartext/credentialed
  addresses refused, pairing, token not in localStorage or plaintext prefs, capture, disconnect/resync, approval, back key,
  relaunch still signed in, landscape, navigation cannot leave the app, sign-out revokes server-side.
  Earlier runs failed for environmental reasons (system ANR dialogs when the host was low on RAM) and one script locator bug.
  Re-run on 2026-10-26 on `main` (with the 3D universe and first-run tour): 11/11. The script now uses port 8791 and refuses to start
  if that port is already serving, because it used to share 8765 with a real AIOS and then pair against the wrong server. The debug
  APK must be built with `VITE_DEV_LOOPBACK_PORT=8791` so its policy allows that port; release builds ignore it.
- **Not** performed: physical device, Tailscale, real HTTPS from the WebView (`https://localhost` origin path), TalkBack.

## Release build
`scripts/android-build.ps1 -Variant release` refuses to run if debug affordances leaked into the synced config. Without
`keystore.properties` the result is an **unsigned** APK that Android will not install.

Verified 2026-10-24: the release build **succeeds** (3m12s), produces `app-release-unsigned.apk` (≈1 MB, minified + resource
shrinking), the release guard passed, and the only permission is INTERNET. Smoke test: a **temporary copy** re-signed with the
local debug key (never the release artifact) installed on the emulator, launched, stayed running with the main activity focused,
logged no `AndroidRuntime` crashes, is not debuggable, and rendered the server-setup screen. That shows R8 minification did not
break startup or the WebView. It does **not** prove the plugin paths after pairing in a minified build (secure storage under
R8) because the release build requires an HTTPS server, which the emulator cannot reach here. Re-test that on the phone.
Observed on Android 17-era emulator: the system lists `ACCESS_LOCAL_NETWORK` as granted for the app though we do not declare it.
There is no signed release yet (the user must create the key).

## Notifications (not built)
Platform needs: Firebase Cloud Messaging (Google) for Android; a server-side sender; a Firebase project (external service,
free tier, needs the user's Google account and approval). Privacy rules if added: lock-screen text generic only ("AIOS: item
needs review"), no prompts/logs/paths/secrets, tapping opens the app to the Inbox (no actions from the notification, no
approving from a notification). Delivery is best-effort and can be delayed or dropped; the app must keep working without it.
Background polling would drain battery and is not promised. Until approved, Settings says push is not enabled.

## Known limitations
- Idempotency keys are kept 7 days; a retry later than that is a new request.
- Event monitoring polls every ~1.5 s while a run is open; no push stream yet.
- Edit/merge/supersede of proposals and project registration are available via API but only approve/reject/defer are on mobile.
- Placeholder Capacitor launcher icon/splash; PWA icons are custom.
- Keystore hardware backing (TEE/StrongBox) is unknown on an emulator.
- Service-worker update banner and the 426 reset path are unit-tested but were not driven in a real browser.
- Emulator tests are sensitive to host memory pressure.

## Remaining work (suggested order)
1. Physical-phone pass (`docs/mobile-android.md` checklist) over Tailscale Serve; fix what breaks.
2. Release signing key (user), signed release APK, install, sign-out/revoke checks on the phone.
3. SSE stream (`capabilities.sse_stream`) using fetch streaming with the Authorization header.
4. Push (needs approval), keeping the privacy rules above.
5. TalkBack and keyboard audit; foldable/tablet pass; custom launcher icon.
6. Mobile screens for proposal edit/merge/supersede if wanted; research handoff screen once that feature exists.
