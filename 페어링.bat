@echo off
chcp 949
cd /d "%~dp0"
title 페어링 코드 발급

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

echo === 페어링 코드 발급 (5분 1회용) ===
python -m server.cli issue
echo.
pause
