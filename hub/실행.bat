@echo off
setlocal
title MTB Hub
cd /d "%~dp0"
if "%MTB_PASSWORD%"=="" set "MTB_PASSWORD=changeme1234"
echo Starting MTB Hub on http://127.0.0.1:47800
echo Password: %MTB_PASSWORD%
call npx tsx src/index.ts
pause
