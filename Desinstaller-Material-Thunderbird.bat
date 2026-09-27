@echo off
chcp 65001 >nul
title Desinstallation de Material-Thunderbird
echo ============================================================
echo   Desinstallation du theme Material-Thunderbird
echo ============================================================
echo.
echo Restauration de l'apparence par defaut de Thunderbird...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0scripts\*.ps1' -ErrorAction SilentlyContinue; & '%~dp0scripts\uninstall.ps1'"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Une erreur est survenue lors de la restauration.
)

echo.
pause
