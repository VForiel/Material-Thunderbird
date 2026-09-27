<#
.SYNOPSIS
    Interface graphique de personnalisation pour Material-Thunderbird.
.DESCRIPTION
    Permet de changer facilement la palette de couleurs, le mode clair/sombre,
    et d'activer/desactiver les icones emojis sans manipuler de code.
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ProjectRoot = (Get-Item (Join-Path $PSScriptRoot "..")).FullName
. (Join-Path $PSScriptRoot "common.ps1")

$profiles = Get-ThunderbirdProfiles
if ($profiles.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("Aucun profil Thunderbird detecte.", "Erreur", "OK", "Error")
    exit 1
}

$targetProfile = $profiles[0]
$overridesFile = Join-Path $targetProfile "chrome\user-overrides.css"

# Formulaire principal
$form = New-Object System.Windows.Forms.Form
$form.Text = "Personnaliser Material-Thunderbird"
$form.Size = New-Object System.Drawing.Size(460, 520)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)

# Titre
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "🎨 Personnalisation Material You"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location = New-Object System.Drawing.Point(20, 15)
$lblTitle.Size = New-Object System.Drawing.Size(400, 30)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(26, 115, 232)
$form.Controls.Add($lblTitle)

# Groupe Palettes
$grpPalette = New-Object System.Windows.Forms.GroupBox
$grpPalette.Text = " Palette de couleurs "
$grpPalette.Location = New-Object System.Drawing.Point(20, 55)
$grpPalette.Size = New-Object System.Drawing.Size(405, 110)
$form.Controls.Add($grpPalette)

$rbBlue = New-Object System.Windows.Forms.RadioButton
$rbBlue.Text = "🔵 Google Blue (#1A73E8)"
$rbBlue.Location = New-Object System.Drawing.Point(20, 28)
$rbBlue.Size = New-Object System.Drawing.Size(175, 25)
$rbBlue.Checked = $true
$grpPalette.Controls.Add($rbBlue)

$rbEmerald = New-Object System.Windows.Forms.RadioButton
$rbEmerald.Text = "🟢 Emerald (#0F9D58)"
$rbEmerald.Location = New-Object System.Drawing.Point(210, 28)
$rbEmerald.Size = New-Object System.Drawing.Size(175, 25)
$grpPalette.Controls.Add($rbEmerald)

$rbPurple = New-Object System.Windows.Forms.RadioButton
$rbPurple.Text = "🟣 Purple (#7C4DFF)"
$rbPurple.Location = New-Object System.Drawing.Point(20, 65)
$rbPurple.Size = New-Object System.Drawing.Size(175, 25)
$grpPalette.Controls.Add($rbPurple)

$rbCoral = New-Object System.Windows.Forms.RadioButton
$rbCoral.Text = "🟠 Coral (#FF5722)"
$rbCoral.Location = New-Object System.Drawing.Point(210, 65)
$rbCoral.Size = New-Object System.Drawing.Size(175, 25)
$grpPalette.Controls.Add($rbCoral)

# Groupe Mode de thème
$grpTheme = New-Object System.Windows.Forms.GroupBox
$grpTheme.Text = " Mode du thème "
$grpTheme.Location = New-Object System.Drawing.Point(20, 175)
$grpTheme.Size = New-Object System.Drawing.Size(405, 70)
$form.Controls.Add($grpTheme)

$rbAuto = New-Object System.Windows.Forms.RadioButton
$rbAuto.Text = "Automatique (Système)"
$rbAuto.Location = New-Object System.Drawing.Point(20, 28)
$rbAuto.Size = New-Object System.Drawing.Size(160, 25)
$rbAuto.Checked = $true
$grpTheme.Controls.Add($rbAuto)

$rbLight = New-Object System.Windows.Forms.RadioButton
$rbLight.Text = "☀️ Clair"
$rbLight.Location = New-Object System.Drawing.Point(190, 28)
$rbLight.Size = New-Object System.Drawing.Size(95, 25)
$grpTheme.Controls.Add($rbLight)

$rbDark = New-Object System.Windows.Forms.RadioButton
$rbDark.Text = "🌙 Sombre"
$rbDark.Location = New-Object System.Drawing.Point(295, 28)
$rbDark.Size = New-Object System.Drawing.Size(100, 25)
$grpTheme.Controls.Add($rbDark)

# Groupe Options supplémentaires
$grpOptions = New-Object System.Windows.Forms.GroupBox
$grpOptions.Text = " Options visuelles "
$grpOptions.Location = New-Object System.Drawing.Point(20, 255)
$grpOptions.Size = New-Object System.Drawing.Size(405, 75)
$form.Controls.Add($grpOptions)

$chkEmojis = New-Object System.Windows.Forms.CheckBox
$chkEmojis.Text = "✨ Icônes Émojis Modernes (📥 📤 📝 🗑️ 📁 ⭐)"
$chkEmojis.Location = New-Object System.Drawing.Point(20, 28)
$chkEmojis.Size = New-Object System.Drawing.Size(360, 25)
$chkEmojis.Checked = $true
$grpOptions.Controls.Add($chkEmojis)

