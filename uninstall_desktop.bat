@echo off
setlocal
title VibeLink / MTB Hub Desktop Cleaner
chcp 65001 >nul

echo ===================================================
echo   VibeLink / MTB Hub 데스크톱 버전 완전 제거 스크립트
echo ===================================================
echo.

echo [1/4] 실행 중인 데스크톱 프로그램 종료 중...
taskkill /f /im "MTB Hub.exe" >nul 2>&1
taskkill /f /im "TermiCast.exe" >nul 2>&1
taskkill /f /im "VibeLink.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] 공식 언인스톨러(Uninstall MTB Hub.exe) 백그라운드 실행 중...
set "UNINSTALLER=%LOCALAPPDATA%\Programs\mtb-desktop\MTB Hub\Uninstall MTB Hub.exe"
if exist "%UNINSTALLER%" (
    echo 기존 MTB Hub 설치 정보가 발견되었습니다. 자동 제거를 시작합니다.
    start /wait "" "%UNINSTALLER%" /S
    echo 제거 완료.
) else (
    echo 등록된 공식 언인스톨러를 찾을 수 없습니다. (이미 제거되었거나 수동 설치됨)
)

echo [3/4] 잔여 임시 폴더 및 사용자 설정 파일 제거 중...
:: 프로그램 디렉토리 정리
if exist "%LOCALAPPDATA%\Programs\mtb-desktop" (
    rmdir /s /q "%LOCALAPPDATA%\Programs\mtb-desktop" >nul 2>&1
)
:: 예전 데이터 폴더 정리 (.termicast, .mtb 등)
if exist "%USERPROFILE%\.termicast" (
    echo [제거] %USERPROFILE%\.termicast 폴더 삭제 중...
    rmdir /s /q "%USERPROFILE%\.termicast" >nul 2>&1
)
if exist "%USERPROFILE%\.mtb" (
    echo [제거] %USERPROFILE%\.mtb 폴더 삭제 중...
    rmdir /s /q "%USERPROFILE%\.mtb" >nul 2>&1
)

echo [4/4] 바탕화면 잔여 바로가기 아이콘 제거 중...
:: 사용자 기본 바탕화면 및 D드라이브 바탕화면 타겟
del /f /q "%USERPROFILE%\Desktop\MTB Hub.lnk" >nul 2>&1
del /f /q "D:\Desktop\MTB Hub.lnk" >nul 2>&1
del /f /q "%USERPROFILE%\Desktop\TermiCast.lnk" >nul 2>&1
del /f /q "D:\Desktop\TermiCast.lnk" >nul 2>&1
del /f /q "%USERPROFILE%\Desktop\VibeLink.lnk" >nul 2>&1
del /f /q "D:\Desktop\VibeLink.lnk" >nul 2>&1

echo.
echo ===================================================
echo [완료] 예전 데스크톱 버전(MTB Hub)이 완전히 제거되었습니다!
echo ===================================================
pause
