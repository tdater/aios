# Start AIOS in the background on loopback. State lives outside the repo (AIOS_STATE_DIR).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$Port = if ($env:AIOS_PORT) { $env:AIOS_PORT } else { '8765' }
New-Item -ItemType Directory -Force "$State\logs" | Out-Null
$PidFile = "$State\aios.pid"

if (Test-Path $PidFile) {
    $old = Get-Process -Id ([int](Get-Content $PidFile)) -ErrorAction SilentlyContinue
    if ($old) { Write-Host "Already running (pid $($old.Id)) at http://127.0.0.1:$Port"; exit 0 }
    Remove-Item $PidFile
}
$env:PYTHONPATH = "$Root\apps\api"
$env:AIOS_STATE_DIR = $State
$p = Start-Process -FilePath "$Root\.venv\Scripts\python.exe" -ArgumentList '-m', 'aios.main' `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$State\logs\server.out.log" -RedirectStandardError "$State\logs\server.err.log"
Set-Content $PidFile $p.Id

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        Write-Host "AIOS up (pid $($p.Id)) -> http://127.0.0.1:$Port  schema=$($h.schema -join ',')"
        exit 0
    } catch { }
}
Write-Error "AIOS did not become healthy; see $State\logs\server.err.log"
