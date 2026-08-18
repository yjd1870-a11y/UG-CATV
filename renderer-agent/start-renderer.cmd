@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-renderer.ps1" %*
exit /b %ERRORLEVEL%
