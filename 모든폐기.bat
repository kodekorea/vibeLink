@echo off
chcp 949
cd /d "%~dp0"
title ¸ðµç device Æó±â

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

echo === ¸ðµç device Æó±â (ÈÞ´ëÆù ºÐ½Ç µî) ===
python -m server.cli revoke --all
pause
