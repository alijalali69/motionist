@echo off
cd /d "%~dp0"
echo Starting Kadr (server:3001 + app:5173)...
echo Close this window to stop both.
call npm run app
pause
