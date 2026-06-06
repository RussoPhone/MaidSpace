@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File scripts\setup-maidspace.ps1
pause
