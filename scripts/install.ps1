<#
.SYNOPSIS
    Script unique d'installation globale de Material-Thunderbird (Material You M3).
.DESCRIPTION
    Detecte automatiquement le profil Thunderbird actif, active les preferences necessaires
    dans user.js, deploie les feuilles de style chrome/, et compile l'extension .xpi.
.PARAMETER DryRun
    Affiche les actions sans modifier le systeme.
#>
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   Installation Globale de Material-Thunderbird (M3)        " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Localiser le dossier Thunderbird dans AppData
$AppData = [Environment]::GetFolderPath("ApplicationData")
$ThunderbirdDir = Join-Path $AppData "Thunderbird"
$ProfilesIni = Join-Path $ThunderbirdDir "profiles.ini"

if (-not (Test-Path $ThunderbirdDir)) {
    Write-Error "Dossier Thunderbird introuvable dans $ThunderbirdDir. Veuillez verifier que Mozilla Thunderbird est bien installe."
    exit 1
}

# 2. Identifier le profil cible via profiles.ini
$TargetProfileRelPath = $null
if (Test-Path $ProfilesIni) {
    $iniContent = Get-Content $ProfilesIni
    $currentSection = ""
    $isDefaultSection = $false
    
    # Recherche en priorite dans [Install...] Default=...
    foreach ($line in $iniContent) {
        if ($line -match "^\[(.*)\]$") {
            $currentSection = $matches[1]
            if ($currentSection -like "Install*") { $isDefaultSection = $true }
            else { $isDefaultSection = $false }
        }
        elseif ($isDefaultSection -and $line -match "^Default=(.*)$") {
            $TargetProfileRelPath = $matches[1].Trim()
            break
        }
    }

    # Recherche secondaire si non trouve dans Install
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

# Recherche de secours si profiles.ini n'a pas pu etre analyse
if (-not $TargetProfileRelPath) {
    $fallbackProfiles = Get-ChildItem (Join-Path $ThunderbirdDir "Profiles") -Directory | Where-Object { $_.Name -like "*.default*" }
    if ($fallbackProfiles.Count -gt 0) {
        $TargetProfileRelPath = "Profiles/" + $fallbackProfiles[0].Name
    }
}

if (-not $TargetProfileRelPath) {
    Write-Error "Impossible d'identifier automatiquement le profil Thunderbird actif."
    exit 1
}

$ProfileDir = Join-Path $ThunderbirdDir $TargetProfileRelPath.Replace("/", "\")
if (-not (Test-Path $ProfileDir)) {
    Write-Error "Le profil cible n'existe pas : $ProfileDir"
    exit 1
}

Write-Host "[*] Profil Thunderbird detecte :" -ForegroundColor Green
Write-Host "    $ProfileDir" -ForegroundColor Yellow

# 3. Verifier si Thunderbird est en cours d'execution
$tbProcess = Get-Process -Name "thunderbird" -ErrorAction SilentlyContinue
if ($tbProcess) {
    Write-Host "[!] Note : Mozilla Thunderbird est actuellement ouvert." -ForegroundColor Magenta
    Write-Host "    Pensez a fermer et relancer Thunderbird apres l'installation pour appliquer les styles." -ForegroundColor Magenta
}

# 4. Verifier la source du dossier chrome/ dans le depot
$ProjectRoot = (Get-Item "$PSScriptRoot\..").FullName
$SourceChromeDir = Join-Path $ProjectRoot "chrome"

if (-not (Test-Path $SourceChromeDir)) {
    Write-Error "Dossier source chrome/ introuvable dans $SourceChromeDir."
    exit 1
}

$AllProfiles = @($ProfileDir)
$otherProfiles = Get-ChildItem (Join-Path $ThunderbirdDir "Profiles") -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
foreach ($p in $otherProfiles) {
    if ($AllProfiles -notcontains $p) {
        $AllProfiles += $p
    }
}

Write-Host "[*] Profils cibles pour le deploiement :" -ForegroundColor Cyan
foreach ($p in $AllProfiles) {
    Write-Host "    - $p" -ForegroundColor Yellow
}

if ($DryRun) {
    foreach ($p in $AllProfiles) {
        Write-Host "[DRY-RUN] Deploiement prevu dans : $p" -ForegroundColor Cyan
    }
    Write-Host "[DRY-RUN] Test termine avec succes." -ForegroundColor Green
    return
}

# 5. Deploiement des styles et configuration pour chaque profil
$PrefsToAdd = @(
    'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
    'user_pref("svg.context-properties.content.enabled", true);',
    'user_pref("extensions.experiments.enabled", true);',
    'user_pref("xpinstall.signatures.required", false);'
)

foreach ($targetDir in $AllProfiles) {
    # A. Copie du dossier chrome/
    $destChrome = Join-Path $targetDir "chrome"
    if (-not (Test-Path $destChrome)) {
        New-Item -ItemType Directory -Path $destChrome | Out-Null
    }
    Copy-Item -Path "$SourceChromeDir\*" -Destination $destChrome -Recurse -Force
    Write-Host "[+] Styles CSS deployes dans $destChrome" -ForegroundColor Green

    # B. Configuration de user.js
    $uJs = Join-Path $targetDir "user.js"
    $existing = ""
    if (Test-Path $uJs) {
        $existing = Get-Content $uJs -Raw
    }
    $toAdd = @()
    foreach ($pref in $PrefsToAdd) {
        if ($existing -notmatch [regex]::Escape($pref)) {
            $toAdd += $pref
        }
    }
    if ($toAdd.Count -gt 0) {
        Add-Content -Path $uJs -Value ($toAdd -join [Environment]::NewLine) -Encoding UTF8
        Write-Host "[+] Preferences user.js mises a jour dans $targetDir" -ForegroundColor Green
    }
}

# 6. Nettoyage d'anciens fichiers autoconfig residuels
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

# 7. Recompilation automatique et deploiement de l'extension WebExtension .xpi
$BuildScript = Join-Path $PSScriptRoot "build.ps1"
if (Test-Path $BuildScript) {
    try {
        & $BuildScript | Out-Null
        Write-Host "[+] Package WebExtension dist/material-thunderbird.xpi synchronise." -ForegroundColor Green
        
        $DistXpi = Join-Path $ProjectRoot "dist\material-thunderbird.xpi"
        if (Test-Path $DistXpi) {
            foreach ($targetDir in $AllProfiles) {
                $extDir = Join-Path $targetDir "extensions"
                if (-not (Test-Path $extDir)) {
                    New-Item -ItemType Directory -Path $extDir | Out-Null
                }
                $targetXpi = Join-Path $extDir "material-you-thunderbird@vforiel.xpi"
                Copy-Item -Path $DistXpi -Destination $targetXpi -Force
                Write-Host "[+] Extension WebExtension synchronisee dans :" -ForegroundColor Green
                Write-Host "    $targetXpi" -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host "[!] Note : Deploiement de l'extension (.xpi) reporte : $_" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Material-Thunderbird installe avec succes !             " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Pour admirer le resultat :" -ForegroundColor Cyan
Write-Host "  1. Fermez et relancez Mozilla Thunderbird." -ForegroundColor White
Write-Host "  2. Profitez de votre interface Material You !" -ForegroundColor White
