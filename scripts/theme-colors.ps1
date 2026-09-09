<#
.SYNOPSIS
    Reporte la palette de chrome/tokens/ dans les couleurs de theme de manifest.json.
.DESCRIPTION
    manifest.json declare "theme" et "dark_theme" : les couleurs que Thunderbird
    applique lui-meme aux zones que la feuille de style ne couvre pas. Elles etaient
    ecrites a la main, soit une troisieme copie de la palette a cote de
    chrome/tokens/ et de extension/material-theme.css, et elles avaient deja
    diverge : la barre d outils y valait #F3F4F6 quand le jeton correspondant
    valait #edf2fa, et la surbrillance des listes tirait vers primary-container en
    clair mais vers secondary-container en sombre.

    Chaque cle est donc rattachee a un jeton, et seule la valeur de la ligne est
    reecrite : le reste du fichier n est pas touche.
#>

# Cle du manifeste -> nom du jeton --md-sys-color-*.
# Les cles absentes de cette table (transparent, separateurs) restent litterales.
$script:ThemeColorMap = [ordered]@{
    "frame"                    = "surface"
    "frame_inactive"           = "surface-container-low"
    "tab_selected"             = "surface-container-lowest"
    "tab_text"                 = "primary"
    "tab_background_text"      = "on-surface-variant"
    "tab_line"                 = "primary"
    "toolbar"                  = "surface-container-low"
    "toolbar_text"             = "on-surface"
    "toolbar_field"            = "surface-container"
    "toolbar_field_text"       = "on-surface"
    "toolbar_bottom_separator" = "outline-variant"
    "icons"                    = "on-surface-variant"
    "icons_attention"          = "primary"
    "popup"                    = "surface-container-high"
    "popup_text"               = "on-surface"
    "popup_border"             = "outline-variant"
    # La selection dans les listes tire sur secondary-container partout dans le
    # theme (--treeitem-background-selected, --tree-card-background-selected).
    "popup_highlight"          = "secondary-container"
    "popup_highlight_text"     = "on-secondary-container"
    "sidebar"                  = "surface-container-low"
    "sidebar_text"             = "on-surface"
    "sidebar_highlight"        = "secondary-container"
    "sidebar_highlight_text"   = "on-secondary-container"
}

# Quelques cles ne pointent pas sur le meme jeton dans les deux modes, a l image
# des ponts natifs de chrome/tokens/ : --tab-selected-bgcolor vaut
# surface-container-lowest en clair et surface-container-high en sombre.
$script:ThemeColorMapDark = [ordered]@{
    "tab_selected" = "surface-container-high"
}

# Cle du manifeste -> jeton + opacite, pour les etats de survol et d appui.
$script:ThemeAlphaMap = [ordered]@{
    "button_background_hover"  = @{ Token = "primary"; Alpha = 0.08 }
    "button_background_active" = @{ Token = "primary"; Alpha = 0.16 }
}

<#
.SYNOPSIS
    Lit les jetons --md-sys-color-* d un fichier de palette.
.DESCRIPTION
    La premiere valeur rencontree fait foi. colors-dark.css declare la meme palette
    deux fois (mode sombre du systeme, puis theme sombre impose) : les deux blocs
    sont identiques, lire le premier suffit.
#>
function Get-ColorTokens {
    param([string]$Path)

    $map = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*--md-sys-color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;') {
            if (-not $map.ContainsKey($matches[1])) { $map[$matches[1]] = $matches[2].ToLower() }
        }
    }
    return $map
}

# Les separateurs decimaux locaux n ont pas leur place dans du JSON.
function ConvertTo-Rgba {
    param([string]$Hex, [double]$Alpha)

    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    $r = [Convert]::ToInt32($Hex.Substring(1, 2), 16)
    $g = [Convert]::ToInt32($Hex.Substring(3, 2), 16)
    $b = [Convert]::ToInt32($Hex.Substring(5, 2), 16)
    return "rgba($r, $g, $b, $($Alpha.ToString($inv)))"
}

function Resolve-ThemeColors {
    param([hashtable]$Tokens, [string]$Label, [switch]$Dark)

    $colors = @{}
    foreach ($key in $script:ThemeColorMap.Keys) {
        $token = $script:ThemeColorMap[$key]
        if ($Dark -and $script:ThemeColorMapDark.Contains($key)) {
            $token = $script:ThemeColorMapDark[$key]
        }
        if (-not $Tokens.ContainsKey($token)) {
            throw "Jeton --md-sys-color-$token introuvable pour la palette $Label."
        }
        $colors[$key] = $Tokens[$token]
    }
    foreach ($key in $script:ThemeAlphaMap.Keys) {
        $spec = $script:ThemeAlphaMap[$key]
        if (-not $Tokens.ContainsKey($spec.Token)) {
            throw "Jeton --md-sys-color-$($spec.Token) introuvable pour la palette $Label."
        }
        $colors[$key] = ConvertTo-Rgba -Hex $Tokens[$spec.Token] -Alpha $spec.Alpha
    }
    return $colors
}

<#
.SYNOPSIS
    Reecrit les couleurs de "theme" et "dark_theme" dans manifest.json.
.OUTPUTS
    Le nombre de valeurs modifiees.
#>
function Update-ManifestThemeColors {
    param([string]$ManifestPath, [string]$ChromeDir)

    $light = Resolve-ThemeColors -Tokens (Get-ColorTokens (Join-Path $ChromeDir "tokens\colors-light.css")) -Label "claire"
    $dark  = Resolve-ThemeColors -Tokens (Get-ColorTokens (Join-Path $ChromeDir "tokens\colors-dark.css"))  -Label "sombre" -Dark

    $lines = [System.IO.File]::ReadAllLines($ManifestPath)
    $current = $null
    $changed = 0

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        if ($line -match '^\s*"theme"\s*:')           { $current = $light; continue }
        elseif ($line -match '^\s*"dark_theme"\s*:')  { $current = $dark;  continue }
        if ($null -eq $current) { continue }

        if ($line -match '^(\s*")([a-z_]+)("\s*:\s*")([^"]*)("[,]?\s*)$') {
            $key = $matches[2]
            if ($current.ContainsKey($key) -and $matches[4] -ne $current[$key]) {
                $lines[$i] = $matches[1] + $key + $matches[3] + $current[$key] + $matches[5]
                $changed++
            }
        }
    }

    if ($changed -gt 0) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($ManifestPath, ($lines -join "`r`n") + "`r`n", $utf8NoBom)
    }
    return $changed
}
