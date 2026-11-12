/**
 * Material-Thunderbird - WebExtension Experiment
 * Component: Material Assistant (Chrome Native Unsubscribe Banner & Material You Helpers)
 * Injects Material Design 3 enhancements directly into the Thunderbird chrome window:
 * 1. Native unsubscribe banner, rendered on request from background.js
 * 2. Unified Avatar Resolution (Address Book photo > Gravatar, opt-in > Contact initial > Email initial)
 * 3. Text-sized sender avatar in multimessage view (multiMessageBrowser)
 * 4. Thread reply unread status, and hiding of read replies in threads that have unread ones
 */

var ExtensionCommon;
try {
  ({ ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs"));
} catch (e) {
  ({ ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm"));
}

// Services est un global des scripts privilegies depuis Gecko 104, et
// Services.sys.mjs n existe plus dans les versions recentes : l importer levait
// une erreur, puis le repli ChromeUtils.import (retire lui aussi) en levait une
// seconde, et l experiment entier echouait au chargement -- plus de boutons, plus
// de fenetre de personnalisation, plus de bandeau.
var Services = globalThis.Services;
if (!Services) {
  try {
    ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
  } catch (e) {
    ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
  }
}

var MailServices;
try {
  ({ MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs"));
} catch (e) {
  try {
    ({ MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm"));
  } catch (e2) {}
}

// Material You Tonal Palettes for High-Entropy Hashing
const M3_AVATAR_PALETTES = [
  { bg: "#D3E3FD", fg: "#041E49" }, // Royal Blue
  { bg: "#FFD8D3", fg: "#3A0B07" }, // Coral
  { bg: "#C4EED0", fg: "#072711" }, // Mint
  { bg: "#EEDCFF", fg: "#2E004E" }, // Amethyst
  { bg: "#FFE088", fg: "#261900" }, // Amber
  { bg: "#FFD8E4", fg: "#3B071E" }, // Rose
  { bg: "#C2E7FF", fg: "#001D35" }, // Soft Azure
  { bg: "#E1EAAF", fg: "#1B1F00" }, // Lime
  { bg: "#FFDBCA", fg: "#360F00" }, // Tangerine
  { bg: "#E8DEF8", fg: "#1D192B" }, // Lavender
  { bg: "#B9F2D5", fg: "#002114" }, // Emerald
  { bg: "#FFDAD6", fg: "#410002" }, // Ruby
  { bg: "#DBE1FF", fg: "#00174B" }, // Indigo
  { bg: "#FFDDB8", fg: "#2A1700" }, // Ochre
  { bg: "#F5D9FF", fg: "#2B003A" }, // Plum
  { bg: "#D7E8CD", fg: "#111F0E" }  // Sage
];

// Configuration des palettes et options Material You
const PREF_PALETTE = "extensions.material-thunderbird.palette";
const PREF_EMOJIS = "extensions.material-thunderbird.emojis";
// Theme d icones : "default", "emoji" ou "modern". Remplace PREF_EMOJIS, garde
// a jour pour une version precedente qui reviendrait.
const PREF_ICON_THEME = "extensions.material-thunderbird.icon-theme";
const PREF_THEME_MODE = "extensions.material-thunderbird.theme-mode";
// Bandeau de desinscription : interrupteur general, expediteurs et listes pour
// lesquels il n est plus propose, messages ou il a ete masque.
const PREF_UNSUB_ENABLED = "extensions.material-thunderbird.unsubscribe-banner";
const PREF_UNSUB_IGNORED = "extensions.material-thunderbird.unsubscribe-ignored";
const PREF_UNSUB_HIDDEN = "extensions.material-thunderbird.unsubscribe-hidden-messages";
const UNSUB_HIDDEN_MAX = 500;
// Le mode clair / sombre passe par ui.systemUsesDarkTheme, que Gecko lit a la
// place du reglage de Windows : prefers-color-scheme bascule pour toute
// l interface, donc les deux palettes de chrome/tokens/ au complet.
// Cette preference n appartient pas a l extension : elle n en est que le miroir
// tant que l extension tourne. Le choix lui-meme vit dans PREF_THEME_MODE, et
// PREF_DARK_OVERRIDE_OWNED dit si la valeur actuelle a ete posee par nous, pour
// ne jamais effacer un reglage pose par quelqu un d autre. Sans cela, desactiver
// ou desinstaller l extension laissait Thunderbird bloque en sombre.
const PREF_DARK_OVERRIDE = "ui.systemUsesDarkTheme";
const PREF_DARK_OVERRIDE_OWNED = "extensions.material-thunderbird.dark-override-owned";

// light / dark : primary, primary-container, secondary-container.
const PALETTES_CONFIG = {
  blue:    { name: "Bleu Google", color: "#0b57d0", desc: "Classique M3",
             light: ["#0b57d0", "#d3e3fd", "#c2e7ff"], dark: ["#a8c7fa", "#004a77", "#004b72"] },
  emerald: { name: "Émeraude",    color: "#006a60", desc: "Nature & Sérénité",
             light: ["#006a60", "#74f8e5", "#cce8e3"], dark: ["#53dbc9", "#005048", "#334b46"] },
  purple:  { name: "Améthyste",   color: "#6750a4", desc: "Violet élégant",
             light: ["#6750a4", "#eaddff", "#e8def8"], dark: ["#d0bcff", "#4f378b", "#4a4458"] },
  coral:   { name: "Corail",      color: "#9c4125", desc: "Terracotta chaud",
             light: ["#9c4125", "#ffdbd1", "#f5ddd6"], dark: ["#ffb59f", "#7d2b11", "#5c2a1a"] }
};

/**
 * Les selecteurs reprennent exactement ceux de chrome/tokens/ : a specificite
 * egale, user-overrides.css, importe apres, l emporte. Un simple `:root` (0-1-0)
 * perdait contre `:root[lwt-theme-brighttext="false"]` (0-2-0) des que
 * Thunderbird posait cet attribut, et la couleur choisie ne s affichait pas.
 */
function paletteCss(pal) {
  // !important : la feuille est une feuille utilisateur, et une declaration
  // utilisateur ordinaire perd contre n importe quelle declaration de page. Il
  // suffisait d un <style> laisse par une version precedente pour que la
  // couleur choisie ne s affiche jamais. Entre elles, ces regles restent
  // departagees par la specificite, comme les jetons de chrome/tokens/.
  const block = (values, indent) =>
    `${indent}--md-sys-color-primary: ${values[0]} !important;\n` +
    `${indent}--md-sys-color-primary-container: ${values[1]} !important;\n` +
    `${indent}--md-sys-color-secondary-container: ${values[2]} !important;\n`;
  return `:root,
:root[lwt-theme-brighttext="false"] {
${block(pal.light, "  ")}}
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) {
${block(pal.dark, "    ")}  }
}
:root[lwt-theme-brighttext="true"] {
${block(pal.dark, "  ")}}`;
}

function getThemeMode() {
  let mode = "auto";
  try { mode = Services.prefs.getStringPref(PREF_THEME_MODE, "auto"); } catch (e) {}
  return (mode === "light" || mode === "dark") ? mode : "auto";
}

function applyThemeModeOverride() {
  const mode = getThemeMode();
  try {
    if (mode === "auto") {
      releaseThemeModeOverride();
      return;
    }
    Services.prefs.setIntPref(PREF_DARK_OVERRIDE, mode === "dark" ? 1 : 0);
    Services.prefs.setBoolPref(PREF_DARK_OVERRIDE_OWNED, true);
  } catch (e) {
    console.error("[Material-Thunderbird] Mode clair / sombre non applique :", e);
  }
}

function releaseThemeModeOverride() {
  try {
    if (Services.prefs.getBoolPref(PREF_DARK_OVERRIDE_OWNED, false)) {
      Services.prefs.clearUserPref(PREF_DARK_OVERRIDE);
    }
    Services.prefs.clearUserPref(PREF_DARK_OVERRIDE_OWNED);
  } catch (e) {}
}

function setThemeMode(mode) {
  try {
    Services.prefs.setStringPref(PREF_THEME_MODE, mode);
  } catch (e) {
    console.error("[Material-Thunderbird] Error saving theme mode:", e);
  }
  applyThemeModeOverride();
}

function getCustomizerSettings() {
  let palette = "blue";
  let emojis = false;
  let iconTheme = "";
  try { palette = Services.prefs.getStringPref(PREF_PALETTE, "blue"); } catch (e) {}
  try { emojis = Services.prefs.getBoolPref(PREF_EMOJIS, false); } catch (e) {}
  try { iconTheme = Services.prefs.getStringPref(PREF_ICON_THEME, ""); } catch (e) {}
  // Sans choix enregistre : Moderne, ou Emojis pour qui les avait actives avant
  // les themes d icones.
  if (!ICON_THEMES.includes(iconTheme)) iconTheme = emojis ? "emoji" : "modern";
  if (!PALETTES_CONFIG[palette]) palette = "blue";
  return { palette, themeMode: getThemeMode(), iconTheme };
}

function saveCustomizerSettings(settings) {
  try {
    if (settings.palette) Services.prefs.setStringPref(PREF_PALETTE, settings.palette);
    if (settings.themeMode) setThemeMode(settings.themeMode);
    if (ICON_THEMES.includes(settings.iconTheme)) {
      Services.prefs.setStringPref(PREF_ICON_THEME, settings.iconTheme);
      Services.prefs.setBoolPref(PREF_EMOJIS, settings.iconTheme === "emoji");
    }
  } catch (e) {
    console.error("[Material-Thunderbird] Error saving prefs:", e);
  }
}

/**
 * Documents ou s appliquent les feuilles globales : l interface de Thunderbird,
 * jamais le contenu des courriels ni les pages web ouvertes dans un onglet.
 * userChrome.css visait de meme les seuls documents privilegies. Le corps de
 * l editeur de redaction est un about:blank, d ou une liste plutot que about:.
 */
const CHROME_DOCUMENTS = [
  'url-prefix("chrome://")',
  'url-prefix("about:3pane")',
  'url-prefix("about:message")',
  'url-prefix("about:addressbook")',
  'url-prefix("about:preferences")',
  'url-prefix("about:addons")',
  'url-prefix("about:accountsettings")'
].join(", ");

/**
 * Themes d icones. Trois choix : "default" (icones de Thunderbird), "emoji" et
 * "modern" (icones Material pleines, teintees de la couleur d accent). Les deux
 * derniers remplacent les memes icones, listees une fois ci-dessous par leur
 * role ; chaque theme donne l image de chaque role.
 */
const ICON_THEMES = ["default", "emoji", "modern"];

/**
 * Les icones de dossiers et de la barre des espaces sont des <img> dont l image
 * vient de la propriete content : un <img> n a pas de ::before. On remplace donc
 * l image elle-meme par un petit SVG, contenant l emoji ou le trace de l icone.
 */
function emojiImage(emoji) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<text x="10" y="16" font-size="16" text-anchor="middle" ' +
    'font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">' +
    emoji + "</text></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// La couleur est ecrite dans le SVG : les proprietes de contexte (context-fill)
// ne s appliquent pas a une image data:. D ou une regle par mode, clair et
// sombre, avec la teinte de la palette choisie.
function materialImage(path, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="${color}"><path d="${path}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Role -> emoji.
const EMOJI_ICONS = {
  folder: "📁", account: "📧", inbox: "📥", sent: "📤", drafts: "📝", templates: "📋",
  archive: "🗃️", junk: "🚫", trash: "🗑️", outbox: "📮", virtual: "🔎",
  mail: "📬", contacts: "📇", calendar: "📆", tasks: "✅", chat: "💬", settings: "⚙️",
  reply: "↩️", replyAll: "↩️", forward: "➡️", extension: "🧩", sync: "🔄"
};

// Role -> trace Material Symbols Rounded, graisse 400 (Apache 2.0,
// google/material-design-icons, paquet @material-symbols/svg-400). Comme Gmail :
// icones en contour, version pleine pour l element choisi (dossier ouvert,
// espace courant, onglet actif). Les versions pleines seules faisaient paves.
const MATERIAL_ICONS = {
  folder: "M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h256q12.44 0 23.72 5t19.37 13.09L481-740h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Zm0-60h680v-460H456l-60-60H140v520Zm0 0v-520 520Z",
  account: "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm680-525L496-473q-4 2-7.5 3.5T480-468q-5 0-8.5-1.5T464-473L140-685v465h680v-465ZM480-522l336-218H145l335 218ZM140-685v7-39.32.73V-740v23-.91V-678v-7 465-465Z",
  inbox: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-136H634q-26 40-67.5 61.5T480-233q-45 0-86.5-21.5T326-316H180v136Zm300.02-113q34.98 0 64.48-17.5Q574-328 591-359q7-10 18.5-13.5T633-376h147v-404H180v404h147q12 0 23.5 3.5T369-359q17 31 46.52 48.5 29.51 17.5 64.5 17.5ZM180-180h600-600Z",
  sent: "M814-452 162-178q-15 6-28.5-2.5T120-205v-550q0-16 13.5-24.5T162-782l652 274q18 8 18 28t-18 28ZM180-253l544-227-544-230v168l242 62-242 60v167Zm0 0v-457 457Z",
  drafts: "M180-180h44l472-471-44-44-472 471v44Zm-30 60q-13 0-21.5-8.5T120-150v-73q0-12 5-23.5t13-19.5l557-556q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L266-138q-8 8-19.5 13t-23.5 5h-73Zm629-617-41-41 41 41Zm-105 64-22-22 44 44-22-22Z",
  templates: "M349-250h262q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H349q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-170h262q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H349q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h336q12.44 0 23.72 5T599-862l183 183q8 8 13 19.28 5 11.28 5 23.72v496q0 24-18 42t-42 18H220Zm331-584v-156H220v680h520v-494H581q-12.75 0-21.37-8.63Q551-651.25 551-664ZM220-820v186-186 680-680Z",
  archive: "M479.82-581q-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v171l-66-66q-7.82-8-19.91-8T344-446.14q-8 7.85-8 20 0 12.14 8 20.14l115 115q9 9 21 9t21-9l115-115q8-7.82 8-19.91T616.14-446q-7.85-8-20-8-12.14 0-20.14 8l-66 66v-171q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62ZM180-674v494h600v-494H180Zm0 554q-24.75 0-42.37-17.63Q120-155.25 120-180v-529q0-9.88 3-19.06 3-9.18 9-16.94l52-71q8-11 20.94-17.5Q217.88-840 232-840h495q14.12 0 27.06 6.5T775-816l53 71q6 7.76 9 16.94 3 9.18 3 19.06v529q0 24.75-17.62 42.37Q804.75-120 780-120H180Zm17-614h565l-36.41-46H233l-36 46Zm283 307Z",
  junk: "M480-281q14 0 24.5-10.5T515-316q0-14-10.5-24.5T480-351q-14 0-24.5 10.5T445-316q0 14 10.5 24.5T480-281Zm0-144q13 0 21.5-8.5T510-455v-203q0-13-8.5-21.5T480-688q-13 0-21.5 8.5T450-658v203q0 13 8.5 21.5T480-425ZM355-120q-12 0-23.5-5T312-138L138-312q-8-8-13-19.5t-5-23.5v-250q0-12 5-23.5t13-19.5l174-174q8-8 19.5-13t23.5-5h250q12 0 23.5 5t19.5 13l174 174q8 8 13 19.5t5 23.5v250q0 12-5 23.5T822-312L648-138q-8 8-19.5 13t-23.5 5H355Zm0-60h250l175-175v-250L605-780H355L180-605v250l175 175Zm125-300Z",
  trash: "M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-11q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h158q0-13 8.63-21.5 8.62-8.5 21.37-8.5h204q12.75 0 21.38 8.62Q612-822.75 612-810h158q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-11v570q0 24.75-17.62 42.37Q723.75-120 699-120H261Zm438-630H261v570h438v-570ZM397.18-266q12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-339q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v339q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63Zm166 0q12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-339q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v339q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63ZM261-750v570-570Z",
  outbox: "m453-611-58 58q-9 9-21 9t-21.39-9q-8.61-9-8.61-21.5t9-21.5l109-110q5-5 10.13-7 5.14-2 11-2 5.87 0 10.87 2 5 2 10 7l110 110q9 9 9 21t-8.61 21q-9.39 9-21.89 9t-21.5-9l-58-57v159q0 12.75-8.68 21.37-8.67 8.63-21.5 8.63-12.82 0-21.32-8.63-8.5-8.62-8.5-21.37v-159ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-136H634q-26 40-67.5 61.5T480-233q-45 0-86.5-21.5T326-316H180v136Zm300.02-113q34.98 0 64.48-17.5Q574-328 591-359q7-10 18.5-13.5T633-376h147v-404H180v404h147q12 0 23.5 3.5T369-359q17 31 46.52 48.5 29.51 17.5 64.5 17.5ZM180-180h600-600Z",
  virtual: "M378-329q-108.16 0-183.08-75Q120-479 120-585t75-181q75-75 181.5-75t181 75Q632-691 632-584.85 632-542 618-502q-14 40-42 75l242 240q9 8.56 9 21.78T818-143q-9 9-22.22 9-13.22 0-21.78-9L533-384q-30 26-69.96 40.5Q423.08-329 378-329Zm-1-60q81.25 0 138.13-57.5Q572-504 572-585t-56.87-138.5Q458.25-781 377-781q-82.08 0-139.54 57.5Q180-666 180-585t57.46 138.5Q294.92-389 377-389Z",
  mail: "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm680-525L496-473q-4 2-7.5 3.5T480-468q-5 0-8.5-1.5T464-473L140-685v465h680v-465ZM480-522l336-218H145l335 218ZM140-685v7-39.32.73V-740v23-.91V-678v-7 465-465Z",
  contacts: "M174-40q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h612q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32Q798.75-40 786-40H174Zm0-820q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h612q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5H174Zm306 416q50 0 84-34t34-84q0-50-34-84t-84-34q-50 0-84 34t-34 84q0 50 34 84t84 34ZM132-160q-24 0-42-18t-18-42v-520q0-26 18-43t42-17h696q24 0 42 18t18 42v520q0 24-18 42t-42 18H132Zm88-60q51-63 121-94.5T479.5-346q68.5 0 140 31.5T740-220h88v-520H132v520h88Zm94 0h334q-31-30-72.5-48T480-286q-54 0-94.5 18T314-220Zm166.16-284q-24.16 0-40.66-17-16.5-17-16.5-41t16.34-41q16.34-17 40.5-17t40.66 17q16.5 17 16.5 41t-16.34 41q-16.34 17-40.5 17Zm-.16 24Z",
  calendar: "M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.02 0 23.51 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.03 0 23.51 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Zm300 230q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-160 0q-17 0-28.5-11.5T280-280q0-17 11.5-28.5T320-320q17 0 28.5 11.5T360-280q0 17-11.5 28.5T320-240Zm320 0q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z",
  tasks: "M480-80q-85 0-158-30.5T195-195q-54-54-84.5-127T80-480q0-84 30.5-157T195-764q54-54 127-85t158-31q60 0 117 17.5T704-811q11 7 13.5 19t-5.5 22q-8 10-20 11t-23-6q-42-27-90-41t-99-14q-145 0-242.5 97.5T140-480q0 145 97.5 242.5T480-140q145 0 242.5-97.5T820-480q0-19-1.5-37t-5.5-35q-2-13 4-24t18-13q13-3 24 4.5t13 20.5q4 20 6 41t2 43q0 85-31 158t-85 127q-54 54-127 84.5T480-80Zm-59-309 392-392q9-9 22-9t23 9q10 10 10 23t-10 23L442-319q-9 9-21 9t-21-9L278-442q-9-9-8.5-22.5T279-487q9-9 22.5-9t22.5 9l97 98Z",
  chat: "M240-240 131-131q-14 14-32.5 6.34Q80-132.31 80-152v-668q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240Zm-26-60h606v-520H140v600l74-80Zm-74 0v-520 520Zm130-99h253q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-130h420q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-130h420q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Z",
  settings: "M421-80q-14 0-25-9t-13-23l-15-94q-19-7-40-19t-37-25l-86 40q-14 6-28 1.5T155-226L97-330q-8-13-4.5-27t15.5-23l80-59q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521l-80-59q-12-9-15.5-23t4.5-27l58-104q8-13 22-17.5t28 1.5l86 40q16-13 37-25t40-18l15-95q2-14 13-23t25-9h118q14 0 25 9t13 23l15 94q19 7 40.5 18.5T669-710l86-40q14-6 27.5-1.5T804-734l59 104q8 13 4.5 27.5T852-580l-80 57q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l80 58q12 8 15.5 22.5T863-330l-58 104q-8 13-22 17.5t-28-1.5l-86-40q-16 13-36.5 25.5T592-206l-15 94q-2 14-13 23t-25 9H421Zm15-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z",
  reply: "m236-494 142 142q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L141-503q-9-9-9-21t9-21l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L236-554h406q85 0 141.5 56.5T840-356v126q0 13-8.5 21.5T810-200q-13 0-21.5-8.5T780-230v-126q0-60-39-99t-99-39H236Z",
  replyAll: "m166-524 172 172q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L101-503q-5-5-7-10t-2-11q0-6 2-11t7-10l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L166-524Zm210 30 142 142q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L281-503q-5-5-7-10t-2-11q0-6 2-11t7-10l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L376-554h305q85 0 141.5 56.5T879-356v126q0 13-8.5 21.5T849-200q-13 0-21.5-8.5T819-230v-126q0-60-39-99t-99-39H376Z",
  forward: "M794-524 623-696q-9-9-9-21.5t9-21.5q9-9 21-9t21 9l194 194q5 5 7 10t2 11q0 6-2 11t-7 10L666-310q-9 9-21.5 9t-21.5-9q-9-9-9.5-21t8.5-21l172-172Zm-210 30H279q-60 0-99 39t-39 99v126q0 13-8.5 21.5T111-200q-13 0-21.5-8.5T81-230v-126q0-85 56.5-141.5T279-554h305L443-696q-9-9-9-21.5t9-21.5q9-9 21-9t21 9l194 194q5 5 7 10t2 11q0 6-2 11t-7 10L486-310q-9 9-21.5 9t-21.5-9q-9-9-9.5-21t8.5-21l142-142Z",
  extension: "M356-120H180q-24 0-42-18t-18-42v-176q44-5 75.5-34.5T227-463q0-43-31.5-72.5T120-570v-176q0-24 18-42t42-18h177q11-40 39.5-67t68.5-27q40 0 68.5 27t39.5 67h173q24 0 42 18t18 42v173q40 11 65.5 41.5T897-461q0 40-25.5 67T806-356v176q0 24-18 42t-42 18H570q-5-48-35.5-77.5T463-227q-41 0-71.5 29.5T356-120Zm-176-60h130q25-61 69.89-84t83-23Q501-287 546-264t70 84h130v-235h45q20 0 33-13t13-33q0-20-13-33t-33-13h-45v-239H511v-48q0-20-13-33t-33-13q-20 0-33 13t-13 33v48H180v130q48.15 17.82 77.58 59.69Q287-514.45 287-462.78 287-412 257.5-370T180-310v130Zm285-281Z",
  sync: "M220-477q0 63 23.5 109.5T307-287l30 21v-94q0-13 8.5-21.5T367-390q13 0 21.5 8.5T397-360v170q0 13-8.5 21.5T367-160H197q-13 0-21.5-8.5T167-190q0-13 8.5-21.5T197-220h100l-15-12q-64-51-93-111t-29-134q0-94 49.5-171.5T342-766q11-5 21 0t14 16q5 11 0 22.5T361-710q-64 34-102.5 96.5T220-477Zm520-6q0-48-23.5-97.5T655-668l-29-26v94q0 13-8.5 21.5T596-570q-13 0-21.5-8.5T566-600v-170q0-13 8.5-21.5T596-800h170q13 0 21.5 8.5T796-770q0 13-8.5 21.5T766-740H665l15 14q60 56 90 120t30 123q0 93-48 169.5T623-195q-11 6-22.5 1.5T584-210q-5-11 0-22.5t16-17.5q65-33 102.5-96T740-483Z",
  palette: "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-85 32-158t87.5-127q55.5-54 130-84.5T489-880q79 0 150 26.5T763.5-780q53.5 47 85 111.5T880-527q0 108-63 170.5T650-294h-75q-18 0-31 14t-13 31q0 27 14.5 46t14.5 44q0 38-21 58.5T480-80Zm0-400Zm-233 26q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm126-170q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm214 0q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm131 170q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15ZM480-140q11 0 15.5-4.5T500-159q0-14-14.5-26T471-238q0-46 30-81t76-35h73q76 0 123-44.5T820-527q0-132-100-212.5T489-820q-146 0-247.5 98.5T140-480q0 141 99.5 240.5T480-140Z",
  heart: "M480-140q-10.7 0-21.78-3.87-11.08-3.87-19.49-12.38L386-205Q262-320 171-424.5T80-643q0-90.15 60.5-150.58Q201-854 290-854q51 0 101 24.5t89 80.5q44-56 91-80.5t99-24.5q89 0 149.5 60.42Q880-733.15 880-643q0 114-91 218.5T574-205l-53 49q-8.25 8.38-19.12 12.19Q491-140 480-140Zm-26-543q-27-49-71-80t-93-31q-66 0-108 42.5t-42 108.93q0 57.57 38.88 121.22 38.88 63.66 93 123.5Q326-338 384-286.5q58 51.5 96 86.5 38-34 96-86t112-112.5q54-60.5 93-124.19T820-643q0-66-42.5-108.5T670-794q-50 0-93.5 30.5T504-683q-5 8-11 11.5t-14 3.5q-8 0-14.5-3.5T454-683Zm26 186Z"
};

const MATERIAL_ICONS_FILLED = {
  folder: "M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h256q12 0 23.5 5t19.5 13l42 42h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Z",
  account: "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm340-308q5 0 8.5-1.5t7.5-3.5l314-205q5-3 7.5-8t2.5-11q0-13-11.5-20.5t-23.5.5L480-522 176-717q-12-8-24-1t-12 20q0 6 3 11.5t7 8.5l314 205q4 2 7.5 3.5t8.5 1.5Z",
  inbox: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm300-173q35 0 64-18t47-48q6-11 18-14t24-3h147v-404H180v404h147q12 0 24 3t18 14q18 30 47 48t64 18Z",
  sent: "M162-178q-15 6-28.5-2.5T120-205v-200l302-75-302-77v-198q0-16 13.5-24.5T162-782l652 274q18 8 18 28t-18 28L162-178Z",
  drafts: "M150-120q-13 0-21.5-8.5T120-150v-73q0-12 5-23.5t13-19.5l557-556q8-8 19-12.5t23-4.5q11 0 22 4.5t20 12.5l44 44q9 9 13 20t4 22q0 11-4.5 22.5T823-694L266-138q-8 8-19.5 13t-23.5 5h-73Zm589-577 40-40-41-41-40 40 41 41Z",
  templates: "M349-250h262q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H349q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-170h262q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H349q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5ZM220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h336q12.44 0 23.72 5T599-862l183 183q8 8 13 19.28 5 11.28 5 23.72v496q0 24-18 42t-42 18H220Zm331-584q0 12.75 8.63 21.37Q568.25-634 581-634h159L551-820v156Z",
  archive: "M180-120q-24.75 0-42.37-17.63Q120-155.25 120-180v-529q0-9.88 3-19.06 3-9.18 9-16.94l52-71q8-11 20.94-17.5Q217.88-840 232-840h495q14.12 0 27.06 6.5T775-816l53 71q6 7.76 9 16.94 3 9.18 3 19.06v529q0 24.75-17.62 42.37Q804.75-120 780-120H180Zm17-614h565l-36.41-46H233l-36 46Zm282.82 153q-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v171l-66-66q-7.82-8-19.91-8T344-446.14q-8 7.85-8 20 0 12.14 8 20.14l115 115q9 9 21 9t21-9l115-115q8-7.82 8-19.91T616.14-446q-7.85-8-20-8-12.14 0-20.14 8l-66 66v-171q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62Z",
  junk: "M480-281q14 0 24.5-10.5T515-316q0-14-10.5-24.5T480-351q-14 0-24.5 10.5T445-316q0 14 10.5 24.5T480-281Zm0-144q13 0 21.5-8.5T510-455v-203q0-13-8.5-21.5T480-688q-13 0-21.5 8.5T450-658v203q0 13 8.5 21.5T480-425ZM355-120q-12 0-23.5-5T312-138L138-312q-8-8-13-19.5t-5-23.5v-250q0-12 5-23.5t13-19.5l174-174q8-8 19.5-13t23.5-5h250q12 0 23.5 5t19.5 13l174 174q8 8 13 19.5t5 23.5v250q0 12-5 23.5T822-312L648-138q-8 8-19.5 13t-23.5 5H355Z",
  trash: "M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-11q-12.75 0-21.37-8.68-8.63-8.67-8.63-21.5 0-12.82 8.63-21.32 8.62-8.5 21.37-8.5h158q0-13 8.63-21.5 8.62-8.5 21.37-8.5h204q12.75 0 21.38 8.62Q612-822.75 612-810h158q12.75 0 21.38 8.68 8.62 8.67 8.62 21.5 0 12.82-8.62 21.32-8.63 8.5-21.38 8.5h-11v570q0 24.75-17.62 42.37Q723.75-120 699-120H261Zm136.18-146q12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-339q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v339q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63Zm166 0q12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-339q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v339q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63Z",
  outbox: "M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm300-173q35 0 64-18t47-48q6-11 18-14t24-3h147v-404H180v404h147q12 0 24 3t18 14q18 30 47 48t64 18Zm-27-318-58 58q-9 9-21 9t-21-9q-9-9-9-21.5t9-21.5l109-110q5-5 10-7t11-2q6 0 11 2t10 7l110 110q9 9 9 21t-9 21q-9 9-21.5 9t-21.5-9l-58-57v159q0 13-8.5 21.5T483-422q-13 0-21.5-8.5T453-452v-159Z",
  virtual: "M378-329q-108.16 0-183.08-75Q120-479 120-585t75-181q75-75 181.5-75t181 75Q632-691 632-584.85 632-542 618-502q-14 40-42 75l242 240q9 8.56 9 21.78T818-143q-9 9-22.22 9-13.22 0-21.78-9L533-384q-30 26-69.96 40.5Q423.08-329 378-329Zm-1-60q81.25 0 138.13-57.5Q572-504 572-585t-56.87-138.5Q458.25-781 377-781q-82.08 0-139.54 57.5Q180-666 180-585t57.46 138.5Q294.92-389 377-389Z",
  mail: "M140-160q-24 0-42-18t-18-42v-520q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H140Zm340-308q5 0 8.5-1.5t7.5-3.5l314-205q5-3 7.5-8t2.5-11q0-13-11.5-20.5t-23.5.5L480-522 176-717q-12-8-24-1t-12 20q0 6 3 11.5t7 8.5l314 205q4 2 7.5 3.5t8.5 1.5Z",
  contacts: "M480-444q50 0 84-34t34-84q0-50-34-84t-84-34q-50 0-84 34t-34 84q0 50 34 84t84 34ZM132-160q-24 0-42-18t-18-42v-520q0-26 18-43t42-17h696q24 0 42 18t18 42v520q0 24-18 42t-42 18H132Zm88-60h520q-49-63-120.5-94.5T480-346q-69 0-139 31.5T220-220ZM174-40q-13 0-21.5-8.5T144-70q0-13 8.5-21.5T174-100h612q13 0 21.5 8.5T816-70q0 13-8.5 21.5T786-40H174Zm0-820q-13 0-21.5-8.5T144-890q0-13 8.5-21.5T174-920h612q13 0 21.5 8.5T816-890q0 13-8.5 21.5T786-860H174Z",
  calendar: "M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.02 0 23.51 9.2Q310-861.6 310-848v28h340v-28q0-13.6 9.2-22.8 9.2-9.2 22.8-9.2 14.03 0 23.51 9.2Q715-861.6 715-848v28h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm300-260q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-160 0q-17 0-28.5-11.5T280-280q0-17 11.5-28.5T320-320q17 0 28.5 11.5T360-280q0 17-11.5 28.5T320-240Zm320 0q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z",
  tasks: "M480-80q-85 0-158-30.5T195-195q-54-54-84.5-127T80-480q0-84 30.5-157T195-764q54-54 127-85t158-31q60 0 117 17.5T704-811q11 7 13.5 19t-5.5 22q-8 10-20 11t-23-6q-42-27-90-41t-99-14q-145 0-242.5 97.5T140-480q0 145 97.5 242.5T480-140q145 0 242.5-97.5T820-480q0-19-1.5-37t-5.5-35q-2-13 4-24t18-13q13-3 24 4.5t13 20.5q4 20 6 41t2 43q0 85-31 158t-85 127q-54 54-127 84.5T480-80Zm-59-309 392-392q9-9 22-9t23 9q10 10 10 23t-10 23L442-319q-9 9-21 9t-21-9L278-442q-9-9-8.5-22.5T279-487q9-9 22.5-9t22.5 9l97 98Z",
  chat: "M240-240 131-131q-14 14-32.5 6.34Q80-132.31 80-152v-668q0-24 18-42t42-18h680q24 0 42 18t18 42v520q0 24-18 42t-42 18H240Zm30-159h253q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-130h420q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Zm0-130h420q12.75 0 21.38-8.68 8.62-8.67 8.62-21.5 0-12.82-8.62-21.32-8.63-8.5-21.38-8.5H270q-12.75 0-21.37 8.68-8.63 8.67-8.63 21.5 0 12.82 8.63 21.32 8.62 8.5 21.37 8.5Z",
  settings: "M421-80q-14 0-25-9t-13-23l-15-94q-19-7-40-19t-37-25l-86 40q-14 6-28 1.5T155-226L97-330q-8-13-4.5-27t15.5-23l80-59q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521l-80-59q-12-9-15.5-23t4.5-27l58-104q8-13 22-17.5t28 1.5l86 40q16-13 37-25t40-18l15-95q2-14 13-23t25-9h118q14 0 25 9t13 23l15 94q19 7 40.5 18.5T669-710l86-40q14-6 27.5-1.5T804-734l59 104q8 13 4.5 27.5T852-580l-80 57q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l80 58q12 8 15.5 22.5T863-330l-58 104q-8 13-22 17.5t-28-1.5l-86-40q-16 13-36.5 25.5T592-206l-15 94q-2 14-13 23t-25 9H421Zm59-270q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Z",
  reply: "m236-494 142 142q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L141-503q-9-9-9-21t9-21l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L236-554h406q85 0 141.5 56.5T840-356v126q0 13-8.5 21.5T810-200q-13 0-21.5-8.5T780-230v-126q0-60-39-99t-99-39H236Z",
  replyAll: "m166-524 172 172q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L101-503q-5-5-7-10t-2-11q0-6 2-11t7-10l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L166-524Zm210 30 142 142q9 9 8.5 21t-9.5 21q-9 9-21.5 9t-21.5-9L281-503q-5-5-7-10t-2-11q0-6 2-11t7-10l194-194q9-9 21.5-9t21.5 9q9 9 9 21.5t-9 21.5L376-554h305q85 0 141.5 56.5T879-356v126q0 13-8.5 21.5T849-200q-13 0-21.5-8.5T819-230v-126q0-60-39-99t-99-39H376Z",
  forward: "M794-524 623-696q-9-9-9-21.5t9-21.5q9-9 21-9t21 9l194 194q5 5 7 10t2 11q0 6-2 11t-7 10L666-310q-9 9-21.5 9t-21.5-9q-9-9-9.5-21t8.5-21l172-172Zm-210 30H279q-60 0-99 39t-39 99v126q0 13-8.5 21.5T111-200q-13 0-21.5-8.5T81-230v-126q0-85 56.5-141.5T279-554h305L443-696q-9-9-9-21.5t9-21.5q9-9 21-9t21 9l194 194q5 5 7 10t2 11q0 6-2 11t-7 10L486-310q-9 9-21.5 9t-21.5-9q-9-9-9.5-21t8.5-21l142-142Z",
  extension: "M356-120H180q-24 0-42-18t-18-42v-176q44-5 75.5-34.5T227-463q0-43-31.5-72.5T120-570v-176q0-24 18-42t42-18h177q11-40 39.5-67t68.5-27q40 0 68.5 27t39.5 67h173q24 0 42 18t18 42v173q40 11 65.5 41.5T897-461q0 40-25.5 67T806-356v176q0 24-18 42t-42 18H570q-5-48-35.5-77.5T463-227q-41 0-71.5 29.5T356-120Z",
  sync: "M220-477q0 63 23.5 109.5T307-287l30 21v-94q0-13 8.5-21.5T367-390q13 0 21.5 8.5T397-360v170q0 13-8.5 21.5T367-160H197q-13 0-21.5-8.5T167-190q0-13 8.5-21.5T197-220h100l-15-12q-64-51-93-111t-29-134q0-94 49.5-171.5T342-766q11-5 21 0t14 16q5 11 0 22.5T361-710q-64 34-102.5 96.5T220-477Zm520-6q0-48-23.5-97.5T655-668l-29-26v94q0 13-8.5 21.5T596-570q-13 0-21.5-8.5T566-600v-170q0-13 8.5-21.5T596-800h170q13 0 21.5 8.5T796-770q0 13-8.5 21.5T766-740H665l15 14q60 56 90 120t30 123q0 93-48 169.5T623-195q-11 6-22.5 1.5T584-210q-5-11 0-22.5t16-17.5q65-33 102.5-96T740-483Z",
  palette: "M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-84 32-157t87.5-127q55.5-54 130-85T489-880q79 0 150 26.5T763.5-780q53.5 47 85 111.5T880-527q0 108-63 170.5T650-294h-75q-18 0-31 14t-13 31q0 20 14.5 38t14.5 43q0 26-24.5 57T480-80ZM247-454q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm126-170q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm214 0q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Zm131 170q20 0 35-15t15-35q0-20-15-35t-35-15q-20 0-35 15t-15 35q0 20 15 35t35 15Z",
  heart: "M480-140q-11 0-22-4t-19-12l-53-49Q262-320 171-424.5T80-643q0-90 60.5-150.5T290-854q51 0 101 24.5t89 80.5q44-56 91-80.5t99-24.5q89 0 149.5 60.5T880-643q0 114-91 218.5T574-205l-53 49q-8 8-19 12t-22 4Z"
};

// Emplacements remplaces, et le role de chacun.
const FOLDER_ICON_ROLES = [
  ["inbox", "inbox"], ["sent", "sent"], ["drafts", "drafts"], ["templates", "templates"],
  ["archive", "archive"], ["junk", "junk"], ["trash", "trash"], ["outbox", "outbox"],
  ["virtual", "virtual"]
];

const SPACES_ICON_ROLES = [
  ["mailButton", "mail"], ["addressBookButton", "contacts"], ["calendarButton", "calendar"],
  ["tasksButton", "tasks"], ["chatButton", "chat"], ["settingsButton", "settings"]
];

const HEADER_ICON_ROLES = [
  ["hdrReplyButton", "reply"], ["hdrReplyToSenderButton", "reply"], ["hdrReplyAllButton", "replyAll"],
  ["hdrReplyListButton", "replyAll"], ["hdrFollowupButton", "reply"], ["hdrForwardButton", "forward"],
  ["hdrArchiveButton", "archive"], ["hdrJunkButton", "junk"], ["hdrTrashButton", "trash"]
];

// Nom du fichier de l icone native de l onglet -> role. Pas de fragment comme
// "message" : tous les chemins commencent par chrome://messenger/.
const TAB_ICON_ROLES = [
  ["address-book", "contacts"], ["calendar", "calendar"], ["tasks", "tasks"], ["chat", "chat"],
  ["settings", "settings"], ["extension", "extension"], ["inbox", "inbox"], ["sent", "sent"],
  ["draft", "drafts"], ["template", "templates"], ["archive", "archive"], ["junk", "junk"],
  ["spam", "junk"], ["trash", "trash"], ["outbox", "outbox"], ["folder", "folder"]
];

/**
 * Feuille d un theme d icones. imageFor(role) rend l url de l image ; prefix
 * precede chaque selecteur (theme sombre).
 */
function iconRulesCss(imageFor, prefix = "", selectedImageFor = null) {
  const sel = (s) => prefix + s;
  const rule = (selector, role, prop, image) =>
    `${sel(selector)} {
  ${prop}: ${image(role)} !important;
  -moz-context-properties: none !important;
}
`;
  // [selecteur, selecteur de l element choisi ou null, role, propriete]
  const slots = [
    ["#folderTree li > .container > .icon", "#folderTree li.selected > .container > .icon", "folder", "content"],
    ["#folderTree li[data-server-type] > .container > .icon", "#folderTree li.selected[data-server-type] > .container > .icon", "account", "content"]
  ];
  for (const [type, role] of FOLDER_ICON_ROLES) {
    slots.push([`#folderTree li[data-folder-type="${type}"] > .container > .icon`,
      `#folderTree li.selected[data-folder-type="${type}"] > .container > .icon`, role, "content"]);
  }
  for (const [id, role] of SPACES_ICON_ROLES) {
    slots.push([`#${id} > img`, `#${id}.current > img`, role, "content"]);
  }
  // Boutons de l en-tete du message : toolbarbutton XUL, dont l icone est une
  // <image> dessinee par list-style-image. Repondre et Repondre a tous sont des
  // boutons a menu : leur icone est dans un bouton imbrique, pas un enfant direct.
  for (const [id, role] of HEADER_ICON_ROLES) {
    slots.push([`#${id} .toolbarbutton-icon`, null, role, "list-style-image"]);
  }
  // Icones des onglets : <img> dont l image vient de l attribut src, reconnu
  // par le nom du fichier d icone de Thunderbird.
  for (const [file, role] of TAB_ICON_ROLES) {
    slots.push([`#tabmail-tabs .tab-icon-image[src*="${file}"]`,
      `#tabmail-tabs .tabmail-tab[selected] .tab-icon-image[src*="${file}"]`, role, "content"]);
  }
  // Relever le courrier : image de fond du bouton.
  slots.push(["#folderPaneGetMessages", null, "sync", "background-image"]);
  let css = "";
  for (const [selector, , role, prop] of slots) css += rule(selector, role, prop, imageFor);
  if (selectedImageFor) {
    for (const [, selected, role, prop] of slots) {
      if (selected) css += rule(selected, role, prop, selectedImageFor);
    }
  }
  return css;
}

function emojiCss() {
  let css = "/* Icones emojis */\n" + iconRulesCss((role) => emojiImage(EMOJI_ICONS[role]));
  // Le "+" du bouton de redaction est une image de fond, pas un <img>.
  css += `#folderPaneWriteMessage {
  background-image: none !important;
}
#folderPaneWriteMessage::before {
  content: "✏️" !important;
  margin-inline-end: 6px !important;
}
.material-rail-btn > svg {
  display: none !important;
}
.material-rail-btn::before {
  content: "🎨";
  font-size: 16px;
  line-height: 1;
  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;
}
.material-rail-sponsor::before {
  content: "💖";
}
`;
  return css;
}

/**
 * Melange lineaire de deux couleurs #rrggbb ; t est la part de a.
 */
function mixHex(a, b, t) {
  const ca = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const cb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return "#" + ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

/**
 * Couleur des icones "Moderne". L accent pur (#0b57d0, ton 40 a pleine
 * saturation) est fait pour un bouton, pas pour vingt icones : il tranchait sur
 * les surfaces. Comme les icones de Google (on-surface-variant, legerement
 * teinte), on garde la teinte de la palette mais on la rapproche du gris des
 * textes secondaires : un bleu ardoise en clair, un bleu pale en sombre.
 */
function iconColors(pal) {
  return {
    light: mixHex(pal.light[0], "#444746", 0.55),
    dark: mixHex(pal.dark[0], "#c4c7c5", 0.6)
  };
}

/**
 * Icones "Moderne" : une seule couleur, la teinte de la palette adoucie, au lieu
 * du gris de Thunderbird. Les selecteurs clair / sombre reprennent ceux de
 * paletteCss.
 */
function modernIconCss(pal) {
  const colors = iconColors(pal);
  const light = (role) => materialImage(MATERIAL_ICONS[role], colors.light);
  const dark = (role) => materialImage(MATERIAL_ICONS[role], colors.dark);
  const lightFilled = (role) => materialImage(MATERIAL_ICONS_FILLED[role], colors.light);
  const darkFilled = (role) => materialImage(MATERIAL_ICONS_FILLED[role], colors.dark);
  // Boutons ajoutes par l extension (palette, coeur) : leur SVG en ligne est
  // remplace par l icone du meme jeu, dessinee en fond d un ::before.
  const rail = `.material-rail-btn > svg {
  display: none !important;
}
.material-rail-btn::before {
  content: "";
  inline-size: 20px;
  block-size: 20px;
  background: var(--material-rail-icon) center / 20px no-repeat;
}
#material-theme-settings-btn { --material-rail-icon: ${lightFilled("palette")}; }
.material-rail-sponsor { --material-rail-icon: ${lightFilled("heart")}; }
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) #material-theme-settings-btn { --material-rail-icon: ${darkFilled("palette")}; }
  :root:not([lwt-theme-brighttext="false"]) .material-rail-sponsor { --material-rail-icon: ${darkFilled("heart")}; }
}
:root[lwt-theme-brighttext="true"] #material-theme-settings-btn { --material-rail-icon: ${darkFilled("palette")}; }
:root[lwt-theme-brighttext="true"] .material-rail-sponsor { --material-rail-icon: ${darkFilled("heart")}; }
`;
  return "/* Icones modernes */\n" +
    iconRulesCss(light, "", lightFilled) +
    "@media (prefers-color-scheme: dark) {\n" +
    iconRulesCss(dark, ':root:not([lwt-theme-brighttext="false"]) ', darkFilled) +
    "}\n" +
    iconRulesCss(dark, ':root[lwt-theme-brighttext="true"] ', darkFilled) +
    rail;
}

function iconThemeCss(settings, pal) {
  if (settings.iconTheme === "emoji") return emojiCss();
  if (settings.iconTheme === "modern") return modernIconCss(pal);
  return "";
}

/**
 * :root:root ajoute une classe de specificite : a importance egale, ces regles
 * l emportent ainsi sur celles de chrome/tokens/ quel que soit l ordre des
 * feuilles.
 */
function generateCustomizerCss(settings) {
  const pal = PALETTES_CONFIG[settings.palette] || PALETTES_CONFIG.blue;
  const body = paletteCss(pal).replace(/:root/g, ":root:root") + "\n" +
    iconThemeCss(settings, pal);
  return `@-moz-document ${CHROME_DOCUMENTS} {\n${body}\n}\n`;
}

/**
 * Les anciennes versions ecrivaient la personnalisation dans
 * chrome/user-overrides.css, lu par userChrome.css au demarrage seulement : ce
 * fichier continuait d imposer d anciens reglages, que la fenetre de
 * personnalisation ne pouvait plus defaire. Un fichier qu elles ont genere est
 * vide ; un fichier ecrit a la main est laisse tel quel.
 */
function neutralizeGeneratedOverrides() {
  try {
    const file = Services.dirsvc.get("ProfD", Ci.nsIFile);
    file.append("chrome");
    file.append("user-overrides.css");
    if (!file.exists()) return;
    const text = readExtensionFile(Services.io.newFileURI(file).spec);
    if (!/^\s*\/\*\*\s*\n\s*\* Personnalisation Material-Thunderbird \(g[eé]n[eé]r[eé] automatiquement\)/i.test(text)) return;
    const fos = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    fos.init(file, 0x02 | 0x08 | 0x20, 0o644, 0);
    const cos = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
    cos.init(fos, "UTF-8", 0, 0);
    cos.writeString("/* Personnalisation Material-Thunderbird : desormais geree depuis Thunderbird (Alt+M). */\n");
    cos.close();
    fos.close();
  } catch (e) {
    console.error("[Material-Thunderbird] user-overrides.css non nettoye :", e);
  }
}

/**
 * Les versions 1.0.x posaient leur personnalisation dans un <style> de chaque
 * document, et leur theme comme feuille d auteur. Thunderbird garde ces ajouts
 * jusqu a son redemarrage, meme apres la mise a jour de l extension : une feuille
 * d auteur l emporte sur une feuille utilisateur, et l ancienne couleur restait
 * affichee. On les retire en passant.
 */
function removeLegacyDocumentStyles(doc, extension) {
  try {
    const live = doc.getElementById("material-live-customizer");
    if (live) live.remove();
    if (doc.documentElement) {
      doc.documentElement.removeAttribute("data-material-emojis");
      doc.documentElement.classList.remove("material-emojis-active");
    }
    const utils = doc.defaultView && doc.defaultView.windowUtils;
    if (utils) {
      utils.removeSheetUsingURIString(extension.rootURI.resolve("material-theme.css"), utils.AUTHOR_SHEET);
    }
  } catch (e) {}
}

/* ==========================================================================
   Reponses deja lues masquees dans les fils
   ==========================================================================

   Dans un long fil qui recoit un nouveau message, il fallait faire defiler
   toutes les reponses deja lues pour atteindre la nouvelle. Elles sont donc
   masquees : le fil deplie montre son premier message et ses reponses non
   lues, et un bouton dans la carte du fil affiche les autres.

   Le masquage se fait dans la vue de Thunderbird, pas dans la page. La liste
   des messages est virtualisee (tree-view.mjs : chaque ligne a index *
   ROW_HEIGHT, espaceurs calcules sur le nombre de lignes) : une ligne retiree
   ou ajoutee a la main decalait tout, d ou la zone vide et les cartes rognees
   des versions precedentes. On ajoute plutot un critere de recherche a la vue,
   comme le fait la vue "Non lus" de Thunderbird : il reconstruit sa liste avec
   les seuls messages retenus, et tout reste coherent (defilement, selection,
   clavier, compteurs).
*/
const PREF_HIDE_READ_REPLIES = "extensions.material-thunderbird.hide-read-replies";
// Thunderbird garde un critere enregistre jusqu a son redemarrage, sans moyen
// de le retirer. Le critere ne fait donc qu appeler l implementation courante,
// que chaque version de l extension remplace (voir registerReadRepliesTerm).
// Le suffixe change si l objet enregistre change de forme ; le prefixe sert a
// reconnaitre, et retirer des vues, les criteres des versions precedentes.
const READ_REPLIES_TERM_PREFIX = "material-you-thunderbird@vforiel#hideReadReplies";
const READ_REPLIES_TERM_ID = READ_REPLIES_TERM_PREFIX + ".2";

// Surplus de hauteur des cartes du theme sur celles de Thunderbird, et part de
// la ligne qui n est pas la carte : rembourrage de la cellule (2 + 2 px) et
// marges de la carte (3 + 3 px). Doivent rester accordes a thread-tree.css.
const MATERIAL_CARD_EXTRA = 20;
const MATERIAL_CARD_FRAME = 10;

// Fils dont l utilisateur a demande toutes les reponses, le temps de la session.
const threadsShowingAll = new Set();
// Faux apres l arret de l extension : le critere, qu on ne peut pas desinscrire,
// laisse alors tout passer.
let readRepliesFilterLive = false;

function readRepliesHidingEnabled() {
  try { return Services.prefs.getBoolPref(PREF_HIDE_READ_REPLIES, true); } catch (e) { return true; }
}

function threadKeyOf(hdr) {
  return hdr.folder.URI + "#" + hdr.threadId;
}

function isReadRepliesTerm(term) {
  return term && term.attrib == Ci.nsMsgSearchAttrib.Custom &&
    typeof term.customId === "string" && term.customId.startsWith(READ_REPLIES_TERM_PREFIX);
}

// Vrai = le message reste affiche.
function readRepliesMatch(hdr) {
  if (!readRepliesFilterLive) return true;
  try {
    if (!hdr.isRead) return true;
    const thread = hdr.folder.msgDatabase.getThreadContainingMsgHdr(hdr);
    if (!thread || thread.numUnreadChildren == 0) return true;
    const root = thread.getRootHdr();
    if (!root || root.messageKey == hdr.messageKey) return true;
    return threadsShowingAll.has(threadKeyOf(root));
  } catch (e) {
    return true;
  }
}

function registerReadRepliesTerm() {
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const existing = MailServices.filters.getCustomTerm(READ_REPLIES_TERM_ID);
  if (existing) {
    // Enregistre par une version precedente, dans la meme session.
    const impl = existing.wrappedJSObject;
    if (impl) impl.matchImpl = readRepliesMatch;
    return;
  }
  MailServices.filters.addCustomTerm({
    id: READ_REPLIES_TERM_ID,
    name: "Material-Thunderbird : reponses deja lues",
    needsBody: false,
    matchImpl: readRepliesMatch,
    get wrappedJSObject() { return this; },
    getEnabled: () => true,
    getAvailable: () => true,
    getAvailableOperators: () => [Ci.nsMsgSearchOp.Is],
    match(hdr) {
      try { return this.matchImpl(hdr); } catch (e) { return true; }
    }
  });
}

function makeReadRepliesTerm(session) {
  const term = session.createTerm();
  term.attrib = Ci.nsMsgSearchAttrib.Custom;
  term.customId = READ_REPLIES_TERM_ID;
  term.op = Ci.nsMsgSearchOp.Is;
  const value = term.value;
  value.attrib = Ci.nsMsgSearchAttrib.Custom;
  value.str = "1";
  term.value = value;
  term.booleanAnd = true;
  return term;
}

/**
 * Le critere ne vaut que pour une vue en fils, d un vrai dossier, sans autre
 * vue active ("Non lus", etiquettes...). En liste a plat, il masquerait des
 * messages lus sans raison visible ; "Grouper par tri" et les fils non lus
 * utilisent d autres vues, que tout critere de recherche remplacerait.
 */
function shouldHideReadReplies(wrapper) {
  try {
    return readRepliesFilterLive && readRepliesHidingEnabled() &&
      wrapper.isSingleFolder && !wrapper.isVirtual && !wrapper.isSynthetic &&
      wrapper.showThreaded && !wrapper.showGroupedBySort &&
      !wrapper.specialViewThreadsWithUnread && !wrapper.specialViewWatchedThreadsWithUnread &&
      wrapper._mailViewIndex === 0;
  } catch (e) {
    return false;
  }
}

/**
 * Pose ou retire le critere dans les termes de vue, juste avant que
 * Thunderbird reconstruise la vue. Ecrit _viewTerms plutot que le setter, qui
 * relancerait lui-meme une reconstruction.
 */
function syncReadRepliesTerm(wrapper) {
  const search = wrapper.search;
  if (!search) return;
  const current = search._viewTerms || [];
  const others = current.filter((t) => !isReadRepliesTerm(t));
  const want = others.length === 0 && shouldHideReadReplies(wrapper);
  if (want) {
    if (current.length !== 1 || !isReadRepliesTerm(current[0])) {
      search._viewTerms = search._groupifyTerms([makeReadRepliesTerm(search.session)]);
    }
  } else if (others.length !== current.length) {
    search._viewTerms = others.length ? others : null;
  }
}

function hasReadRepliesTerm(wrapper) {
  try { return (wrapper.search._viewTerms || []).some(isReadRepliesTerm); } catch (e) { return false; }
}

const styleSheetService = Cc["@mozilla.org/content/style-sheet-service;1"]
  .getService(Ci.nsIStyleSheetService);

function registerUserSheet(url) {
  const uri = Services.io.newURI(url);
  if (!styleSheetService.sheetRegistered(uri, styleSheetService.USER_SHEET)) {
    styleSheetService.loadAndRegisterSheet(uri, styleSheetService.USER_SHEET);
  }
  return uri;
}

function unregisterUserSheet(uri) {
  if (uri && styleSheetService.sheetRegistered(uri, styleSheetService.USER_SHEET)) {
    styleSheetService.unregisterSheet(uri, styleSheetService.USER_SHEET);
  }
}

// Fast 32-bit FNV-1a string hash
function hashString(str) {
  if (!str) return 0;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Recherche Gravatar : desactivee par defaut.
 *
 * Interroger gravatar.com revient a transmettre a un tiers, pour chaque message
 * ouvert, une empreinte de l adresse de votre correspondant et le moment ou vous
 * lisez son courrier. L empreinte est triviale a inverser pour une adresse connue.
 * Cette fonctionnalite reste donc explicitement opt-in :
 *
 *   about:config > extensions.material-thunderbird.gravatar.enabled = true
 *
 * Sans elle, les avatars retombent sur la photo du carnet d adresses puis sur
 * l initiale coloree, sans aucune requete reseau.
 */
const GRAVATAR_PREF = "extensions.material-thunderbird.gravatar.enabled";

function isGravatarEnabled() {
  try {
    return Services.prefs.getBoolPref(GRAVATAR_PREF, false);
  } catch (e) {
    return false;
  }
}

// SHA-256 via la pile cryptographique de la plateforme. Remplace une implementation
// manuelle de 45 lignes qui traitait par ailleurs mal les adresses non ASCII.
function sha256Hex(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
    hasher.init(Ci.nsICryptoHash.SHA256);
    hasher.update(bytes, bytes.length);
    const digest = hasher.finish(false);
    let hex = "";
    for (let i = 0; i < digest.length; i++) {
      hex += ("0" + digest.charCodeAt(i).toString(16)).slice(-2);
    }
    return hex;
  } catch (e) {
    return null;
  }
}

// Cache en memoire : email -> { found: boolean, url: string }
const gravatarCache = new Map();
const pendingGravatarCallbacks = new Map();

function checkGravatar(win, cleanEmail, onResolved) {
  if (!cleanEmail || !win) return;
  if (!isGravatarEnabled()) return;

  if (gravatarCache.has(cleanEmail)) {
    const cached = gravatarCache.get(cleanEmail);
    if (cached && cached.found && onResolved) {
      onResolved(cached.url);
    }
    return;
  }
  if (pendingGravatarCallbacks.has(cleanEmail)) {
    if (onResolved) pendingGravatarCallbacks.get(cleanEmail).push(onResolved);
    return;
  }

  const hash = sha256Hex(cleanEmail);
  if (!hash) {
    gravatarCache.set(cleanEmail, { found: false, url: null });
    return;
  }

  pendingGravatarCallbacks.set(cleanEmail, onResolved ? [onResolved] : []);
  const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=80`;

  const settle = (found) => {
    gravatarCache.set(cleanEmail, { found, url: found ? gravatarUrl : null });
    const cbs = pendingGravatarCallbacks.get(cleanEmail) || [];
    pendingGravatarCallbacks.delete(cleanEmail);
    if (found) {
      cbs.forEach((cb) => { try { cb(gravatarUrl); } catch (e) {} });
    }
  };

  try {
    // Image doit provenir de la fenetre : le global de experiment ne le definit pas.
    const img = new win.Image();
    const timer = win.setTimeout(() => {
      img.onload = img.onerror = null;
      settle(false);
    }, 2500);
    img.onload = () => { win.clearTimeout(timer); settle(true); };
    img.onerror = () => { win.clearTimeout(timer); settle(false); };
    img.src = gravatarUrl;
  } catch (e) {
    settle(false);
  }
}

/**
 * Logos des marques (BIMI, Brand Indicators for Message Identification)
 *
 * C est ce que Gmail affiche a la place de l initiale pour Revolut, Doctolib ou
 * les banques : le domaine publie dans son DNS un enregistrement
 *   default._bimi.<domaine>  TXT  "v=BIMI1; l=https://.../logo.svg; a=..."
 * qui donne l adresse de son logo. Gmail exige en plus un certificat (VMC) ;
 * ici, la garantie retenue est celle sur laquelle BIMI repose : le domaine doit
 * appliquer DMARC en mode strict (p=quarantine ou p=reject), si bien qu un
 * courriel usurpant ce domaine est refuse ou classe en indesirable par le
 * serveur de reception avant d arriver ici.
 *
 * Reseau : une requete DNS par domaine d expediteur, puis le telechargement du
 * logo depuis le serveur de la marque. Aucune donnee sur le destinataire ni sur
 * le message n est envoyee, et les resultats sont gardes 7 jours (1 jour pour
 * une absence). Si le resolveur du systeme ne sait pas repondre aux requetes
 * TXT, la recherche passe par le DNS sur HTTPS de Cloudflare, comme le fait
 * Firefox en mode DoH.
 */
const PREF_BRAND_LOGOS = "extensions.material-thunderbird.brand-logos";
const PREF_BRAND_CACHE = "extensions.material-thunderbird.brand-logo-cache-v5";
// Remplis de fausses absences (resolveur natif sans TXT, puis CSP) : oublies.
const PREF_BRAND_CACHE_OLD = "extensions.material-thunderbird.brand-logo-cache";
const PREF_BRAND_CACHE_OLD2 = "extensions.material-thunderbird.brand-logo-cache-v4";
const BRAND_TTL_FOUND = 7 * 24 * 3600 * 1000;
const BRAND_TTL_MISSING = 24 * 3600 * 1000;
const BRAND_CACHE_MAX = 400;
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

function areBrandLogosEnabled() {
  try { return Services.prefs.getBoolPref(PREF_BRAND_LOGOS, true); } catch (e) { return true; }
}

// domaine -> { u: url du logo ou "", t: date }
let brandCache = null;
function loadBrandCache() {
  if (brandCache) return brandCache;
  brandCache = new Map();
  try { Services.prefs.clearUserPref(PREF_BRAND_CACHE_OLD); } catch (e) {}
  try { Services.prefs.clearUserPref(PREF_BRAND_CACHE_OLD2); } catch (e) {}
  try {
    const stored = JSON.parse(Services.prefs.getStringPref(PREF_BRAND_CACHE, "{}"));
    for (const [domain, entry] of Object.entries(stored || {})) {
      if (entry && typeof entry.t === "number") brandCache.set(domain, entry);
    }
  } catch (e) {}
  return brandCache;
}

function saveBrandCache() {
  const entries = Array.from(loadBrandCache().entries())
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, BRAND_CACHE_MAX);
  try { Services.prefs.setStringPref(PREF_BRAND_CACHE, JSON.stringify(Object.fromEntries(entries))); } catch (e) {}
}

function freshBrandEntry(domain) {
  const entry = loadBrandCache().get(domain);
  if (!entry) return null;
  const ttl = entry.u ? BRAND_TTL_FOUND : BRAND_TTL_MISSING;
  return Date.now() - entry.t < ttl ? entry : null;
}

/**
 * Domaine organisationnel approche : les deux derniers labels, ou trois pour les
 * suffixes du type co.uk, com.au, gouv.fr. Sans liste publique des suffixes,
 * c est une approximation suffisante pour un second essai.
 */
function organizationalDomain(domain) {
  const labels = domain.split(".");
  if (labels.length <= 2) return domain;
  const second = labels[labels.length - 2];
  const short = labels[labels.length - 1].length === 2 &&
    /^(?:co|com|org|net|gov|gouv|ac|edu|ne|or)$/.test(second);
  return labels.slice(short ? -3 : -2).join(".");
}

// Requete TXT par le resolveur de la plateforme. Resout en tableau de chaines,
// en [] si le nom n existe pas, en null si ce type de requete est indisponible.
function nativeTxtLookup(name) {
  return new Promise((resolve) => {
    let dns;
    try {
      dns = Cc["@mozilla.org/network/dns-service;1"].getService(Ci.nsIDNSService);
    } catch (e) {
      resolve(null);
      return;
    }
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIDNSListener"]),
      onLookupComplete(request, record, status) {
        if (!Components.isSuccessCode(status)) {
          // NS_ERROR_UNKNOWN_HOST : le nom n existe pas, c est une reponse.
          const results = typeof Cr !== "undefined" ? Cr : Components.results;
          resolve(status === results.NS_ERROR_UNKNOWN_HOST ? [] : null);
          return;
        }
        try {
          const txt = record.QueryInterface(Ci.nsIDNSTXTRecord);
          resolve(txt.getRecords());
        } catch (e) {
          resolve(null);
        }
      }
    };
    try {
      dns.asyncResolve(name, Ci.nsIDNSService.RESOLVE_TYPE_TXT, 0, null, listener,
                       Services.tm.mainThread, {});
    } catch (e) {
      resolve(null);
    }
  });
}

// Repli : DNS sur HTTPS (format JSON), sans cookie.
async function dohTxtLookup(win, name) {
  try {
    // about:message et about:3pane interdisent toute connexion par leur CSP
    // (default-src chrome:) : la requete part de la fenetre principale.
    const host = Services.wm.getMostRecentWindow("mail:3pane") || win.top || win;
    const response = await host.fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: "application/dns-json" },
      credentials: "omit"
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.Answer || [])
      .filter((a) => a.type === 16 && typeof a.data === "string")
      .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch (e) {
    return [];
  }
}

/**
 * Sans DNS sur HTTPS active, le resolveur de Gecko ne sait pas faire de requete
 * TXT : il repond NS_ERROR_UNKNOWN_HOST meme pour un nom qui existe, ce qui
 * ressemble a "pas de logo". Un premier essai sur un nom qui a toujours des
 * enregistrements TXT dit si le resolveur natif est utilisable ; sinon toutes
 * les recherches passent par le DNS sur HTTPS.
 */
let nativeTxtWorks = null;
async function txtLookup(win, name) {
  if (nativeTxtWorks === null) {
    const probe = await nativeTxtLookup("google.com");
    nativeTxtWorks = Array.isArray(probe) && probe.length > 0;
  }
  if (nativeTxtWorks) {
    const records = await nativeTxtLookup(name);
    if (records !== null) return records;
  }
  return dohTxtLookup(win, name);
}

// Premier enregistrement qui commence par le prefixe voulu.
function findRecord(records, prefix) {
  return (records || []).map((r) => String(r).trim()).find((r) => r.toLowerCase().startsWith(prefix)) || "";
}

async function strictDmarc(win, domain) {
  for (const candidate of [domain, organizationalDomain(domain)]) {
    const record = findRecord(await txtLookup(win, `_dmarc.${candidate}`), "v=dmarc1");
    if (record) {
      const policy = /(?:^|;)\s*p\s*=\s*(\w+)/i.exec(record);
      const pct = /(?:^|;)\s*pct\s*=\s*(\d+)/i.exec(record);
      return !!policy && /^(?:quarantine|reject)$/i.test(policy[1]) && (!pct || Number(pct[1]) === 100);
    }
    if (candidate === organizationalDomain(domain)) break;
  }
  return false;
}

async function lookupBrandLogo(win, domain) {
  const candidates = [domain];
  const org = organizationalDomain(domain);
  if (org !== domain) candidates.push(org);
  let logo = "";
  for (const candidate of candidates) {
    const record = findRecord(await txtLookup(win, `default._bimi.${candidate}`), "v=bimi1");
    if (!record) continue;
    const location = /(?:^|;)\s*l\s*=\s*([^;\s]*)/i.exec(record);
    // l= vide : le domaine declare explicitement ne pas avoir de logo.
    logo = location && /^https:\/\/[^\s"<>]+$/i.test(location[1]) ? location[1] : "";
    break;
  }
  if (!logo) return "";
  return (await strictDmarc(win, domain)) ? logo : "";
}

const pendingBrandCallbacks = new Map();

// domaine -> logo en data:, pour la session. about:message et about:3pane
// n acceptent que les images chrome:, moz-icon: et data: (CSP) : le SVG est
// telecharge par la fenetre principale puis transmis en data:. Il n est pas
// garde dans les preferences, seule son adresse l est.
const brandDataUris = new Map();
const BRAND_LOGO_MAX_BYTES = 64 * 1024;

async function fetchBrandLogo(win, url) {
  const host = Services.wm.getMostRecentWindow("mail:3pane") || win.top || win;
  const response = await host.fetch(url, { credentials: "omit" });
  if (!response.ok) return "";
  const text = await response.text();
  // Un logo BIMI est un SVG (profil SVG Tiny PS) : tout le reste est refuse.
  if (text.length > BRAND_LOGO_MAX_BYTES || !/<svg[\s>]/i.test(text)) return "";
  // Encodage d URL plutot que base64 : ni TextEncoder ni btoa ne sont surs
  // dans le bac a sable de l experiment.
  // Un logo transparent laissait voir la couleur pastel de l avatar : il est
  // pose sur un fond blanc, comme dans Gmail.
  const logo = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
  const framed = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#ffffff"/>' +
    '<image width="100" height="100" href="' + logo + '" xlink:href="' + logo + '"/></svg>';
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(framed);
}

/**
 * Cherche le logo de la marque du domaine de cleanEmail. onResolved(dataUri) est
 * appele si un logo est trouve et se charge ; onMissing() sinon, pour passer a
 * la source suivante (Gravatar).
 */
function checkBrandLogo(win, cleanEmail, onResolved, onMissing) {
  const domain = (cleanEmail.split("@")[1] || "").toLowerCase();
  if (!win || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !areBrandLogosEnabled()) {
    onMissing();
    return;
  }
  if (brandDataUris.has(domain)) {
    onResolved(brandDataUris.get(domain));
    return;
  }
  const cached = freshBrandEntry(domain);
  if (cached && !cached.u) {
    onMissing();
    return;
  }
  if (pendingBrandCallbacks.has(domain)) {
    pendingBrandCallbacks.get(domain).push([onResolved, onMissing]);
    return;
  }
  pendingBrandCallbacks.set(domain, [[onResolved, onMissing]]);

  const settle = (url, dataUri) => {
    loadBrandCache().set(domain, { u: dataUri ? url : "", t: Date.now() });
    saveBrandCache();
    if (dataUri) brandDataUris.set(domain, dataUri);
    const callbacks = pendingBrandCallbacks.get(domain) || [];
    pendingBrandCallbacks.delete(domain);
    for (const [ok, missing] of callbacks) {
      try { if (dataUri) ok(dataUri); else missing(); } catch (e) {}
    }
  };

  // Adresse deja connue : seul le telechargement du logo est a refaire.
  const known = cached && cached.u ? Promise.resolve(cached.u) : lookupBrandLogo(win, domain);
  known
    .then((url) => (url ? fetchBrandLogo(win, url).then((data) => settle(url, data)) : settle("", "")))
    .catch((err) => {
      console.warn("[Material-Thunderbird] Logo de marque indisponible pour " + domain + " : " + err);
      settle("", "");
    });
}

/**
 * Valeur synchrone pour un premier rendu : le logo s il est deja en memoire,
 * "" si le domaine n en a pas, null s il reste a le chercher ou a le telecharger.
 */
function cachedBrandLogo(cleanEmail) {
  const domain = (cleanEmail.split("@")[1] || "").toLowerCase();
  if (!domain || !areBrandLogosEnabled()) return "";
  if (brandDataUris.has(domain)) return brandDataUris.get(domain);
  const entry = freshBrandEntry(domain);
  return entry && !entry.u ? "" : null;
}

// Normalize initial letter (removes quotes, accents, brackets)
function getInitialLetter(nameOrEmail) {
  if (!nameOrEmail) return "?";
  let cleaned = nameOrEmail.replace(/^["'<\s]+/, "").trim();
  if (!cleaned) return "?";
  
  let normalized = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let firstChar = normalized.charAt(0).toUpperCase();
  if (/[A-Z0-9]/.test(firstChar)) {
    return firstChar;
  }
  return "?";
}

// Parse a raw sender/recipient string into { displayName, email }
function parseNameAndEmail(raw) {
  if (!raw) return { displayName: "", email: "" };
  const str = String(raw).trim();
  
  const match = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const displayName = match[1].replace(/^["']+|["']+$/g, "").trim();
    const email = match[2].trim();
    return { displayName, email };
  }
  
  // Texte d interface ou chaine composite : la premiere adresse trouvee.
  const inner = str.match(/<([^<>\s]+@[^<>\s]+)>/) || str.match(/([^\s<>"']+@[^\s<>"']+\.[a-z]{2,})/i);
  if (inner) {
    const displayName = str.slice(0, str.indexOf(inner[0])).replace(/^["'\s]+|["'\s]+$/g, "");
    return { displayName, email: inner[1].trim() };
  }

  return { displayName: str, email: "" };
}

/**
 * Resolution unifiee des avatars
 * Priorite 1 : photo du carnet d adresses (card.photoURL)
 * Priorite 2 : logo de la marque (BIMI), active par defaut (voir PREF_BRAND_LOGOS)
 * Priorite 3 : Gravatar, uniquement si l utilisateur l a active (voir GRAVATAR_PREF)
 * Priorite 4 : initiale du contact enregistre (card.displayName || displayName)
 * Priorite 5 : initiale de l adresse courriel (cleanEmail)
 * Les sources 2 et 3 sont asynchrones : l initiale s affiche d abord, puis
 * onGravatarResolved(url) remplace l image quand l une d elles repond. La
 * suivante n est interrogee que si la precedente n a rien donne.
 * La couleur de fond derive de l empreinte de cleanEmail : elle reste identique
 * partout dans l interface pour un meme correspondant.
 */
function resolveAvatarInfo(win, rawString, onGravatarResolved) {
  const { displayName, email } = parseNameAndEmail(rawString);
  const cleanEmail = (email || "").trim().toLowerCase();

  // Background and text color is derived strictly from normalized email (or displayName fallback)
  const colorKey = cleanEmail || (displayName || "").toLowerCase();
  const hash = hashString(colorKey);
  const palette = M3_AVATAR_PALETTES[hash % M3_AVATAR_PALETTES.length];

  // 1. Priority 1: Address Book contact photo
  let card = null;
  if (cleanEmail && typeof MailServices !== "undefined" && MailServices?.ab) {
    try {
      card = MailServices.ab.cardForEmailAddress(cleanEmail);
    } catch (e) {}
  }
  if (card && card.photoURL) {
    return {
      type: "img",
      url: card.photoURL,
      char: "",
      bg: palette.bg,
      fg: palette.fg,
      cleanEmail
    };
  }

  // 2. et 3. Logo de la marque, puis Gravatar
  if (cleanEmail) {
    const image = (url) => ({ type: "img", url, char: "", bg: palette.bg, fg: palette.fg, cleanEmail });
    const brand = cachedBrandLogo(cleanEmail);
    if (brand) return image(brand);
    const g = gravatarCache.get(cleanEmail);
    if (brand === "" && g && g.found) return image(g.url);
    if (brand === null) {
      checkBrandLogo(win, cleanEmail, onGravatarResolved,
                     () => checkGravatar(win, cleanEmail, onGravatarResolved));
    } else if (!gravatarCache.has(cleanEmail)) {
      checkGravatar(win, cleanEmail, onGravatarResolved);
    }
  }

  // 4. Priority 4: First letter of the saved contact name
  const contactName = (card && card.displayName) ? card.displayName : displayName;
  if (contactName && contactName.trim()) {
    const letter = getInitialLetter(contactName);
    return {
      type: "char",
      url: null,
      char: letter,
      bg: palette.bg,
      fg: palette.fg,
      cleanEmail
    };
  }

  // 5. Priority 5: First letter of the email address
  if (cleanEmail) {
    const letter = getInitialLetter(cleanEmail);
    return {
      type: "char",
      url: null,
      char: letter,
      bg: palette.bg,
      fg: palette.fg,
      cleanEmail
    };
  }

  return {
    type: "char",
    url: null,
    char: "?",
    bg: palette.bg,
    fg: palette.fg,
    cleanEmail
  };
}

/**
 * Regles partagees avec background.js et le script de message. La detection est
 * faite par background.js ; ce qui sert ici est isSafeUrl, aux deux derniers
 * points avant qu une URL venue d un courriel n atteigne l interface : juste
 * avant d afficher le bouton, et juste avant de naviguer. Sans les regles,
 * aucune URL n est acceptee et le bandeau reste simplement absent.
 */
var UnsubscribeRules = null;

function readExtensionFile(url) {
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
  const channel = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true });
  const stream = channel.open();
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), { charset: "UTF-8" });
  } finally {
    stream.close();
  }
}

/**
 * Remplace le contenu de target par un balisage XHTML.
 *
 * Dans une fenetre de Thunderbird, innerHTML passe par un nettoyeur qui retire
 * <button>, aplatit <input> et ote l attribut xmlns des <svg> ("Removing unsafe
 * node") : la fenetre de personnalisation s ouvrait sans aucun de ses boutons.
 * Un document analyse a part par DOMParser n est pas nettoye, et importNode en
 * recopie les noeuds tels quels.
 */
function setMarkup(target, markup) {
  const doc = target.ownerDocument;
  const parsed = new doc.defaultView.DOMParser().parseFromString(
    `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>`,
    "application/xhtml+xml"
  );
  const root = parsed.documentElement;
  if (root.localName === "parsererror") {
    throw new Error("Balisage XHTML invalide : " + root.textContent);
  }
  target.replaceChildren(...Array.from(root.childNodes, (n) => doc.importNode(n, true)));
}

// --- Choix de l utilisateur sur le bandeau de desinscription ---------------

function readJsonPref(name, fallback) {
  try {
    const value = JSON.parse(Services.prefs.getStringPref(name, ""));
    return Array.isArray(value) ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJsonPref(name, value) {
  try { Services.prefs.setStringPref(name, JSON.stringify(value)); } catch (e) {}
}

function unsubscribeBannerEnabled() {
  try { return Services.prefs.getBoolPref(PREF_UNSUB_ENABLED, true); } catch (e) { return true; }
}

// [{ key, label, reason: "ignored" | "unsubscribed", date }]
function unsubscribeIgnoredList() {
  return readJsonPref(PREF_UNSUB_IGNORED, []).filter((item) => item && typeof item.key === "string");
}

function isUnsubscribeKeyIgnored(key) {
  return !!key && unsubscribeIgnoredList().some((item) => item.key === key);
}

function ignoreUnsubscribeKey(key, label, reason) {
  if (!key || key === "from:" || key === "list:") return;
  const list = unsubscribeIgnoredList().filter((item) => item.key !== key);
  list.unshift({ key, label: String(label || "").slice(0, 120), reason, date: Date.now() });
  writeJsonPref(PREF_UNSUB_IGNORED, list);
}

function forgetUnsubscribeKey(key) {
  writeJsonPref(PREF_UNSUB_IGNORED, unsubscribeIgnoredList().filter((item) => item.key !== key));
}

function isUnsubscribeHiddenForMessage(messageId) {
  return !!messageId && readJsonPref(PREF_UNSUB_HIDDEN, []).includes(messageId);
}

// Les plus anciens sortent de la liste : elle reste bornee.
function hideUnsubscribeForMessage(messageId) {
  if (!messageId) return;
  const list = readJsonPref(PREF_UNSUB_HIDDEN, []).filter((id) => id !== messageId);
  list.unshift(messageId);
  writeJsonPref(PREF_UNSUB_HIDDEN, list.slice(0, UNSUB_HIDDEN_MAX));
}

// "Nom" <adresse> -> Nom ; adresse seule -> adresse.
function displayNameOf(raw) {
  const text = String(raw || "").trim();
  const name = text.replace(/<[^>]*>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (name) return name;
  const angle = /<([^>]+)>/.exec(text);
  return angle ? angle[1].trim() : text;
}

function isSafeMailto(value) {
  return typeof value === "string" && /^mailto:[^@\s?<>"]+@[^@\s?<>"]+(?:\?[^\s<>"]*)?$/i.test(value.trim());
}

function loadUnsubscribeRules(extension) {
  if (UnsubscribeRules) return UnsubscribeRules;
  try {
    // loadSubScript refuse les URL jar: d une extension ("Trying to load
    // untrusted URL") : sans regles, aucune URL n etait acceptee et le bandeau
    // ne s affichait jamais. Le fichier est donc lu puis evalue dans un bac a
    // sable, comme le ferait loadSubScript.
    const url = extension.rootURI.resolve("shared/unsubscribe-rules.js");
    const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), { freshZone: true });
    Cu.evalInSandbox(readExtensionFile(url), sandbox, "latest", url, 1);
    UnsubscribeRules = sandbox.MaterialUnsubscribeRules || null;
  } catch (e) {
    console.error("[Material-Thunderbird] Chargement des regles impossible : " + e);
    UnsubscribeRules = null;
  }
  return UnsubscribeRules;
}

this.materialAssistant = class extends ExtensionCommon.ExtensionAPI {
  /**
   * Le theme est une feuille de style utilisateur enregistree pour toute
   * l application, comme le faisait userChrome.css : le .xpi suffit, sans
   * script d installation ni preference toolkit.legacyUserProfileCustomizations.
   * La feuille est enveloppee par build.ps1 dans @-moz-document, qui la
   * restreint aux documents de l interface.
   */
  onStartup() {
    loadUnsubscribeRules(this.extension);
    neutralizeGeneratedOverrides();
    try {
      this._themeSheet = registerUserSheet(this.extension.rootURI.resolve("material-theme.css"));
    } catch (e) {
      console.error("[Material-Thunderbird] Feuille de style du theme non chargee :", e);
    }
    this._applyCustomizerSheet();
    applyThemeModeOverride();
    this._installReadRepliesFilter();
    this._initWindows();
    this._windowListener = {
      onOpenWindow: (xulWin) => {
        const win = xulWin.docShell.domWindow;
        win.addEventListener("load", () => {
          if (win.document.documentElement.getAttribute("windowtype") === "mail:3pane") {
            this._setupWindow(win);
          }
        }, { once: true });
      },
      onCloseWindow: () => {},
      onWindowTitleChange: () => {}
    };
    Services.wm.addListener(this._windowListener);
  }

  /**
   * Desactivation, mise a jour ou desinstallation : tout ce qui a ete accroche aux
   * fenetres doit etre relache. Sans cela, les observateurs continuaient de tourner
   * et le bandeau restait affiche jusqu au prochain redemarrage, et la reactivation
   * de extension ne rebranchait rien puisque __materialWindowSetup restait pose.
   */
  onShutdown(isAppShutdown) {
    if (this._windowListener) {
      Services.wm.removeListener(this._windowListener);
      this._windowListener = null;
    }

    // Au redemarrage complet de application, la fenetre disparait de toute facon,
    // et le mode clair / sombre doit survivre jusqu au prochain demarrage.
    if (isAppShutdown) return;

    // Desactivation, desinstallation ou mise a jour : le theme se retire, et
    // Thunderbird retrouve le mode clair / sombre de Windows. onStartup le
    // repose apres une mise a jour.
    releaseThemeModeOverride();
    unregisterUserSheet(this._themeSheet);
    unregisterUserSheet(this._customizerSheet);
    this._uninstallReadRepliesFilter();
    this._themeSheet = null;
    this._customizerSheet = null;

    const windows = Services.wm.getEnumerator("mail:3pane");
    while (windows.hasMoreElements()) {
      this._teardownWindow(windows.getNext());
    }
  }

  _teardownWindow(win) {
    if (!win || !win.__materialWindowSetup) return;
    const state = win.__materialWindowState;
    win.__materialWindowSetup = false;
    win.__materialWindowState = null;
    if (!state) return;

    if (state.tabmail && state.tabMonitor) {
      try { state.tabmail.unregisterTabMonitor(state.tabMonitor); } catch (e) {}
    }

    for (const observer of state.observers) {
      try { observer.disconnect(); } catch (e) {}
    }
    // Les minuteurs appartiennent a la fenetre qui les a poses : about:message
    // a la sienne, et clearTimeout de la fenetre chrome ne les annulerait pas.
    for (const [timerWin, id] of state.timers) {
      try { timerWin.clearTimeout(id); } catch (e) {}
    }
    for (const [target, type, handler, capture] of state.listeners) {
      try { target.removeEventListener(type, handler, capture); } catch (e) {}
    }

    // Retire les elements injectes, dans chacun des sous-documents visites.
    try { this._removeUnsubscribeBanner(win); } catch (e) {}
    try { this._closeCustomizerModal(win); } catch (e) {}
    try {
      const customBtn = win.document && win.document.getElementById("material-theme-settings-btn");
      if (customBtn) customBtn.remove();
    } catch (e) {}
    try {
      const spBtn = win.document && win.document.getElementById("material-sponsor-btn");
      if (spBtn) spBtn.remove();
    } catch (e) {}
    try {
      const menuItem = win.document && win.document.getElementById("material-theme-tools-menuitem");
      if (menuItem) menuItem.remove();
    } catch (e) {}
    for (const doc of state.documents) {
      try {
        delete doc.__materialAbout3PaneSetup;
        delete doc.__materialAboutMessageSetup;
        delete doc.__materialMultimessageObserved;
        for (const row of doc.querySelectorAll("tr.material-thread-toggle-row")) {
          row.remove();
        }
        for (const chip of doc.querySelectorAll(".material-thread-reveal")) {
          chip.remove();
        }
        this._restoreCardRowHeight(doc.defaultView);
        this._restoreViewRefresh(doc.defaultView);
        for (const row of doc.querySelectorAll(".material-thread-read-hidden, .material-thread-read-dimmed")) {
          row.classList.remove("material-thread-read-hidden", "material-thread-read-dimmed");
        }
        for (const row of doc.querySelectorAll("[data-avatar-key]")) {
          delete row.dataset.avatarKey;
          row.classList.remove("avatar-loaded");
        }
      } catch (e) {}
    }
  }

  /**
   * Les vues des dossiers sont reconstruites par DBViewWrapper._applyViewChanges
   * (changement de dossier, d affichage, de tri, de vue). On s y glisse pour
   * poser ou retirer le critere : Thunderbird l applique alors comme les siens.
   */
  _installReadRepliesFilter() {
    try {
      registerReadRepliesTerm();
      readRepliesFilterLive = true;
      const { DBViewWrapper } = ChromeUtils.importESModule("resource:///modules/DBViewWrapper.sys.mjs");
      const proto = DBViewWrapper.prototype;
      if (!proto.__materialOriginalApplyViewChanges) {
        const original = proto._applyViewChanges;
        proto.__materialOriginalApplyViewChanges = original;
        proto._applyViewChanges = function (...args) {
          try { syncReadRepliesTerm(this); } catch (e) {
            console.error("[Material-Thunderbird] Filtre des reponses lues :", e);
          }
          return original.apply(this, args);
        };
      }
      this._refreshThreadViews();
    } catch (e) {
      console.error("[Material-Thunderbird] Masquage des reponses lues indisponible :", e);
    }
  }

  _uninstallReadRepliesFilter() {
    readRepliesFilterLive = false;
    try {
      const { DBViewWrapper } = ChromeUtils.importESModule("resource:///modules/DBViewWrapper.sys.mjs");
      const proto = DBViewWrapper.prototype;
      if (proto.__materialOriginalApplyViewChanges) {
        proto._applyViewChanges = proto.__materialOriginalApplyViewChanges;
        delete proto.__materialOriginalApplyViewChanges;
      }
    } catch (e) {}
    // Le critere reste pose dans les vues ouvertes : on le retire, ce qui les
    // reconstruit sans lui.
    for (const aboutWin of this._about3PaneWindows()) {
      try {
        const search = aboutWin.gViewWrapper.search;
        const current = search._viewTerms || [];
        const others = current.filter((t) => !isReadRepliesTerm(t));
        if (others.length !== current.length) search.viewTerms = others.length ? others : null;
      } catch (e) {}
    }
  }

  _about3PaneWindows() {
    const result = [];
    const windows = Services.wm.getEnumerator("mail:3pane");
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      const tabmail = win.document && win.document.getElementById("tabmail");
      if (!tabmail || !tabmail.tabInfo) continue;
      for (const tab of tabmail.tabInfo) {
        const aboutWin = tab.chromeBrowser && tab.chromeBrowser.contentWindow;
        if (aboutWin && aboutWin.gViewWrapper && aboutWin.gViewWrapper.displayedFolder) {
          result.push(aboutWin);
        }
      }
    }
    return result;
  }

  /** Reconstruit les vues dont l etat du critere n est plus le bon. */
  _refreshThreadViews() {
    for (const aboutWin of this._about3PaneWindows()) {
      try {
        const wrapper = aboutWin.gViewWrapper;
        if (shouldHideReadReplies(wrapper) !== hasReadRepliesTerm(wrapper)) {
          wrapper._applyViewChanges();
        }
      } catch (e) {
        console.error("[Material-Thunderbird] Vue non rafraichie :", e);
      }
    }
  }

  /**
   * Affiche (ou masque de nouveau) les reponses lues d un fil, puis rouvre ce
   * fil : la vue est reconstruite, ses fils repartent replies.
   */
  _setThreadShowsAll(aboutWin, rowIndex, showAll) {
    const dbView = aboutWin.gDBView;
    let root;
    try {
      root = dbView.getThreadContainingIndex(rowIndex).getRootHdr();
    } catch (e) {
      return;
    }
    const key = threadKeyOf(root);
    if (showAll) threadsShowingAll.add(key); else threadsShowingAll.delete(key);

    const wrapper = aboutWin.gViewWrapper;
    wrapper._applyViewChanges();

    // La recherche de la nouvelle vue est asynchrone, et quand elle se termine
    // (searching repasse a faux), about3Pane replie tous les fils d une vue
    // filtree. Le fil n est donc rouvert qu apres : rouvert plus tot, il etait
    // aussitot replie.
    const started = Date.now();
    const reopen = () => {
      if (wrapper.searching && Date.now() - started < 10000) {
        aboutWin.setTimeout(reopen, 100);
        return;
      }
      let index = -1;
      try { index = aboutWin.gDBView.findIndexOfMsgHdr(root, true); } catch (e) {}
      if (index < 0) return;
      try {
        if (!aboutWin.gDBView.isContainerOpen(index)) aboutWin.gDBView.toggleOpenState(index);
        // Le fil en haut de la liste : scrollToIndex se contente de le rendre
        // visible, souvent tout en bas, sous ses reponses hors de vue.
        const tree = aboutWin.document.getElementById("threadTree");
        const rowHeight = tree && tree._rowElementClass && tree._rowElementClass.ROW_HEIGHT;
        if (rowHeight) {
          tree.scrollTop = index * rowHeight;
        } else if (tree && typeof tree.scrollToIndex === "function") {
          tree.scrollToIndex(index);
        }
      } catch (e) {}
    };
    // Laisse a about3Pane le temps de traiter la fin de recherche.
    aboutWin.setTimeout(reopen, 250);
  }

  _initWindows() {
    const windows = Services.wm.getEnumerator("mail:3pane");
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      // Au demarrage de Thunderbird, la fenetre courrier est deja enumeree mais
      // pas encore chargee : tabmail et la barre des espaces n existent pas encore.
      if (win.document && win.document.readyState === "complete") {
        this._setupWindow(win);
      } else {
        win.addEventListener("load", () => this._setupWindow(win), { once: true });
      }
    }
  }

  /**
   * Depuis Supernova (115), la fenetre mail:3pane ne contient plus l interface
   * courrier : elle porte un tabmail, et chaque onglet courrier charge about:3pane
   * (liste des messages, #threadTree, #multiMessageBrowser) qui charge a son tour
   * about:message (#messageHeader, #expandedfromBox, #messagepane) -- trois
   * documents distincts.
   *
   * Tout ce qui suit cherchait ses elements dans le document de la fenetre, ou
   * aucun d eux n existe : les quatre points d accroche retournaient null et
   * aucune fonction de ce module ne s executait. Les avatars restaient des
   * cercles gris vides, le repli des fils lus ne se declenchait jamais, et le
   * bandeau de desinscription etait construit puis abandonne faute de point
   * d insertion. Le theme paraissait correct parce que userChrome.css, lui,
   * s applique bien a ces sous-documents.
   *
   * On passe donc par le tabmail, et on se raccroche a chaque changement
   * d onglet : chaque onglet courrier a ses propres documents.
   */
  _setupWindow(win) {
    if (!win || !win.document || win.__materialWindowSetup) return;
    win.__materialWindowSetup = true;

    // Tout ce qui est accroche ici est enregistre pour pouvoir etre relache dans
    // _teardownWindow. documents retient les sous-documents visites, dont les
    // elements injectes doivent eux aussi etre retires.
    const state = { observers: [], timers: [], listeners: [], documents: [] };
    win.__materialWindowState = state;
    removeLegacyDocumentStyles(win.document, this.extension);

    const tabmail = win.document.getElementById("tabmail");
    if (!tabmail) return;
    state.tabmail = tabmail;

    const monitor = {
      monitorName: "materialAssistant",
      onTabSwitched: () => {
        this._ensureCustomizerButtons(win);
        this._attachToCurrentTab(win);
      },
      onTabOpened: () => {
        this._ensureCustomizerButtons(win);
        this._attachToCurrentTab(win);
      },
      onTabRestored: () => {
        this._ensureCustomizerButtons(win);
        this._attachToCurrentTab(win);
      },
      // tabmail appelle onTabTitleChanged sans garde : la methode doit exister.
      onTabTitleChanged: () => {},
      onTabClosing: () => {},
      onTabPersist: () => null
    };
    tabmail.registerTabMonitor(monitor);
    state.tabMonitor = monitor;

    this._ensureCustomizerButtons(win);
    this._attachToCurrentTab(win);

    const onKeyDown = (e) => {
      // Alt+M, et Ctrl+Alt+M qui passe aussi par ce test (altKey vrai).
      if (e.altKey && (e.key === "m" || e.key === "M")) {
        e.preventDefault();
        this._openCustomizerModal(win);
      }
    };
    win.addEventListener("keydown", onKeyDown);
    state.listeners.push([win, "keydown", onKeyDown, false]);
  }

  _ensureCustomizerButtons(win) {
    if (!win || !win.document) return;
    const doc = win.document;
    const spaces = doc.querySelector(".spaces-toolbar") || doc.getElementById("spacesToolbar");
    if (!spaces) return;

    // Cible : bouton de paramètres (#settingsButton) ou conteneur du bas
    const settingsBtn = doc.getElementById("settingsButton") ||
                        spaces.querySelector('[data-l10n-id*="settings"]') ||
                        spaces.querySelector(".spaces-toolbar-bottom-container button") ||
                        spaces.querySelector(".spaces-toolbar-pinned-button");

    const bottomContainer = spaces.querySelector(".spaces-toolbar-bottom-container") ||
                            (settingsBtn ? settingsBtn.parentNode : null);

    // 1. Bouton Personnalisation & Thème Material You (inséré au-dessus du bouton Paramètres)
    let customBtn = doc.getElementById("material-theme-settings-btn");
    if (!customBtn) {
      customBtn = doc.createElement("button");
      customBtn.id = "material-theme-settings-btn";
      customBtn.type = "button";
      customBtn.className = "spaces-toolbar-button material-rail-btn";
      customBtn.setAttribute("tabindex", "-1");
      customBtn.setAttribute("title", "Personnaliser Material-Thunderbird (Thème, Couleurs, Émojis) [Alt+M]");
      customBtn.setAttribute("aria-label", "Personnaliser le thème Material-Thunderbird");
      setMarkup(customBtn, `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path class="material-icon-tone" d="M10 3.25a6.75 6.75 0 0 0 0 13.5c.95 0 1.5-.65 1.5-1.4 0-.45-.2-.8-.45-1.1-.25-.3-.45-.65-.45-1.1 0-.85.7-1.5 1.55-1.5h1.6a3.5 3.5 0 0 0 3.5-3.5c0-2.8-3.25-4.9-7.25-4.9z"/><circle class="material-icon-dot" cx="6.4" cy="10.2" r="1.05"/><circle class="material-icon-dot" cx="7.6" cy="6.9" r="1.05"/><circle class="material-icon-dot" cx="10.7" cy="5.9" r="1.05"/><circle class="material-icon-dot" cx="13.4" cy="7.7" r="1.05"/></svg>`);

      customBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openCustomizerModal(win);
      });

      if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(customBtn, settingsBtn);
      } else if (bottomContainer) {
        bottomContainer.appendChild(customBtn);
      } else {
        spaces.appendChild(customBtn);
      }
    }

    // 2. Bouton Soutenir / Sponsor (GitHub Sponsors)
    let sponsorBtn = doc.getElementById("material-sponsor-btn");
    if (!sponsorBtn) {
      sponsorBtn = doc.createElement("button");
      sponsorBtn.id = "material-sponsor-btn";
      sponsorBtn.type = "button";
      sponsorBtn.className = "spaces-toolbar-button material-rail-btn material-rail-sponsor";
      sponsorBtn.setAttribute("tabindex", "-1");
      sponsorBtn.setAttribute("title", "Soutenir Material-Thunderbird (GitHub Sponsors)");
      sponsorBtn.setAttribute("aria-label", "Soutenir le développement du thème");
      setMarkup(sponsorBtn, `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path class="material-icon-tone" d="M10 16.5s-6.25-3.9-6.25-8.3A3.45 3.45 0 0 1 7.2 4.75c1.2 0 2.2.6 2.8 1.55.6-.95 1.6-1.55 2.8-1.55a3.45 3.45 0 0 1 3.45 3.45c0 4.4-6.25 8.3-6.25 8.3z"/></svg>`);

      sponsorBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sponsorUrl = "https://github.com/sponsors/VForiel";
        const host = win.top || win;
        if (typeof host.openContentTab === "function") {
          host.openContentTab(sponsorUrl);
        } else if (typeof host.openURL === "function") {
          host.openURL(sponsorUrl);
        } else {
          const uri = Services.io.newURI(sponsorUrl);
          const extProtocolSvc = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
            .getService(Ci.nsIExternalProtocolService);
          extProtocolSvc.loadURI(uri);
        }
      });

      if (customBtn && customBtn.parentNode) {
        customBtn.parentNode.insertBefore(sponsorBtn, customBtn);
      } else if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(sponsorBtn, settingsBtn);
      } else if (bottomContainer) {
        bottomContainer.appendChild(sponsorBtn);
      } else {
        spaces.appendChild(sponsorBtn);
      }
    }

    // 3. Entrée dans le menu supérieur Outils
    this._ensureToolsMenuItem(win);
  }

  _ensureToolsMenuItem(win) {
    if (!win || !win.document) return;
    const doc = win.document;
    if (doc.getElementById("material-theme-tools-menuitem")) return;

    const toolsPopup = doc.getElementById("menu_ToolsPopup") ||
                       doc.getElementById("mailToolsPopup") ||
                       doc.querySelector("#tasksMenu > menupopup");
    if (toolsPopup) {
      const item = doc.createXULElement ? doc.createXULElement("menuitem") : doc.createElement("menuitem");
      item.id = "material-theme-tools-menuitem";
      item.setAttribute("label", "Personnaliser le thème Material (M3)...");
      item.setAttribute("acceltext", "Alt+M");
      item.addEventListener("command", (e) => {
        e.preventDefault();
        this._openCustomizerModal(win);
      });
      toolsPopup.appendChild(item);
    }
  }

  /**
   * Palette et emojis forment une seconde feuille utilisateur, generee : elle
   * s applique d un coup a toutes les fenetres, fenetres de redaction comprises.
   * La precedente est retiree apres que la nouvelle est posee, sans clignotement.
   */
  _applyCustomizerSheet() {
    const previous = this._customizerSheet;
    try {
      const css = generateCustomizerCss(getCustomizerSettings());
      this._customizerSheet = registerUserSheet("data:text/css;charset=utf-8," + encodeURIComponent(css));
    } catch (e) {
      console.error("[Material-Thunderbird] Personnalisation non appliquee :", e);
      return;
    }
    if (previous && !previous.equals(this._customizerSheet)) unregisterUserSheet(previous);
  }

  _openCustomizerModal(win) {
    if (!win || !win.document) return;
    const doc = win.document;
    let backdrop = doc.getElementById("material-customizer-backdrop");
    // Une fenetre deja ouverte, ou en train de se fermer, est reconstruite : son
    // minuteur de fermeture l aurait sinon retiree juste apres la reouverture.
    if (backdrop) {
      if (win.__materialCustomizerKeyListener) {
        win.removeEventListener("keydown", win.__materialCustomizerKeyListener);
        win.__materialCustomizerKeyListener = null;
      }
      backdrop.remove();
    }

    const settings = getCustomizerSettings();
    backdrop = doc.createElement("div");
    backdrop.id = "material-customizer-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "material-customizer-title");

    const dialog = doc.createElement("div");
    dialog.id = "material-customizer-dialog";

    // messenger.xhtml est un document XML : innerHTML y passe par l analyseur
    // XML, qui rejette un & nu, une balise <input> non fermee ou &nbsp;. La
    // fenetre levait donc une erreur avant meme d etre affichee. Tout texte
    // variable passe par xmlEscape, et chaque balise vide est auto-fermee.
    const xmlEscape = (str) => String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" class="material-dlg-check" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    const ICON_HEART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;

    const modes = [
      { id: "light", label: "Clair" },
      { id: "dark", label: "Sombre" },
      { id: "auto", label: "Système" }
    ];
    const modeButtons = modes.map((m) => {
      const on = settings.themeMode === m.id;
      return `<button type="button" class="material-segmented-btn${on ? " active" : ""}" data-mode="${m.id}" aria-pressed="${on}">${ICON_CHECK}<span>${xmlEscape(m.label)}</span></button>`;
    }).join("");

    const iconThemes = [
      { id: "modern", label: "Moderne" },
      { id: "emoji", label: "Émojis" },
      { id: "default", label: "Thunderbird" }
    ];
    const iconButtons = iconThemes.map((t) => {
      const on = settings.iconTheme === t.id;
      return `<button type="button" class="material-segmented-btn${on ? " active" : ""}" data-icons="${t.id}" aria-pressed="${on}">${ICON_CHECK}<span>${xmlEscape(t.label)}</span></button>`;
    }).join("");

    const swatches = Object.keys(PALETTES_CONFIG).map((key) => {
      const pal = PALETTES_CONFIG[key];
      const on = settings.palette === key;
      return `<button type="button" class="material-palette-card${on ? " active" : ""}" data-pal="${key}" aria-pressed="${on}" title="${xmlEscape(pal.desc)}">` +
        `<span class="material-palette-dot" style="background-color: ${pal.color};">${ICON_CHECK}</span>` +
        `<span class="material-palette-name">${xmlEscape(pal.name)}</span></button>`;
    }).join("");

    setMarkup(dialog, `
      <div class="material-modal-header">
        <div>
          <h2 id="material-customizer-title" class="material-modal-title">Personnaliser le thème</h2>
          <div class="material-modal-subtitle">Material-Thunderbird · Alt+M</div>
        </div>
        <button type="button" id="material-modal-close" class="material-modal-close-btn" title="Fermer (Échap)" aria-label="Fermer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Apparence</div>
        <div class="material-segmented-group" id="material-mode-group">${modeButtons}</div>
      </section>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Couleur d'accent</div>
        <div class="material-palette-grid" id="material-palette-group">${swatches}</div>
      </section>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Icônes</div>
        <div class="material-modal-section-desc">Moderne : icônes arrondies teintées de l'accent. Thunderbird : ses icônes d'origine.</div>
        <div class="material-segmented-group" id="material-icons-group">${iconButtons}</div>
      </section>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Avatars</div>
        <div class="material-modal-section-desc">Photo du contact d'abord, puis les sources ci-dessous, puis l'initiale.</div>
        <label class="material-option-row" for="material-brand-toggle">
          <span class="material-option-info">
            <span class="material-option-title">Logos des marques</span>
            <span class="material-option-desc">Comme Gmail : le logo officiel publié par l'expéditeur (BIMI), seulement pour les domaines protégés contre l'usurpation.</span>
          </span>
          <span class="material-switch">
            <input type="checkbox" id="material-brand-toggle"${areBrandLogosEnabled() ? ' checked="checked"' : ""} />
            <span class="material-switch-slider"></span>
          </span>
        </label>
        <label class="material-option-row" for="material-gravatar-toggle">
          <span class="material-option-info">
            <span class="material-option-title">Gravatar</span>
            <span class="material-option-desc">Photo publique liée à l'adresse. Envoie une empreinte de chaque expéditeur à gravatar.com.</span>
          </span>
          <span class="material-switch">
            <input type="checkbox" id="material-gravatar-toggle"${isGravatarEnabled() ? ' checked="checked"' : ""} />
            <span class="material-switch-slider"></span>
          </span>
        </label>
      </section>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Fils de discussion</div>
        <label class="material-option-row" for="material-hide-read-toggle">
          <span class="material-option-info">
            <span class="material-option-title">Masquer les réponses déjà lues</span>
            <span class="material-option-desc">Un fil qui reçoit un nouveau message s'ouvre sur ses réponses non lues ; un bouton dans le fil affiche les autres.</span>
          </span>
          <span class="material-switch">
            <input type="checkbox" id="material-hide-read-toggle"${readRepliesHidingEnabled() ? ' checked="checked"' : ""} />
            <span class="material-switch-slider"></span>
          </span>
        </label>
      </section>

      <section class="material-modal-section">
        <div class="material-modal-section-title">Désinscription</div>
        <label class="material-option-row" for="material-unsub-toggle">
          <span class="material-option-info">
            <span class="material-option-title">Proposer la désinscription</span>
            <span class="material-option-desc">Affiche un bandeau sur les infolettres et les listes de diffusion. Jamais sur les codes de connexion ni les commandes.</span>
          </span>
          <span class="material-switch">
            <input type="checkbox" id="material-unsub-toggle"${unsubscribeBannerEnabled() ? ' checked="checked"' : ""} />
            <span class="material-switch-slider"></span>
          </span>
        </label>
        <div id="material-unsub-ignored" class="material-unsub-ignored"></div>
      </section>

      <div class="material-sponsor-banner">
        <span class="material-sponsor-icon">${ICON_HEART}</span>
        <span class="material-option-info">
          <span class="material-option-title">Soutenir le projet</span>
          <span class="material-option-desc">Material-Thunderbird est gratuit et développé bénévolement.</span>
        </span>
        <button type="button" class="material-btn-pill material-btn-tonal" id="material-modal-sponsor-link">Faire un don</button>
      </div>

      <div id="material-uninstall-confirm" class="material-uninstall-confirm" style="display: none;">
        <div class="material-option-title">Désinstaller Material-Thunderbird ?</div>
        <div class="material-option-desc">L'extension sera retirée de Thunderbird avec son thème, ses boutons et ses réglages. Vos courriels et vos comptes ne sont pas touchés.</div>
        <div class="material-modal-actions">
          <button type="button" class="material-btn-pill material-btn-text" id="material-uninstall-cancel">Annuler</button>
          <button type="button" class="material-btn-pill material-btn-error" id="material-uninstall-proceed">Désinstaller</button>
        </div>
      </div>

      <div class="material-modal-footer">
        <button type="button" class="material-btn-pill material-btn-text material-btn-danger" id="material-btn-uninstall" title="Désinstaller complètement le thème">Désinstaller…</button>
        <button type="button" class="material-btn-pill material-btn-primary" id="material-btn-done">Terminé</button>
      </div>
    `);

    backdrop.appendChild(dialog);
    (doc.body || doc.documentElement).appendChild(backdrop);
    win.setTimeout(() => backdrop.classList.add("active"), 20);

    const closeBtn = dialog.querySelector("#material-modal-close");
    const doneBtn = dialog.querySelector("#material-btn-done");
    const handleClose = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      this._closeCustomizerModal(win);
    };
    if (closeBtn) closeBtn.addEventListener("click", handleClose);
    if (doneBtn) doneBtn.addEventListener("click", handleClose);

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) handleClose(e);
    });

    // Retire par _closeCustomizerModal, quelle que soit la facon de fermer :
    // sinon chaque ouverture laissait un ecouteur de plus sur la fenetre.
    const keyListener = (e) => {
      if (e.key === "Escape") handleClose(e);
    };
    win.addEventListener("keydown", keyListener);
    win.__materialCustomizerKeyListener = keyListener;

    // Mode segmented
    const modeBtns = dialog.querySelectorAll("#material-mode-group .material-segmented-btn");
    modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        modeBtns.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const mode = btn.getAttribute("data-mode");
        const cur = getCustomizerSettings();
        cur.themeMode = mode;
        saveCustomizerSettings(cur);
        this._applyCustomizerSheet();
      });
    });

    // Palette cards
    const palCards = dialog.querySelectorAll("#material-palette-group .material-palette-card");
    palCards.forEach(card => {
      card.addEventListener("click", () => {
        palCards.forEach(c => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
        card.classList.add("active");
        card.setAttribute("aria-pressed", "true");
        const pal = card.getAttribute("data-pal");
        const cur = getCustomizerSettings();
        cur.palette = pal;
        saveCustomizerSettings(cur);
        this._applyCustomizerSheet();
      });
    });

    // Reponses lues masquees
    const hideReadToggle = dialog.querySelector("#material-hide-read-toggle");
    if (hideReadToggle) {
      hideReadToggle.addEventListener("change", () => {
        try { Services.prefs.setBoolPref(PREF_HIDE_READ_REPLIES, hideReadToggle.checked); } catch (e) {}
        this._refreshThreadViews();
      });
    }

    const iconBtns = dialog.querySelectorAll("#material-icons-group .material-segmented-btn");
    iconBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        iconBtns.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const cur = getCustomizerSettings();
        cur.iconTheme = btn.getAttribute("data-icons");
        saveCustomizerSettings(cur);
        this._applyCustomizerSheet();
      });
    });

    // Avatars : les nouvelles sources s appliquent aux prochains affichages.
    const brandToggle = dialog.querySelector("#material-brand-toggle");
    if (brandToggle) {
      brandToggle.addEventListener("change", () => {
        try { Services.prefs.setBoolPref(PREF_BRAND_LOGOS, brandToggle.checked); } catch (e) {}
      });
    }
    const gravatarToggle = dialog.querySelector("#material-gravatar-toggle");
    if (gravatarToggle) {
      gravatarToggle.addEventListener("change", () => {
        try { Services.prefs.setBoolPref(GRAVATAR_PREF, gravatarToggle.checked); } catch (e) {}
      });
    }

    // Desinscription : interrupteur et expediteurs ignores.
    const unsubToggle = dialog.querySelector("#material-unsub-toggle");
    if (unsubToggle) {
      unsubToggle.addEventListener("change", () => {
        try { Services.prefs.setBoolPref(PREF_UNSUB_ENABLED, unsubToggle.checked); } catch (e) {}
        if (!unsubToggle.checked) {
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) this._removeUnsubscribeBanner(windows.getNext());
        }
      });
    }
    const ignoredBox = dialog.querySelector("#material-unsub-ignored");
    const renderIgnored = () => {
      if (!ignoredBox) return;
      ignoredBox.replaceChildren();
      const items = unsubscribeIgnoredList();
      if (!items.length) return;
      const heading = doc.createElement("div");
      heading.className = "material-option-desc material-unsub-ignored-title";
      heading.textContent = "Bandeau masqué pour :";
      ignoredBox.appendChild(heading);
      for (const item of items) {
        const row = doc.createElement("div");
        row.className = "material-unsub-ignored-row";
        const label = doc.createElement("span");
        label.className = "material-unsub-ignored-label";
        // Libelle venu d un courriel : insere en texte.
        label.textContent = item.label || item.key.replace(/^(from|list):/, "");
        label.setAttribute("title", item.key.replace(/^(from|list):/, ""));
        const state = doc.createElement("span");
        state.className = "material-unsub-ignored-state";
        state.textContent = item.reason === "unsubscribed" ? "désinscrit" : "ignoré";
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "material-btn-pill material-btn-text";
        remove.textContent = "Retirer";
        remove.setAttribute("title", "Proposer à nouveau la désinscription");
        remove.addEventListener("click", () => { forgetUnsubscribeKey(item.key); renderIgnored(); });
        row.appendChild(label);
        row.appendChild(state);
        row.appendChild(remove);
        ignoredBox.appendChild(row);
      }
    };
    renderIgnored();

    // Sponsor button
    const sponsorBtn = dialog.querySelector("#material-modal-sponsor-link");
    if (sponsorBtn) {
      sponsorBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const sponsorUrl = "https://github.com/sponsors/VForiel";
        const host = win.top || win;
        if (typeof host.openContentTab === "function") {
          host.openContentTab(sponsorUrl);
        } else if (typeof host.openURL === "function") {
          host.openURL(sponsorUrl);
        } else {
          const uri = Services.io.newURI(sponsorUrl);
          const extProtocolSvc = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
            .getService(Ci.nsIExternalProtocolService);
          extProtocolSvc.loadURI(uri);
        }
      });
    }

    // Uninstall
    const uninstBtn = dialog.querySelector("#material-btn-uninstall");
    const confirmBox = dialog.querySelector("#material-uninstall-confirm");
    const cancelUninstBtn = dialog.querySelector("#material-uninstall-cancel");
    const proceedUninstBtn = dialog.querySelector("#material-uninstall-proceed");

    if (uninstBtn && confirmBox) {
      uninstBtn.addEventListener("click", () => {
        confirmBox.style.display = confirmBox.style.display === "none" ? "flex" : "none";
        confirmBox.scrollIntoView({ behavior: "smooth" });
      });
    }

    if (cancelUninstBtn && confirmBox) {
      cancelUninstBtn.addEventListener("click", () => {
        confirmBox.style.display = "none";
      });
    }

    if (proceedUninstBtn) {
      proceedUninstBtn.addEventListener("click", async () => {
        proceedUninstBtn.disabled = true;
        proceedUninstBtn.textContent = "Désinstallation…";
        await this._uninstallEverything(win);
      });
    }
  }

  _closeCustomizerModal(win) {
    if (!win || !win.document) return;
    if (win.__materialCustomizerKeyListener) {
      win.removeEventListener("keydown", win.__materialCustomizerKeyListener);
      win.__materialCustomizerKeyListener = null;
    }
    const backdrop = win.document.getElementById("material-customizer-backdrop");
    if (!backdrop) return;
    backdrop.classList.remove("active");
    win.setTimeout(() => {
      try { backdrop.remove(); } catch (e) {}
    }, 220);
  }

  _restartThunderbird() {
    try {
      const appStartup = Services.startup;
      appStartup.quit(Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart);
    } catch (e) {
      console.error("[Material-Thunderbird] Restart failed:", e);
    }
  }

  /**
   * Desinstalle l extension depuis la fenetre de personnalisation. Les anciennes
   * versions s installaient par script dans le dossier chrome/ du profil : ces
   * fichiers sont retires au passage, et comme userChrome.css n est relu qu au
   * demarrage, un redemarrage est alors propose.
   */
  async _uninstallEverything(win) {
    const legacyRemoved = this._removeLegacyProfileInstall();
    for (const pref of [PREF_PALETTE, PREF_THEME_MODE, PREF_EMOJIS, PREF_ICON_THEME, PREF_HIDE_READ_REPLIES,
                        PREF_UNSUB_ENABLED, PREF_UNSUB_IGNORED, PREF_UNSUB_HIDDEN,
                        PREF_BRAND_LOGOS, PREF_BRAND_CACHE, PREF_BRAND_CACHE_OLD, PREF_BRAND_CACHE_OLD2, GRAVATAR_PREF]) {
      try { Services.prefs.clearUserPref(pref); } catch (e) {}
    }
    releaseThemeModeOverride();
    this._closeCustomizerModal(win);

    if (legacyRemoved) {
      const restart = Services.prompt.confirm(
        win,
        "Material-Thunderbird",
        "Les fichiers installés autrefois par script dans le profil ont été retirés. " +
        "Thunderbird doit redémarrer pour les oublier. Redémarrer maintenant ?"
      );
      if (restart) win.setTimeout(() => this._restartThunderbird(), 500);
    }

    try {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const addon = await AddonManager.getAddonByID(this.extension.id);
      if (addon) await addon.uninstall();
    } catch (e) {
      console.error("[Material-Thunderbird] Desinstallation de l extension impossible :", e);
    }
  }

  /** @returns {boolean} vrai si une installation par script a ete trouvee et retiree. */
  _removeLegacyProfileInstall() {
    let found = false;
    try {
      const profDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
      const chromeDir = profDir.clone();
      chromeDir.append("chrome");

      if (chromeDir.exists()) {
        const manifestFile = chromeDir.clone();
        manifestFile.append("material-thunderbird-install.json");
        let manifest = null;
        found = manifestFile.exists();
        if (manifestFile.exists()) {
          try {
            const fis = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
            fis.init(manifestFile, 0x01, 0o444, 0);
            const cis = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
            cis.init(fis, "UTF-8", 1024, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
            let str = {};
            let jsonText = "";
            while (cis.readString(4096, str) != 0) { jsonText += str.value; }
            cis.close();
            fis.close();
            manifest = JSON.parse(jsonText);
          } catch (e) {}
        }

        const legacyFiles = [
          "userChrome.css", "userContent.css", "user-overrides.css",
          "tokens/shapes.css", "tokens/colors-light.css", "tokens/colors-dark.css", "tokens/bridge.css",
          "components/spaces-toolbar.css", "components/unified-toolbar.css", "components/folder-pane.css",
          "components/thread-tree.css", "components/message-header.css", "components/tabs-and-dialogs.css",
          "components/calendar.css", "components/addressbook.css", "components/avatars.css",
          "components/multimessage.css", "components/compose.css", "components/extras.css"
        ];

        // Sans manifeste, seuls les fichiers reconnaissables comme les notres sont
        // retires : userChrome.css peut appartenir a quelqu un d autre.
        const ours = chromeDir.clone();
        ours.append("tokens");
        if (!found && !ours.exists()) return false;
        found = true;
        const filesToDelete = (manifest && Array.isArray(manifest.files)) ? manifest.files : legacyFiles;
        for (const rel of filesToDelete) {
          try {
            const f = chromeDir.clone();
            const parts = rel.split("/");
            for (const p of parts) f.append(p);
            if (f.exists()) f.remove(false);
          } catch (e) {}
        }

        if (manifest && manifest.backupDir) {
          try {
            const bDir = profDir.clone();
            bDir.append(manifest.backupDir);
            if (bDir.exists()) {
              const entries = bDir.directoryEntries;
              while (entries.hasMoreElements()) {
                const entry = entries.getNext().QueryInterface(Ci.nsIFile);
                entry.moveTo(chromeDir, entry.leafName);
              }
              bDir.remove(true);
            }
          } catch (e) {}
        }

        try {
          if (manifestFile.exists()) manifestFile.remove(false);
          const ov = chromeDir.clone();
          ov.append("user-overrides.css");
          if (ov.exists()) ov.remove(false);
        } catch (e) {}
      }

      try {
        const userJs = profDir.clone();
        userJs.append("user.js");
        if (userJs.exists()) {
          const fis = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
          fis.init(userJs, 0x01, 0o444, 0);
          const cis = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
          cis.init(fis, "UTF-8", 1024, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
          let str = {};
          let content = "";
          while (cis.readString(4096, str) != 0) { content += str.value; }
          cis.close();
          fis.close();

          const prefsToClean = [
            "toolkit.legacyUserProfileCustomizations.stylesheets",
            "svg.context-properties.content.enabled",
            "extensions.experiments.enabled"
          ];
          const lines = content.split(/\r?\n/).filter(line => {
            if (line.trim() === "// Material-Thunderbird") return false;
            for (const p of prefsToClean) {
              if (line.includes(`user_pref("${p}"`)) return false;
            }
            return true;
          });

          const fos = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
          fos.init(userJs, 0x02 | 0x08 | 0x20, 0o644, 0);
          const cos = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
          cos.init(fos, "UTF-8", 0, 0);
          cos.writeString(lines.join("\r\n") + "\r\n");
          cos.close();
          fos.close();
        }
      } catch (e) {}

      return found;
    } catch (err) {
      console.error("[Material-Thunderbird] Nettoyage de l installation par script impossible :", err);
      return found;
    }
  }

  /**
   * Accroche les documents de l onglet courant. Sans effet si l onglet n est pas
   * un onglet courrier ; chaque document porte un drapeau, donc rappeler cette
   * methode a chaque changement d onglet ne double aucune accroche.
   */
  _attachToCurrentTab(win) {
    const state = win.__materialWindowState;
    if (!state || !state.tabmail) return;

    let about3Pane = null;
    try { about3Pane = state.tabmail.currentAbout3Pane; } catch (e) {}
    if (about3Pane) this._setupAbout3Pane(win, about3Pane);

    let aboutMessage = null;
    try { aboutMessage = state.tabmail.currentAboutMessage; } catch (e) {}
    if (aboutMessage) this._setupAboutMessage(win, aboutMessage);
  }

  _rememberDocument(win, doc) {
    const state = win.__materialWindowState;
    if (state && !state.documents.includes(doc)) {
      state.documents.push(doc);
      removeLegacyDocumentStyles(doc, this.extension);
    }
  }

  /**
   * about:3pane : liste des messages et vue multi-messages. Les navigateurs
   * imbriques restent masques tant qu aucun message n est selectionne, d ou les
   * ecouteurs de chargement plutot qu une seule passe.
   */
  _setupAbout3Pane(win, win3) {
    const doc = win3.document;
    if (!doc || doc.__materialAbout3PaneSetup) return;

    const state = win.__materialWindowState;
    const listen = (target, type, handler, capture) => {
      target.addEventListener(type, handler, capture);
      if (state) state.listeners.push([target, type, handler, capture]);
    };

    // about3Pane.js clone son <template> et ne publie messageBrowser et
    // multiMessageBrowser qu au cours de son initialisation. Le moniteur
    // d onglets nous appelle des le demarrage, donc parfois avant : on
    // repasserait alors a cote des deux navigateurs, sans jamais y revenir
    // puisque le drapeau serait deja pose.
    if (doc.readyState !== "complete") {
      listen(win3, "load", () => this._setupAbout3Pane(win, win3), true);
      return;
    }

    doc.__materialAbout3PaneSetup = true;
    this._rememberDocument(win, doc);

    const threadTree = doc.getElementById("threadTree");
    if (threadTree) {
      // Les observateurs et le cadencement doivent venir de la fenetre qui
      // possede l arbre, pas de la fenetre chrome exterieure.
      this._setupThreadTree(win3, threadTree, state);
      this._adjustCardRowHeight(win3);
      this._keepScrollOnViewRefresh(win3);
    }

    // La vue multi-messages se charge a la premiere selection multiple.
    const multiBrowser = win3.multiMessageBrowser || doc.getElementById("multiMessageBrowser");
    if (multiBrowser) {
      const attachMulti = () => {
        try {
          if (multiBrowser.contentDocument) {
            this._setupMultimessageObserver(win3, multiBrowser.contentDocument, state);
            this._rememberDocument(win, multiBrowser.contentDocument);
          }
        } catch (e) {}
      };
      listen(multiBrowser, "load", attachMulti, true);
      attachMulti();
    }

    // about:message n existe pas tant qu aucun message n est affiche.
    const messageBrowser = win3.messageBrowser || doc.getElementById("messageBrowser");
    if (messageBrowser) {
      const attachMessage = () => {
        try {
          if (messageBrowser.contentWindow) {
            this._setupAboutMessage(win, messageBrowser.contentWindow);
          }
        } catch (e) {}
      };
      listen(messageBrowser, "load", attachMessage, true);
      attachMessage();
    }
  }

  /**
   * about:message : en-tete du message, avatars de l expediteur et des
   * destinataires. C est aussi le document qui recoit le bandeau de
   * desinscription.
   */
  _setupAboutMessage(win, winMsg) {
    const doc = winMsg.document;
    if (!doc || doc.__materialAboutMessageSetup) return;

    const state = win.__materialWindowState;

    // Meme precaution que pour about:3pane : l en-tete du message n existe
    // pas encore tant que le document n est pas charge.
    if (doc.readyState !== "complete") {
      const onLoad = () => this._setupAboutMessage(win, winMsg);
      winMsg.addEventListener("load", onLoad, true);
      if (state) state.listeners.push([winMsg, "load", onLoad, true]);
      return;
    }

    doc.__materialAboutMessageSetup = true;
    this._rememberDocument(win, doc);
    const timers = new Map();
    const debounce = (key, delay, fn) => {
      if (timers.has(key)) winMsg.clearTimeout(timers.get(key));
      const id = winMsg.setTimeout(() => { timers.delete(key); fn(); }, delay);
      timers.set(key, id);
      if (state) state.timers.push([winMsg, id]);
    };

    const header = doc.getElementById("messageHeader") || doc.getElementById("msgHeaderView");
    if (header) {
      const observer = new winMsg.MutationObserver(() => {
        debounce("header", 50, () => this._updateRecipientAvatars(winMsg));
      });
      observer.observe(header, { childList: true, subtree: true });
      if (state) state.observers.push(observer);
    }

    this._updateRecipientAvatars(winMsg);
  }

  /**
   * Fenetre about:message associee a une fenetre chrome. L en-tete du message et
   * le volet de lecture vivent la, jamais dans le document de la fenetre.
   */
  _aboutMessageWindow(win) {
    if (!win || !win.document) return null;
    // Deja une fenetre about:message.
    try {
      if (win.document.getElementById("messageHeader")) return win;
    } catch (e) {}
    // Fenetre 3 panneaux : l onglet courant repond pour son propre document.
    try {
      const tabmail = win.document.getElementById("tabmail");
      if (tabmail && tabmail.currentAboutMessage) return tabmail.currentAboutMessage;
    } catch (e) {}
    // Fenetre de message autonome : un seul navigateur about:message.
    try {
      const browser = win.document.getElementById("messageBrowser");
      if (browser && browser.contentWindow) return browser.contentWindow;
    } catch (e) {}
    return null;
  }

  /**
   * Bandeau de desinscription.
   *
   * Deux variantes : "newsletter" (carte avec bouton plein) et "list" (ligne
   * discrete pour les listes de diffusion). Toutes les donnees viennent du
   * courriel, donc d une source non fiable : elles sont inserees en texte, et
   * les liens revalides au moment du clic.
   *
   * La fermeture propose de masquer le bandeau pour ce message ou de ne plus le
   * proposer pour cet expediteur ; ces choix vivent dans les preferences, et
   * getAPI les consulte avant tout affichage.
   */
  _renderUnsubscribeBanner(chromeWin, details) {
    const win = this._aboutMessageWindow(chromeWin);
    if (!win) return;
    const doc = win.document;
    const isList = details.kind === "list";
    let banner = doc.getElementById("material-unsubscribe-banner");
    if (!banner) {
      banner = doc.createElement("div");
      banner.id = "material-unsubscribe-banner";
    }
    banner.className = "material-unsubscribe-card" + (isList ? " material-unsub-list" : "");
    banner.setAttribute("role", "status");
    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const senderLabel = displayNameOf(details.senderName) || "Cet expéditeur";
    const listLabel = (details.listName || "").trim() || "cette liste";
    const targetLabel = isList ? `la liste ${listLabel}` : senderLabel;
    const url = details.url && UnsubscribeRules && UnsubscribeRules.isSafeUrl(details.url) ? details.url.trim() : "";
    const mailto = !url && isSafeMailto(details.mailto) ? details.mailto.trim() : "";
    let host = "";
    try { host = url ? new win.URL(url).host : ""; } catch (e) {}

    const SVG_NS = "http://www.w3.org/2000/svg";
    const svgIcon = (size, pathData) => {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("aria-hidden", "true");
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
      return svg;
    };
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const button = (className, text, title) => {
      const b = el("button", className, text);
      b.type = "button";
      if (title) b.setAttribute("title", title);
      return b;
    };

    const ICON_MAIL = "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z";
    const ICON_GROUP = "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z";
    const ICON_CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
    const ICON_OPEN = "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z";

    const left = el("div", "material-unsub-left");
    const icon = el("div", "material-unsub-icon");
    icon.appendChild(svgIcon(isList ? 16 : 18, isList ? ICON_GROUP : ICON_MAIL));
    const textBox = el("div", "material-unsub-details");
    const title = el("span", "material-unsub-title");
    const desc = el("span", "material-unsub-desc");
    textBox.appendChild(title);
    textBox.appendChild(desc);
    left.appendChild(icon);
    left.appendChild(textBox);
    const actions = el("div", "material-unsub-actions");
    banner.appendChild(left);
    banner.appendChild(actions);

    const setText = (t, d) => {
      title.textContent = t;
      desc.textContent = d || "";
      desc.hidden = !d;
    };
    const setActions = (...nodes) => {
      while (actions.firstChild) actions.removeChild(actions.firstChild);
      nodes.forEach((n) => actions.appendChild(n));
    };
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

    const rememberDone = (reason) => {
      ignoreUnsubscribeKey(details.key, isList ? listLabel : senderLabel, reason);
    };

    // Etat final : confirmation, puis le bandeau s efface de lui-meme.
    const finish = (t, d) => {
      icon.replaceChildren(svgIcon(18, ICON_CHECK));
      banner.classList.add("material-unsub-done");
      setText(t, d);
      const ok = button("material-unsub-text-btn", "Fermer");
      ok.onclick = (e) => { stop(e); banner.remove(); };
      setActions(ok);
    };

    // Apres ouverture d une page ou d un brouillon : l extension ne peut pas
    // savoir si la desinscription a abouti, l utilisateur le confirme.
    const askIfDone = (t, d) => {
      setText(t, d);
      const done = button("material-unsub-btn", "C'est fait");
      done.prepend(svgIcon(14, ICON_CHECK));
      done.onclick = (e) => {
        stop(e);
        rememberDone("unsubscribed");
        finish("Désinscription notée", `Le bandeau ne sera plus proposé pour ${targetLabel}.`);
      };
      const later = button("material-unsub-text-btn", "Plus tard");
      later.onclick = (e) => { stop(e); banner.remove(); };
      setActions(later, done);
    };

    const openPage = () => {
      // Derniere verification avant navigation : l URL vient du courriel.
      if (!url || !UnsubscribeRules || !UnsubscribeRules.isSafeUrl(url)) return false;
      try {
        // Le bandeau vit dans about:message, qui n a pas de fonction de
        // navigation : msgHdrView.js passe lui aussi par top pour ouvrir ses
        // liens. Sans cela on retombait sur le service de protocole externe et
        // le lien partait dans le navigateur du systeme.
        const top = win.top || win;
        if (typeof top.openContentTab === "function") {
          top.openContentTab(url);
        } else if (typeof top.openURL === "function") {
          top.openURL(url);
        } else {
          Cc["@mozilla.org/uriloader/external-protocol-service;1"]
            .getService(Ci.nsIExternalProtocolService)
            .loadURI(Services.io.newURI(url));
        }
        return true;
      } catch (err) {
        console.error("[Material-Thunderbird] Ouverture du lien impossible : " + err);
        return false;
      }
    };

    // Ouvre la fenetre de redaction pre-remplie. Rien n est envoye : c est a
    // l utilisateur de relire puis de cliquer sur Envoyer.
    const openDraft = () => {
      if (!mailto || !MailServices || !MailServices.compose) return false;
      try {
        MailServices.compose.OpenComposeWindowWithURI(null, Services.io.newURI(mailto));
        return true;
      } catch (err) {
        console.error("[Material-Thunderbird] Brouillon de desinscription impossible : " + err);
        return false;
      }
    };

    // Desinscription en un clic (RFC 8058) : un POST sans cookie vers l URL de
    // l en-tete. La fenetre chrome n est pas soumise a CORS, et la reponse dit
    // si l expediteur a accepte.
    const oneClick = async () => {
      setText("Désinscription en cours…", host);
      setActions();
      const controller = new win.AbortController();
      const timer = win.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await (win.top || win).fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
          credentials: "omit",
          redirect: "follow",
          signal: controller.signal
        });
        win.clearTimeout(timer);
        if (response.ok) {
          rememberDone("unsubscribed");
          finish("Désinscription envoyée", `${host} a accepté la demande. Les prochains envois peuvent mettre quelques jours à s'arrêter.`);
          return;
        }
        throw new Error("HTTP " + response.status);
      } catch (err) {
        win.clearTimeout(timer);
        console.warn("[Material-Thunderbird] Desinscription en un clic refusee : " + err);
        setText("La désinscription automatique a échoué", "Vous pouvez la terminer sur la page de l'expéditeur.");
        const open = button("material-unsub-btn", "Ouvrir la page", `Ouvrir ${host}`);
        open.prepend(svgIcon(13, ICON_OPEN));
        open.onclick = (e) => {
          stop(e);
          if (openPage()) askIfDone("Page ouverte dans un nouvel onglet", "Une fois désinscrit, confirmez-le ici.");
        };
        const cancel = button("material-unsub-text-btn", "Annuler");
        cancel.onclick = (e) => { stop(e); showInitial(); };
        setActions(cancel, open);
      }
    };

    // Le choix a la fermeture : ce message, ou cet expediteur.
    const showDismissChoices = () => {
      setText("Masquer ce bandeau ?", "");
      const thisMessage = button("material-unsub-text-btn", "Pour ce message");
      thisMessage.onclick = (e) => {
        stop(e);
        hideUnsubscribeForMessage(details.messageId);
        banner.remove();
      };
      const always = button("material-unsub-text-btn", isList ? "Pour cette liste" : "Pour cet expéditeur",
        `Ne plus proposer la désinscription pour ${targetLabel}. Réversible dans la personnalisation du thème.`);
      always.onclick = (e) => {
        stop(e);
        rememberDone("ignored");
        banner.remove();
      };
      const back = button("material-unsub-text-btn material-unsub-back", "Annuler");
      back.onclick = (e) => { stop(e); showInitial(); };
      setActions(thisMessage, always, back);
    };

    const showInitial = () => {
      banner.classList.remove("material-unsub-done");
      icon.replaceChildren(svgIcon(isList ? 16 : 18, isList ? ICON_GROUP : ICON_MAIL));
      if (isList) {
        setText(`Liste de diffusion · ${listLabel}`, "");
      } else {
        setText("Infolettre", details.oneClick
          ? `${senderLabel} permet la désinscription en un clic.`
          : `${senderLabel} propose un lien de désinscription.`);
      }

      let mainTitle;
      if (url && details.oneClick) mainTitle = `Désinscription immédiate auprès de ${host}, sans ouvrir de page`;
      else if (url) mainTitle = `Ouvrir ${host}`;
      else mainTitle = "Préparer le courriel de désinscription (rien n'est envoyé sans vous)";
      const main = button(isList ? "material-unsub-text-btn material-unsub-main" : "material-unsub-btn",
        isList ? "Quitter la liste" : "Se désinscrire", mainTitle);
      if (!isList && !details.oneClick) main.prepend(svgIcon(13, ICON_OPEN));

      main.onclick = (e) => {
        stop(e);
        if (url && details.oneClick) {
          // Action irreversible : une confirmation, sur place.
          setText(isList ? `Quitter la liste ${listLabel} ?` : `Se désinscrire de ${senderLabel} ?`,
            `La demande part directement à ${host}.`);
          const confirm = button("material-unsub-btn", "Confirmer");
          confirm.onclick = (ev) => { stop(ev); oneClick(); };
          const cancel = button("material-unsub-text-btn", "Annuler");
          cancel.onclick = (ev) => { stop(ev); showInitial(); };
          setActions(cancel, confirm);
        } else if (url) {
          if (openPage()) askIfDone("Page ouverte dans un nouvel onglet", "Une fois désinscrit, confirmez-le ici.");
        } else if (openDraft()) {
          askIfDone("Courriel de désinscription préparé", "Relisez-le puis envoyez-le. Rien ne part sans vous.");
        }
      };

      const close = button("material-unsub-close", "", "Masquer");
      close.setAttribute("aria-label", "Masquer");
      close.appendChild(svgIcon(16, "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"));
      close.onclick = (e) => { stop(e); showDismissChoices(); };
      setActions(main, close);
    };

    showInitial();

    if (!banner.parentNode) {
      const messageHeader = doc.getElementById("msgHeaderView") || doc.getElementById("messageHeader");
      const messagePaneBox = doc.getElementById("messagepanebox") || doc.getElementById("messagepane");
      if (messageHeader && messageHeader.parentNode) {
        messageHeader.parentNode.insertBefore(banner, messageHeader.nextSibling);
      } else if (messagePaneBox && messagePaneBox.parentNode) {
        messagePaneBox.parentNode.insertBefore(banner, messagePaneBox);
      } else {
        const notificationBox = doc.getElementById("mail-notification-top");
        if (notificationBox) notificationBox.appendChild(banner);
      }
    }
  }

  /**
   * Fenetre chrome de l onglet designe par la WebExtension. getGlobalForObject est
   * la resolution employee par ext-mail.js lui-meme (getTabWindow).
   */
  _windowForTab(context, tabId) {
    if (typeof tabId !== "number") return null;
    try {
      const tab = context.extension.tabManager.get(tabId);
      const nativeTab = tab && tab.nativeTab;
      return nativeTab ? Cu.getGlobalForObject(nativeTab) : null;
    } catch (e) {
      return null;
    }
  }

  _removeUnsubscribeBanner(chromeWin) {
    const win = this._aboutMessageWindow(chromeWin);
    if (!win) return;
    const banner = win.document.getElementById("material-unsubscribe-banner");
    if (banner) {
      banner.remove();
    }
  }

  async _updateRecipientAvatars(win) {
    try {
      const doc = win.document;

      // 1. Sender Avatar in #expandedfromBox
      const fromBox = doc.getElementById("expandedfromBox");
      if (fromBox) {
        const fromRec = fromBox.querySelector(".header-recipient, mail-emailaddress, [emailAddress], .email-address") || fromBox;
        // Thunderbird 128 expose l adresse en proprietes de <li is="header-recipient">,
        // pas en attributs : le repli sur textContent melangeait le libelle "De",
        // l initiale de l avatar et le nom, et l adresse n etait pas reconnue.
        const rawFrom = fromRec.fullAddress ||
                        fromRec.emailAddress ||
                        fromRec.getAttribute("label") ||
                        fromRec.getAttribute("displayName") ||
                        fromRec.getAttribute("emailAddress") ||
                        fromRec.getAttribute("title") ||
                        fromRec.textContent || "";
        const fromAvatar = fromBox.querySelector(".recipient-avatar");
        if (fromAvatar && rawFrom) {
          const avatarInfo = resolveAvatarInfo(win, rawFrom, (gravUrl) => {
            fromAvatar.style.setProperty("--md-avatar-img", `url("${gravUrl}")`);
            fromAvatar.style.removeProperty("--md-avatar-char");
            fromAvatar.style.backgroundImage = `url("${gravUrl}")`;
            fromAvatar.style.backgroundSize = "cover";
            const span = fromAvatar.querySelector("span");
            if (span) span.textContent = "";
          });

          fromAvatar.style.setProperty("--md-avatar-bg", avatarInfo.bg);
          fromAvatar.style.setProperty("--md-avatar-fg", avatarInfo.fg);
          fromAvatar.style.backgroundColor = avatarInfo.bg;
          fromAvatar.style.color = avatarInfo.fg;

          if (avatarInfo.type === "img") {
            fromAvatar.style.setProperty("--md-avatar-img", `url("${avatarInfo.url}")`);
            fromAvatar.style.removeProperty("--md-avatar-char");
            fromAvatar.style.backgroundImage = `url("${avatarInfo.url}")`;
            fromAvatar.style.backgroundSize = "cover";
            const span = fromAvatar.querySelector("span");
            if (span) span.textContent = "";
          } else {
            fromAvatar.style.removeProperty("--md-avatar-img");
            fromAvatar.style.setProperty("--md-avatar-char", `"${avatarInfo.char}"`);
            fromAvatar.style.backgroundImage = "none";
            const span = fromAvatar.querySelector("span");
            if (span) span.textContent = avatarInfo.char;
          }
        }
      }

      // 2. Recipient Boxes (Pour, Copie à, Copie cachée à, etc.)
      const recipientBoxes = doc.querySelectorAll("#expandedtoBox, #expandedccBox, #expandedbccBox, #expandedreply-toBox");
      recipientBoxes.forEach((box) => {
        const recipients = box.querySelectorAll(".header-recipient, mail-emailaddress, [emailAddress]");
        recipients.forEach((rec) => {
          const raw = rec.getAttribute("label") ||
                      rec.getAttribute("displayName") ||
                      rec.getAttribute("emailAddress") ||
                      rec.getAttribute("title") ||
                      rec.textContent || "";
          
          if (!raw) return;
          const btn = rec.querySelector(".recipient-address-book-button") ||
                      rec.querySelector(".recipient-avatar") ||
                      rec;

          const avatarInfo = resolveAvatarInfo(win, raw, (gravUrl) => {
            btn.style.setProperty("--md-avatar-img", `url("${gravUrl}")`);
            btn.style.removeProperty("--md-avatar-char");
          });

          btn.style.setProperty("--md-avatar-bg", avatarInfo.bg);
          btn.style.setProperty("--md-avatar-fg", avatarInfo.fg);

          if (avatarInfo.type === "img") {
            btn.style.setProperty("--md-avatar-img", `url("${avatarInfo.url}")`);
            btn.style.removeProperty("--md-avatar-char");
          } else {
            btn.style.removeProperty("--md-avatar-img");
            btn.style.setProperty("--md-avatar-char", `"${avatarInfo.char}"`);
          }
        });
      });
    } catch (e) {}
  }

  // doc est le document de la vue multi-messages, dans son propre navigateur :
  // MutationObserver et requestAnimationFrame viennent de sa fenetre a lui.
  // win ne sert plus qu au calcul des avatars ; state est celui de la fenetre
  // chrome, ou l observateur est enregistre pour le demontage.
  _setupMultimessageObserver(win, doc, state) {
    if (!doc || doc.__materialMultimessageObserved) return;
    doc.__materialMultimessageObserved = true;
    const view = doc.defaultView || win;

    const processItems = () => {
      const items = doc.querySelectorAll("#messageList > li");
      items.forEach((li) => {
        // Eradicate native green unread dot elements
        li.querySelectorAll(".unread-status, .unread-icon, .status-unread, [class*='unread-dot'], .multi-avatar").forEach((el) => {
          el.remove();
        });

        const authorEl = li.querySelector(".item-header .author");
        if (authorEl) {
          const rawText = (authorEl.getAttribute("title") || authorEl.textContent || "").trim();
          if (!rawText) return;

          const avatarInfo = resolveAvatarInfo(win, rawText, (gravUrl) => {
            authorEl.style.setProperty("--author-img", `url("${gravUrl}")`);
            authorEl.style.removeProperty("--author-char");
          });

          authorEl.style.setProperty("--author-bg", avatarInfo.bg);
          authorEl.style.setProperty("--author-fg", avatarInfo.fg);
          authorEl.setAttribute("data-author", avatarInfo.char || "A");
          if (!authorEl.getAttribute("title")) {
            authorEl.setAttribute("title", rawText);
          }

          if (avatarInfo.type === "img") {
            authorEl.style.setProperty("--author-img", `url("${avatarInfo.url}")`);
            authorEl.style.removeProperty("--author-char");
          } else {
            authorEl.style.removeProperty("--author-img");
            authorEl.style.setProperty("--author-char", `"${avatarInfo.char}"`);
          }
        }
      });
    };

    processItems();

    const msgList = doc.getElementById("messageList") || doc.body;
    if (msgList) {
      // processItems modifie la liste observee : le travail est regroupe sur la
      // frame suivante et l observateur est suspendu pendant son execution.
      let pending = false;
      let applying = false;
      const listObs = new view.MutationObserver(() => {
        if (pending || applying) return;
        pending = true;
        view.requestAnimationFrame(() => {
          pending = false;
          applying = true;
          try { processItems(); } finally { applying = false; }
        });
      });
      listObs.observe(msgList, { childList: true, subtree: true });

      if (state) state.observers.push(listObs);
    }
  }

  // win est la fenetre about:3pane qui possede l arbre ; state celui de la
  // fenetre chrome.
  /**
   * Bouton "N lues" dans la carte d un fil deplie dont des reponses lues sont
   * masquees, ou "Masquer les lues" quand elles sont affichees. Il est place
   * dans la carte, a cote du nombre de reponses : aucune ligne n est ajoutee a
   * la liste. Les cartes etant recyclees, il est recalcule a chaque passage.
   */
  _updateRevealChip(win, row, expandedParent) {
    let chip = row.querySelector(".material-thread-reveal");
    let label = null;
    let showAll = false;

    if (expandedParent && win.gDBView && hasReadRepliesTerm(win.gViewWrapper)) {
      try {
        const dbView = win.gDBView;
        const index = row.index;
        const thread = dbView.getThreadContainingIndex(index);
        if (thread && thread.numUnreadChildren > 0) {
          if (threadsShowingAll.has(threadKeyOf(thread.getRootHdr()))) {
            label = "Masquer les lues";
          } else {
            let shown = 0;
            for (let i = index + 1; i < dbView.rowCount && dbView.getLevel(i) > 0; i++) shown++;
            const hidden = thread.numChildren - 1 - shown;
            if (hidden > 0) {
              label = `+ ${hidden} lue${hidden > 1 ? "s" : ""}`;
              showAll = true;
            }
          }
        }
      } catch (e) {
        label = null;
      }
    }

    if (!label) {
      if (chip) chip.remove();
      return;
    }

    if (!chip) {
      const doc = row.ownerDocument;
      chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "material-thread-reveal";
      // La carte entiere reagit au clic (selection, glisser) : le bouton garde
      // ses evenements pour lui.
      for (const type of ["mousedown", "dblclick", "dragstart"]) {
        chip.addEventListener(type, (e) => e.stopPropagation());
      }
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const card = chip.closest("tr");
        if (card) this._setThreadShowsAll(win, card.index, chip.dataset.showAll === "true");
      });
      // La carte de fil est une grille a zones nommees : place apres le bouton
      // des reponses, le bouton ouvrait une troisieme rangee. En tete de la zone
      // "info", il partage la ligne du nombre de reponses.
      const info = row.querySelector(".thread-card-icon-info");
      if (info) info.prepend(chip); else return;
    }
    if (chip.textContent !== label) chip.textContent = label;
    chip.dataset.showAll = String(showAll);
    chip.title = showAll
      ? "Afficher les réponses déjà lues de ce fil"
      : "Masquer de nouveau les réponses déjà lues de ce fil";
  }

  /**
   * Hauteur des cartes de la liste des messages.
   *
   * La liste est virtualisee : Thunderbird place chaque ligne a
   * index * ThreadCard.ROW_HEIGHT, hauteur qu il calcule lui-meme d apres la
   * police et la densite (threadPane.densityChange) pour SES cartes. Celles du
   * theme ont plus de marge et de rembourrage (MATERIAL_CARD_EXTRA px) : les
   * lignes faisaient 83 a 90 px pour 70 prevus, et le decalage cumule
   * desalignait la liste (zones vides, fin de liste hors d atteinte, defilement
   * qui saute).
   *
   * On ajoute donc ce surplus au calcul de Thunderbird, et on publie la hauteur
   * de carte qui en decoule (--material-card-height) : thread-tree.css l impose
   * a toutes les cartes, qui ont ainsi exactement la hauteur attendue.
   */
  _adjustCardRowHeight(win3) {
    const pane = win3.threadPane;
    if (!pane || typeof pane.densityChange !== "function" || pane.__materialDensityChange) return;
    const original = pane.densityChange;
    pane.__materialDensityChange = original;
    pane.densityChange = async function (...args) {
      await original.apply(this, args);
      try {
        const cardClass = win3.customElements.get("thread-card");
        cardClass.ROW_HEIGHT += MATERIAL_CARD_EXTRA;
        const tree = win3.document.getElementById("threadTree");
        if (tree) {
          tree.style.setProperty("--material-card-height", `${cardClass.ROW_HEIGHT - MATERIAL_CARD_FRAME}px`);
        }
      } catch (e) {
        console.error("[Material-Thunderbird] Hauteur des cartes non ajustee :", e);
      }
    };
    try { pane.updateThreadItemSize(); } catch (e) {}
  }

  /**
   * Defilement garde quand Thunderbird actualise la meme vue.
   *
   * Avec le critere des reponses lues, la vue d un dossier devient une vue
   * "avec criteres de recherche". Thunderbird traite alors chaque fin de
   * chargement (dossier IMAP resynchronise, releve, fin de recherche) comme
   * celle d un filtre rapide : il replie les fils, redessine la liste et
   * restaure la selection, ce qui ramenait la liste sur le message ouvert
   * pendant qu on defilait ailleurs. Une vue sans critere n y passe pas.
   *
   * Quand la vue n a pas change (simple actualisation), la position de
   * defilement est donc remise telle qu elle etait. Un changement de dossier
   * ou une vue reconstruite garde le comportement de Thunderbird.
   */
  _keepScrollOnViewRefresh(win3) {
    const listener = win3.dbViewWrapperListener;
    if (!listener || typeof listener.onMessagesLoaded !== "function" || listener.__materialOnMessagesLoaded) return;
    const original = listener.onMessagesLoaded;
    listener.__materialOnMessagesLoaded = original;
    let lastView = null;
    listener.onMessagesLoaded = function (...args) {
      const tree = win3.document.getElementById("threadTree");
      const view = win3.gDBView;
      const keep = !!(tree && view && view === lastView && hasReadRepliesTerm(win3.gViewWrapper));
      const top = keep ? tree.scrollTop : 0;
      try {
        return original.apply(this, args);
      } finally {
        lastView = win3.gDBView;
        if (keep && tree.scrollTop !== top) tree.scrollTop = top;
      }
    };
  }

  _restoreViewRefresh(win3) {
    const listener = win3 && win3.dbViewWrapperListener;
    if (!listener || !listener.__materialOnMessagesLoaded) return;
    listener.onMessagesLoaded = listener.__materialOnMessagesLoaded;
    delete listener.__materialOnMessagesLoaded;
  }

  _restoreCardRowHeight(win3) {
    const pane = win3 && win3.threadPane;
    if (!pane || !pane.__materialDensityChange) return;
    pane.densityChange = pane.__materialDensityChange;
    delete pane.__materialDensityChange;
    try {
      const tree = win3.document.getElementById("threadTree");
      if (tree) tree.style.removeProperty("--material-card-height");
      pane.updateThreadItemSize();
    } catch (e) {}
  }

  _setupThreadTree(win, threadTree, state) {
    /**
     * Aucune ligne de la liste n est masquee, deplacee ni ajoutee ici : la liste
     * est virtualisee (voir "Reponses deja lues masquees" plus haut). Le masquage
     * des reponses lues se fait dans la vue ; on ne fait que decorer les cartes.
     */
    const processRows = () => {
      // Restes des versions qui masquaient les reponses.
      for (const stale of threadTree.querySelectorAll("tr.material-thread-toggle-row")) {
        stale.remove();
      }

      const rows = threadTree.querySelectorAll("tr.card-layout");
      let currentParent = null;
      let currentParentHasUnread = false;
      let parentExpanded = false;

      rows.forEach((row) => {
        row.classList.remove("material-thread-read-hidden");

        // 1. Avatar. La liste des messages est virtualisee : Thunderbird reutilise
        //    les <tr> pour d autres messages pendant le defilement. Un simple
        //    drapeau "deja resolu" figeait donc avatar du correspondant precedent.
        //    La cle memorise l expediteur rendu, et declenche un recalcul des qu il
        //    change.
        const cardContainer = row.querySelector(".card-container");
        const senderEl = row.querySelector(".sender");
        if (cardContainer && senderEl) {
          const senderText = senderEl.getAttribute("title") || senderEl.textContent || "";
          if (senderText && row.dataset.avatarKey !== senderText) {
            row.dataset.avatarKey = senderText;

            const avatarInfo = resolveAvatarInfo(win, senderText, (gravUrl) => {
              // La reponse Gravatar est asynchrone : la ligne a pu etre recyclee
              // entre-temps, auquel cas le resultat ne la concerne plus.
              if (row.dataset.avatarKey !== senderText) return;
              cardContainer.style.setProperty("--md-avatar-img", `url("${gravUrl}")`);
              cardContainer.style.removeProperty("--md-avatar-char");
            });

            cardContainer.style.setProperty("--md-avatar-bg", avatarInfo.bg);
            cardContainer.style.setProperty("--md-avatar-fg", avatarInfo.fg);

            if (avatarInfo.type === "img") {
              cardContainer.style.setProperty("--md-avatar-img", `url("${avatarInfo.url}")`);
              cardContainer.style.removeProperty("--md-avatar-char");
            } else {
              cardContainer.style.removeProperty("--md-avatar-img");
              cardContainer.style.setProperty("--md-avatar-char", `"${avatarInfo.char}"`);
            }

            row.classList.add("avatar-loaded");
          }
        }


        const isChild = row.getAttribute("data-properties")?.includes("thread-children");
        const isParent = !isChild && (row.classList.contains("children") || row.hasAttribute("aria-expanded"));
        const twisty = row.querySelector("button.twisty");

        if (isParent) {
          currentParent = row;
          parentExpanded = row.getAttribute("aria-expanded") === "true";

          // Fil avec des messages non lus. Lu dans les donnees de Thunderbird
          // seulement : les classes posees ici suivaient la ligne recyclee et
          // gardaient la bordure bleue sur des fils deja lus.
          const props = (row.getAttribute("data-properties") || "").split(/\s+/);
          let hasUnread = props.includes("hasUnread");
          if (!hasUnread && win.gDBView) {
            try {
              hasUnread = win.gDBView.getThreadContainingIndex(row.index).numUnreadChildren > 0;
            } catch (e) {}
          }

          currentParentHasUnread = !!hasUnread;
          if (hasUnread) {
            row.classList.add("has-unread-replies");
            if (twisty) twisty.classList.add("has-unread");
          } else {
            row.classList.remove("has-unread-replies");
            if (twisty) twisty.classList.remove("has-unread");
          }
        } else {
          // Ligne recyclee : elle a pu porter un fil non lu juste avant, et la
          // classe gardait la bordure bleue sur un message lu.
          row.classList.remove("has-unread-replies");
          if (twisty) twisty.classList.remove("has-unread");
        }

        // Restes de la version qui attenuait les reponses lues.
        row.classList.remove("material-thread-read-dimmed");
        this._updateRevealChip(win, row, isParent && parentExpanded);
      });
    };

    /**
     * processRows parcourt toutes les lignes et ecrit dans arbre, ce qui declenche
     * a nouveau observateur. Sans regroupement, un defilement dans un dossier
     * volumineux relancait un balayage complet a chaque mutation d attribut.
     * Le travail est donc reporte a la frame suivante et fusionne, et le drapeau
     * suspend les mutations que processRows provoque lui-meme.
     */
    let pending = false;
    let applying = false;

    const runProcessRows = () => {
      pending = false;
      applying = true;
      try {
        processRows();
      } finally {
        applying = false;
      }
    };

    const scheduleProcessRows = () => {
      if (pending || applying) return;
      pending = true;
      win.requestAnimationFrame(runProcessRows);
    };

    const treeObserver = new win.MutationObserver(scheduleProcessRows);
    treeObserver.observe(threadTree, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "class", "data-properties"]
    });

    if (state) state.observers.push(treeObserver);

    runProcessRows();
  }

  getAPI(context) {
    loadUnsubscribeRules(this.extension);
    return {
      materialAssistant: {
        showUnsubscribeBanner: async (details) => {
          if (!details || !unsubscribeBannerEnabled()) return;
          if (isUnsubscribeHiddenForMessage(details.messageId)) return;
          if (isUnsubscribeKeyIgnored(details.key)) return;
          // Les liens viennent d un courriel via le script d arriere-plan : ils
          // sont revalides ici, au dernier point avant affichage d un bouton chrome.
          const rules = UnsubscribeRules;
          const urlOk = !!rules && rules.isSafeUrl(details.url);
          if (!urlOk && !isSafeMailto(details.mailto)) return;

          // Le bandeau appartient a un message, donc a un onglet. Il etait rendu
          // dans toutes les fenetres courrier ouvertes : une infolettre lue dans
          // l une en faisait apparaitre un dans l autre, ou aucun message
          // correspondant n etait affiche.
          const target = this._windowForTab(context, details.tabId) ||
                         Services.wm.getMostRecentWindow("mail:3pane");
          if (target) {
            this._renderUnsubscribeBanner(target, {
              kind: details.kind === "list" ? "list" : "newsletter",
              url: urlOk ? details.url : "",
              mailto: urlOk ? "" : details.mailto,
              oneClick: urlOk && !!details.oneClick,
              listName: details.listName || "",
              senderName: details.senderName || "",
              key: details.key || "",
              messageId: details.messageId || ""
            });
          }
        },
        hideUnsubscribeBanner: async () => {
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) {
            const win = windows.getNext();
            this._removeUnsubscribeBanner(win);
          }
        },
        openSettingsModal: async () => {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          if (win) {
            this._openCustomizerModal(win);
          }
        }
      }
    };
  }
};
