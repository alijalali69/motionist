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
