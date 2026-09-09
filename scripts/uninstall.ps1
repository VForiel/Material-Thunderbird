<#
.SYNOPSIS
    Desinstallation de Material-Thunderbird.
.DESCRIPTION
    Retire uniquement ce que install.ps1 a deploye, en se basant sur le manifeste ecrit
    dans <profil>/chrome/. Les personnalisations preexistantes sauvegardees lors de
    installation sont restaurees. Toutes les preferences posees par installation sont
    retirees, y compris xpinstall.signatures.required qu une version precedente
    desactivait a tort.

    Le balayage porte sur tous les profils, car une version precedente de installateur
    deployait dans chacun. Sans cela, les profils secondaires conserveraient les fichiers.
.PARAMETER Profile
    Restreint la desinstallation a ce chemin de profil.
.PARAMETER DryRun
    Affiche les actions sans modifier le systeme.
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "   Desinstallation de Material-Thunderbird                   " -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow

# Les anciennes versions deployaient dans tous les profils : on les balaie tous.
$Profiles = if ($Profile) { @($Profile) } else { Get-ThunderbirdProfiles -AllProfiles }
if ($Profiles.Count -eq 0) {
    throw "Impossible identifier un profil Thunderbird."
}

# Fichiers deployes par les versions anterieures au manifeste.
$LegacyFiles = @(
    "userChrome.css",
    "userContent.css",
    "tokens/shapes.css",
    "tokens/colors-light.css",
    "tokens/colors-dark.css",
    "components/spaces-toolbar.css",
    "components/unified-toolbar.css",
    "components/folder-pane.css",
    "components/thread-tree.css",
    "components/message-header.css",
    "components/tabs-and-dialogs.css",
    "components/calendar.css",
    "components/addressbook.css",
    "components/avatars.css",
    "components/multimessage.css",
    "components/compose.css"
)

if ($DryRun) {
    Write-Host "[DRY-RUN] Aucune modification ne sera ecrite." -ForegroundColor Cyan
}

$touched = 0

foreach ($profileDir in $Profiles) {
    $destChrome = Join-Path $profileDir "chrome"
    $manifest = Read-InstallManifest $profileDir

    $files = if ($manifest -and $manifest.files) { @($manifest.files) } else { $LegacyFiles }

    # Un fichier n est supprime que s il porte encore en-tete du projet. Sans ce
    # controle, une seconde desinstallation effacerait le userChrome.css personnel
    # restaure par la premiere, puisque le nom de fichier est identique au notre.
    $present = @($files | Where-Object {
        $p = Join-Path $destChrome ($_ -replace "/", "\")
        (Test-Path $p) -and ((Get-Content -LiteralPath $p -TotalCount 8 -ErrorAction SilentlyContinue) -join "`n") -match "Material-Thunderbird"
    })

    $uJs = Join-Path $profileDir "user.js"
    $prefNames = @($script:ManagedPrefs) + @($script:LegacyPrefsToRepair)
    $hasPrefs = $false
    if (Test-Path $uJs) {
        $userJsText = Read-TextFile $uJs
        foreach ($n in $prefNames) {
            if ($userJsText -match ('user_pref\(\s*"' + [regex]::Escape($n) + '"')) { $hasPrefs = $true; break }
        }
    }

    $xpiRel = if ($manifest -and $manifest.xpi) { $manifest.xpi } else { "extensions/$($script:AddonId).xpi" }
    $xpiPath = Join-Path $profileDir ($xpiRel -replace "/", "\")
    $hasXpi = Test-Path $xpiPath

    if ($present.Count -eq 0 -and -not $hasPrefs -and -not $hasXpi) { continue }

    $touched++
    Write-Host ""
    Write-Host "[*] Profil : $profileDir" -ForegroundColor Cyan

    if ($DryRun) {
        if ($present.Count -gt 0) { Write-Host "    - $($present.Count) fichier(s) CSS supprime(s)" -ForegroundColor DarkGray }
        if ($manifest -and $manifest.backupDir) { Write-Host "    - sauvegarde restauree : $($manifest.backupDir)" -ForegroundColor DarkGray }
        if ($hasPrefs) { Write-Host "    - preferences retirees de user.js" -ForegroundColor DarkGray }
        if ($hasXpi)   { Write-Host "    - extension supprimee : $xpiRel" -ForegroundColor DarkGray }
        continue
    }

    # 1. Suppression des seuls fichiers deployes. Le dossier chrome/ n est jamais
    #    supprime en bloc : il peut contenir des personnalisations de utilisateur.
    foreach ($rel in $present) {
        Remove-Item -Path (Join-Path $destChrome ($rel -replace "/", "\")) -Force -ErrorAction SilentlyContinue
    }
    if ($present.Count -gt 0) {
        Write-Host "[+] $($present.Count) fichier(s) CSS supprime(s)." -ForegroundColor Green
    }

    $manifestPath = Get-ManifestPath $profileDir
    if (Test-Path $manifestPath) { Remove-Item $manifestPath -Force -ErrorAction SilentlyContinue }

    # 2. Restauration des fichiers sauvegardes lors de installation.
    if ($manifest -and $manifest.backupDir) {
        $backupDir = Join-Path $profileDir $manifest.backupDir
        if (Test-Path $backupDir) {
            $restored = 0
            foreach ($f in @(Get-ChildItem -Path $backupDir -Recurse -File)) {
                $rel = $f.FullName.Substring($backupDir.Length + 1)
                $dest = Join-Path $destChrome $rel
                $parent = Split-Path $dest -Parent
                if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
                Copy-Item -Path $f.FullName -Destination $dest -Force
                $restored++
            }
            if ($restored -gt 0) {
                Write-Host "[+] $restored fichier(s) personnel(s) restaure(s) depuis la sauvegarde." -ForegroundColor Green
            }
            Remove-Item -Path $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # 3. Suppression des sous-dossiers devenus vides, puis de chrome/ si vide.
    foreach ($sub in @("tokens", "components")) {
        $subPath = Join-Path $destChrome $sub
        if ((Test-Path $subPath) -and -not @(Get-ChildItem $subPath -Force -ErrorAction SilentlyContinue)) {
            Remove-Item $subPath -Force -ErrorAction SilentlyContinue
        }
    }
    if ((Test-Path $destChrome) -and -not @(Get-ChildItem $destChrome -Force -ErrorAction SilentlyContinue)) {
        Remove-Item $destChrome -Force -ErrorAction SilentlyContinue
        Write-Host "[+] Dossier chrome/ vide supprime." -ForegroundColor Green
    } elseif (Test-Path $destChrome) {
        Write-Host "[i] Dossier chrome/ conserve : il contient encore vos fichiers." -ForegroundColor DarkGray
    }

    # 4. Preferences, y compris celle qui affaiblissait la verification des signatures.
    $removed = Remove-UserPrefs -UserJsPath $uJs -PrefNames $prefNames -RemoveMarker
    if ($removed -gt 0) {
        Write-Host "[+] $removed ligne(s) retiree(s) de user.js." -ForegroundColor Green
    }

    # 5. Extension.
    if ($hasXpi) {
        Remove-Item -Path $xpiPath -Force -ErrorAction SilentlyContinue
        Write-Host "[+] Extension supprimee : $xpiPath" -ForegroundColor Green
    }
}

Write-Host ""
if ($touched -eq 0) {
    Write-Host "[i] Aucune trace de Material-Thunderbird trouvee." -ForegroundColor DarkGray
} else {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "   Desinstallation terminee ($touched profil(s)).           " -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "Redemarrez Mozilla Thunderbird pour retrouver interface par defaut." -ForegroundColor Cyan
}
