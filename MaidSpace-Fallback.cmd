@echo off
cd /d "%~dp0"
if not exist node_modules (
  powershell -ExecutionPolicy Bypass -File scripts\setup-maidspace.ps1
)
npm run fallback
pause
