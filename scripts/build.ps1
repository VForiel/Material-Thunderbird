# Script de packaging de l'extension Material-Thunderbird (.xpi)
# Garantit des chemins avec slashes '/' conformes aux specifications XPI / Gecko
$ErrorActionPreference = "Stop"

$ProjectRoot = (Get-Item "$PSScriptRoot\..").FullName
$ExtensionDir = Join-Path $ProjectRoot "extension"
$DistDir = Join-Path $ProjectRoot "dist"
$OutputFile = Join-Path $DistDir "material-thunderbird.xpi"

Write-Host "[*] Packaging Material-Thunderbird Extension (.xpi)..." -ForegroundColor Cyan

if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

if (Test-Path $OutputFile) {
    Remove-Item $OutputFile -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipArchive = [System.IO.Compression.ZipFile]::Open($OutputFile, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    $files = Get-ChildItem -Path $ExtensionDir -Recurse -File
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($ExtensionDir.Length + 1).Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArchive, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $zipArchive.Dispose()
}

Write-Host "[+] Extension (.xpi) creee avec succes :" -ForegroundColor Green
Write-Host "    $OutputFile" -ForegroundColor Yellow
