@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then retry.
  pause
  exit /b 1
)
node scripts\paar.mjs serve --open
if errorlevel 1 pause
