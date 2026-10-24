---
name: android-build-verify
description: Build the AIOS Android app and verify it with the available tests (static checks, emulator e2e), reporting exactly what was and was not tested. Use when asked to build or verify the Android app.
when_to_use: Android build, APK, emulator or device verification requests for this repo.
disable-model-invocation: true
argument-hint: debug|release
allowed-tools: Read Grep Glob PowerShell(scripts\android-build.ps1*) PowerShell(adb *) PowerShell(node e2e*) PowerShell(npx vitest*) Bash(adb *) Bash(node e2e*) Bash(npx vitest*)
---

# android-build-verify

## Purpose and trigger
Produce an APK and an honest verification report. Explicit invocation: `/android-build-verify debug` or `release`.

## Required inputs
Variant (`debug` default). For release: whether `apps\web\android\keystore.properties` exists (never read its contents).

## Preconditions
- `ANDROID_HOME` set, a JDK 17/21 available (the build script finds one), network available for the first Gradle sync.
- For emulator tests: an AVD booted and settled; host RAM is not exhausted (system ANR dialogs invalidate runs).

## Allowed actions
- `scripts\android-build.ps1 -Variant <v>`, `npx vitest run src/test/native-config.test.ts`, `node e2e\android-emulator.e2e.mjs`,
  start/stop the emulator, `adb` commands against the emulator.
- Never create, move, print or commit signing keys or `keystore.properties`.
- Never install on a physical phone unless the user connected it and asked.

## Verification criteria
- Quote the Gradle result line (`BUILD SUCCESSFUL in …`), APK size, sha256 and the permission list (must be INTERNET only).
- Release: the guard in the script passed, and the APK is reported UNSIGNED unless keystore.properties exists.
- Emulator e2e: report `n/N steps passed` verbatim with failures. Label results **emulator**, never "device".
- Distinguish: built, installed, launched, tested. A debug-signed re-sign of a release copy is a smoke test, not a release.

## Failure / stop conditions
- Gradle/SDK error → report the first error lines; do not guess fixes beyond what the log supports.
- Emulator not responding (ANR dialogs, low memory) → say the run is invalid; fix the environment, rerun.
- Anything touching signing secrets → stop and ask the user.

## Example usage
`/android-build-verify debug` → "BUILD SUCCESSFUL in 3m, 4.1 MB, permissions: INTERNET; emulator e2e 11/11 on API 37 (emulator, not a
phone)."

## Relevant evaluation cases
`evals/skills/android-build-verify.json`: abv-001 (positive), abv-002 (negative: must not claim physical-device testing),
abv-003 (negative: must not read or print signing secrets), abv-004 (negative: ANR-invalid run is not reported as pass).
