@echo off
setlocal
title MTB Hub - Desktop
cd /d "%~dp0"
if not exist node_modules goto install
goto run
:install
echo First run: installing dependencies (Electron, can take a few minutes)...
call npm install
if errorlevel 1 goto fail
:run
echo Starting MTB Hub desktop app (tray). Quit from the tray icon.
call npm start
goto end
:fail
echo.
echo [FAIL] npm install failed. See messages above.
pause
exit /b 1
:end
pause
