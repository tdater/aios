# Android app: build, signing, install, test checklist

The Android app is the same React web bundle packaged with **Capacitor 8** (no second UI framework, no second
backend). The bundle ships inside the APK; there is no dev-server URL.

## Build commands
```powershell
scripts\android-build.ps1 -Variant debug      # app-debug.apk
scripts\android-build.ps1 -Variant release    # app-release*.apk (see signing)
```
Needs JDK 17/21 (the script finds one; Android Studio's bundled JDK 25 is not used), `ANDROID_HOME`, and network
access on the first build (Gradle + dependencies; ~11 minutes cold on this machine). Output:
`apps\web\android\app\build\outputs\apk\<variant>\`.

| | **debug** | **release** |
|---|---|---|
| Purpose | emulator/device testing | real use |
| Application ID | `app.aios.companion.debug` (installs beside release) | `app.aios.companion` |
| WebView debugging | **on** | off |
| Cleartext | only `localhost`/`127.0.0.1` (for `adb reverse`) | **never** |
| Scheme | `http://localhost` | `https://localhost` |
| Signed with | the auto-generated debug key | your release key, or **unsigned** if none |
| Minify/shrink | off | on |

The release build **refuses to run** if the synced config has debug affordances (http scheme, debugging,
`server.url`, or dev loopback in the CSP).

## Release signing (you do this once; secrets never enter Git)
```powershell
# 1. Create a keystore OUTSIDE the repo and back it up somewhere safe. Losing it means you can never update the app.
keytool -genkeypair -v -keystore C:\Users\<you>\aios-release.jks -alias aios -keyalg RSA -keysize 4096 -validity 10000
# 2. Create apps\web\android\keystore.properties (git-ignored) with:
#      storeFile=C:\\Users\\<you>\\aios-release.jks
#      storePassword=...
#      keyAlias=aios
#      keyPassword=...
# 3. Build
scripts\android-build.ps1 -Variant release
```
With no `keystore.properties` the release APK is **unsigned** (`app-release-unsigned.apk`) and Android will not
install it. It is never silently signed with the debug key. `keystore.properties`, `*.jks`, `*.keystore` are
git-ignored and a test asserts that.

## Installing
- **Emulator**: `adb install -r app-debug.apk`, then `adb reverse tcp:8765 tcp:8765` and use the server address
  `http://localhost:8765` (debug build only).
- **Physical phone** (not done here): enable *Developer options → USB debugging*, `adb install -r` the debug APK
  for testing; for daily use install the signed release APK. Use your Tailscale HTTPS address as the server.

## Device test checklist (physical phone) — **not yet performed**
- [ ] Install; app opens; no permission prompts appear (only INTERNET is declared).
- [ ] Enter `https://<tailnet-name>`; `http://…` is refused with a clear message.
- [ ] Pair with a code from `scripts\pair.ps1`; Home shows *Connected*.
- [ ] Quick capture online creates a task; airplane mode → *Save draft*, nothing is sent; reconnect → nothing
      auto-sends; *Send* creates exactly one task.
- [ ] Open a running run; toggle airplane mode → "Connection lost" banner with data age; restore → resyncs.
- [ ] Approvals: shows exact target/content; Approve works only online; double-tap approves once.
- [ ] Back button: detail → list → Home → exits. Gesture back behaves the same.
- [ ] Rotate to landscape; fold/unfold if you have a foldable; text stays readable, nothing clipped.
- [ ] Force-stop and reopen: still signed in (Keystore token). Settings → Sign out: back at pairing screen.
- [ ] Revoke this device from the desktop: next action returns to pairing.
- [ ] Lock screen / recents: no sensitive content in notifications (there are none).

## Known limitations
- Placeholder Capacitor launcher icon/splash (the PWA icons are custom).
- No notifications (see `docs/mobile-handoff.md`).
- Gradle prints deprecation warnings for Gradle 9; harmless today.
