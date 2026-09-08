@echo off
title Desinstallation de Material-Thunderbird
echo Lancement du script de desinstallation...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
