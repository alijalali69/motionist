@echo off
echo Stopping anything on ports 3001 and 5173...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3001 ^| findstr LISTENING') do taskkill /F /PID %%p 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%p 2>nul
echo Done.
pause
