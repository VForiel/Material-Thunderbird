@echo off
chcp 65001 >nul
title Installation de Material-Thunderbird (Material You)
echo ============================================================
echo   Installation du theme Material-Thunderbird
echo ============================================================
echo.
echo Lancement du script de configuration automatique...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0scripts\*.ps1' -ErrorAction SilentlyContinue; & '%~dp0scripts\install.ps1'"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Si Windows a bloque l'execution, faites un clic droit sur le fichier .zip
    echo     avant de l'extraire, Proprietes, cochez 'Debloquer' puis validez.
)

echo.
pause
