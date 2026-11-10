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
  ["mailButton", "📬"],
  ["addressBookButton", "📇"],
  ["calendarButton", "📆"],
  ["tasksButton", "✅"],
  ["chatButton", "💬"],
  ["settingsButton", "⚙️"]
];

const HEADER_EMOJIS = [
  ["hdrReplyButton", "↩️"],
  ["hdrReplyToSenderButton", "↩️"],
  ["hdrReplyAllButton", "↩️"],
  ["hdrReplyListButton", "↩️"],
  ["hdrFollowupButton", "↩️"],
  ["hdrForwardButton", "➡️"],
  ["hdrArchiveButton", "🗃️"],
  ["hdrJunkButton", "🚫"],
  ["hdrTrashButton", "🗑️"]
];

// Nom du fichier de l icone native -> emoji. Pas de fragment comme "message" :
// tous les chemins commencent par chrome://messenger/.
const TAB_EMOJIS = [
  ["address-book", "📇"],
  ["calendar", "📆"],
  ["tasks", "✅"],
  ["chat", "💬"],
  ["settings", "⚙️"],
  ["extension", "🧩"],
  ["inbox", "📥"],
  ["sent", "📤"],
  ["draft", "📝"],
  ["template", "📋"],
  ["archive", "🗃️"],
  ["junk", "🚫"],
  ["spam", "🚫"],
  ["trash", "🗑️"],
  ["outbox", "📮"],
  ["folder", "📁"]
];

function emojiCss() {
  const icon = (selector, emoji) =>
    `${selector} {\n  content: ${emojiImage(emoji)} !important;\n  -moz-context-properties: none !important;\n}\n`;
  let css = "/* Icones emojis */\n";
  css += icon("#folderTree li > .container > .icon", "📁");
  css += icon("#folderTree li[data-server-type] > .container > .icon", "📧");
  for (const [type, emoji] of FOLDER_EMOJIS) {
    css += icon(`#folderTree li[data-folder-type="${type}"] > .container > .icon`, emoji);
  }
  for (const [id, emoji] of SPACES_EMOJIS) {
    css += icon(`#${id} > img`, emoji);
  }
  // Boutons de l en-tete du message : toolbarbutton XUL, dont l icone est une
  // <image> dessinee par list-style-image. Repondre et Repondre a tous sont des
  // boutons a menu : leur icone est dans un bouton imbrique, pas un enfant direct.
  for (const [id, emoji] of HEADER_EMOJIS) {
    css += `#${id} .toolbarbutton-icon {\n  list-style-image: ${emojiImage(emoji)} !important;\n  -moz-context-properties: none !important;\n}\n`;
  }
  // Icones des onglets : <img> dont l image vient de l attribut src, reconnu
  // par le nom du fichier d icone de Thunderbird.
  for (const [file, emoji] of TAB_EMOJIS) {
    css += icon(`#tabmail-tabs .tab-icon-image[src*="${file}"]`, emoji);
  }
  // Relever le courrier : image de fond du bouton.
  css += `#folderPaneGetMessages {\n  background-image: ${emojiImage("🔄")} !important;\n  -moz-context-properties: none !important;\n}\n`;
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
const PREF_BRAND_CACHE = "extensions.material-thunderbird.brand-logo-cache";
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
    const response = await win.fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`, {
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

let nativeTxtWorks = true;
async function txtLookup(win, name) {
  if (nativeTxtWorks) {
    const records = await nativeTxtLookup(name);
    if (records !== null) return records;
    nativeTxtWorks = false;
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

/**
 * Cherche le logo de la marque du domaine de cleanEmail. onResolved(url) est
 * appele si un logo est trouve et se charge ; onMissing() sinon, pour passer a
 * la source suivante (Gravatar).
 */
function checkBrandLogo(win, cleanEmail, onResolved, onMissing) {
  const domain = (cleanEmail.split("@")[1] || "").toLowerCase();
  if (!win || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !areBrandLogosEnabled()) {
    onMissing();
    return;
  }
  const cached = freshBrandEntry(domain);
  if (cached) {
    if (cached.u) onResolved(cached.u); else onMissing();
    return;
  }
  if (pendingBrandCallbacks.has(domain)) {
    pendingBrandCallbacks.get(domain).push([onResolved, onMissing]);
    return;
  }
  pendingBrandCallbacks.set(domain, [[onResolved, onMissing]]);

  const settle = (url) => {
    loadBrandCache().set(domain, { u: url || "", t: Date.now() });
    saveBrandCache();
    const callbacks = pendingBrandCallbacks.get(domain) || [];
    pendingBrandCallbacks.delete(domain);
    for (const [ok, missing] of callbacks) {
      try { if (url) ok(url); else missing(); } catch (e) {}
    }
  };

  lookupBrandLogo(win, domain).then((url) => {
    if (!url) { settle(""); return; }
    // Le logo doit effectivement se charger : une URL morte retomberait sinon
    // sur une image cassee.
    const img = new win.Image();
    const timer = win.setTimeout(() => { img.onload = img.onerror = null; settle(""); }, 4000);
    img.onload = () => { win.clearTimeout(timer); settle(url); };
    img.onerror = () => { win.clearTimeout(timer); settle(""); };
    img.src = url;
  }, () => settle(""));
}

/**
 * Valeur synchrone pour un premier rendu : l URL du logo si elle est connue,
 * "" si le domaine n en a pas, null si la recherche n a pas encore eu lieu.
 */
function cachedBrandLogo(cleanEmail) {
  const domain = (cleanEmail.split("@")[1] || "").toLowerCase();
  if (!domain || !areBrandLogosEnabled()) return "";
  const entry = freshBrandEntry(domain);
  return entry ? entry.u : null;
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

    // Emoji toggle
    const hideReadToggle = dialog.querySelector("#material-hide-read-toggle");
    if (hideReadToggle) {
      hideReadToggle.addEventListener("change", () => {
        try { Services.prefs.setBoolPref(PREF_HIDE_READ_REPLIES, hideReadToggle.checked); } catch (e) {}
        this._refreshThreadViews();
      });
    }

    const emojiToggle = dialog.querySelector("#material-emoji-toggle");
    if (emojiToggle) {
      emojiToggle.addEventListener("change", () => {
        const cur = getCustomizerSettings();
        cur.emojis = emojiToggle.checked;
        saveCustomizerSettings(cur);
        this._applyCustomizerSheet();
      });
    }

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
    for (const pref of [PREF_PALETTE, PREF_THEME_MODE, PREF_EMOJIS, PREF_HIDE_READ_REPLIES,
                        PREF_UNSUB_ENABLED, PREF_UNSUB_IGNORED, PREF_UNSUB_HIDDEN,
                        PREF_BRAND_LOGOS, PREF_BRAND_CACHE, GRAVATAR_PREF]) {
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
      setActions(back, thisMessage, always);
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
