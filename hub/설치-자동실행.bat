@echo off
setlocal
set "SRC=%~dp0launcher.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
echo Registering MTB Hub to run at login...
echo Source: %SRC%
echo Startup: %STARTUP%
copy /y "%SRC%" "%STARTUP%\mtb-hub.vbs" >nul
if errorlevel 1 goto fail
echo DONE. MTB Hub will start hidden at next login.
echo To start now without reboot, double-click launcher.vbs.
echo To remove: delete "%STARTUP%\mtb-hub.vbs"
pause
exit /b 0
:fail
echo FAILED to copy launcher to Startup.
pause
exit /b 1
