@echo off
setlocal
title MTB extension build + install

set "VSIX=mobile-term-bridge-0.1.0.vsix"
set "EXTDIR=%~dp0"
set "VSIXPATH=%EXTDIR%%VSIX%"

echo ============================================================
echo   MTB extension update   ( WSL build  -^>  VS Code install )
echo ============================================================
echo.
echo [1/3] Building in WSL (typecheck + vsce package)...
echo       first run can take ~30-60s, please wait.
echo.

wsl -d Ubuntu-24.04 -- bash -c "export PATH=$HOME/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin; cd /mnt/e/mobile_term_bridge_distrib/extension && echo '- typecheck' && ./node_modules/.bin/tsc -p ./ --noEmit && echo '- package' && npm run package"
if errorlevel 1 goto build_fail
if not exist "%VSIXPATH%" goto novsix

echo.
echo [2/3] Installing into VS Code (--force)...
echo.
set "CODECLI="
for /f "delims=" %%i in ('where code 2^>nul') do if not defined CODECLI set "CODECLI=%%i"
if not defined CODECLI set "CODECLI=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
if not exist "%CODECLI%" goto nocli

call "%CODECLI%" --install-extension "%VSIXPATH%" --force
if errorlevel 1 goto install_fail

echo.
echo ============================================================
echo  [3/3] DONE!  Last step in VS Code:
echo    Ctrl+Shift+P  -^>  "Developer: Reload Window"
echo    (or just close the VS Code window and reopen it)
echo ============================================================
echo.
pause
exit /b 0

:build_fail
echo.
echo [FAIL] Build error. Check the messages above.
echo.
pause
exit /b 1

:novsix
echo.
echo [FAIL] %VSIX% was not produced.
echo.
pause
exit /b 1

:nocli
echo.
echo [INFO] 'code' CLI not found. Install the VSIX manually in VS Code:
echo        %VSIXPATH%
echo        Extensions panel  -^>  "..."  -^>  "Install from VSIX..."
start "" "%EXTDIR%"
pause
exit /b 1

:install_fail
echo.
echo [FAIL] Install failed. Install the VSIX via GUI: %VSIXPATH%
echo.
pause
exit /b 1