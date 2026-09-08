<#
.SYNOPSIS
    Script de desinstallation de Material-Thunderbird.
.DESCRIPTION
    Supprime le dossier chrome/ du profil Thunderbird actif et restaure la configuration initiale.
#>
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "  Desinstallation de Material-Thunderbird (Material You M3) " -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow

$AppData = [Environment]::GetFolderPath("ApplicationData")
$ThunderbirdDir = Join-Path $AppData "Thunderbird"
$ProfilesIni = Join-Path $ThunderbirdDir "profiles.ini"

if (-not (Test-Path $ThunderbirdDir)) {
    Write-Error "Dossier Thunderbird introuvable dans $ThunderbirdDir."
    exit 1
}

$TargetProfileRelPath = $null
if (Test-Path $ProfilesIni) {
    $iniContent = Get-Content $ProfilesIni
    $isDefaultSection = $false
    foreach ($line in $iniContent) {
        if ($line -match "^\[(.*)\]$") {
            $section = $matches[1]
            if ($section -like "Install*") { $isDefaultSection = $true }
            else { $isDefaultSection = $false }
        }
        elseif ($isDefaultSection -and $line -match "^Default=(.*)$") {
            $TargetProfileRelPath = $matches[1].Trim()
            break
        }
    }
}

if (-not $TargetProfileRelPath) {
    $fallbackProfiles = Get-ChildItem (Join-Path $ThunderbirdDir "Profiles") -Directory | Where-Object { $_.Name -like "*.default*" }
    if ($fallbackProfiles.Count -gt 0) {
        $TargetProfileRelPath = "Profiles/" + $fallbackProfiles[0].Name
    }
}

if (-not $TargetProfileRelPath) {
    Write-Error "Impossible de localiser le profil Thunderbird actif."
    exit 1
}

$ProfileDir = Join-Path $ThunderbirdDir $TargetProfileRelPath.Replace("/", "\")
$DestChromeDir = Join-Path $ProfileDir "chrome"

if (Test-Path $DestChromeDir) {
    Write-Host "[*] Suppression du dossier chrome/ dans :" -ForegroundColor Cyan
    Write-Host "    $DestChromeDir" -ForegroundColor Yellow
    Remove-Item -Path $DestChromeDir -Recurse -Force
    Write-Host "[+] Dossier de personnalisation CSS supprime avec succes." -ForegroundColor Green
} else {
    Write-Host "[!] Aucun dossier chrome/ trouve dans le profil." -ForegroundColor DarkGray
}

# Nettoyage de user.js
$UserJsPath = Join-Path $ProfileDir "user.js"
if (Test-Path $UserJsPath) {
    $lines = Get-Content $UserJsPath | Where-Object { 
        $_ -notmatch "toolkit.legacyUserProfileCustomizations.stylesheets" -and
        $_ -notmatch "svg.context-properties.content.enabled"
    }
    Set-Content -Path $UserJsPath -Value $lines -Encoding UTF8
    Write-Host "[+] Preferences user.js restaurees avec succes." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Desinstallation terminee avec succes !                   " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Redemarrez Mozilla Thunderbird pour retrouver l'interface par defaut." -ForegroundColor Cyan
