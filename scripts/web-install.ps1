<#
.SYNOPSIS
    Installateur en ligne de Material-Thunderbird (Material You M3).
.DESCRIPTION
    Télécharge la dernière version de Material-Thunderbird depuis GitHub,
    extrait les fichiers et exécute automatiquement scripts/install.ps1.
    Idéal pour une installation rapide sans avoir besoin de cloner le dépôt.
.PARAMETER AllProfiles
    Déploie dans tous les profils Thunderbird au lieu du seul profil par défaut.
.PARAMETER Profile
    Restreint le déploiement à ce chemin de profil.
.PARAMETER DryRun
    Affiche les actions sans modifier le système.
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [switch]$AllProfiles,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   Installation Web de Material-Thunderbird (Material You)  " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$ZipUrl = "https://github.com/VForiel/Material-Thunderbird/archive/refs/heads/main.zip"
$UniqueId = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "Material-Thunderbird-Install-$UniqueId"
$ZipFile = Join-Path ([System.IO.Path]::GetTempPath()) "Material-Thunderbird-$UniqueId.zip"

try {
    Write-Host "[*] Téléchargement du pack Material-Thunderbird..." -ForegroundColor Cyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipFile -UseBasicParsing

    Write-Host "[*] Extraction des fichiers..." -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipFile, $TempDir)

    $ExtractedRoot = Join-Path $TempDir "Material-Thunderbird-main"
    if (-not (Test-Path $ExtractedRoot)) {
        $found = Get-ChildItem -Path $TempDir -Directory | Select-Object -First 1
        if ($found) { $ExtractedRoot = $found.FullName }
    }

    $InstallerScript = Join-Path $ExtractedRoot "scripts\install.ps1"
    if (-not (Test-Path $InstallerScript)) {
        throw "Script d'installation introuvable dans l'archive téléchargée ($InstallerScript)."
    }

    Write-Host "[*] Lancement du script d'installation..." -ForegroundColor Cyan
    Write-Host ""

    $params = @{}
    if ($Profile) { $params["Profile"] = $Profile }
    if ($AllProfiles) { $params["AllProfiles"] = $true }
    if ($DryRun) { $params["DryRun"] = $true }

    & $InstallerScript @params
}
catch {
    Write-Host ""
    Write-Host "[!] Une erreur est survenue lors de l'installation : $_" -ForegroundColor Red
    Write-Host "    Pour obtenir de l'aide : https://github.com/VForiel/Material-Thunderbird" -ForegroundColor DarkGray
    exit 1
}
finally {
    if (Test-Path $ZipFile) { Remove-Item -LiteralPath $ZipFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $TempDir) { Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
