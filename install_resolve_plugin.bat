@echo off
setlocal
title Motionist - install Resolve plugin

echo ================================================
echo   Motionist - DaVinci Resolve plugin installer
echo ================================================
echo.
echo Needs DaVinci Resolve STUDIO - the free version
echo doesn't support Workflow Integration Plugins.
echo.

set "SRC=%~dp0resolve-plugin\com.motionist.reelpanel"
set "DEST=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.motionist.reelpanel"

if not exist "%SRC%" (
  echo Could not find "%SRC%".
  echo Run this from inside your cloned motionist folder, and make sure
  echo you're on the latest version first ^(bootstrap.bat, or git pull^).
  pause
  exit /b 1
)

echo Copying plugin into Resolve's plugin folder...
rem /R:2 /W:2 - fail fast (2 retries, 2s apart) instead of robocopy's default
rem of a MILLION retries 30s apart, which hangs indefinitely if the plugin
rem is currently open in Resolve (its .node file is locked while running).
robocopy "%SRC%" "%DEST%" /E /R:2 /W:2 /NFL /NDL /NJH /NJS >nul
if %errorlevel% GEQ 8 (
  echo.
  echo Copy failed - robocopy error code %errorlevel%.
  echo If Resolve is open with the Motionist panel loaded, close that panel
  echo ^(or quit Resolve entirely^) and run this again.
  pause
  exit /b 1
)

echo.
echo ================================================
echo   Done. Restart DaVinci Resolve, then check:
echo   Workspace - Workflow Integrations - Motionist
echo ================================================
pause
