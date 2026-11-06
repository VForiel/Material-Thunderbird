<#
.SYNOPSIS
    Fonctions partagees par install.ps1 et uninstall.ps1.
.DESCRIPTION
    Centralise la resolution des profils Thunderbird, la lecture/ecriture de user.js
    et le manifeste de deploiement. Les deux scripts doivent cibler exactement les
    memes profils et les memes fichiers, sinon la desinstallation laisse des residus.
#>

# Nom du manifeste ecrit dans <profil>/chrome/ par installateur.
$script:ManifestName = "material-thunderbird-install.json"

# Preferences posees par installateur. La desinstallation retire exactement cette liste.
$script:ManagedPrefs = @(
    "toolkit.legacyUserProfileCustomizations.stylesheets",
    "svg.context-properties.content.enabled",
    "extensions.experiments.enabled"
)

# Preference que des versions precedentes de installateur desactivaient a tort.
# Elle n est plus jamais posee ; elle est seulement nettoyee pour reparer ces profils.
# Le theme n en a pas besoin : ce qui empechait l extension de s activer etait
# extensions.autoDisableScopes, contourne proprement par deploy-policy.ps1.
$script:LegacyPrefsToRepair = @(
    "xpinstall.signatures.required"
)

# Preferences que des versions precedentes de deploy-policy.ps1 ajoutaient dans
# policies.json. Retirees a chaque passage du script.
$script:LegacyPolicyPrefs = @(
    "xpinstall.signatures.required",
    "extensions.experiments.enabled"
)

$script:AddonId = "material-you-thunderbird@vforiel"