# Pré-lecture des options existantes si le fichier existe
if (Test-Path $overridesFile) {
    $existing = Get-Content $overridesFile -Raw -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing -match "#0F9D58") { $rbEmerald.Checked = $true }
        elseif ($existing -match "#7C4DFF") { $rbPurple.Checked = $true }
        elseif ($existing -match "#FF5722") { $rbCoral.Checked = $true }
        else { $rbBlue.Checked = $true }

        if ($existing -match "color-scheme:\s*dark") { $rbDark.Checked = $true }
        elseif ($existing -match "color-scheme:\s*light") { $rbLight.Checked = $true }
        else { $rbAuto.Checked = $true }

        if ($existing -match "specialFolder-Inbox") { $chkEmojis.Checked = $true }
        else { $chkEmojis.Checked = $false }
    }
}

# Bouton Appliquer
$btnApply = New-Object System.Windows.Forms.Button
$btnApply.Text = "💾 Appliquer les modifications"
$btnApply.Location = New-Object System.Drawing.Point(20, 345)
$btnApply.Size = New-Object System.Drawing.Size(240, 42)
$btnApply.BackColor = [System.Drawing.Color]::FromArgb(26, 115, 232)
$btnApply.ForeColor = [System.Drawing.Color]::White
$btnApply.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnApply.FlatStyle = "Flat"
$btnApply.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnApply)

# Bouton Redémarrer Thunderbird
$btnRestart = New-Object System.Windows.Forms.Button
$btnRestart.Text = "🔄 Relancer Thunderbird"
$btnRestart.Location = New-Object System.Drawing.Point(270, 345)
$btnRestart.Size = New-Object System.Drawing.Size(155, 42)
$btnRestart.BackColor = [System.Drawing.Color]::FromArgb(226, 232, 240)
$btnRestart.ForeColor = [System.Drawing.Color]::FromArgb(31, 31, 31)
$btnRestart.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
$btnRestart.FlatStyle = "Flat"
$btnRestart.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnRestart)

# Bouton Soutenir
$btnSponsor = New-Object System.Windows.Forms.Button
$btnSponsor.Text = "❤️ Soutenir Vincent Foriel (GitHub Sponsors)"
$btnSponsor.Location = New-Object System.Drawing.Point(20, 397)
$btnSponsor.Size = New-Object System.Drawing.Size(405, 34)
$btnSponsor.BackColor = [System.Drawing.Color]::FromArgb(234, 74, 170)
$btnSponsor.ForeColor = [System.Drawing.Color]::White
$btnSponsor.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$btnSponsor.FlatStyle = "Flat"
$btnSponsor.FlatAppearance.BorderSize = 0
$form.Controls.Add($btnSponsor)

# Bouton Désinstaller
$btnUninstall = New-Object System.Windows.Forms.Button
$btnUninstall.Text = "🗑️ Désinstaller Material-Thunderbird..."
$btnUninstall.Location = New-Object System.Drawing.Point(20, 439)
$btnUninstall.Size = New-Object System.Drawing.Size(405, 30)
$btnUninstall.BackColor = [System.Drawing.Color]::Transparent
$btnUninstall.ForeColor = [System.Drawing.Color]::FromArgb(186, 26, 26)
$btnUninstall.FlatStyle = "Flat"
$btnUninstall.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(186, 26, 26)
$form.Controls.Add($btnUninstall)

