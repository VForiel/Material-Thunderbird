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

var Services;
try {
  ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (e) {
  ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
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
const PREF_THEME_MODE = "extensions.material-thunderbird.theme-mode";
const PREF_EMOJIS = "extensions.material-thunderbird.emojis";

const PALETTES_CONFIG = {
  blue: {
    name: "Bleu Google",
    color: "#0b57d0",
    desc: "Classique M3",
    css: `
:root {
  --md-sys-color-primary: #0b57d0;
  --md-sys-color-primary-container: #d3e3fd;
  --md-sys-color-secondary-container: #c2e7ff;
}
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) {
    --md-sys-color-primary: #a8c7fa;
    --md-sys-color-primary-container: #004a77;
    --md-sys-color-secondary-container: #004b72;
  }
}
:root[lwt-theme-brighttext="true"] {
  --md-sys-color-primary: #a8c7fa;
  --md-sys-color-primary-container: #004a77;
  --md-sys-color-secondary-container: #004b72;
}`
  },
  emerald: {
    name: "Émeraude",
    color: "#006a60",
    desc: "Nature & Sérénité",
    css: `
:root {
  --md-sys-color-primary: #006a60;
  --md-sys-color-primary-container: #74f8e5;
  --md-sys-color-secondary-container: #cce8e3;
}
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) {
    --md-sys-color-primary: #53dbc9;
    --md-sys-color-primary-container: #005048;
    --md-sys-color-secondary-container: #334b46;
  }
}
:root[lwt-theme-brighttext="true"] {
  --md-sys-color-primary: #53dbc9;
  --md-sys-color-primary-container: #005048;
  --md-sys-color-secondary-container: #334b46;
}`
  },
  purple: {
    name: "Améthyste",
    color: "#6750a4",
    desc: "Violet élégant",
    css: `
:root {
  --md-sys-color-primary: #6750a4;
  --md-sys-color-primary-container: #eaddff;
  --md-sys-color-secondary-container: #e8def8;
}
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) {
    --md-sys-color-primary: #d0bcff;
    --md-sys-color-primary-container: #4f378b;
    --md-sys-color-secondary-container: #4a4458;
  }
}
:root[lwt-theme-brighttext="true"] {
  --md-sys-color-primary: #d0bcff;
  --md-sys-color-primary-container: #4f378b;
  --md-sys-color-secondary-container: #4a4458;
}`
  },
  coral: {
    name: "Corail",
    color: "#9c4125",
    desc: "Terracotta chaud",
    css: `
:root {
  --md-sys-color-primary: #9c4125;
  --md-sys-color-primary-container: #ffdbd1;
  --md-sys-color-secondary-container: #f5ddd6;
}
@media (prefers-color-scheme: dark) {
  :root:not([lwt-theme-brighttext="false"]) {
    --md-sys-color-primary: #ffb59f;
    --md-sys-color-primary-container: #7d2b11;
    --md-sys-color-secondary-container: #5c2a1a;
  }
}
:root[lwt-theme-brighttext="true"] {
  --md-sys-color-primary: #ffb59f;
  --md-sys-color-primary-container: #7d2b11;
  --md-sys-color-secondary-container: #5c2a1a;
}`
  }
};

const THEME_MODE_CSS = {
  light: `
:root, :root:not([lwt-theme-brighttext="false"]), :root[lwt-theme-brighttext="true"] {
  --md-sys-color-surface: #f0f4fa !important;
  --md-sys-color-surface-dim: #ded8e1 !important;
  --md-sys-color-surface-bright: #fdf8fd !important;
  --md-sys-color-surface-container-lowest: #ffffff !important;
  --md-sys-color-surface-container-low: #edf2fa !important;
  --md-sys-color-surface-container: #e2e8f0 !important;
  --md-sys-color-surface-container-high: #dbe3f0 !important;
  --md-sys-color-surface-container-highest: #cfd8e8 !important;
  --md-sys-color-on-surface: #1f1f1f !important;
  --md-sys-color-on-surface-variant: #444746 !important;
  --md-sys-color-outline: #747775 !important;
  --md-sys-color-outline-variant: #c4c7c5 !important;
  --md-sys-color-inverse-surface: #303030 !important;
  --md-sys-color-inverse-on-surface: #f2f2f2 !important;
}`,
  dark: `
:root, :root[lwt-theme-brighttext="false"] {
  --md-sys-color-surface: #111315 !important;
  --md-sys-color-surface-dim: #111315 !important;
  --md-sys-color-surface-bright: #37393b !important;
  --md-sys-color-surface-container-lowest: #0c0e10 !important;
  --md-sys-color-surface-container-low: #191c1e !important;
  --md-sys-color-surface-container: #1d2023 !important;
  --md-sys-color-surface-container-high: #272a2d !important;
  --md-sys-color-surface-container-highest: #323538 !important;
  --md-sys-color-on-surface: #e2e2e5 !important;
  --md-sys-color-on-surface-variant: #c4c7c5 !important;
  --md-sys-color-outline: #8e918f !important;
  --md-sys-color-outline-variant: #444746 !important;
  --md-sys-color-inverse-surface: #e2e2e5 !important;
  --md-sys-color-inverse-on-surface: #303030 !important;
}`,
  auto: ""
};

function getCustomizerSettings() {
  let palette = "blue";
  let themeMode = "auto";
  let emojis = false;
  try { palette = Services.prefs.getStringPref(PREF_PALETTE, "blue"); } catch (e) {}
  try { themeMode = Services.prefs.getStringPref(PREF_THEME_MODE, "auto"); } catch (e) {}
  try { emojis = Services.prefs.getBoolPref(PREF_EMOJIS, false); } catch (e) {}
  if (!PALETTES_CONFIG[palette]) palette = "blue";
  return { palette, themeMode, emojis };
}

function saveCustomizerSettings(settings) {
  try {
    if (settings.palette) Services.prefs.setStringPref(PREF_PALETTE, settings.palette);
    if (settings.themeMode) Services.prefs.setStringPref(PREF_THEME_MODE, settings.themeMode);
    if (typeof settings.emojis === "boolean") Services.prefs.setBoolPref(PREF_EMOJIS, settings.emojis);
  } catch (e) {
    console.error("[Material-Thunderbird] Error saving prefs:", e);
  }
}

function generateOverridesCss(settings) {
  const pal = PALETTES_CONFIG[settings.palette] || PALETTES_CONFIG.blue;
  const themeCss = THEME_MODE_CSS[settings.themeMode] || "";
  let emojiCss = "";
  if (settings.emojis) {
    emojiCss = `
/* Modern Emoji Icons Mode */
:root[data-material-emojis="true"] #folderTree li .icon {
  background-image: none !important;
  -moz-context-properties: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
:root[data-material-emojis="true"] #folderTree li .icon::before {
  content: "📁" !important;
  font-size: 14px !important;
}
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="inbox"], [data-properties~="specialFolder-Inbox"]) .icon::before { content: "📥" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="sent"], [data-properties~="specialFolder-Sent"]) .icon::before { content: "📤" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="drafts"], [data-folder-type="draft"], [data-properties~="specialFolder-Drafts"]) .icon::before { content: "📝" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="archive"], [data-folder-type="archives"], [data-properties~="specialFolder-Archive"]) .icon::before { content: "📁" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="trash"], [data-properties~="specialFolder-Trash"]) .icon::before { content: "🗑️" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="junk"], [data-properties~="specialFolder-Junk"]) .icon::before { content: "🚫" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="starred"], [data-properties~="starred"], [data-properties~="specialFolder-Starred"]) .icon::before { content: "⭐" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="outbox"], [data-properties~="specialFolder-Outbox"]) .icon::before { content: "📨" !important; }
:root[data-material-emojis="true"] #folderTree li:is([data-folder-type="templates"], [data-properties~="specialFolder-Templates"]) .icon::before { content: "📋" !important; }

:root[data-material-emojis="true"] .spaces-toolbar-button > img { display: none !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#mail-button, [data-l10n-id*="mail"])::before { content: "✉️" !important; font-size: 18px !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#addressbook-button, [data-l10n-id*="address"])::before { content: "📇" !important; font-size: 18px !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#calendar-button, [data-l10n-id*="calendar"])::before { content: "📆" !important; font-size: 18px !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#tasks-button, [data-l10n-id*="tasks"])::before { content: "✔️" !important; font-size: 18px !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#chat-button, [data-l10n-id*="chat"])::before { content: "💬" !important; font-size: 18px !important; }
:root[data-material-emojis="true"] .spaces-toolbar-button:is(#settings-button, [data-l10n-id*="settings"])::before { content: "⚙️" !important; font-size: 18px !important; }

:root[data-material-emojis="true"] #folderPaneWriteMessage .button-icon { display: none !important; }
:root[data-material-emojis="true"] #folderPaneWriteMessage::before { content: "✏️ " !important; font-size: 14px !important; }
`;
  }

  return `/**
 * Personnalisation Material-Thunderbird (Généré automatiquement)
 */
${pal.css}
${themeCss}
${emojiCss}
`;
}

function saveUserOverridesFile(cssContent) {
  try {
    const profDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
    const chromeDir = profDir.clone();
    chromeDir.append("chrome");
    if (!chromeDir.exists()) {
      chromeDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o755);
    }
    const overridesFile = chromeDir.clone();
    overridesFile.append("user-overrides.css");

    const fos = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    fos.init(overridesFile, 0x02 | 0x08 | 0x20, 0o644, 0);
    const cos = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
    cos.init(fos, "UTF-8", 0, 0);
    cos.writeString(cssContent);
    cos.close();
    fos.close();
  } catch (e) {
    console.error("[Material-Thunderbird] Error saving user-overrides.css:", e);
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

function loadUnsubscribeRules(extension) {
  if (UnsubscribeRules) return UnsubscribeRules;
  try {
    const scope = {};
    Services.scriptloader.loadSubScript(
      extension.rootURI.resolve("shared/unsubscribe-rules.js"),
      scope
    );
    UnsubscribeRules = scope.MaterialUnsubscribeRules || null;
  } catch (e) {
    Cu.reportError("[Material-Thunderbird] Chargement des regles impossible : " + e);
    UnsubscribeRules = null;
  }
  return UnsubscribeRules;
}

this.materialAssistant = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
    loadUnsubscribeRules(this.extension);
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

    // Au redemarrage complet de application, la fenetre disparait de toute facon.
    if (isAppShutdown) return;

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
    try {
      const spBtn = win.document && win.document.getElementById("material-sponsor-btn");
      if (spBtn) spBtn.remove();
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
      this._setupWindow(win);
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
      onTabSwitched: () => this._attachToCurrentTab(win),
      onTabOpened: () => this._attachToCurrentTab(win),
      onTabRestored: () => this._attachToCurrentTab(win),
      // tabmail appelle onTabTitleChanged sans garde : la methode doit exister.
      onTabTitleChanged: () => {},
      onTabClosing: () => {},
      onTabPersist: () => null
    };
    tabmail.registerTabMonitor(monitor);
    state.tabMonitor = monitor;

    this._ensureCustomizerButtons(win);
    this._applyCustomizerStylesToWindow(win);
    this._attachToCurrentTab(win);

    const onKeyDown = (e) => {
      const isM = e.key === "m" || e.key === "M" || e.code === "KeyM";
      // Supporte Ctrl+Alt+M, Alt+Shift+M, ou Ctrl+Shift+M (évite le conflit avec le menu Messages de Windows)
      if (isM && ((e.altKey && e.ctrlKey) || (e.altKey && e.shiftKey) || (e.ctrlKey && e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        this._openCustomizerModal(win);
      }
    };
    win.addEventListener("keydown", onKeyDown);
    state.listeners.push([win, "keydown", onKeyDown, false]);
  }

  _ensureCustomizerButtons(win) {
    if (!win || !win.document) return;
    const doc = win.document;

    // Trouver le bouton des paramètres dans la Spaces Toolbar (barre latérale)
    const settingsBtn = doc.getElementById("settingsButton") ||
                        doc.querySelector('[data-l10n-id*="settings"]') ||
                        doc.querySelector(".spaces-toolbar-bottom-container .spaces-toolbar-button") ||
                        doc.querySelector(".spaces-toolbar-pinned-button");

    const bottomContainer = doc.querySelector(".spaces-toolbar-bottom-container") ||
                            (settingsBtn ? settingsBtn.parentNode : null) ||
                            doc.querySelector(".spaces-toolbar") ||
                            doc.getElementById("spacesToolbar");

    if (!bottomContainer && !settingsBtn) return;

    // 1. Bouton Personnalisation & Thème Material You
    if (!doc.getElementById("material-theme-settings-btn")) {
      const customBtn = doc.createElement("button");
      customBtn.id = "material-theme-settings-btn";
      customBtn.type = "button";
      customBtn.className = "spaces-toolbar-button";
      customBtn.setAttribute("tabindex", "-1");
      customBtn.setAttribute("title", "Personnaliser Material-Thunderbird (Thème, Couleurs, Émojis) [Ctrl+Alt+M]");
      customBtn.setAttribute("aria-label", "Personnaliser le thème Material-Thunderbird");
      customBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;display:block;"><path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 18.5a1 1 0 0 0 .15 1.41c.4.32.96.3 1.34-.06l1.39-1.32C8.65 19.38 10.26 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`;
      customBtn.style.cssText = "display:flex;align-items:center;justify-content:center;cursor:pointer;margin:4px auto;padding:6px;border:none;background:transparent;color:var(--md-sys-color-primary, #0b57d0);";

      customBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openCustomizerModal(win);
      });

      if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(customBtn, settingsBtn);
      } else if (bottomContainer) {
        bottomContainer.appendChild(customBtn);
      }
    }

    // 2. Bouton Soutenir / Sponsor (GitHub Sponsors)
    if (!doc.getElementById("material-sponsor-btn")) {
      const sponsorBtn = doc.createElement("button");
      sponsorBtn.id = "material-sponsor-btn";
      sponsorBtn.type = "button";
      sponsorBtn.className = "spaces-toolbar-button";
      sponsorBtn.setAttribute("tabindex", "-1");
      sponsorBtn.setAttribute("title", "Soutenir Material-Thunderbird (GitHub Sponsors)");
      sponsorBtn.setAttribute("aria-label", "Soutenir le développement du thème");
      sponsorBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#ea4aaa" style="vertical-align:middle;display:block;"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
      sponsorBtn.style.cssText = "display:flex;align-items:center;justify-content:center;cursor:pointer;margin:4px auto;padding:6px;border:none;background:transparent;";

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

      if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(sponsorBtn, settingsBtn);
      } else if (bottomContainer) {
        bottomContainer.appendChild(sponsorBtn);
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
      item.setAttribute("acceltext", "Ctrl+Alt+M");
      item.addEventListener("command", () => {
        this._openCustomizerModal(win);
      });
      toolsPopup.appendChild(item);
    }
  }
  }

  _applyCustomizerStylesToDocument(doc) {
    if (!doc) return;
    const settings = getCustomizerSettings();
    const cssContent = generateOverridesCss(settings);
    try {
      let style = doc.getElementById("material-live-customizer");
      if (!style) {
        style = doc.createElement("style");
        style.id = "material-live-customizer";
        const targetHead = doc.head || doc.documentElement;
        if (targetHead) targetHead.appendChild(style);
      }
      style.textContent = cssContent;

      if (doc.documentElement) {
        if (settings.emojis) {
          doc.documentElement.setAttribute("data-material-emojis", "true");
          doc.documentElement.classList.add("material-emojis-active");
        } else {
          doc.documentElement.removeAttribute("data-material-emojis");
          doc.documentElement.classList.remove("material-emojis-active");
        }
      }
    } catch (e) {
      console.error("[Material-Thunderbird] Error applying customizer styles to doc:", e);
    }
  }

  _applyCustomizerStylesToWindow(win) {
    if (!win || !win.document) return;
    this._applyCustomizerStylesToDocument(win.document);
    const state = win.__materialWindowState;
    if (state && Array.isArray(state.documents)) {
      for (const d of state.documents) {
        this._applyCustomizerStylesToDocument(d);
      }
    }
  }

  _applyStylesToAllWindows() {
    const settings = getCustomizerSettings();
    const css = generateOverridesCss(settings);
    saveUserOverridesFile(css);

    const windows = Services.wm.getEnumerator("mail:3pane");
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      this._applyCustomizerStylesToWindow(win);
    }
  }

  _openCustomizerModal(win) {
    if (!win || !win.document) return;
    const doc = win.document;
    let backdrop = doc.getElementById("material-customizer-backdrop");
    if (backdrop) {
      backdrop.classList.add("active");
      return;
    }

    const settings = getCustomizerSettings();
    backdrop = doc.createElement("div");
    backdrop.id = "material-customizer-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "material-customizer-title");

    const dialog = doc.createElement("div");
    dialog.id = "material-customizer-dialog";

    dialog.innerHTML = `
      <div class="material-modal-header">
        <div class="material-modal-title-group">
          <div class="material-modal-icon">🎨</div>
          <div>
            <h2 id="material-customizer-title" class="material-modal-title">Material-Thunderbird</h2>
            <div style="font-size: 11.5px; color: var(--md-sys-color-primary, #0b57d0); font-weight: 600;">Personnalisation & Options du thème</div>
          </div>
        </div>
        <button id="material-modal-close" class="material-modal-close-btn" title="Fermer (Échap)">✕</button>
      </div>

      <!-- Section 1 : Mode d'affichage -->
      <div>
        <div class="material-modal-section-title">Mode d'affichage</div>
        <div class="material-segmented-group" id="material-mode-group">
          <button type="button" class="material-segmented-btn \${settings.themeMode === 'light' ? 'active' : ''}" data-mode="light">☀️ Clair</button>
          <button type="button" class="material-segmented-btn \${settings.themeMode === 'dark' ? 'active' : ''}" data-mode="dark">🌙 Sombre</button>
          <button type="button" class="material-segmented-btn \${settings.themeMode === 'auto' ? 'active' : ''}" data-mode="auto">💻 Système</button>
        </div>
      </div>

      <!-- Section 2 : Palettes de couleurs -->
      <div>
        <div class="material-modal-section-title">Palette de couleurs Material You</div>
        <div class="material-palette-grid" id="material-palette-group">
          <div class="material-palette-card \${settings.palette === 'blue' ? 'active' : ''}" data-pal="blue">
            <div class="material-palette-dot" style="background: #0b57d0;"></div>
            <div>
              <div class="material-palette-name">Bleu Google</div>
              <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant, #444746);">Classique M3</div>
            </div>
          </div>
          <div class="material-palette-card \${settings.palette === 'emerald' ? 'active' : ''}" data-pal="emerald">
            <div class="material-palette-dot" style="background: #006a60;"></div>
            <div>
              <div class="material-palette-name">Émeraude</div>
              <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant, #444746);">Nature & Sérénité</div>
            </div>
          </div>
          <div class="material-palette-card \${settings.palette === 'purple' ? 'active' : ''}" data-pal="purple">
            <div class="material-palette-dot" style="background: #6750a4;"></div>
            <div>
              <div class="material-palette-name">Améthyste</div>
              <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant, #444746);">Violet élégant</div>
            </div>
          </div>
          <div class="material-palette-card \${settings.palette === 'coral' ? 'active' : ''}" data-pal="coral">
            <div class="material-palette-dot" style="background: #9c4125;"></div>
            <div>
              <div class="material-palette-name">Corail</div>
              <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant, #444746);">Terracotta chaud</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 3 : Emojis Modernes -->
      <div>
        <div class="material-modal-section-title">Icônes de l'interface</div>
        <div class="material-option-row">
          <div class="material-option-info">
            <div class="material-option-title">Icônes Émojis Modernes</div>
            <div class="material-option-desc">Remplace les icônes de dossiers et d'onglets par des émojis colorés (📥 📤 ⭐ 📝 📁 🗑️ ✉️ 📇 📆).</div>
          </div>
          <label class="material-switch">
            <input type="checkbox" id="material-emoji-toggle" \${settings.emojis ? 'checked' : ''}>
            <span class="material-switch-slider"></span>
          </label>
        </div>
      </div>

      <!-- Section 4 : Soutenir le projet -->
      <div class="material-sponsor-banner">
        <div>
          <div style="font-size: 13.5px; font-weight: 700; color: #ea4aaa; display: flex; align-items: center; gap: 6px;">
            <span>💖</span> Soutenir le développement
          </div>
          <div style="font-size: 11.5px; color: var(--md-sys-color-on-surface-variant, #444746); margin-top: 2px;">
            Material-Thunderbird est 100% gratuit et bénévole.
          </div>
        </div>
        <button type="button" class="material-sponsor-btn" id="material-modal-sponsor-link">
          💖 Soutenir
        </button>
      </div>

      <!-- Section 5 : Actions & Désinstallation -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; padding-top: 14px; border-top: 1px solid var(--md-sys-color-outline-variant, #c4c7c5);">
        <button type="button" class="material-btn-pill material-btn-danger" id="material-btn-uninstall" title="Désinstaller complètement le thème">
          🗑️ Désinstaller
        </button>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="material-btn-pill material-btn-secondary" id="material-btn-restart" title="Recharger complètement l'application">
            🔄 Redémarrer Thunderbird
          </button>
          <button type="button" class="material-btn-pill material-btn-primary" id="material-btn-done">
            Terminé
          </button>
        </div>
      </div>

      <!-- Zone de confirmation de désinstallation -->
      <div id="material-uninstall-confirm" style="display: none; background: rgba(186, 26, 26, 0.08); border: 1px solid #ba1a1a; border-radius: 16px; padding: 14px 18px; margin-top: 10px;">
        <div style="font-size: 13.5px; font-weight: 700; color: #ba1a1a; margin-bottom: 6px;">
          ⚠️ Confirmer la désinstallation de Material-Thunderbird ?
        </div>
        <div style="font-size: 12.5px; color: var(--md-sys-color-on-surface, #1f1f1f); margin-bottom: 12px; line-height: 1.4;">
          Cette action retirera tous les fichiers de style du dossier <code>chrome/</code> de votre profil et rétablira l'apparence par défaut de Thunderbird. Vos courriels et paramètres ne seront pas touchés.
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button type="button" class="material-btn-pill material-btn-secondary" id="material-uninstall-cancel">Annuler</button>
          <button type="button" class="material-btn-pill material-btn-danger" id="material-uninstall-proceed" style="background: #ba1a1a !important; color: #fff !important;">Confirmer et Désinstaller</button>
        </div>
      </div>
    `;

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

    const keyListener = (e) => {
      if (e.key === "Escape") {
        handleClose(e);
        win.removeEventListener("keydown", keyListener);
      }
    };
    win.addEventListener("keydown", keyListener);

    // Mode segmented
    const modeBtns = dialog.querySelectorAll("#material-mode-group .material-segmented-btn");
    modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        modeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const mode = btn.getAttribute("data-mode");
        const cur = getCustomizerSettings();
        cur.themeMode = mode;
        saveCustomizerSettings(cur);
        this._applyStylesToAllWindows();
      });
    });

    // Palette cards
    const palCards = dialog.querySelectorAll("#material-palette-group .material-palette-card");
    palCards.forEach(card => {
      card.addEventListener("click", () => {
        palCards.forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        const pal = card.getAttribute("data-pal");
        const cur = getCustomizerSettings();
        cur.palette = pal;
        saveCustomizerSettings(cur);
        this._applyStylesToAllWindows();
      });
    });

    // Emoji toggle
    const emojiToggle = dialog.querySelector("#material-emoji-toggle");
    if (emojiToggle) {
      emojiToggle.addEventListener("change", () => {
        const cur = getCustomizerSettings();
        cur.emojis = emojiToggle.checked;
        saveCustomizerSettings(cur);
        this._applyStylesToAllWindows();
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

    // Restart button
    const restartBtn = dialog.querySelector("#material-btn-restart");
    if (restartBtn) {
      restartBtn.addEventListener("click", () => {
        this._restartThunderbird();
      });
    }

    // Uninstall
    const uninstBtn = dialog.querySelector("#material-btn-uninstall");
    const confirmBox = dialog.querySelector("#material-uninstall-confirm");
    const cancelUninstBtn = dialog.querySelector("#material-uninstall-cancel");
    const proceedUninstBtn = dialog.querySelector("#material-uninstall-proceed");

    if (uninstBtn && confirmBox) {
      uninstBtn.addEventListener("click", () => {
        confirmBox.style.display = confirmBox.style.display === "none" ? "block" : "none";
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
        proceedUninstBtn.textContent = "Désinstallation...";
        await this._performUninstall(win);
        dialog.innerHTML = `
          <div style="text-align: center; padding: 20px 10px;">
            <div style="font-size: 44px; margin-bottom: 12px;">✅</div>
            <h2 class="material-modal-title" style="margin-bottom: 8px;">Désinstallation effectuée</h2>
            <p style="font-size: 13.5px; color: var(--md-sys-color-on-surface-variant, #444746); line-height: 1.5; margin-bottom: 24px;">
              Les fichiers de style ont été retirés de votre profil Thunderbird.<br>
              Veuillez redémarrer Mozilla Thunderbird pour retrouver l'interface par défaut.
            </p>
            <div style="display: flex; gap: 10px; justify-content: center;">
              <button type="button" class="material-btn-pill material-btn-primary" id="material-uninst-restart">
                🔄 Redémarrer Thunderbird
              </button>
              <button type="button" class="material-btn-pill material-btn-secondary" id="material-uninst-close">
                Fermer
              </button>
            </div>
          </div>
        `;
        const postRestart = dialog.querySelector("#material-uninst-restart");
        const postClose = dialog.querySelector("#material-uninst-close");
        if (postRestart) postRestart.addEventListener("click", () => this._restartThunderbird());
        if (postClose) postClose.addEventListener("click", () => this._closeCustomizerModal(win));
      });
    }
  }

  _closeCustomizerModal(win) {
    if (!win || !win.document) return;
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

  async _performUninstall(win) {
    try {
      const profDir = Services.dirsvc.get("ProfD", Ci.nsIFile);
      const chromeDir = profDir.clone();
      chromeDir.append("chrome");

      if (chromeDir.exists()) {
        const manifestFile = chromeDir.clone();
        manifestFile.append("material-thunderbird-install.json");
        let manifest = null;
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
              if (line.includes(`user_pref("\${p}"`)) return false;
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

      try {
        Services.prefs.clearUserPref(PREF_PALETTE);
        Services.prefs.clearUserPref(PREF_THEME_MODE);
        Services.prefs.clearUserPref(PREF_EMOJIS);
      } catch (e) {}

      return true;
    } catch (err) {
      console.error("[Material-Thunderbird] Uninstall error:", err);
      return false;
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
      this._applyCustomizerStylesToDocument(doc);
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
        Cu.reportError("[Material-Thunderbird] URL de desinscription refusee : " + unsubscribeUrl);
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
        Cu.reportError("[Material-Thunderbird] Ouverture du lien impossible : " + err);
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
