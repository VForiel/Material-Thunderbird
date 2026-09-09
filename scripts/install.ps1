<#
.SYNOPSIS
    Installation de Material-Thunderbird (Material You M3).
.DESCRIPTION
    Detecte le profil Thunderbird par defaut, sauvegarde toute personnalisation chrome/
    existante, deploie les feuilles de style, active les preferences necessaires puis
    compile et deploie extension .xpi.

    Chaque fichier deploye est consigne dans un manifeste lu par uninstall.ps1, afin que
    la desinstallation ne retire que ce que installation a ajoute.
.PARAMETER AllProfiles
    Deploie dans tous les profils Thunderbird au lieu du seul profil par defaut.
.PARAMETER Profile
    Restreint le deploiement a ce chemin de profil.
.PARAMETER DryRun
    Affiche les actions sans modifier le systeme.
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [switch]$AllProfiles,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   Installation de Material-Thunderbird (Material You M3)   " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$ProjectRoot = (Get-Item (Join-Path $PSScriptRoot "..")).FullName
$SourceChromeDir = Join-Path $ProjectRoot "chrome"
if (-not (Test-Path $SourceChromeDir)) {
    throw "Dossier source chrome/ introuvable dans $SourceChromeDir."
}

$Profiles = if ($Profile) { @($Profile) } else { Get-ThunderbirdProfiles -AllProfiles:$AllProfiles }
if ($Profiles.Count -eq 0) {
    throw "Impossible identifier un profil Thunderbird. Lancez Thunderbird une premiere fois."
}

Write-Host "[*] Profils cibles :" -ForegroundColor Cyan
foreach ($p in $Profiles) { Write-Host "    - $p" -ForegroundColor Yellow }
if (-not $AllProfiles) {
    Write-Host "    (utilisez -AllProfiles pour deployer dans tous les profils)" -ForegroundColor DarkGray
}

if (Get-Process -Name "thunderbird" -ErrorAction SilentlyContinue) {
    Write-Host "[!] Thunderbird est ouvert : relancez-le apres installation." -ForegroundColor Magenta
}

$PrefLines = @(
    'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
    'user_pref("svg.context-properties.content.enabled", true);',
    'user_pref("extensions.experiments.enabled", true);'
)

$SourceFiles = @(Get-ChildItem -Path $SourceChromeDir -Recurse -File)
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ($DryRun) {
    Write-Host ""
    Write-Host "[DRY-RUN] Aucune modification ne sera ecrite." -ForegroundColor Cyan
    foreach ($targetDir in $Profiles) {
        Write-Host "[DRY-RUN] Profil : $targetDir" -ForegroundColor Cyan
        Write-Host "          - $($SourceFiles.Count) fichier(s) CSS copie(s) vers chrome" -ForegroundColor DarkGray
        $destChrome = Join-Path $targetDir "chrome"
        $clashes = @()
        foreach ($f in $SourceFiles) {
            $rel = $f.FullName.Substring($SourceChromeDir.Length + 1)
            if (Test-Path (Join-Path $destChrome $rel)) { $clashes += $rel }
        }
        if ($clashes.Count -gt 0) {
            Write-Host "          - $($clashes.Count) fichier(s) existant(s) sauvegarde(s) avant remplacement :" -ForegroundColor DarkGray
            foreach ($c in $clashes) { Write-Host "              $c" -ForegroundColor DarkGray }
        }
        Write-Host "          - preferences ajoutees a user.js : $($PrefLines.Count)" -ForegroundColor DarkGray
        Write-Host "          - extension deployee dans extensions" -ForegroundColor DarkGray
    }
    Write-Host "[DRY-RUN] Termine." -ForegroundColor Green
    return
}

# 1. Compilation du package .xpi, une seule fois avant deploiement.
$XpiPath = $null
$BuildScript = Join-Path $PSScriptRoot "build.ps1"
if (Test-Path $BuildScript) {
    try {
        & $BuildScript | Out-Null
        $candidate = Join-Path $ProjectRoot "dist\material-thunderbird.xpi"
        if (Test-Path $candidate) {
            $XpiPath = $candidate
            Write-Host "[+] Package .xpi compile." -ForegroundColor Green
        }
    } catch {
        Write-Host "[!] Compilation du .xpi echouee, deploiement CSS seul : $_" -ForegroundColor Yellow
    }
}

