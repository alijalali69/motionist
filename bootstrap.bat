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

echo [1/6] Node.js...
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent

echo.
echo [2/6] Git...
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements --silent

echo.
echo [3/6] Python...
winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements --silent

echo.
echo [4/6] ffmpeg...
winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements --silent

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
python -m pip install --upgrade pip
python -m pip install psd-tools svgelements aggdraw

echo.
echo [6/6] Getting Motionist...
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
echo Installing app dependencies (a few minutes the first time)...
call npm install

echo.
echo ================================================
echo   Done. Starting Motionist...
echo ================================================
call start.bat
