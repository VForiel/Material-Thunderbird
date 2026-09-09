<#
.SYNOPSIS
    Genere extension/material-theme.css puis empaquette extension (.xpi).
.DESCRIPTION
    material-theme.css est un fichier GENERE : il concatene les memes sources que
    chrome/userChrome.css. Auparavant, la feuille de extension et celle du profil
    etaient deux copies manuelles du theme, qui avaient diverge sur pres de la
    moitie de leurs regles. Il n existe plus qu une source : chrome/.

    Les chemins internes du .xpi utilisent des barres obliques, conformement a la
    specification.
#>
$ErrorActionPreference = "Stop"

$ProjectRoot = (Get-Item (Join-Path $PSScriptRoot "..")).FullName
$ChromeDir = Join-Path $ProjectRoot "chrome"
$ExtensionDir = Join-Path $ProjectRoot "extension"
$DistDir = Join-Path $ProjectRoot "dist"
$OutputFile = Join-Path $DistDir "material-thunderbird.xpi"
$GeneratedCss = Join-Path $ExtensionDir "material-theme.css"

# Meme ordre que les @import de chrome/userChrome.css : les jetons d abord,
# puis les composants, extras.css en dernier.
$Sources = @(
    "tokens/shapes.css",
    "tokens/colors-light.css",
    "tokens/colors-dark.css",
    "tokens/bridge.css",
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
    "components/compose.css",
    "components/extras.css"
)

Write-Host "[*] Generation de extension/material-theme.css..." -ForegroundColor Cyan

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/**")
[void]$sb.AppendLine(" * Material-Thunderbird - Material Design 3 (Material You)")
[void]$sb.AppendLine(" *")
[void]$sb.AppendLine(" * FICHIER GENERE - NE PAS MODIFIER A LA MAIN.")
[void]$sb.AppendLine(" * Produit par scripts/build.ps1 a partir de chrome/. Toute modification")
[void]$sb.AppendLine(" * doit etre faite dans chrome/tokens/ ou chrome/components/, puis le")
[void]$sb.AppendLine(" * script relance ; sinon elle sera ecrasee au prochain build.")
[void]$sb.AppendLine(" */")
[void]$sb.AppendLine()

$missing = @()
foreach ($rel in $Sources) {
    $path = Join-Path $ChromeDir ($rel -replace "/", "\")
    if (-not (Test-Path $path)) { $missing += $rel; continue }
    [void]$sb.AppendLine("/* ===== $rel ===== */")
    [void]$sb.AppendLine(([System.IO.File]::ReadAllText($path)).TrimEnd())
    [void]$sb.AppendLine()
}
if ($missing.Count -gt 0) {
    throw "Sources CSS introuvables : $($missing -join ', ')"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($GeneratedCss, $sb.ToString(), $utf8NoBom)
$lineCount = ([System.IO.File]::ReadAllLines($GeneratedCss)).Length
Write-Host "    $($Sources.Count) sources -> $lineCount lignes" -ForegroundColor DarkGray

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
    foreach ($file in (Get-ChildItem -Path $ExtensionDir -Recurse -File)) {
        $relativePath = $file.FullName.Substring($ExtensionDir.Length + 1).Replace("\", "/")
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zipArchive, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    }
}
finally {
    $zipArchive.Dispose()
}

Write-Host "[+] Extension (.xpi) creee avec succes :" -ForegroundColor Green
Write-Host "    $OutputFile" -ForegroundColor Yellow
