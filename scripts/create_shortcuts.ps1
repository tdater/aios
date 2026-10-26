# Creates the clickable AIOS icons on your Desktop and in the Start menu, so nobody has to open PowerShell.
#   AIOS                   starts AIOS and opens it in your browser
#   AIOS sign-in code      shows a one-time code to sign in another browser or phone
#   AIOS import folder     opens the folder where you drop exported chat history
#   Stop AIOS              stops the background server
param([string]$Folder, [switch]$NoStartMenu)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$State = if ($env:AIOS_STATE_DIR) { $env:AIOS_STATE_DIR } else { Join-Path (Split-Path -Parent $Root) 'aios-state' }
$Icon = Join-Path $Root 'assets\aios.ico'
$PS = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Import = Join-Path $State 'imports\approved'
New-Item -ItemType Directory -Force $Import | Out-Null

$shell = New-Object -ComObject WScript.Shell
function New-Link([string]$Dir, [string]$Name, [string]$Arguments, [string]$Target = $PS, [string]$Description = '') {
    New-Item -ItemType Directory -Force $Dir | Out-Null
    $lnk = $shell.CreateShortcut((Join-Path $Dir "$Name.lnk"))
    $lnk.TargetPath = $Target
    $lnk.Arguments = $Arguments
    $lnk.WorkingDirectory = $Root
    $lnk.Description = $Description
    if (Test-Path $Icon) { $lnk.IconLocation = "$Icon,0" }
    $lnk.Save()
}
$hidden = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\launch.ps1`""
$code = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\launch.ps1`" -NewCode"
$stop = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\stop.ps1`""

$targets = @()
if ($Folder) { $targets += $Folder } else {
    $targets += [Environment]::GetFolderPath('Desktop')
    if (-not $NoStartMenu) { $targets += (Join-Path ([Environment]::GetFolderPath('Programs')) 'AIOS') }
}
foreach ($dir in $targets) {
    New-Link $dir 'AIOS' $hidden $PS 'Start AIOS and open it in your browser'
    New-Link $dir 'AIOS sign-in code' $code $PS 'Sign in another browser or phone'
    New-Link $dir 'AIOS import folder' "`"$Import`"" "$env:SystemRoot\explorer.exe" 'Drop exported chat history here'
    New-Link $dir 'Stop AIOS' $stop $PS 'Stop the AIOS background server'
    Write-Host "Shortcuts created in $dir"
}
