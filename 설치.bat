@echo off
chcp 949
cd /d "%~dp0"
title mobile_term_bridge - 의존성 설치

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
) else (
    python -m venv .venv
    call ".venv\Scripts\activate.bat"
)

echo === 의존성 설치 ===
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
echo.
echo === 완료 ===
pause
