@echo off
setlocal
set "APP=%LOCALAPPDATA%\JichulHelper\server.ps1"
if not exist "%APP%" set "APP=%~dp0program\server.ps1"
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APP%"
