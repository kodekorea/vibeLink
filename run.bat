@echo off
setlocal
cd /d "%~dp0"
title VibeLink Launcher
chcp 65001 >nul
echo ============================================
echo   VibeLink - Desktop(Hub) + Mobile 한번에 실행
echo ============================================
echo.
echo  [1/2] 데스크톱(트레이 + 허브) 창 여는 중...
start "VibeLink - Desktop" "%~dp0desktop\run.bat"

echo  [2/2] 모바일(Expo) 창 여는 중...
start "VibeLink - Mobile" "%~dp0mobile\run.bat"

echo.
echo  두 창이 각각 열렸습니다.
echo   - 데스크톱: 트레이 아이콘에서 종료
echo   - 모바일: 그 창에서 Ctrl+C 로 중지
echo  이 창은 닫아도 됩니다.
timeout /t 5 >nul
