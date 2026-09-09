# Guide de Personnalisation de Material-Thunderbird

Le thème **Material-Thunderbird** a été conçu selon les spécifications [Material Design 3](https://m3.material.io) avec des jetons de design modulaires (`tokens/`). Vous pouvez facilement adapter la palette tonale et l'apparence à vos préférences.

---

## 1. Changer la Palette Tonale (Couleurs Material You)

Les couleurs sont définies dans `chrome/tokens/colors-light.css` et `chrome/tokens/colors-dark.css`.

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

## 2. Avatars Gravatar (désactivés par défaut)

Le thème peut afficher la photo Gravatar de vos correspondants. Cette option est
**désactivée par défaut** car elle a un coût en vie privée : pour chaque message
ouvert, une empreinte de l'adresse de l'expéditeur est envoyée à `gravatar.com`,
ce qui révèle à un tiers avec qui vous correspondez et quand vous lisez son courrier.
L'empreinte est facile à inverser pour une adresse déjà connue.

Sans cette option, les avatars utilisent la photo de votre carnet d'adresses, puis
l'initiale colorée du contact. **Aucune requête réseau n'est émise.**

Pour l'activer en connaissance de cause :

1. Ouvrez `about:config` dans Thunderbird (Paramètres > Général > Éditeur de configuration).
2. Recherchez `extensions.material-thunderbird.gravatar.enabled`.
3. Basculez la valeur à `true`.

---

## 3. Personnaliser les Polices de Caractères

Dans `chrome/tokens/shapes.css`, modifiez la variable `--md-sys-font-family` :

```css
:root {
  /* Si vous avez installé Google Sans ou Roboto */
  --md-sys-font-family: "Google Sans", "Roboto", "Segoe UI", sans-serif;
}
```

---

## 4. Ajuster les Rayons de Courbure (Formes & Pilules)

Si vous préférez des arrondis plus subtils ou plus prononcés, modifiez les valeurs dans `chrome/tokens/shapes.css` :

```css
:root {
  --md-shape-corner-medium: 10px; /* Cartes et boîtes de messages */
  --md-shape-corner-large: 14px;  /* Cartes d'en-tête et dialogues */
  --md-shape-corner-full: 9999px; /* Éléments sélectionnés et badges */
}
```
