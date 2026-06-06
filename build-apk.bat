@echo off
setlocal
cd /d "%~dp0mobile"
title Build Android APK (local, no EAS)
echo ============================================
echo   Building VibeLink Android APK (local gradle)
echo ============================================
echo.

if not exist node_modules (
  echo Installing mobile deps...
  call npm install
  if errorlevel 1 goto fail
)

if not exist android (
  echo Prebuilding Android project...
  call npx expo prebuild -p android
  if errorlevel 1 goto fail
)

echo Running gradle assembleRelease (bundles JS + builds APK)...
cd android
call gradlew.bat assembleRelease
if errorlevel 1 goto fail

echo.
echo [OK] Done. APK at:
echo   mobile\android\app\build\outputs\apk\release\app-release.apk
echo (Release APK is debug-signed -> installable directly on your phone.)
goto end

:fail
echo.
echo [FAIL] Build failed. See messages above.
echo  Needs: JDK 17 + Android SDK (same as 'expo run:android').

:end
pause
