# Material-Thunderbird ✉️🎨

[![Thunderbird](https://img.shields.io/badge/Thunderbird-115%2B%20%7C%20128%2B%20Nebula-0A84FF?logo=thunderbird&logoColor=white)](https://www.thunderbird.net/)
[![Material Design 3](https://img.shields.io/badge/Design-Material%20You%20(M3)-4285F4?logo=google&logoColor=white)](https://m3.material.io/)
[![Installation](https://img.shields.io/badge/Installation-1--Clic%20Automatis%C3%A9e-34A853)](#-installation-rapide-en-1-clic-windows)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Material-Thunderbird** métamorphose l'interface de **Mozilla Thunderbird** (compatible avec les versions modernes Supernova 115+ et Nebula 128+) en adoptant le langage visuel **Material You (Material Design 3)** : formes en pilules douces, barres d'outils aérées, palettes tonales dynamiques, cartes surélevées et bouton d'action flottant (Extended FAB).

---

## ✨ Caractéristiques

- **🎨 Palettes Tonales Material You** : Support natif et harmonieux des modes **Clair** et **Sombre**, avec teintes douces et contrastes reposants.
- **🧭 Navigation Rail (Barre d'espaces)** : Indicateurs en pilules ovales pour identifier l'espace actif (Courrier, Carnet, Calendrier).
- **✏️ Extended Floating Action Button (FAB)** : Bouton "Écrire" modernisé avec coins arrondis et ombre d'élévation Material 3.
- **🔍 Barre de Recherche Pilule** : Barre de recherche globale aux angles complètement arrondis (`border-radius: 9999px`).
- **📂 Arbre des Dossiers (Navigation Drawer)** : Sélection des dossiers sous forme de capsules ovales tonales et badges de notification doux.
- **🗂️ Vue Cartes pour les Messages & Fils (Threads)** : Liste des messages présentée sous forme de cartes aérées avec point indicateur d'état non lu. Padding vertical optimisé pour les conversations avec réponses et affichage direct d'une puce pour les réponses non lues même lorsque le fil est replié.
- **📑 Vue Multi-Messages Material You (`multimessageview`)** : Refonte totale du panneau de sélection multiple / conversation complète sous forme de cartes d'e-mails d'un blanc pur (`#ffffff`), sans bordure, sur fond bleu doux (`surface-container-low`), avec en-tête surélevée, titre en gras et boutons d'action Material 3.
- **✉️ En-tête de Message Surélevé** : Fiche d'en-tête de courriel élégante avec boutons d'actions en pilules (Répondre, Transférer, Archiver, Supprimer).
- **⚡ Avatars Non-Bloquants avec Placeholder Instantané** : Placeholder neutre affiché immédiatement lors du défilement, suivi d'une résolution asynchrone progressive sans gel d'affichage. Les avatars proviennent de votre carnet d'adresses puis de l'initiale colorée du contact, **sans aucune requête réseau**. La recherche Gravatar existe mais reste désactivée par défaut ([pourquoi](docs/CUSTOMIZATION.md#2-avatars-gravatar-désactivés-par-défaut)).
- **🛡️ Détecteur de Désinscription Intelligent** : Script d'arrière-plan non-bloquant analysant les liens de désinscription (mots-clés multilingues, regex, ESP majeurs) et injectant un bandeau d'action Material You au-dessus du message pour se désinscrire en 1 clic.
- **📅 Agenda & Calendrier Modernisés** : Événements sous forme de cartes Material 3 aux coins arrondis, sélecteur de vues en boutons segmentés, badge "Aujourd'hui" en pilule tonale et volet d'agenda restylé.
- **⚡ Installation Globale en 1 Clic** : Script unique automatique sous Windows qui détecte votre profil, déploie les styles et configure Thunderbird sans manipulation manuelle !

---

## 🚀 Installation Rapide en 1 Clic (Windows)

Un **seul et unique script global** pour tout installer :

1. Téléchargez ou clonez ce dépôt sur votre machine :
   ```bash
   git clone https://github.com/VForiel/Material-Thunderbird.git
   ```
2. Rendez-vous dans le dossier **`scripts/`**.
3. **Double-cliquez sur `install.bat`** (ou lancez `install.ps1` dans PowerShell).
4. Le script :
   - Détecte automatiquement votre profil Thunderbird par défaut (`profiles.ini`). Ajoutez `-AllProfiles` pour cibler tous vos profils.
   - Sauvegarde toute personnalisation `chrome/` existante avant de la remplacer.
   - Active le support des feuilles de style dans `user.js` (`toolkit.legacyUserProfileCustomizations.stylesheets` et `svg.context-properties.content.enabled`).
   - Déploie le thème Material You dans le dossier `chrome/` de votre profil.
   - Compile et synchronise le package WebExtension `dist/material-thunderbird.xpi`.

> [!NOTE]
> Le script n'écrit que dans votre dossier de profil. Il ne modifie pas le dossier
> d'installation de Thunderbird et ne désactive aucun contrôle de sécurité.
> `install.ps1 -DryRun` affiche les actions sans rien modifier.
5. **Fermez et relancez Mozilla Thunderbird** pour admirer votre nouvelle interface !

> [!TIP]
> **Pour tout désinstaller :** Double-cliquez simplement sur l'unique script **`scripts/uninstall.bat`** puis redémarrez Thunderbird.

---

## 📦 Méthode Alternative : Extension WebExtension (`.xpi`)

Si vous préférez installer le thème sous forme d'extension :

1. Générez le package en lançant **`scripts/build.ps1`** (il produit `dist/material-thunderbird.xpi`, non versionné).
2. Dans Thunderbird, ouvrez le gestionnaire de modules (`Ctrl + Maj + A`).
3. Cliquez sur la roue crantée en haut à droite > **Installer un module depuis un fichier...**
4. Sélectionnez le fichier `material-thunderbird.xpi`.

> [!NOTE]
> Pour que l'extension injecte l'ensemble des formes et arrondis avancés via `theme_experiment`, assurez-vous que `extensions.experiments.enabled` est activé dans `about:config`.

---

## 🖥️ Démonstrateur Web Interactif

Vous souhaitez visualiser le rendu avant de l'installer ?
Ouvrez le fichier **[`docs/preview.html`](file:///e:/Material-Thunderbird/docs/preview.html)** directement dans votre navigateur web favori :
- Testez la bascule entre le **Mode Clair** et le **Mode Sombre**.
- Essayez les différentes teintes dynamiques : **Google Blue**, **Émeraude**, **Améthyste** et **Corail**.

---

## 📁 Arborescence du Projet

Conformément aux bonnes pratiques, l'arborescence est claire, structurée et ne surcharge pas la racine du dépôt :

```
Material-Thunderbird/
├── README.md                      # Présentation et guide de démarrage rapide
├── chrome/                        # Feuilles de style pour le profil Thunderbird
│   ├── userChrome.css             # Point d'entrée principal des styles
│   ├── userContent.css            # Styles pour les contenus de courriels et pages internes
│   ├── tokens/                    # Jetons de design Material You
│   │   ├── shapes.css             # Arrondis, élévations et polices
│   │   ├── colors-light.css       # Palette tonale claire (Google Blue)
│   │   └── colors-dark.css        # Palette tonale sombre
│   └── components/                # Modules CSS par composant
│       ├── spaces-toolbar.css     # Barre d'espaces (Navigation Rail)
│       ├── unified-toolbar.css    # Barre d'outils supérieure et bouton FAB
│       ├── folder-pane.css        # Volet des dossiers (Drawer MD3)
│       ├── thread-tree.css        # Liste des messages (Vue cartes)
│       ├── message-header.css     # En-tête de courriel surélevé
│       ├── tabs-and-dialogs.css   # Onglets, menus contextuels et modales
│       ├── calendar.css           # Agenda, vues du calendrier et volet Aujourd'hui
│       ├── avatars.css            # Cercles avatars non-bloquants avec placeholder neutre
│       └── multimessage.css       # Vue multi-messages / conversation (Material You)
├── extension/                     # Sources de l'extension WebExtension
│   ├── manifest.json              # Déclaration du thème et theme_experiment
│   ├── material-theme.css         # Feuille de style injectée
│   ├── background.js              # Script d'arrière-plan et enregistrement d'APIs
│   ├── shared/                    # Code partagé par les trois contextes
│   │   └── unsubscribe-rules.js   # Règles de détection de désinscription
│   ├── scripts/                   # Scripts d'assistance non-bloquants
│   │   └── unsubscribe-detector.js # Analyse du message affiché
│   └── icons/                     # Icône de l'extension au format SVG
│       └── icon.svg
├── scripts/                       # Outils d'automatisation
│   ├── install.bat                # Lanceur d'installation double-clic (Windows)
│   ├── install.ps1                # Script PowerShell d'installation automatique
│   ├── uninstall.bat              # Lanceur de désinstallation (Windows)
│   ├── uninstall.ps1              # Script PowerShell de restauration
│   └── build.ps1                  # Script de génération du package .xpi
├── dist/                          # Sortie de build (ignorée par Git)
│   └── material-thunderbird.xpi   # Générée par scripts/build.ps1
└── docs/                          # Documentation complémentaire
    ├── INSTALL.md                 # Guide d'installation complet (Windows, macOS, Linux)
    ├── CUSTOMIZATION.md           # Guide pour changer de palette de couleurs
    └── preview.html               # Vitrine interactive Material You pour navigateur
```

---

## 🛠️ Personnalisation

Envie d'une teinte **Verte Sarcelle**, **Violette** ou **Terracotta** ?
Consultez le guide détaillé : **[`docs/CUSTOMIZATION.md`](file:///e:/Material-Thunderbird/docs/CUSTOMIZATION.md)** pour savoir comment adapter les variables CSS à vos goûts en quelques secondes.

---

## 📚 Références & Sources

- [Spécifications Material Design 3 (Google Material You)](https://m3.material.io/)
- [Documentation Mozilla WebExtensions Themes](https://developer.mozilla.org/fr/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme)
- [Thunderbird WebExtension APIs - theme_experiment](https://webextension-api.thunderbird.net/)

---

## 📄 Licence

Ce projet est distribué sous licence [MIT](LICENSE). Libre à vous de le modifier et de l'adapter !