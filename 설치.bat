@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0program\install.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 5 >nul
