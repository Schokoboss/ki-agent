@echo off
chcp 65001 >nul
title Tumult Arena
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Python\bin\python3.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -u server.py --internet
echo.
echo Server beendet. Beliebige Taste zum Schliessen.
pause >nul
