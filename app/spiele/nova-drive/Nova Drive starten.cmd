@echo off
chcp 65001 >nul
title Nova Drive
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Python\bin\python3.exe"
if not exist "%PY%" set "PY=python"
"%PY%" -u starten.py
if errorlevel 9009 py -3 -u starten.py
echo.
echo Nova Drive beendet. Beliebige Taste zum Schliessen.
pause >nul
