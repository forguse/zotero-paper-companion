@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  python scripts\build.py
) else (
  py -3 scripts\build.py
)
if errorlevel 1 (
  echo Build failed. Python 3 is required. See CONTRIBUTING.md.
  pause
  exit /b 1
)
echo Ready: INSTALL-LATEST.xpi
pause
