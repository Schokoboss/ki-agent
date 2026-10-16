@echo off
chcp 65001 >nul
title KI-Agent Nova
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Python\bin\python3.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -u server\agent_server.py
echo.
echo Agent beendet. Beliebige Taste zum Schliessen.
pause >nul
