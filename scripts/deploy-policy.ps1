# Deploy Enterprise Policy for Material-Thunderbird
param()

$tbDir = "C:\Program Files\Mozilla Thunderbird"
if (-not (Test-Path $tbDir)) {
    $tbDir = "C:\Program Files (x86)\Mozilla Thunderbird"
}

if (-not (Test-Path $tbDir)) {
    Write-Warning "Dossier d'installation de Thunderbird introuvable."
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    # Relance en tant qu'administrateur
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs -Wait
    exit 0
}

$distDir = Join-Path $tbDir "distribution"
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$xpiPath = (Join-Path (Get-Item (Join-Path $PSScriptRoot "..")).FullName "dist\material-thunderbird.xpi").Replace("\", "/")
$policyJson = @"
{
  "policies": {
    "Preferences": {
      "xpinstall.signatures.required": false,
      "extensions.experiments.enabled": true
    },
    "ExtensionSettings": {
      "material-you-thunderbird@vforiel": {
        "installation_mode": "force_installed",
        "install_url": "file:///$xpiPath"
      }
    }
  }
}
"@

$targetPolicy = Join-Path $distDir "policies.json"
[System.IO.File]::WriteAllText($targetPolicy, $policyJson, [System.Text.Encoding]::UTF8)
Write-Host "[+] Politique d'entreprise Mozilla Thunderbird activee avec succes !" -ForegroundColor Green
Write-Host "    Fichier : $targetPolicy" -ForegroundColor DarkGray
