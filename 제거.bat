@echo off
setlocal
if exist "%LOCALAPPDATA%\JichulHelper\uninstall.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\JichulHelper\uninstall.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0program\uninstall.ps1"
)
pause
