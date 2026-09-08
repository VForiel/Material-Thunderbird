# Guide d'installation de Material-Thunderbird

Ce document détaille les méthodes d'installation et de configuration du thème **Material-Thunderbird** (Material Design 3 / Material You).

---

## Compatibilité

- **Mozilla Thunderbird** : 115+ (Supernova), 128+ (Nebula), 140+ et versions supérieures.
- **Systèmes d'exploitation** : Windows 10/11, macOS, Linux.

---

## Méthode 1 : Installation Automatisée 1-Clic (Recommandée sous Windows)

Cette méthode est la plus simple et rapide. Elle configure automatiquement votre profil et active le support CSS.

1. Téléchargez ou clonez ce dépôt sur votre ordinateur.
2. Ouvrez le dossier `scripts/`.
3. **Double-cliquez sur `install.bat`** (ou exécutez `install.ps1` via PowerShell).
4. Le script va :
   - Détecter automatiquement votre profil Thunderbird actif (via `profiles.ini`).
   - Activer `toolkit.legacyUserProfileCustomizations.stylesheets = true` et `svg.context-properties.content.enabled = true` dans le fichier `user.js` de votre profil.
   - Déployer l'ensemble des feuilles de style Material 3 dans le sous-dossier `chrome/`.
5. **Redémarrez Mozilla Thunderbird**.

### Pour désinstaller :
- Double-cliquez sur `scripts/uninstall.bat`.
- Redémarrez Thunderbird.

---

## Méthode 2 : Installation de l'Extension WebExtension (`.xpi`)

Si vous préférez installer le thème via le gestionnaire de modules de Thunderbird :

1. Récupérez le fichier packagé **`dist/material-thunderbird.xpi`** (ou compilez-le avec `scripts/build.ps1`).
2. Lancez **Mozilla Thunderbird**.
3. Ouvrez les **Paramètres** (icône d'engrenage en bas à gauche) > **Modules complémentaires et thèmes** (ou raccourci `Ctrl + Maj + A`).
4. Cliquez sur l'icône d'engrenage en haut à droite de la page des modules complémentaires.
5. Sélectionnez **Installer un module depuis un fichier...**
6. Choisissez le fichier `dist/material-thunderbird.xpi` et confirmez l'installation.

> [!NOTE]
> Pour que l'extension injecte l'intégralité des rayons d'arrondi personnalisés et la navigation rail via `theme_experiment`, activez `extensions.experiments.enabled` dans l'éditeur de configuration (`about:config`).

---

## Méthode 3 : Installation Manuelle (Multiplateforme : macOS & Linux)

Si vous utilisez Linux ou macOS, ou souhaitez installer manuellement les fichiers :

### 1. Activer le support CSS dans Thunderbird
1. Dans Thunderbird, allez dans **Paramètres** > onglet **Général**.
2. Faites défiler tout en bas et cliquez sur **Éditeur de configuration...**
3. Recherchez : `toolkit.legacyUserProfileCustomizations.stylesheets`
4. Double-cliquez pour passer sa valeur à **`true`**.
5. Recherchez également `svg.context-properties.content.enabled` et passez-le à **`true`**.

### 2. Localiser votre dossier de profil
1. Dans le menu Thunderbird, rendez-vous dans **Aide** > **Informations de dépannage**.
2. À la ligne **Dossier de profil**, cliquez sur **Ouvrir le dossier** (ou *Afficher dans le Finder* sous macOS).

### 3. Copier les styles
1. Dans ce dossier de profil, créez un dossier nommé **`chrome`** (s'il n'existe pas déjà).
2. Copiez l'intégralité du contenu du dossier `chrome/` de ce dépôt dans le dossier `chrome` de votre profil :
   - `userChrome.css`
   - `userContent.css`
   - Le dossier `tokens/`
   - Le dossier `components/`
3. **Redémarrez Thunderbird**.

---

## Dépannage (FAQ)

### Les styles ne s'appliquent pas après le redémarrage
1. Assurez-vous d'avoir complètement fermé Thunderbird (vérifiez qu'aucun processus fantôme `thunderbird.exe` ne tourne dans le Gestionnaire des tâches).
2. Vérifiez que `toolkit.legacyUserProfileCustomizations.stylesheets` est bien sur `true` dans `about:config` (ou dans `user.js`).
3. Vérifiez que le dossier se nomme bien `chrome` (en minuscules) et non `Chrome` ou `chrome.txt`.

### L'apparence de la liste de messages n'est pas sous forme de cartes
1. Dans Thunderbird, cliquez sur le bouton de disposition d'affichage de liste (en haut de la colonne des messages).
2. Sélectionnez le mode **Cartes** au lieu de l'affichage classique en tableau pour profiter pleinement du design Material You.
