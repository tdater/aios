# Stop the AIOS server started by start.ps1. Interrupted runs are reconciled on next start.
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$PidFile = "$State\aios.pid"
if (-not (Test-Path $PidFile)) { Write-Host "Not running (no pid file)."; exit 0 }
$procId = [int](Get-Content $PidFile)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($p -and $p.ProcessName -like 'python*') { Stop-Process -Id $procId -Force; Write-Host "Stopped pid $procId." }
else { Write-Host "Stale pid file (pid $procId not an AIOS python process)." }
Remove-Item $PidFile -Force