function Get-ThunderbirdInstallDir {
    # Emplacement declare par l installateur de Mozilla, puis emplacements par defaut.
    foreach ($root in @("HKLM:\SOFTWARE\Mozilla\Mozilla Thunderbird", "HKLM:\SOFTWARE\WOW6432Node\Mozilla\Mozilla Thunderbird")) {
        try {
            $current = (Get-ItemProperty -Path $root -ErrorAction Stop).CurrentVersion
            if ($current) {
                $dir = (Get-ItemProperty -Path "$root\$current\Main" -ErrorAction Stop)."Install Directory"
                if ($dir -and (Test-Path $dir)) { return $dir }
            }
        } catch {}
    }
    foreach ($dir in @("$env:ProgramFiles\Mozilla Thunderbird", "${env:ProgramFiles(x86)}\Mozilla Thunderbird")) {
        if ($dir -and (Test-Path $dir)) { return $dir }
    }
    return $null
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DirectoryWritable {
    param([string]$Path)
    $probe = Join-Path $Path ".material-thunderbird-write-test"
    try {
        [System.IO.File]::WriteAllText($probe, "")
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

# Vrai si policies.json contient quelque chose que ce projet y a mis (lisible sans droits).
function Test-PolicyMentionsAddon {
    param([string]$PolicyPath)
    if (-not (Test-Path $PolicyPath)) { return $false }
    $text = Read-TextFile $PolicyPath
    return ($text -match [regex]::Escape($script:AddonId)) -or ($text -match "material-thunderbird\.xpi")
}

# Retire des preferences de prefs.js, que Thunderbird reecrit en quittant :
# a ne faire que Thunderbird ferme, sinon la modification est perdue.
function Remove-PrefsJsEntries {
    param([string]$PrefsJsPath, [string[]]$PrefNames)
    if (-not (Test-Path $PrefsJsPath)) { return 0 }
    $lines = [System.IO.File]::ReadAllLines($PrefsJsPath)
    $kept = @($lines | Where-Object {
        $line = $_
        -not ($PrefNames | Where-Object { $line -match ('user_pref\(\s*"' + [regex]::Escape($_) + '"') })
    })
    $removed = $lines.Count - $kept.Count
    if ($removed -gt 0) { Write-TextFileNoBom -Path $PrefsJsPath -Text (($kept -join "`r`n") + "`r`n") }
    return $removed
}

function Get-ThunderbirdDir {
    $appData = [Environment]::GetFolderPath("ApplicationData")
    return (Join-Path $appData "Thunderbird")
}

function Get-ThunderbirdProfiles {
    param([switch]$AllProfiles)

    $tbDir = Get-ThunderbirdDir
    if (-not (Test-Path $tbDir)) {
        throw "Dossier Thunderbird introuvable dans $tbDir. Verifiez que Mozilla Thunderbird est installe."
    }

    $profilesIni = Join-Path $tbDir "profiles.ini"
    $declared = New-Object System.Collections.Generic.List[object]
    $installDefault = $null

    if (Test-Path $profilesIni) {
        $section = ""
        $path = $null
        $isDefault = $false
        $isRelative = $true

        foreach ($raw in (Get-Content $profilesIni)) {
            $line = $raw.Trim()
            if ($line -match "^\[(.+)\]$") {
                if ($section -like "Profile*" -and $path) {
                    $declared.Add([pscustomobject]@{ Path = $path; IsRelative = $isRelative; IsDefault = $isDefault })
                }
                $section = $matches[1]
                $path = $null; $isDefault = $false; $isRelative = $true
            }
            elseif ($line -match "^Path=(.*)$")        { $path = $matches[1].Trim() }
            elseif ($line -match "^IsRelative=(\d)$")  { $isRelative = ($matches[1] -eq "1") }
            elseif ($line -match "^Default=(.*)$") {
                $val = $matches[1].Trim()
                if ($section -like "Install*")  { $installDefault = $val }
                elseif ($val -eq "1")           { $isDefault = $true }
            }
        }
        if ($section -like "Profile*" -and $path) {
            $declared.Add([pscustomobject]@{ Path = $path; IsRelative = $isRelative; IsDefault = $isDefault })
        }
    }

    $result = New-Object System.Collections.Generic.List[string]

    function Resolve-ProfilePath($value, $relative) {
        if ($relative) { return (Join-Path $tbDir ($value -replace "/", "\")) }
        return $value
    }

    if ($AllProfiles) {
        foreach ($p in $declared) {
            $full = Resolve-ProfilePath $p.Path $p.IsRelative
            if (Test-Path $full) { $result.Add($full) }
        }
    }
    else {
        $target = $null
        if ($installDefault) {
            $match = $declared | Where-Object { $_.Path -eq $installDefault } | Select-Object -First 1
            $relative = if ($match) { $match.IsRelative } else { $true }
            $target = Resolve-ProfilePath $installDefault $relative
        }
        if (-not $target) {
            $d = $declared | Where-Object { $_.IsDefault } | Select-Object -First 1
            if ($d) { $target = Resolve-ProfilePath $d.Path $d.IsRelative }
        }
        if ($target -and (Test-Path $target)) { $result.Add($target) }
    }

    # Repli si profiles.ini est absent ou illisible.
    if ($result.Count -eq 0) {
        $profilesDir = Join-Path $tbDir "Profiles"
        if (Test-Path $profilesDir) {
            $dirs = @(Get-ChildItem $profilesDir -Directory -ErrorAction SilentlyContinue)
            if (-not $AllProfiles) {
                $dirs = @($dirs | Where-Object { $_.Name -like "*.default*" } | Select-Object -First 1)
            }
            foreach ($d in $dirs) { if ($d) { $result.Add($d.FullName) } }
        }
    }

    return @($result | Select-Object -Unique)
}

# Gecko ne tolere pas de BOM en tete de user.js : ecriture UTF-8 sans BOM.
function Write-TextFileNoBom {
    param([string]$Path, [string]$Text)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Read-TextFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return "" }
    return [System.IO.File]::ReadAllText($Path)
}

function Add-UserPrefs {
    param([string]$UserJsPath, [string[]]$PrefLines)

    $existing = Read-TextFile $UserJsPath
    $toAdd = @()
    foreach ($line in $PrefLines) {
        $name = $null
        if ($line -match 'user_pref\(\s*"([^"]+)"') { $name = $matches[1] }
        if ($name -and ($existing -match ('user_pref\(\s*"' + [regex]::Escape($name) + '"'))) { continue }
        $toAdd += $line
    }
    if ($toAdd.Count -eq 0) { return 0 }

    $nl = "`r`n"
    $prefix = ""
    # Sans ce saut de ligne, la premiere preference se collerait a la derniere ligne existante.
    if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { $prefix = $nl }
    $block = $prefix + "// Material-Thunderbird" + $nl + ($toAdd -join $nl) + $nl
    Write-TextFileNoBom -Path $UserJsPath -Text ($existing + $block)
    return $toAdd.Count
}

function Remove-UserPrefs {
    param(
        [string]$UserJsPath,
        [string[]]$PrefNames,
        # Retire aussi le commentaire de section. A n utiliser que lors de la
        # desinstallation complete : la reparation ciblee doit le conserver, sinon
        # elle decapite le bloc quelle vient decrire.
        [switch]$RemoveMarker
    )

    if (-not (Test-Path $UserJsPath)) { return 0 }
    $lines = [System.IO.File]::ReadAllLines($UserJsPath)
    $kept = New-Object System.Collections.Generic.List[string]
    $removed = 0

    foreach ($line in $lines) {
        $drop = $false
        if ($RemoveMarker -and $line.Trim() -eq "// Material-Thunderbird") { $drop = $true }
        if (-not $drop) {
            foreach ($name in $PrefNames) {
                if ($line -match ('user_pref\(\s*"' + [regex]::Escape($name) + '"')) { $drop = $true; break }
            }
        }
        if ($drop) { $removed++ } else { $kept.Add($line) }
    }

    if ($removed -eq 0) { return 0 }

    while ($kept.Count -gt 0 -and [string]::IsNullOrWhiteSpace($kept[$kept.Count - 1])) {
        $kept.RemoveAt($kept.Count - 1)
    }
    $text = ""
    if ($kept.Count -gt 0) { $text = ($kept -join "`r`n") + "`r`n" }
    Write-TextFileNoBom -Path $UserJsPath -Text $text
    return $removed
}

function Get-ManifestPath {
    param([string]$ProfileDir)
    return (Join-Path (Join-Path $ProfileDir "chrome") $script:ManifestName)
}

function Read-InstallManifest {
    param([string]$ProfileDir)
    $path = Get-ManifestPath $ProfileDir
    if (-not (Test-Path $path)) { return $null }
    try { return ((Read-TextFile $path) | ConvertFrom-Json) } catch { return $null }
}
