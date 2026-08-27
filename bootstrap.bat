@echo off
setlocal enabledelayedexpansion
title Motionist setup

echo ================================================
echo   Motionist setup
echo   This installs everything needed and starts
echo   the app. Safe to double-click again later.
echo ================================================
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo winget was not found.
  echo Install "App Installer" from the Microsoft Store, then run this file again.
  pause
  exit /b 1
)

call :install OpenJS.NodeJS.LTS "Node.js" 1
call :install Git.Git "Git" 2
call :install Python.Python.3.12 "Python" 3
call :install Gyan.FFmpeg "ffmpeg" 4

echo.
echo (If Windows asked "Do you want to allow this app to make changes?"
echo  during any of the above, that's normal - click Yes.)
echo.

rem --- Pick up the PATH changes the installs above just made, without
rem     needing to close and reopen this window. ---
echo Refreshing PATH for this window...
for /f "usebackq skip=2 tokens=1,2,*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path`) do set "SYS_PATH=%%C"
for /f "usebackq skip=2 tokens=1,2,*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USER_PATH=%%C"
set "PATH=%SYS_PATH%;%USER_PATH%;%PATH%"

echo.
echo [5/6] Python packages (psd-tools, svgelements, aggdraw)...
where python >nul 2>nul
if errorlevel 1 (
  echo Python isn't on PATH in this window yet.
  echo Close this window, reopen it, and double-click bootstrap.bat again -
  echo it'll pick up right where it left off.
  pause
  exit /b 1
)
python -m pip install --upgrade pip
python -m pip install psd-tools svgelements aggdraw

echo.
echo [6/6] Getting Motionist...
where git >nul 2>nul
if errorlevel 1 (
  echo Git isn't on PATH in this window yet.
  echo Close this window, reopen it, and double-click bootstrap.bat again -
  echo it'll pick up right where it left off.
  pause
  exit /b 1
)
set "DEST=%USERPROFILE%\motionist"
if exist "%DEST%\.git" (
  echo Already cloned - pulling the latest instead.
  cd /d "%DEST%"
  git pull
) else (
  echo.
  echo A browser window may open asking you to log into GitHub -
  echo use the account that was invited to the motionist repo.
  echo.
  git clone https://github.com/alijalali69/motionist.git "%DEST%"
  if errorlevel 1 (
    echo.
    echo Clone failed - most likely this GitHub account hasn't been
    echo added to the repo yet. Ask for an invite, accept it, then
    echo double-click this file again.
    pause
    exit /b 1
  )
  cd /d "%DEST%"
)

echo.
where npm >nul 2>nul
if errorlevel 1 (
  echo npm isn't on PATH in this window yet.
  echo Close this window, reopen it, and double-click bootstrap.bat again -
  echo it'll pick up right where it left off.
  pause
  exit /b 1
)
echo Installing app dependencies (a few minutes the first time)...
call npm install

echo.
echo ================================================
echo   Done. Starting Motionist...
echo ================================================
call start.bat
exit /b 0

:install
set "PKG_ID=%~1"
set "PKG_LABEL=%~2"
set "STEP=%~3"
echo [%STEP%/6] %PKG_LABEL%...
winget install --id %PKG_ID% -e --source winget --accept-package-agreements --accept-source-agreements --silent
if errorlevel 1 (
  echo.
  echo %PKG_LABEL% install failed. This script will keep going and check
  echo again below - if it stops you there, install %PKG_LABEL% manually
  echo from its website and double-click this file again.
)
echo.
exit /b 0
