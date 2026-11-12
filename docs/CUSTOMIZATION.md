# Guide de Personnalisation de Material-Thunderbird

## Depuis Thunderbird

Cliquez sur le bouton palette de la barre latérale gauche (au-dessus de la roue des paramètres),
ou utilisez **`Alt+M`**, ou **Outils > Personnaliser le thème Material (M3)...** :

- **Apparence** : clair, sombre, ou le mode de Windows / macOS (*Système*) ;
- **Couleur d'accent** : quatre palettes Material You, détaillées plus bas ;
- **Icônes** : celles de Thunderbird (*Défaut*), des émojis, ou *Moderne* : icônes Material pleines,
  de la couleur d'accent ; les deux derniers remplacent les icônes des dossiers, de la barre des espaces,
  des onglets et des boutons du message ;
- **Avatars** : logos des marques et Gravatar (voir plus bas) ;
- **Fils de discussion** : masquer les réponses déjà lues ;
- **Désinscription** : activer ou couper le bandeau, et retrouver les expéditeurs pour lesquels
  il est masqué (bouton *Retirer* pour le proposer à nouveau).

Tout s'applique immédiatement, dans toutes les fenêtres, et se retire avec l'extension.

---

## Pour aller plus loin : modifier le thème lui-même

Couleurs sur mesure, polices et arrondis se règlent dans les sources du thème, `chrome/`, puis
en recompilant l'extension avec `scripts/build.ps1` (voir le [README](../README.md)).

## 1. Palettes de couleurs

Les jetons de couleur sont définis dans `chrome/tokens/colors-light.css` et
`chrome/tokens/colors-dark.css`. Les palettes proposées par la fenêtre de personnalisation sont
dans `PALETTES_CONFIG`, en tête de `extension/experiments/material-assistant.js` : ajoutez-y une
entrée pour proposer une teinte de plus.

### Palettes d'accentuation recommandées :

#### 🔵 Google Blue / Indigo (Par défaut)
```css
/* Mode Clair */
--md-sys-color-primary: #0b57d0;
--md-sys-color-primary-container: #d3e3fd;
--md-sys-color-secondary-container: #c2e7ff;

/* Mode Sombre */
--md-sys-color-primary: #a8c7fa;
--md-sys-color-primary-container: #004a77;
```

#### 🟢 Émeraude / Sarcelle (Nature & Calme)
```css
/* Mode Clair */
--md-sys-color-primary: #006a60;
--md-sys-color-primary-container: #74f8e5;
--md-sys-color-secondary-container: #cce8e3;

/* Mode Sombre */
--md-sys-color-primary: #53dbc9;
--md-sys-color-primary-container: #005048;
```

#### 🟣 Améthyste / Lavande (Élégance)
```css
/* Mode Clair */
--md-sys-color-primary: #6750a4;
--md-sys-color-primary-container: #eaddff;
--md-sys-color-secondary-container: #e8def8;

/* Mode Sombre */
--md-sys-color-primary: #d0bcff;
--md-sys-color-primary-container: #4f378b;
```

#### 🟠 Corail / Terracotta (Dynamique & Chaud)
```css
/* Mode Clair */
--md-sys-color-primary: #9c4125;
--md-sys-color-primary-container: #ffdbd1;
--md-sys-color-secondary-container: #f5ddd6;

/* Mode Sombre */
--md-sys-color-primary: #ffb59f;
--md-sys-color-primary-container: #7d2b11;
```

---

## 2. Avatars

Ordre de priorité :

1. **Photo du contact** dans votre carnet d'adresses ;
2. **Logo de la marque** (activé par défaut) ;
3. **Gravatar** (désactivé par défaut) ;
4. **Initiale colorée** du contact ou de l'adresse.

La photo d'un compte Google ou Microsoft n'est pas publique : Gmail la tire de ses propres
serveurs, et aucun client de messagerie tiers ne peut l'obtenir.

### Logos des marques (BIMI)

C'est ce que Gmail affiche pour une banque, Doctolib ou un réseau social : le domaine de
l'expéditeur publie dans son DNS (`default._bimi.<domaine>`) l'adresse de son logo officiel.
L'extension ne l'affiche que si ce domaine applique DMARC en mode strict (`p=quarantine` ou
`p=reject`) : un courriel qui usurpe ce domaine est alors refusé ou classé en indésirable par
votre serveur, et ne peut pas emprunter le logo.

Coût réseau : une requête DNS par domaine d'expéditeur, puis le téléchargement du logo depuis le
serveur de la marque. Rien sur vous ni sur le message n'est transmis, et le résultat est gardé
7 jours. Si le résolveur DNS du système ne répond pas aux requêtes de ce type, la recherche passe
par le DNS sur HTTPS de Cloudflare, comme Firefox en mode DoH. Option *Logos des marques* dans la
fenêtre de personnalisation pour la couper.

### Gravatar

Désactivé par défaut car il a un coût en vie privée : pour chaque expéditeur, une empreinte de
son adresse est envoyée à `gravatar.com`, ce qui révèle à un tiers avec qui vous correspondez.
L'empreinte est facile à inverser pour une adresse déjà connue. Option *Gravatar* dans la
fenêtre de personnalisation pour l'activer en connaissance de cause.

---

## 3. Personnaliser les Polices de Caractères

Dans `chrome/tokens/shapes.css`, modifiez la variable `--md-sys-font-family`, puis recompilez :

```css
:root {
  /* Si vous avez installé Google Sans ou Roboto */
  --md-sys-font-family: "Google Sans", "Roboto", "Segoe UI", sans-serif;
}
```

---

## 4. Ajuster les Rayons de Courbure (Formes & Pilules)

Si vous préférez des arrondis plus subtils ou plus prononcés, modifiez les valeurs dans `chrome/tokens/shapes.css`, puis recompilez :

```css
:root {
  --md-shape-corner-medium: 10px; /* Cartes et boîtes de messages */
  --md-shape-corner-large: 14px;  /* Cartes d'en-tête et dialogues */
  --md-shape-corner-full: 9999px; /* Éléments sélectionnés et badges */
}
```
