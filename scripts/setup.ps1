# Fresh setup: venv, Python deps, web deps + build. Idempotent. Run from anywhere.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path "$Root\.venv\Scripts\python.exe")) { python -m venv "$Root\.venv" }
& "$Root\.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
& "$Root\.venv\Scripts\python.exe" -m pip install --quiet -e ".[dev]" 2>$null
if ($LASTEXITCODE -ne 0) {
    # editable install is optional; the app runs from apps\api via PYTHONPATH
    & "$Root\.venv\Scripts\python.exe" -m pip install --quiet "fastapi>=0.115" "uvicorn[standard]>=0.30" "pydantic>=2.7" pytest httpx
}
Push-Location "$Root\apps\web"
npm install --no-audit --no-fund
npm run build
Pop-Location
Write-Host "Setup complete. Next: scripts\start.ps1"