# 2. Deploiement par profil.
foreach ($targetDir in $Profiles) {
    Write-Host ""
    Write-Host "[*] Profil : $targetDir" -ForegroundColor Cyan

    $destChrome = Join-Path $targetDir "chrome"
    if (-not (Test-Path $destChrome)) {
        New-Item -ItemType Directory -Path $destChrome -Force | Out-Null
    }

    # 2a. Sauvegarde de toute personnalisation chrome/ preexistante avant ecrasement.
    $backupDir = $null
    $deployed = New-Object System.Collections.Generic.List[string]
    $backedUp = New-Object System.Collections.Generic.List[string]

    foreach ($file in $SourceFiles) {
        $rel = $file.FullName.Substring($SourceChromeDir.Length + 1)
        $dest = Join-Path $destChrome $rel

        if (Test-Path $dest) {
            if (-not $backupDir) {
                $backupDir = Join-Path $targetDir "chrome-backup-$Stamp"
                New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
            }
            $backupTarget = Join-Path $backupDir $rel
            $backupParent = Split-Path $backupTarget -Parent
            if (-not (Test-Path $backupParent)) { New-Item -ItemType Directory -Path $backupParent -Force | Out-Null }
            Copy-Item -Path $dest -Destination $backupTarget -Force
            $backedUp.Add($rel)
        }

        $destParent = Split-Path $dest -Parent
        if (-not (Test-Path $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
        Copy-Item -Path $file.FullName -Destination $dest -Force
        $deployed.Add(($rel -replace "\\", "/"))
    }

    if ($backedUp.Count -gt 0) {
        Write-Host "[+] $($backedUp.Count) fichier(s) existant(s) sauvegarde(s) dans :" -ForegroundColor Yellow
        Write-Host "    $backupDir" -ForegroundColor Yellow
    }
    Write-Host "[+] $($deployed.Count) fichier(s) CSS deploye(s)." -ForegroundColor Green

    # 2b. Preferences.
    $uJs = Join-Path $targetDir "user.js"
    $added = Add-UserPrefs -UserJsPath $uJs -PrefLines $PrefLines
    if ($added -gt 0) {
        Write-Host "[+] $added preference(s) ajoutee(s) a user.js" -ForegroundColor Green
    } else {
        Write-Host "[i] Preferences deja presentes dans user.js" -ForegroundColor DarkGray
    }

    # Repare les profils ou une version precedente avait desactive la verification des
    # signatures de modules : cela affaiblit la securite et ne sert pas au theme.
    $repaired = Remove-UserPrefs -UserJsPath $uJs -PrefNames $script:LegacyPrefsToRepair
    if ($repaired -gt 0) {
        Write-Host "[+] Verification des signatures de modules retablie." -ForegroundColor Green
    }

    # 2c. Extension.
    $xpiDeployed = $null
    if ($XpiPath) {
        $extDir = Join-Path $targetDir "extensions"
        if (-not (Test-Path $extDir)) { New-Item -ItemType Directory -Path $extDir -Force | Out-Null }
        $targetXpi = Join-Path $extDir "$($script:AddonId).xpi"
        Copy-Item -Path $XpiPath -Destination $targetXpi -Force
        $xpiDeployed = "extensions/$($script:AddonId).xpi"
        Write-Host "[+] Extension deployee : $targetXpi" -ForegroundColor Green
    }

    # 2d. Manifeste de deploiement, lu par uninstall.ps1.
    $manifest = [ordered]@{
        version     = "1.0.0"
        installedAt = (Get-Date -Format "o")
        files       = @($deployed)
        backupDir   = $(if ($backupDir) { Split-Path $backupDir -Leaf } else { $null })
        backedUp    = @($backedUp | ForEach-Object { $_ -replace "\\", "/" })
        prefs       = @($script:ManagedPrefs)
        xpi         = $xpiDeployed
    }
    Write-TextFileNoBom -Path (Get-ManifestPath $targetDir) -Text ($manifest | ConvertTo-Json -Depth 4)
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "   Material-Thunderbird installe !                          " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Fermez et relancez Mozilla Thunderbird pour appliquer le theme." -ForegroundColor Cyan
if ($XpiPath) {
    Write-Host "Si extension apparait desactivee, activez-la dans le gestionnaire de" -ForegroundColor DarkGray
    Write-Host "modules (Ctrl+Maj+A)." -ForegroundColor DarkGray
}
