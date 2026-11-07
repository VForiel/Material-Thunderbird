/**
 * Material-Thunderbird - WebExtension Experiment
 * Component: Material Assistant (Chrome Native Unsubscribe Banner & Material You Helpers)
 * Injects Material Design 3 enhancements directly into the Thunderbird chrome window:
 * 1. Native unsubscribe banner, rendered on request from background.js
 * 2. Unified Avatar Resolution (Address Book photo > Gravatar, opt-in > Contact initial > Email initial)
 * 3. Text-sized sender avatar in multimessage view (multiMessageBrowser)
 * 4. Thread reply unread status and auto-collapse of read messages in expanded threads
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
const PREF_THEME_MODE = "extensions.material-thunderbird.theme-mode";
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
  const block = (values, indent) =>
    `${indent}--md-sys-color-primary: ${values[0]};\n` +
    `${indent}--md-sys-color-primary-container: ${values[1]};\n` +
    `${indent}--md-sys-color-secondary-container: ${values[2]};\n`;
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
  try { palette = Services.prefs.getStringPref(PREF_PALETTE, "blue"); } catch (e) {}
  try { emojis = Services.prefs.getBoolPref(PREF_EMOJIS, false); } catch (e) {}
  if (!PALETTES_CONFIG[palette]) palette = "blue";
  return { palette, themeMode: getThemeMode(), emojis };
}

function saveCustomizerSettings(settings) {
  try {
    if (settings.palette) Services.prefs.setStringPref(PREF_PALETTE, settings.palette);
    if (settings.themeMode) setThemeMode(settings.themeMode);
    if (typeof settings.emojis === "boolean") Services.prefs.setBoolPref(PREF_EMOJIS, settings.emojis);
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
 * Icone faite d un emoji. Les icones de dossiers et de la barre des espaces
 * sont des <img> dont l image vient de la propriete content : un <img> n a pas
 * de ::before, l emoji n apparaissait donc jamais, et couper les proprietes de
 * contexte laissait l icone d origine en silhouette noire. On remplace l image
 * elle-meme par un petit SVG contenant l emoji.
 */
function emojiImage(emoji) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
    '<text x="10" y="16" font-size="16" text-anchor="middle" ' +
    'font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">' +
    emoji + "</text></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const FOLDER_EMOJIS = [
  ["inbox", "📥"],
  ["sent", "📤"],
  ["drafts", "📝"],
  ["templates", "📋"],
  ["archive", "🗃️"],
  ["junk", "🚫"],
  ["trash", "🗑️"],
  ["outbox", "📮"],
  ["virtual", "🔎"]
];

const SPACES_EMOJIS = [
  ["mailButton", "✉️"],
  ["addressBookButton", "📇"],
  ["calendarButton", "📆"],
  ["tasksButton", "✅"],
  ["chatButton", "💬"],
  ["settingsButton", "⚙️"]
];

function emojiCss() {
  const icon = (selector, emoji) =>
    `${selector} {\n  content: ${emojiImage(emoji)} !important;\n  -moz-context-properties: none !important;\n}\n`;
  let css = "/* Icones emojis */\n";
  css += icon("#folderTree li > .container > .icon", "📁");
  css += icon("#folderTree li[data-server-type] > .container > .icon", "📬");
  for (const [type, emoji] of FOLDER_EMOJIS) {
    css += icon(`#folderTree li[data-folder-type="${type}"] > .container > .icon`, emoji);
  }
  for (const [id, emoji] of SPACES_EMOJIS) {
    css += icon(`#${id} > img`, emoji);
  }
  // Le "+" du bouton de redaction est une image de fond, pas un <img>.
  css += `#folderPaneWriteMessage {
  background-image: none !important;
}
#folderPaneWriteMessage::before {
  content: "✏️" !important;
  margin-inline-end: 6px !important;
}
`;
  return css;
}

/**
 * :root:root ajoute une classe de specificite : a importance egale, ces regles
 * l emportent ainsi sur celles de chrome/tokens/ quel que soit l ordre des
 * feuilles.
 */
