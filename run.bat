@echo off
setlocal
cd /d "%~dp0"
title VibeLink Launcher
echo ============================================
echo   VibeLink - launching Desktop(Hub) + Mobile
echo ============================================
echo.
echo  [1/2] Opening Desktop (tray + hub)...
start "VibeLink - Desktop" "%~dp0desktop\run.bat"

echo  [2/2] Opening Mobile (Expo)...
start "VibeLink - Mobile" "%~dp0mobile\run.bat"

echo.
echo  Two windows opened.
echo    - Desktop: quit from the tray icon
echo    - Mobile:  press Ctrl+C in that window to stop
echo  You can close this window.
timeout /t 5 >nul
