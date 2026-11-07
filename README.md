# Material-Thunderbird ✉️🎨

[![Site Web & Guide Débutant](https://img.shields.io/badge/Site%20Web-D%C3%A9monstration%20%26%20Installation%20Facile-4285F4?logo=googlechrome&logoColor=white)](https://vforiel.github.io/Material-Thunderbird/)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/VForiel)
[![Thunderbird](https://img.shields.io/badge/Thunderbird-115%2B%20%7C%20128%2B%20Nebula-0A84FF?logo=thunderbird&logoColor=white)](https://www.thunderbird.net/)
[![Material Design 3](https://img.shields.io/badge/Design-Material%20You%20(M3)-4285F4?logo=google&logoColor=white)](https://m3.material.io/)
[![Installation](https://img.shields.io/badge/Installation-un%20seul%20.xpi-34A853)](#-installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Material-Thunderbird** métamorphose l'interface de **Mozilla Thunderbird** (compatible avec les versions modernes Supernova 115+ et Nebula 128+) en adoptant le langage visuel **Material You (Material Design 3)** : formes en pilules douces, barres d'outils aérées, palettes tonales dynamiques, cartes surélevées et bouton d'action flottant (Extended FAB).

🌐 **Site Web & Démonstrateur Interactif :** [https://vforiel.github.io/Material-Thunderbird/](https://vforiel.github.io/Material-Thunderbird/)  
*(Présentation visuelle, simulateur en direct et guide pas à pas pour les personnes non-techniques).*

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
- **🛡️ Détecteur de Désinscription Intelligent** : Analyse de l'en-tête `List-Unsubscribe` (RFC 2369) puis du message affiché (mots-clés multilingues, plateformes emailing majeures), et affichage d'un bandeau Material You dans la fenêtre de Thunderbird pour se désinscrire en 1 clic. Seules les URL `http(s)` sont ouvrables, et le domaine de destination est indiqué au survol.
- **📅 Agenda & Calendrier Modernisés** : Événements sous forme de cartes Material 3 aux coins arrondis, sélecteur de vues en boutons segmentés, badge "Aujourd'hui" en pilule tonale et volet d'agenda restylé.
- **⚡ Une seule extension** : un fichier `.xpi` à ouvrir avec Thunderbird. Thème, personnalisation et désinstallation se font depuis Thunderbird, sans script ni redémarrage.

---

## 🚀 Installation

1. Téléchargez **`material-thunderbird.xpi`** depuis le [site du projet](https://vforiel.github.io/Material-Thunderbird/).
2. Ouvrez-le avec Thunderbird (double-clic, ou glisser-déposer dans la fenêtre), puis confirmez avec **Ajouter**.

Le thème s'applique aussitôt. Pour le retirer : **Désinstaller…** dans la fenêtre de personnalisation, ou
**Supprimer** dans le gestionnaire de modules (`Ctrl + Maj + A`).

Détails, et passage depuis une ancienne installation par script : **[`docs/INSTALL.md`](docs/INSTALL.md)**.

### Compiler le `.xpi` soi-même

`scripts/build.ps1` génère les feuilles de style de l'extension depuis `chrome/` et produit
`dist/material-thunderbird.xpi` (dossier non versionné). `npm test` vérifie que les fichiers générés
sont à jour.

---

## 🖥️ Démonstrateur Web Interactif

Vous souhaitez visualiser le rendu avant de l'installer ?
Ouvrez le fichier **[`docs/preview.html`](docs/preview.html)** directement dans votre navigateur web favori :
- Testez la bascule entre le **Mode Clair** et le **Mode Sombre**.
- Essayez les différentes teintes dynamiques : **Google Blue**, **Émeraude**, **Améthyste** et **Corail**.

---

## 📁 Arborescence du Projet

Conformément aux bonnes pratiques, l'arborescence est claire, structurée et ne surcharge pas la racine du dépôt :

```
Material-Thunderbird/
├── README.md                      # Présentation et guide de démarrage rapide
├── chrome/                        # Source unique du thème (compilée dans l'extension)
│   ├── userChrome.css             # Ordre de chargement des feuilles
│   ├── userContent.css            # Styles du corps des courriels
│   ├── tokens/                    # Jetons de design Material You
│   │   ├── shapes.css             # Arrondis, élévations et polices
│   │   ├── colors-light.css       # Palette tonale claire (Google Blue)
│   │   ├── colors-dark.css        # Palette tonale sombre
│   │   └── bridge.css             # Alias courts --md-* vers les jetons système
│   └── components/                # Modules CSS par composant
│       ├── global.css             # Règles générales (police, surface, texte)
│       ├── spaces-toolbar.css     # Barre d'espaces (Navigation Rail)
│       ├── unified-toolbar.css    # Barre d'outils supérieure et bouton FAB
│       ├── folder-pane.css        # Volet des dossiers (Drawer MD3)
│       ├── thread-tree.css        # Liste des messages (Vue cartes)
│       ├── message-header.css     # En-tête de courriel surélevé
│       ├── tabs-and-dialogs.css   # Onglets, menus contextuels et modales
│       ├── calendar.css           # Agenda, vues du calendrier et volet Aujourd'hui
│       ├── avatars.css            # Cercles avatars non-bloquants avec placeholder neutre
│       ├── multimessage.css       # Vue multi-messages / conversation (Material You)
│       └── extras.css             # Règles complémentaires, chargées en dernier
├── extension/                     # Sources de l'extension WebExtension
│   ├── manifest.json              # Déclaration de l'extension et de son experiment
│   ├── experiments/               # API privilégiée : thème, boutons, personnalisation
│   ├── material-theme.css         # GÉNÉRÉ depuis chrome/ par scripts/build.ps1
│   ├── message-content.css        # GÉNÉRÉ depuis chrome/userContent.css
│   ├── background.js              # Script d'arrière-plan et enregistrement d'APIs
│   ├── shared/                    # Code partagé par les trois contextes
│   │   └── unsubscribe-rules.js   # Règles de détection de désinscription
│   ├── scripts/                   # Scripts d'assistance non-bloquants
│   │   └── unsubscribe-detector.js # Analyse du message affiché
│   └── icons/                     # Icône de l'extension au format SVG
│       └── icon.svg
├── scripts/
│   └── build.ps1                  # Génération des feuilles et du package .xpi
├── tests/                         # Suite de tests (`npm test`, sans dépendance)
│   ├── unsubscribe-rules.test.js  # Détection de désinscription et URL sûres
│   ├── generated-css.test.js      # material-theme.css toujours aligné sur chrome/
│   └── tokens-parity.test.js      # Palettes sombres identiques, encodage sain
├── dist/                          # Sortie de build (ignorée par Git)
│   └── material-thunderbird.xpi   # Générée par scripts/build.ps1
└── docs/                          # Documentation complémentaire
    ├── INSTALL.md                 # Installation, désinstallation, dépannage
    ├── CUSTOMIZATION.md           # Guide pour changer de palette de couleurs
    └── preview.html               # Vitrine interactive Material You pour navigateur
```

---

## 🛠️ Personnalisation

Cliquez sur le bouton palette de la barre latérale gauche (au-dessus de la roue des paramètres), ou
utilisez **`Alt+M`**, ou **Outils > Personnaliser le thème Material (M3)...** : mode clair / sombre /
système, couleur d'accent et icônes émojis, appliqués immédiatement. Voir aussi
**[`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md)**.

---

## 📚 Références & Sources

- [Spécifications Material Design 3 (Google Material You)](https://m3.material.io/)
- [Thunderbird WebExtension APIs](https://webextension-api.thunderbird.net/)
- [Experiments Thunderbird](https://developer.thunderbird.net/add-ons/mailextensions/experiments)

---

## 💖 Soutenir le projet

Vous appréciez **Material-Thunderbird** et souhaitez encourager son développement libre et bénévole ?  
Vous pouvez sponsoriser le projet directement sur [**GitHub Sponsors**](https://github.com/sponsors/VForiel) 💖. Merci pour votre soutien !

---

## 📄 Licence

Ce projet est distribué sous licence [MIT](LICENSE). Libre à vous de le modifier et de l'adapter !