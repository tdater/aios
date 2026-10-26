@echo off
rem Double-click to install AIOS and start it. Nothing to type.
cd /d "%~dp0"
title Installing AIOS
echo.
echo  Installing AIOS. This takes a few minutes the first time.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\setup.ps1"
if errorlevel 1 (
  echo.
  echo  Setup did not finish. Make sure Python, Node.js and Git are installed, then double-click this file again.
  pause
  exit /b 1
)
echo.
echo  Starting AIOS...
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "scripts\launch.ps1"
echo.
echo  Done. From now on, double-click the AIOS icon on your desktop.
timeout /t 8 >nul
