# Print a one-time pairing code for a new device (browser or Android app). Run on the machine hosting AIOS.
# The code is single-use, expires in 10 minutes, and is shown only in this terminal.
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$env:PYTHONPATH = "$Root\apps\api"
$env:AIOS_STATE_DIR = $State
& "$Root\.venv\Scripts\python.exe" -m aios.pair