function generateCustomizerCss(settings) {
  const pal = PALETTES_CONFIG[settings.palette] || PALETTES_CONFIG.blue;
  const body = paletteCss(pal).replace(/:root/g, ":root:root") + "\n" +
    (settings.emojis ? emojiCss() : "");
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
  
  if (str.includes("@")) {
    return { displayName: "", email: str.replace(/[<>]/g, "").trim() };
  }
  
  return { displayName: str, email: "" };
}

/**
 * Resolution unifiee des avatars
 * Priorite 1 : photo du carnet d adresses (card.photoURL)
 * Priorite 2 : Gravatar, uniquement si l utilisateur l a active (voir GRAVATAR_PREF)
 * Priorite 3 : initiale du contact enregistre (card.displayName || displayName)
 * Priorite 4 : initiale de l adresse courriel (cleanEmail)
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

  // 2. Priority 2: Gravatar
  if (cleanEmail) {
    if (gravatarCache.has(cleanEmail)) {
      const g = gravatarCache.get(cleanEmail);
      if (g && g.found) {
        return {
          type: "img",
          url: g.url,
          char: "",
          bg: palette.bg,
          fg: palette.fg,
          cleanEmail
        };
      }
    } else {
      checkGravatar(win, cleanEmail, onGravatarResolved);
    }
  }

  // 3. Priority 3: First letter of the saved contact name
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

  // 4. Priority 4: First letter of the email address
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
        for (const row of doc.querySelectorAll(".material-thread-read-hidden")) {
          row.classList.remove("material-thread-read-hidden");
        }
        for (const row of doc.querySelectorAll("[data-avatar-key]")) {
          delete row.dataset.avatarKey;
          row.classList.remove("avatar-loaded");
        }
      } catch (e) {}
    }
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
        <label class="material-option-row" for="material-emoji-toggle">
          <span class="material-option-info">
            <span class="material-option-title">Icônes émojis</span>
            <span class="material-option-desc">Remplace les icônes des dossiers et de la barre des espaces par des émojis.</span>
          </span>
          <span class="material-switch">
            <input type="checkbox" id="material-emoji-toggle"${settings.emojis ? ' checked="checked"' : ""} />
            <span class="material-switch-slider"></span>
          </span>
        </label>
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

    // Emoji toggle
    const emojiToggle = dialog.querySelector("#material-emoji-toggle");
    if (emojiToggle) {
      emojiToggle.addEventListener("change", () => {
        const cur = getCustomizerSettings();
        cur.emojis = emojiToggle.checked;
        saveCustomizerSettings(cur);
        this._applyCustomizerSheet();
      });
    }

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
    for (const pref of [PREF_PALETTE, PREF_THEME_MODE, PREF_EMOJIS]) {
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

  _renderUnsubscribeBanner(chromeWin, unsubscribeUrl, senderName) {
    const win = this._aboutMessageWindow(chromeWin);
    if (!win) return;
    const doc = win.document;
    let banner = doc.getElementById("material-unsubscribe-banner");
    if (!banner) {
      banner = doc.createElement("div");
      banner.id = "material-unsubscribe-banner";
      banner.className = "material-unsubscribe-card";
    }

    // Le nom d expediteur vient du courriel. Il est insere en tant que texte, jamais
    // en tant que balisage : innerHTML dans le document chrome placerait une donnee
    // non fiable dans un contexte privilegie, et le filtrage de <, > et " qui le
    // precedait etait la seule barriere.
    const cleanSender = (senderName || "").trim() || "Cet expéditeur";

    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const SVG_NS = "http://www.w3.org/2000/svg";
    const svgIcon = (size, pathData) => {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "currentColor");
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathData);
      svg.appendChild(path);
      return svg;
    };
    const div = (className) => {
      const el = doc.createElement("div");
      el.className = className;
      return el;
    };
    const span = (className, text) => {
      const el = doc.createElement("span");
      el.className = className;
      el.textContent = text;
      return el;
    };

    const left = div("material-unsub-left");
    const icon = div("material-unsub-icon");
    icon.appendChild(svgIcon(18, "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"));
    const details = div("material-unsub-details");
    details.appendChild(span("material-unsub-title", "Courrier commercial / Infolettre"));
    details.appendChild(span("material-unsub-desc", `Un lien de désinscription a été détecté pour ${cleanSender}.`));
    left.appendChild(icon);
    left.appendChild(details);

    const actions = div("material-unsub-actions");
    const triggerBtn = doc.createElement("button");
    triggerBtn.type = "button";
    triggerBtn.className = "material-unsub-btn";
    triggerBtn.id = "material-unsub-trigger-btn";
    triggerBtn.appendChild(svgIcon(13, "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"));
    triggerBtn.appendChild(doc.createTextNode(" Se désinscrire"));

    // L URL cible est affichee en infobulle : le bandeau chrome a l apparence d un
    // element natif de Thunderbird, l utilisateur doit pouvoir verifier la destination.
    try {
      triggerBtn.setAttribute("title", `Ouvrir ${new win.URL(unsubscribeUrl).host}`);
    } catch (e) {
      triggerBtn.setAttribute("title", "Ouvrir le lien de désinscription");
    }

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "material-unsub-close";
    closeBtn.id = "material-unsub-close-btn";
    closeBtn.setAttribute("title", "Ignorer");
    closeBtn.textContent = "×";

    actions.appendChild(triggerBtn);
    actions.appendChild(closeBtn);
    banner.appendChild(left);
    banner.appendChild(actions);

    triggerBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Dernier controle avant navigation : l URL provient du courriel, donc d une
      // source non fiable. Sans ce filtre, un lien file:, data: ou chrome: place
      // par expediteur serait ouvert depuis la fenetre privilegiee.
      if (!UnsubscribeRules || !UnsubscribeRules.isSafeUrl(unsubscribeUrl)) {
        console.error("[Material-Thunderbird] URL de desinscription refusee : " + unsubscribeUrl);
        return;
      }

      try {
        // Le bandeau vit dans about:message, qui n a pas de fonction de
        // navigation : msgHdrView.js passe lui aussi par top pour ouvrir ses
        // liens. Sans cela on retombait sur le service de protocole externe et
        // le lien partait dans le navigateur du systeme.
        const host = win.top || win;
        if (typeof host.openContentTab === "function") {
          host.openContentTab(unsubscribeUrl);
        } else if (typeof host.openURL === "function") {
          host.openURL(unsubscribeUrl);
        } else {
          const uri = Services.io.newURI(unsubscribeUrl);
          const extProtocolSvc = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
            .getService(Ci.nsIExternalProtocolService);
          extProtocolSvc.loadURI(uri);
        }
      } catch (err) {
        console.error("[Material-Thunderbird] Ouverture du lien impossible : " + err);
      }
    };

    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      banner.remove();
    };

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
        const rawFrom = fromRec.getAttribute("label") ||
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
  _setupThreadTree(win, threadTree, state) {
    const processRows = () => {
      const rows = threadTree.querySelectorAll("tr.card-layout");
      let currentParent = null;
      let currentParentHasUnread = false;
      let parentExpanded = false;
      let hiddenReadRows = [];
      let lastVisibleAnchor = null;

      rows.forEach((row) => {
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
          // Flush toggle row for previous parent if needed
          if (currentParent && hiddenReadRows.length > 0 && parentExpanded) {
            this._ensureShowAllButton(currentParent, lastVisibleAnchor || currentParent, hiddenReadRows);
          } else if (currentParent && !parentExpanded) {
            this._removeShowAllButton(currentParent);
          }

          currentParent = row;
          parentExpanded = row.getAttribute("aria-expanded") === "true";
          hiddenReadRows = [];
          lastVisibleAnchor = row;

          // Detect if this parent thread has unread replies
          const hasUnread = (twisty && (twisty.classList.contains("has-unread") ||
                            twisty.getAttribute("data-properties")?.includes("unread") ||
                            twisty.getAttribute("aria-label")?.toLowerCase().includes("non lu") ||
                            twisty.getAttribute("aria-label")?.toLowerCase().includes("unread"))) ||
                            row.getAttribute("data-properties")?.includes("hasUnread") ||
                            row.classList.contains("has-unread-replies");

          currentParentHasUnread = !!hasUnread;
          if (hasUnread) {
            row.classList.add("has-unread-replies");
            if (twisty) twisty.classList.add("has-unread");
          } else {
            row.classList.remove("has-unread-replies");
            if (twisty) twisty.classList.remove("has-unread");
          }

          if (!parentExpanded) {
            delete currentParent.dataset.showingAll;
            this._removeShowAllButton(currentParent);
          }
        } else if (isChild && currentParent && parentExpanded) {
          const isUnread = row.getAttribute("data-properties")?.includes("unread") || row.classList.contains("unread");

          if (currentParentHasUnread && !isUnread && !currentParent.dataset.showingAll) {
            // Scenario A: Thread has unread replies, this child is read -> hide it
            row.classList.add("material-thread-read-hidden");
            hiddenReadRows.push(row);
          } else {
            // Scenario B: All replies are read, or child is unread, or user requested all -> show it
            row.classList.remove("material-thread-read-hidden");
            lastVisibleAnchor = row;
          }
        }
      });

      // Final parent check
      if (currentParent && hiddenReadRows.length > 0 && parentExpanded) {
        this._ensureShowAllButton(currentParent, lastVisibleAnchor || currentParent, hiddenReadRows);
      } else if (currentParent && !parentExpanded) {
        this._removeShowAllButton(currentParent);
      }
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

  _ensureShowAllButton(parentRow, anchorRow, hiddenRows) {
    let nextRow = anchorRow.nextElementSibling;
    if (nextRow && nextRow.classList.contains("material-thread-toggle-row")) {
      const btn = nextRow.querySelector(".material-show-all-thread-btn");
      if (btn) btn.textContent = `Afficher toutes les réponses (${hiddenRows.length})`;
      return;
    }

    const toggleRow = parentRow.ownerDocument.createElement("tr");
    toggleRow.className = "material-thread-toggle-row";
    toggleRow.dataset.parentThreadId = parentRow.id || "thread";
    const td = parentRow.ownerDocument.createElement("td");
    td.setAttribute("colspan", "100%");

    const btn = parentRow.ownerDocument.createElement("button");
    btn.type = "button";
    btn.className = "material-show-all-thread-btn";
    btn.textContent = `Afficher toutes les réponses (${hiddenRows.length})`;

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      parentRow.dataset.showingAll = "true";
      hiddenRows.forEach((r) => r.classList.remove("material-thread-read-hidden"));
      toggleRow.remove();
    };

    td.appendChild(btn);
    toggleRow.appendChild(td);
    anchorRow.after(toggleRow);
  }

  _removeShowAllButton(parentRow) {
    let sibling = parentRow.nextElementSibling;
    while (sibling && sibling.getAttribute("data-properties")?.includes("thread-children")) {
      sibling = sibling.nextElementSibling;
    }
    if (sibling && sibling.classList.contains("material-thread-toggle-row")) {
      sibling.remove();
    }
  }

  getAPI(context) {
    loadUnsubscribeRules(this.extension);
    return {
      materialAssistant: {
        showUnsubscribeBanner: async (unsubscribeUrl, senderName, tabId) => {
          // L URL vient d un courriel via le script d arriere-plan : elle est
          // revalidee ici, au dernier point avant affichage d un bouton chrome.
          const rules = UnsubscribeRules;
          if (!rules || !rules.isSafeUrl(unsubscribeUrl)) return;

          // Le bandeau appartient a un message, donc a un onglet. Il etait rendu
          // dans toutes les fenetres courrier ouvertes : une infolettre lue dans
          // l une en faisait apparaitre un dans l autre, ou aucun message
          // correspondant n etait affiche.
          const target = this._windowForTab(context, tabId) ||
                         Services.wm.getMostRecentWindow("mail:3pane");
          if (target) {
            this._renderUnsubscribeBanner(target, unsubscribeUrl, senderName);
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
