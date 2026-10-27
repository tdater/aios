# Lets your phone reach AIOS over Tailscale, privately: only devices signed in to YOUR tailnet can connect.
#
#   scripts\phone-access.ps1          turn it on and print the https address to type into the phone app
#   scripts\phone-access.ps1 -Status  show what is shared right now
#   scripts\phone-access.ps1 -Off     stop sharing (tailscale serve reset) and forget the name
#
# What it does, so nothing is a surprise:
#   1. reads this PC's Tailscale name (for example my-pc.tail1234.ts.net) from the Tailscale app
#   2. saves that name to <state>\allowed-hosts.txt so AIOS accepts requests addressed to it (AIOS itself stays on 127.0.0.1)
#   3. runs `tailscale serve --bg 8765`, which puts HTTPS with a real certificate in front of AIOS for your tailnet only
#   4. restarts AIOS so it picks up the name, then checks that nothing is exposed to the public internet (Funnel)
# It never runs `tailscale funnel`. You still pair the phone with a one-time code (scripts\pair.ps1).
param([switch]$Off, [switch]$Status)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$Port = if ($env:AIOS_PORT) { $env:AIOS_PORT } else { '8765' }
$HostsFile = Join-Path $State 'allowed-hosts.txt'

function Stop-WithMessage([string]$Message) { Write-Host ""; Write-Host $Message -ForegroundColor Yellow; exit 1 }

$ts = Get-Command tailscale -ErrorAction SilentlyContinue
if (-not $ts) { $ts = Get-Item "$env:ProgramFiles\Tailscale\tailscale.exe" -ErrorAction SilentlyContinue }
if (-not $ts) { Stop-WithMessage "Tailscale is not installed on this PC. Install it from tailscale.com, sign in, and run this again." }
$tailscale = if ($ts.Source) { $ts.Source } else { $ts.FullName }

if ($Status) { & $tailscale serve status; exit 0 }

if ($Off) {
    & $tailscale serve reset
    if (Test-Path $HostsFile) { Remove-Item $HostsFile }
    Write-Host "Sharing is off. Your phone can no longer reach AIOS. (Restart AIOS with scripts\stop.ps1 then scripts\start.ps1 to apply.)"
    exit 0
}

try { $json = & $tailscale status --json | ConvertFrom-Json } catch { Stop-WithMessage "Tailscale is not answering. Open the Tailscale app, make sure it is connected, and run this again." }
if ($json.BackendState -ne 'Running') { Stop-WithMessage "Tailscale is not connected (state: $($json.BackendState)). Open the Tailscale app and sign in." }
$name = ([string]$json.Self.DNSName).TrimEnd('.').ToLower()
if (-not $name -or $name -notmatch '\.ts\.net$') {
    Stop-WithMessage "This PC has no Tailscale name. In the Tailscale admin console (login.tailscale.com/admin/dns) turn on MagicDNS, then run this again."
}

New-Item -ItemType Directory -Force $State | Out-Null
Set-Content -Path $HostsFile -Value $name -Encoding ascii

Write-Host "Sharing AIOS to your tailnet as https://$name ..."
$out = & $tailscale serve --bg $Port 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $out -match 'not enabled|HTTPS|certificate') {
    Write-Host $out
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage ("Tailscale could not turn on HTTPS for this PC. In the Tailscale admin console (login.tailscale.com/admin/dns), scroll to " +
            "'HTTPS Certificates' and press Enable HTTPS, then run this again. If it printed a link above, open that link and approve it.")
    }
}

# Restart AIOS so it accepts the new name.
& "$PSScriptRoot\stop.ps1" | Out-Null
& "$PSScriptRoot\start.ps1" | Out-Null

$status = & $tailscale serve status 2>&1 | Out-String
Write-Host $status
if ($status -match 'Funnel on') {
    & $tailscale serve reset
    Stop-WithMessage "Tailscale reported that Funnel (public internet sharing) was on. I turned all sharing off. Do not use Funnel with AIOS."
}
if ($status -notmatch 'tailnet only') { Write-Host "Note: could not confirm the line '(tailnet only)' in the status above. Check it before using your phone." -ForegroundColor Yellow }

Write-Host ""
Write-Host "Done. In the AIOS phone app, add this server address:" -ForegroundColor Green
Write-Host "    https://$name" -ForegroundColor Green
Write-Host "Then get a one-time pairing code with scripts\pair.ps1 and type it into the app."
Write-Host "To stop sharing later: scripts\phone-access.ps1 -Off"
