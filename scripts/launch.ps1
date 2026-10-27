# One-click launcher: starts AIOS if it is not running and opens it in your browser.
# The first time, the link carries a one-time sign-in code that fills in the sign-in form (you press Pair). The code is single use,
# expires in 10 minutes, and is only ever shown to this computer. Use -NewCode (the "AIOS sign-in code" shortcut)
# to sign in another browser or to recover after clearing your browser data.
param([switch]$NewCode, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$Port = if ($env:AIOS_PORT) { $env:AIOS_PORT } else { '8765' }

function Fail([string]$Message) {
    if ($NoBrowser) { Write-Error $Message; exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Message, 'AIOS', 'OK', 'Warning')
    exit 1
}

if (-not (Test-Path "$Root\.venv\Scripts\python.exe")) {
    Fail "AIOS is not installed yet.`n`nDouble-click 'Install AIOS' in the AIOS folder first."
}
try { & "$PSScriptRoot\start.ps1" | Out-Null }
catch { Fail "AIOS could not start.`n`nDetails are in:`n$State\logs\server.err.log" }

$url = "http://127.0.0.1:$Port/"
$flag = Join-Path $State 'launcher-signed-in'
if ($NewCode -or -not (Test-Path $flag)) {
    $env:PYTHONPATH = "$Root\apps\api"
    $env:AIOS_STATE_DIR = $State
    $code = (& "$Root\.venv\Scripts\python.exe" -m aios.pair --code-only | Select-Object -Last 1)
    if ($code -notmatch '^[A-Z0-9-]{8,12}$') { Fail "AIOS started, but could not make a sign-in code." }
    $url = "$url#pair=$code"
    Set-Content -Path $flag -Value (Get-Date -Format o)
}
if ($NoBrowser) { Write-Output $url; exit 0 }
# Open AIOS in its own window (no tabs or address bar) when Microsoft Edge is installed, so it feels like an app and sits on the taskbar
# on its own. Any other setup falls back to your default browser.
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process $edge -ArgumentList "--app=$url" } else { Start-Process $url }
