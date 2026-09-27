@echo off
chcp 65001 >nul
title Personnalisation de Material-Thunderbird (Material You)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0scripts\customize.ps1'"
