@echo off
setlocal
title MTB Hub - Mobile (Expo)
cd /d "%~dp0"
if not exist node_modules goto install
goto run
:install
echo First run: installing dependencies, please wait...
call npm install
if errorlevel 1 goto fail
:run
echo Starting Expo dev server. Scan the QR with Expo Go on your phone.
echo Press Ctrl+C in this window to stop.
call npx expo start
goto end
:fail
echo.
echo [FAIL] npm install failed. See messages above.
pause
exit /b 1
:end
pause