# Actions
$btnApply.Add_Click({
    $css = "/**`n * Personnalisation Material-Thunderbird (genere automatiquement)`n */`n"

    # Palette
    if ($rbEmerald.Checked) {
        $css += @"
:root {
  --md-sys-color-primary: #0F9D58 !important;
  --md-sys-color-primary-container: #C4EED0 !important;
  --md-sys-color-on-primary-container: #073E1E !important;
  --md-sys-color-secondary-container: #C4EED0 !important;
  --md-sys-color-on-secondary-container: #073E1E !important;
  --md-primary: #0F9D58 !important;
  --md-primary-container: #C4EED0 !important;
  --md-secondary-container: #C4EED0 !important;
}
"@
    } elseif ($rbPurple.Checked) {
        $css += @"
:root {
  --md-sys-color-primary: #7C4DFF !important;
  --md-sys-color-primary-container: #E8DDFF !important;
  --md-sys-color-on-primary-container: #22005D !important;
  --md-sys-color-secondary-container: #EADDFF !important;
  --md-sys-color-on-secondary-container: #21005D !important;
  --md-primary: #7C4DFF !important;
  --md-primary-container: #E8DDFF !important;
  --md-secondary-container: #EADDFF !important;
}
"@
    } elseif ($rbCoral.Checked) {
        $css += @"
:root {
  --md-sys-color-primary: #FF5722 !important;
  --md-sys-color-primary-container: #FFDBCE !important;
  --md-sys-color-on-primary-container: #3B0900 !important;
  --md-sys-color-secondary-container: #FFDBCF !important;
  --md-sys-color-on-secondary-container: #3A0B01 !important;
  --md-primary: #FF5722 !important;
  --md-primary-container: #FFDBCE !important;
  --md-secondary-container: #FFDBCF !important;
}
"@
    } else {
        $css += @"
:root {
  --md-sys-color-primary: #1A73E8 !important;
  --md-sys-color-primary-container: #D3E3FD !important;
  --md-sys-color-on-primary-container: #041E49 !important;
  --md-sys-color-secondary-container: #C2E7FF !important;
  --md-sys-color-on-secondary-container: #001D35 !important;
  --md-primary: #1A73E8 !important;
  --md-primary-container: #D3E3FD !important;
  --md-secondary-container: #C2E7FF !important;
}
"@
    }

    # Mode
    if ($rbDark.Checked) {
        $css += "`n:root { color-scheme: dark !important; }`n"
    } elseif ($rbLight.Checked) {
        $css += "`n:root { color-scheme: light !important; }`n"
    }

    # Emojis
    if ($chkEmojis.Checked) {
        $css += @"

/* Option Icones Emojis */
#folderTree li .icon {
  background-image: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 18px !important;
  height: 18px !important;
  min-width: 18px !important;
}
#folderTree li .icon::before {
  font-size: 14px !important;
  line-height: 1 !important;
  display: inline-block !important;
  content: "📁" !important;
}
#folderTree li[data-server-type] .icon::before { content: "📬" !important; }
#folderTree li:is([data-folder-type="inbox"], [data-properties~="specialFolder-Inbox"]) .icon::before { content: "📥" !important; }
#folderTree li:is([data-folder-type="sent"], [data-properties~="specialFolder-Sent"]) .icon::before { content: "📤" !important; }
#folderTree li:is([data-folder-type="drafts"], [data-folder-type="draft"], [data-properties~="specialFolder-Drafts"]) .icon::before { content: "📝" !important; }
#folderTree li:is([data-folder-type="archive"], [data-folder-type="archives"], [data-properties~="specialFolder-Archive"]) .icon::before { content: "📁" !important; }
#folderTree li:is([data-folder-type="trash"], [data-properties~="specialFolder-Trash"]) .icon::before { content: "🗑️" !important; }
#folderTree li:is([data-folder-type="junk"], [data-properties~="specialFolder-Junk"]) .icon::before { content: "🚫" !important; }
#folderTree li:is([data-folder-type="starred"], [data-properties~="specialFolder-Flagged"]) .icon::before { content: "⭐" !important; }
#folderTree li:is([data-folder-type="outbox"], [data-properties~="specialFolder-Outbox"]) .icon::before { content: "📮" !important; }
#folderTree li:is([data-folder-type="templates"], [data-properties~="specialFolder-Templates"]) .icon::before { content: "📋" !important; }
"@
    }

    $destChrome = Join-Path $targetProfile "chrome"
    if (-not (Test-Path $destChrome)) { New-Item -ItemType Directory -Path $destChrome -Force | Out-Null }
    [System.IO.File]::WriteAllText($overridesFile, $css, [System.Text.Encoding]::UTF8)

    $res = [System.Windows.Forms.MessageBox]::Show(
        "Modifications enregistrees avec succes !`n`nPour appliquer immediatement le nouveau rendu, Thunderbird doit etre relance.`n`nVoulez-vous redemarrer Thunderbird maintenant ?",
        "Material-Thunderbird",
        "YesNo",
        "Information"
    )

    if ($res -eq "Yes") {
        Get-Process thunderbird -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 1
        $tbExe = "C:\Program Files\Mozilla Thunderbird\thunderbird.exe"
        if (-not (Test-Path $tbExe)) { $tbExe = "C:\Program Files (x86)\Mozilla Thunderbird\thunderbird.exe" }
        if (Test-Path $tbExe) { Start-Process $tbExe }
    }
})

$btnRestart.Add_Click({
    Get-Process thunderbird -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    $tbExe = "C:\Program Files\Mozilla Thunderbird\thunderbird.exe"
    if (-not (Test-Path $tbExe)) { $tbExe = "C:\Program Files (x86)\Mozilla Thunderbird\thunderbird.exe" }
    if (Test-Path $tbExe) { Start-Process $tbExe }
})

$btnSponsor.Add_Click({
    Start-Process "https://github.com/sponsors/VForiel"
})

$btnUninstall.Add_Click({
    $conf = [System.Windows.Forms.MessageBox]::Show(
        "Etes-vous sur de vouloir desinstaller Material-Thunderbird et restaurer l'interface par defaut ?",
        "Confirmation de desinstallation",
        "YesNo",
        "Warning"
    )
    if ($conf -eq "Yes") {
        $uninstallScript = Join-Path $PSScriptRoot "uninstall.ps1"
        if (Test-Path $uninstallScript) {
            & $uninstallScript
            [System.Windows.Forms.MessageBox]::Show("Le theme a ete desinstalle. Relancez Thunderbird.", "Desinstallation terminee", "OK", "Information")
            $form.Close()
        }
    }
})

[void]$form.ShowDialog()
