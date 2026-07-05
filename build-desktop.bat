@echo off
setlocal
cd /d "%~dp0desktop"
title Build Desktop installer (electron-builder)
echo ============================================
echo   Building VibeLink Desktop installer (NSIS)
echo ============================================
echo.

if not exist node_modules (
  echo Installing desktop deps...
  call npm install
  if errorlevel 1 goto fail
)

cd /d "%~dp0hub"
echo Installing hub runtime deps...
call npm install
if errorlevel 1 goto fail

cd /d "%~dp0desktop"

rem No code signing (personal distribution) -> avoids cert prompts.
set CSC_IDENTITY_AUTO_DISCOVERY=false

echo Running electron-builder...
call npm run dist
if errorlevel 1 goto fail

echo.
echo [OK] Done. Installer is in:  desktop\dist\
echo      Look for "MTB Hub Setup *.exe"
goto end

:fail
echo.
echo [FAIL] Build failed. See messages above.
echo  Tip: winCodeSign symlink error -> enable Windows Developer Mode, then retry.

:end
pause
