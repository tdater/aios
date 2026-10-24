# Install a local git pre-commit hook that blocks commits containing probable secrets.
# (Git hooks are not versioned, so each clone runs this once.) CI runs the same scan on every push.
$Root = Split-Path -Parent $PSScriptRoot
$hook = Join-Path $Root '.git\hooks\pre-commit'
$py = '.venv/Scripts/python.exe'
@"
#!/bin/sh
# AIOS pre-commit: scan staged files for secrets (see scripts/scan_secrets.py, .secret-allowlist)
cd "`$(git rev-parse --show-toplevel)" || exit 1
if [ -x "$py" ]; then PY="$py"; else PY="python"; fi
exec "`$PY" scripts/scan_secrets.py --staged
"@ | Set-Content -Path $hook -Encoding ascii -NoNewline
Write-Host "Installed $hook"
