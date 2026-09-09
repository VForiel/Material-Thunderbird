<#
.SYNOPSIS
    Script unique de desinstallation globale de Material-Thunderbird.
.DESCRIPTION
    Supprime le dossier chrome/ du profil Thunderbird actif, restaure la configuration
    initiale dans user.js, et nettoie d'eventuels fichiers residuels.
#>
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "  Desinstallation Globale de Material-Thunderbird (M3)      " -ForegroundColor Yellow
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

    if (-not $TargetProfileRelPath) {
        $profilePath = ""
        $isDefault = $false
        foreach ($line in $iniContent) {
            if ($line -match "^\[(.*)\]$") {
                if ($isDefault -and $profilePath) { $TargetProfileRelPath = $profilePath; break }
                $profilePath = ""
                $isDefault = $false
            }
            elseif ($line -match "^Path=(.*)$") { $profilePath = $matches[1].Trim() }
            elseif ($line -match "^Default=1$") { $isDefault = $true }
        }
        if ($isDefault -and $profilePath -and -not $TargetProfileRelPath) {
            $TargetProfileRelPath = $profilePath
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

# 1. Suppression du dossier chrome/
if (Test-Path $DestChromeDir) {
    Write-Host "[*] Suppression du dossier chrome/ dans :" -ForegroundColor Cyan
    Write-Host "    $DestChromeDir" -ForegroundColor Yellow
    Remove-Item -Path $DestChromeDir -Recurse -Force
    Write-Host "[+] Dossier de personnalisation CSS supprime avec succes." -ForegroundColor Green
} else {
    Write-Host "[i] Aucun dossier chrome/ trouve dans le profil." -ForegroundColor DarkGray
}

# 2. Nettoyage de user.js
$UserJsPath = Join-Path $ProfileDir "user.js"
if (Test-Path $UserJsPath) {
    $lines = Get-Content $UserJsPath | Where-Object { 
        $_ -notmatch "toolkit.legacyUserProfileCustomizations.stylesheets" -and
        $_ -notmatch "svg.context-properties.content.enabled"
    }
    Set-Content -Path $UserJsPath -Value $lines -Encoding UTF8
    Write-Host "[+] Preferences user.js restaurees avec succes." -ForegroundColor Green
}

# 3. Nettoyage des fichiers autoconfig residuels dans Program Files (si presents)
$tbCandidateDirs = @(
    "C:\Program Files\Mozilla Thunderbird",
    "C:\Program Files (x86)\Mozilla Thunderbird"
)
foreach ($tbDir in $tbCandidateDirs) {
    $autoCfg = Join-Path $tbDir "defaults\pref\autoconfig.js"
    $mozCfg  = Join-Path $tbDir "mozilla.cfg"
    if (Test-Path $autoCfg) {
        try { Remove-Item $autoCfg -Force -ErrorAction SilentlyContinue } catch {}
    }
    if (Test-Path $mozCfg) {
        try { Remove-Item $mozCfg -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Desinstallation terminee avec succes !                   " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Redemarrez Mozilla Thunderbird pour retrouver l'interface par defaut." -ForegroundColor Cyan
