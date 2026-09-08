<#
.SYNOPSIS
    Script d'installation 1-Clic pour le theme Material You sur Mozilla Thunderbird.
.DESCRIPTION
    Detecte automatiquement le profil Thunderbird actif, configure user.js pour activer
    toolkit.legacyUserProfileCustomizations.stylesheets et deploie les feuilles de style chrome/.
.PARAMETER DryRun
    Affiche les actions sans modifier le systeme.
#>
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   Installation de Material-Thunderbird (Material You M3)   " -ForegroundColor Cyan
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
    Write-Host "    Pensez a redemarrer Thunderbird apres l'installation pour appliquer le theme." -ForegroundColor Magenta
}

# 4. Verifier la source du dossier chrome/ dans le depot
$ProjectRoot = (Get-Item "$PSScriptRoot\..").FullName
$SourceChromeDir = Join-Path $ProjectRoot "chrome"

if (-not (Test-Path $SourceChromeDir)) {
    Write-Error "Dossier source chrome/ introuvable dans $SourceChromeDir."
    exit 1
}

$DestChromeDir = Join-Path $ProfileDir "chrome"

if ($DryRun) {
    Write-Host "[DRY-RUN] Copie prevue de : $SourceChromeDir vers $DestChromeDir" -ForegroundColor Cyan
    Write-Host "[DRY-RUN] Activation de toolkit.legacyUserProfileCustomizations.stylesheets dans user.js" -ForegroundColor Cyan
    Write-Host "[DRY-RUN] Test termine avec succes." -ForegroundColor Green
    return
}

# 5. Copie des fichiers chrome/ vers le profil
Write-Host "[*] Deploiement des styles Material You dans le profil..." -ForegroundColor Cyan
if (-not (Test-Path $DestChromeDir)) {
    New-Item -ItemType Directory -Path $DestChromeDir | Out-Null
}

Copy-Item -Path "$SourceChromeDir\*" -Destination $DestChromeDir -Recurse -Force
Write-Host "[+] Fichiers CSS deployes avec succes dans $DestChromeDir" -ForegroundColor Green

# 6. Mise a jour / Creation de user.js pour activer les feuilles de style
$UserJsPath = Join-Path $ProfileDir "user.js"
$PrefsToAdd = @(
    'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
    'user_pref("svg.context-properties.content.enabled", true);'
)

$existingContent = ""
if (Test-Path $UserJsPath) {
    $existingContent = Get-Content $UserJsPath -Raw
}

$linesToAppend = @()
foreach ($pref in $PrefsToAdd) {
    if ($existingContent -notmatch [regex]::Escape($pref)) {
        $linesToAppend += $pref
    }
}

if ($linesToAppend.Count -gt 0) {
    Write-Host "[*] Configuration de user.js pour activer le support CSS personnalise..." -ForegroundColor Cyan
    Add-Content -Path $UserJsPath -Value ($linesToAppend -join [Environment]::NewLine) -Encoding UTF8
    Write-Host "[+] Preferences activees avec succes dans user.js" -ForegroundColor Green
} else {
    Write-Host "[+] Support CSS deja actif dans user.js" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Theme Material You installe avec succes !                " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Pour admirer le resultat :" -ForegroundColor Cyan
Write-Host "  1. Fermez et relancez Mozilla Thunderbird." -ForegroundColor White
Write-Host "  2. Profitez de votre interface modernisee !" -ForegroundColor White
