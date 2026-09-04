@echo off
setlocal enabledelayedexpansion
title Motionist - install Resolve plugins

echo ================================================
echo   Motionist - DaVinci Resolve plugin installer
echo ================================================
echo.
echo Needs DaVinci Resolve STUDIO - the free version
echo doesn't support Workflow Integration Plugins.
echo.

set "PLUGINS_ROOT=%~dp0resolve-plugin"
set "DEST_ROOT=%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins"
set "FAILED=0"

rem Regenerate the Timeline panel's entrance/exit effect list from
rem src/presets.ts's own arrays before copying, so an install always ships
rem whatever effects the app currently has, not a hand-copied list that can
rem silently drift out of sync (see tools/gen_resolve_effect_list.mjs).
echo Regenerating Resolve Timeline panel's effect list from src/presets.ts ...
node "%~dp0tools\gen_resolve_effect_list.mjs"
if !errorlevel! NEQ 0 (
  echo   Failed to regenerate the effect list - is Node.js installed and on PATH?
  pause
  exit /b 1
)
echo.

for %%P in (com.motionist.reelpanel com.motionist.timelinepanel) do (
  set "SRC=%PLUGINS_ROOT%\%%P"
  set "DEST=%DEST_ROOT%\%%P"
  if not exist "!SRC!" (
    echo Could not find "!SRC!".
    echo Run this from inside your cloned motionist folder, and make sure
    echo you're on the latest version first ^(bootstrap.bat, or git pull^).
    pause
    exit /b 1
  )
  echo Copying %%P ...
  rem /R:2 /W:2 - fail fast (2 retries, 2s apart) instead of robocopy's default
  rem of a MILLION retries 30s apart, which hangs indefinitely if the plugin
  rem is currently open in Resolve (its .node file is locked while running).
  robocopy "!SRC!" "!DEST!" /E /R:2 /W:2 /NFL /NDL /NJH /NJS >nul
  if !errorlevel! GEQ 8 (
    echo   Failed - robocopy error code !errorlevel!.
    set "FAILED=1"
  )
)

if "%FAILED%"=="1" (
  echo.
  echo One or more plugins failed to copy. If Resolve is open with a
  echo Motionist panel loaded, close it ^(or quit Resolve entirely^) and
  echo run this again.
  pause
  exit /b 1
)

echo.
echo ================================================
echo   Done. Restart DaVinci Resolve, then check:
echo   Workspace - Workflow Integrations -
echo     - Motionist               (full editor panel)
echo     - Motionist Timeline Text (animate a clip's text in place)
echo ================================================
pause
