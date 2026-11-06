<#
.SYNOPSIS
    Installe (ou retire) l extension Material-Thunderbird par politique d entreprise.
.DESCRIPTION
    Thunderbird desactive les modules simplement copies dans le dossier extensions/
    du profil (extensions.autoDisableScopes) : il faut les activer a la main. Une
    politique ExtensionSettings en force_installed les installe et les active d office.

    Le .xpi est copie dans <Thunderbird>\distribution\, a cote de policies.json. Ce
    dossier n est modifiable qu en administrateur : un programme lance par l utilisateur
    ne peut pas remplacer l extension par une autre. policies.json pointe dessus par une
    URL file:///, que Thunderbird relit a chaque demarrage (une mise a jour du .xpi est
    donc prise en compte au lancement suivant).

    La verification des signatures n est pas touchee. Les cles que des versions
    precedentes de ce script ajoutaient a tort (xpinstall.signatures.required, serveur
    http://127.0.0.1) sont nettoyees au passage.

    Le script se relance en administrateur si le dossier n est pas modifiable.
.PARAMETER XpiPath
    Paquet a installer. Par defaut dist\material-thunderbird.xpi (compile si absent).
.PARAMETER Uninstall
    Retire l entree de l extension de policies.json et la copie du .xpi.
.PARAMETER ThunderbirdDir
    Dossier d installation de Thunderbird, s il n est pas a l emplacement habituel.
#>
[CmdletBinding()]
param(
    [string]$XpiPath,
    [switch]$Uninstall,
    [string]$ThunderbirdDir
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$ProjectRoot = (Get-Item (Join-Path $PSScriptRoot "..")).FullName

if (-not $ThunderbirdDir) { $ThunderbirdDir = Get-ThunderbirdInstallDir }
if (-not $ThunderbirdDir -or -not (Test-Path $ThunderbirdDir)) {
    Write-Warning "Dossier d installation de Thunderbird introuvable."
    exit 1
}

$distDir      = Join-Path $ThunderbirdDir "distribution"
$targetPolicy = Join-Path $distDir "policies.json"
$targetXpi    = Join-Path $distDir "material-thunderbird.xpi"

# Rien a retirer : inutile de demander les droits administrateur.
if ($Uninstall -and -not (Test-PolicyMentionsAddon $targetPolicy) -and -not (Test-Path $targetXpi)) {
    exit 0
}

if (-not $Uninstall) {
    if (-not $XpiPath) { $XpiPath = Join-Path $ProjectRoot "dist\material-thunderbird.xpi" }
    if (-not (Test-Path $XpiPath)) {
        $buildScript = Join-Path $PSScriptRoot "build.ps1"
        if (Test-Path $buildScript) { & $buildScript | Out-Null }
    }
    if (-not (Test-Path $XpiPath)) {
        Write-Warning "Paquet .xpi introuvable : $XpiPath"
        exit 1
    }
    $XpiPath = (Get-Item $XpiPath).FullName
}

# --- Elevation ---
# Seule cette etape demande les droits administrateur, et seulement si le dossier
# n est pas modifiable. Relancer tout l installateur en administrateur ferait
# cibler le profil du compte administrateur, pas celui de l utilisateur.
if (-not (Test-DirectoryWritable $(if (Test-Path $distDir) { $distDir } else { $ThunderbirdDir }))) {
    if (Test-IsAdmin) {
        Write-Warning "Ecriture impossible dans $distDir, meme en administrateur."
        exit 1
    }
    Write-Host "[*] Droits administrateur demandes pour ecrire dans $distDir" -ForegroundColor Cyan
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
                 "-ThunderbirdDir", "`"$ThunderbirdDir`"")
    if ($Uninstall) { $argList += "-Uninstall" } else { $argList += @("-XpiPath", "`"$XpiPath`"") }
    try {
        $proc = Start-Process powershell.exe -ArgumentList $argList -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    } catch {
        Write-Warning "Droits administrateur refuses."
        exit 2
    }
    exit $proc.ExitCode
}

# --- Lecture de policies.json ---
$policy = $null
if (Test-Path $targetPolicy) {
    try {
        $policy = (Read-TextFile $targetPolicy) | ConvertFrom-Json
    } catch {
        # Ne jamais ecraser une politique illisible : elle peut contenir d autres reglages.
        Write-Warning "policies.json illisible, laisse intact : $targetPolicy"
        exit 1
    }
}
if (-not $policy) { $policy = [pscustomobject]@{} }
if (-not $policy.policies) {
    $policy | Add-Member -MemberType NoteProperty -Name "policies" -Value ([pscustomobject]@{}) -Force
}
$p = $policy.policies

# Nettoyage de ce que des versions precedentes ajoutaient (dans les deux modes).
if ($p.Preferences) {
    foreach ($name in $script:LegacyPolicyPrefs) {
        if ($p.Preferences.PSObject.Properties[$name]) { $p.Preferences.PSObject.Properties.Remove($name) }
    }
    if (@($p.Preferences.PSObject.Properties).Count -eq 0) { $p.PSObject.Properties.Remove("Preferences") }
}
if ($p.Extensions -and $p.Extensions.Install) {
    $others = @($p.Extensions.Install | Where-Object { $_ -notmatch "material-thunderbird\.xpi" })
    if ($others.Count -gt 0) { $p.Extensions.Install = $others }
    else { $p.Extensions.PSObject.Properties.Remove("Install") }
    if (@($p.Extensions.PSObject.Properties).Count -eq 0) { $p.PSObject.Properties.Remove("Extensions") }
}

if ($Uninstall) {
    if ($p.ExtensionSettings -and $p.ExtensionSettings.PSObject.Properties[$script:AddonId]) {
        $p.ExtensionSettings.PSObject.Properties.Remove($script:AddonId)
        if (@($p.ExtensionSettings.PSObject.Properties).Count -eq 0) { $p.PSObject.Properties.Remove("ExtensionSettings") }
    }
    if (Test-Path $targetXpi) { Remove-Item $targetXpi -Force }
}
else {
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force | Out-Null }
    Copy-Item -Path $XpiPath -Destination $targetXpi -Force

    if (-not $p.ExtensionSettings) {
        $p | Add-Member -MemberType NoteProperty -Name "ExtensionSettings" -Value ([pscustomobject]@{}) -Force
    }
    $entry = [pscustomobject]@{
        installation_mode = "force_installed"
        install_url       = ([System.Uri]$targetXpi).AbsoluteUri
    }
    $p.ExtensionSettings | Add-Member -MemberType NoteProperty -Name $script:AddonId -Value $entry -Force
}

# --- Ecriture ---
if (@($p.PSObject.Properties).Count -eq 0) {
    if (Test-Path $targetPolicy) { Remove-Item $targetPolicy -Force }
    Write-Host "[+] policies.json supprime (il ne contenait plus rien)." -ForegroundColor Green
} else {
    Write-TextFileNoBom -Path $targetPolicy -Text ($policy | ConvertTo-Json -Depth 10)
    Write-Host "[+] policies.json mis a jour : $targetPolicy" -ForegroundColor Green
}
exit 0
