@echo off
chcp 949
cd /d "%~dp0"
title mobile_term_bridge

REM === 본인 암호 (휴대폰 PWA 페어링 폼에 같은 값 입력) ===
REM 영구 사용. 변경하려면 아래 값 수정 후 서버 재시작.
REM set "MTB_PASSWORD=my_password_here"

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

REM === Tailscale HTTPS 노출 (이미 설정된 경우 무시됨) ===
tailscale serve --bg --https=443 http://localhost:47800 2>nul
for /f "tokens=*" %%i in ('tailscale serve status 2^>/dev/null ^| findstr "https://"') do set MTB_URL=%%i
if defined MTB_URL (
    echo.
    echo [접속 URL] %MTB_URL%
    echo.
)

python -m server.server %*
if errorlevel 1 pause
