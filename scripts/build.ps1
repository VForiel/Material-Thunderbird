<#
.SYNOPSIS
    Genere les feuilles de style de l extension puis empaquette le .xpi.
.DESCRIPTION
    Outil de developpement : l utilisateur n a besoin que du .xpi, qu il installe
    d un double-clic et desinstalle depuis Thunderbird.

    chrome/ est la seule source du theme. Ce script en tire :
    - extension/material-theme.css : les sources de $Sources, dans l ordre des
      @import de chrome/userChrome.css, enveloppees dans @-moz-document. L
      experiment enregistre cette feuille pour toute l application ; la
      condition la restreint aux documents de l interface, jamais au contenu des
      courriels ni aux pages web. La liste doit rester celle de CHROME_DOCUMENTS
      dans extension/experiments/material-assistant.js.
    - extension/message-content.css : chrome/userContent.css, applique au corps
      des courriels par le script d affichage des messages.

    Le manifeste ne declare pas de cle "theme" : avec elle, Thunderbird traite le
    paquet comme un theme statique, refuse son script d arriere-plan et son
    experiment, puis annonce un fichier corrompu.

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
$MessageCss = Join-Path $ExtensionDir "message-content.css"

# Meme ordre que les @import de chrome/userChrome.css : les jetons d abord,
# puis les composants, extras.css en dernier.
$Sources = @(
    "tokens/shapes.css",
    "tokens/colors-light.css",
    "tokens/colors-dark.css",
    "tokens/bridge.css",
    "components/global.css",
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
    "components/search.css",
    "components/chat.css",
    "components/extras.css"
)

$DocumentScope = 'url-prefix("chrome://"), url-prefix("about:3pane"), url-prefix("about:message"), url-prefix("about:addressbook"), url-prefix("about:preferences"), url-prefix("about:addons"), url-prefix("about:accountsettings")'

$Header = @"
/**
 * Material-Thunderbird - Material Design 3 (Material You)
 *
 * FICHIER GENERE - NE PAS MODIFIER A LA MAIN.
 * Produit par scripts/build.ps1 a partir de chrome/. Toute modification
 * doit etre faite dans chrome/, puis le script relance ; sinon elle sera
 * ecrasee au prochain build.
 */

"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Host "[*] Generation de extension/material-theme.css..." -ForegroundColor Cyan

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append($Header)
[void]$sb.AppendLine("@-moz-document $DocumentScope {")
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
[void]$sb.AppendLine("}")

[System.IO.File]::WriteAllText($GeneratedCss, $sb.ToString(), $utf8NoBom)
$lineCount = ([System.IO.File]::ReadAllLines($GeneratedCss)).Length
Write-Host "    $($Sources.Count) sources -> $lineCount lignes" -ForegroundColor DarkGray

Write-Host "[*] Generation de extension/message-content.css..." -ForegroundColor Cyan
$messageSource = ([System.IO.File]::ReadAllText((Join-Path $ChromeDir "userContent.css"))).TrimEnd()
[System.IO.File]::WriteAllText($MessageCss, $Header + $messageSource + "`n", $utf8NoBom)

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

# L apercu du site charge les memes jetons de couleur que l extension.
$DocsTokens = Join-Path $ProjectRoot "docs\theme\tokens"
if (-not (Test-Path $DocsTokens)) {
    New-Item -ItemType Directory -Path $DocsTokens | Out-Null
}
Copy-Item (Join-Path $ChromeDir "tokens\*.css") $DocsTokens -Force
Write-Host "[+] Jetons copies dans docs/theme/tokens/ pour l apercu du site" -ForegroundColor Green

$DocsDist = Join-Path $ProjectRoot "docs\dist"
if (-not (Test-Path $DocsDist)) {
    New-Item -ItemType Directory -Path $DocsDist | Out-Null
}
Copy-Item $OutputFile (Join-Path $DocsDist "material-thunderbird.xpi") -Force
Write-Host "[+] Synchronise dans docs/dist/material-thunderbird.xpi" -ForegroundColor Green
