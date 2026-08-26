@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "VBS=%SCRIPT_DIR%start_hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\Motionist.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%VBS%\"'; $s.WorkingDirectory='%SCRIPT_DIR%'; $s.Save()"

echo Done. Motionist will now auto-start every time you log into Windows.
echo Starting it now so you don't have to wait for a reboot...
start "" wscript.exe "%VBS%"
timeout /t 3 >nul
echo Open http://localhost:5173 in your browser.
pause
