# Build the Android app. Usage: scripts\android-build.ps1 [-Variant debug|release]
#   debug   -> app-debug.apk   : debug-signed, WebView debugging ON, http://localhost allowed (emulator + adb reverse). NOT for real use.
#   release -> app-release*.apk: https only, no debugging. Signed only if apps\web\android\keystore.properties exists
#              (see docs\mobile-android.md); otherwise it is UNSIGNED and cannot be installed.
param([ValidateSet('debug', 'release')][string]$Variant = 'debug')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Web = Join-Path $Root 'apps\web'
$Android = Join-Path $Web 'android'

# Gradle 8.14 + AGP 8.13 need JDK 17-21; Android Studio's bundled JBR may be newer, so locate a JDK 21.
$jdk = @($env:JAVA_HOME, (Get-ChildItem 'C:\Program Files\Microsoft\jdk-21*' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
         (Get-ChildItem 'C:\Program Files\Eclipse Adoptium\jdk-21*' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)) |
       Where-Object { $_ -and (Test-Path "$_\bin\java.exe") -and ((& "$_\bin\java.exe" -version 2>&1 | Select-Object -First 1) -match '"(17|21)\.') } | Select-Object -First 1
if (-not $jdk) { throw 'JDK 17 or 21 not found. Install one or set JAVA_HOME.' }
$env:JAVA_HOME = $jdk
if (-not $env:ANDROID_HOME) { throw 'ANDROID_HOME is not set.' }

if ($Variant -eq 'debug') { $env:VITE_ALLOW_DEV_LOOPBACK = '1'; $env:AIOS_ANDROID_DEBUG = '1' }
else { Remove-Item Env:VITE_ALLOW_DEV_LOOPBACK, Env:AIOS_ANDROID_DEBUG -ErrorAction SilentlyContinue }

Push-Location $Web
try {
    npm run build
    npx cap sync android
    $cfg = Get-Content "$Android\app\src\main\assets\capacitor.config.json" -Raw | ConvertFrom-Json
    if ($Variant -eq 'release') {
        # Guard: a release APK must never carry the debug affordances.
        $bad = @()
        if ($cfg.server.androidScheme -ne 'https') { $bad += 'androidScheme is not https' }
        if ($cfg.android.webContentsDebuggingEnabled) { $bad += 'WebView debugging enabled' }
        if ($cfg.server.url) { $bad += 'server.url present' }
        if (Select-String -Path "$Web\dist\index.html" -Pattern 'localhost:8765' -Quiet) { $bad += 'dev loopback in CSP' }
        if ($bad) { throw "Refusing release build: $($bad -join '; ')" }
    }
} finally { Pop-Location }

Push-Location $Android
try {
    $task = if ($Variant -eq 'debug') { 'assembleDebug' } else { 'assembleRelease' }
    & .\gradlew.bat $task --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle $task failed ($LASTEXITCODE)" }
} finally { Pop-Location }

$apk = Get-ChildItem "$Android\app\build\outputs\apk\$Variant\*.apk" | Select-Object -First 1
$hash = (Get-FileHash $apk.FullName -Algorithm SHA256).Hash
Write-Host "`nBuilt ($Variant): $($apk.FullName)`n  size=$([math]::Round($apk.Length/1KB)) KB  sha256=$hash"
if ($apk.Name -match 'unsigned') { Write-Warning 'This release APK is UNSIGNED. Create keystore.properties (docs\mobile-android.md) to sign it.' }
$aapt2 = Get-ChildItem "$env:ANDROID_HOME\build-tools\*\aapt2.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if ($aapt2) { Write-Host 'Permissions:'; & $aapt2.FullName dump permissions $apk.FullName | Select-Object -Skip 1 }
