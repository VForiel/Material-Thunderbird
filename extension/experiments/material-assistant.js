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

    for (const observer of state.observers) {
      try { observer.disconnect(); } catch (e) {}
    }
    for (const timer of state.timers) {
      try { win.clearTimeout(timer); } catch (e) {}
    }
    for (const [target, type, handler, capture] of state.listeners) {
      try { target.removeEventListener(type, handler, capture); } catch (e) {}
    }

    // Retire les elements injectes dans interface de Thunderbird.
    try {
      this._removeUnsubscribeBanner(win);
      const doc = win.document;
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

  _initWindows() {
    const windows = Services.wm.getEnumerator("mail:3pane");
    while (windows.hasMoreElements()) {
      const win = windows.getNext();
      this._setupWindow(win);
    }
  }

  _setupWindow(win) {
    if (!win || !win.document || win.__materialWindowSetup) return;
    win.__materialWindowSetup = true;

    // Tout ce qui est accroche ici est enregistre pour pouvoir etre relache
    // dans _teardownWindow.
    const state = { observers: [], timers: [], listeners: [] };
    win.__materialWindowState = state;

    const listen = (target, type, handler, capture) => {
      target.addEventListener(type, handler, capture);
      state.listeners.push([target, type, handler, capture]);
    };
    const observe = (target, handler, options) => {
      const observer = new win.MutationObserver(handler);
      observer.observe(target, options);
      state.observers.push(observer);
      return observer;
    };
    // Un seul minuteur en vol par cle : les rafales de mutations en programmaient
    // un par lot, sans jamais les annuler.
    const timers = new Map();
    const debounce = (key, delay, fn) => {
      if (timers.has(key)) win.clearTimeout(timers.get(key));
      const id = win.setTimeout(() => { timers.delete(key); fn(); }, delay);
      timers.set(key, id);
      state.timers.push(id);
    };
    state.debounce = debounce;

    // 1. Volet de lecture : desinscription et avatars des destinataires.
    const messagePane = win.document.getElementById("messagepane");
    if (messagePane) {
      const handleMessageLoaded = () => {
        this._updateRecipientAvatars(win);
      };
      listen(messagePane, "load", handleMessageLoaded, true);
      listen(messagePane, "DOMContentLoaded", handleMessageLoaded, true);
    }

    // 2. En-tete du message.
    const msgHeaderView = win.document.getElementById("msgHeaderView") || win.document.getElementById("messageHeader");
    if (msgHeaderView) {
      observe(msgHeaderView, () => {
        debounce("header", 50, () => this._updateRecipientAvatars(win));
      }, { childList: true, subtree: true });
    }

    // 3. Vue multi-messages.
    const hookMultimessage = () => {
      const multiBrowsers = win.document.querySelectorAll("#multiMessageBrowser, #multimessage, browser[src*='multimessageview']");
      multiBrowsers.forEach((browser) => {
        const attach = () => {
          try {
            if (browser.contentDocument) {
              this._setupMultimessageObserver(win, browser.contentDocument);
            }
          } catch (e) {}
        };
        listen(browser, "load", attach, true);
        listen(browser, "DOMContentLoaded", attach, true);
        attach();
      });
    };
    hookMultimessage();
    listen(win, "select", () => debounce("multimessage", 100, hookMultimessage), true);

    this._setupMultimessageObserver(win, win.document);

    // 4. Liste des messages : avatars et repli des fils.
    const threadTree = win.document.getElementById("threadTree") || win.document.querySelector("table#threadTree");
    if (threadTree) {
      this._setupThreadTree(win, threadTree);
    }
  }

  _renderUnsubscribeBanner(win, unsubscribeUrl, senderName) {
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
        if (typeof win.openContentTab === "function") {
          win.openContentTab(unsubscribeUrl);
        } else if (typeof win.openURL === "function") {
          win.openURL(unsubscribeUrl);
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

  _removeUnsubscribeBanner(win) {
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

  _setupMultimessageObserver(win, doc) {
    if (!doc || doc.__materialMultimessageObserved) return;
    doc.__materialMultimessageObserved = true;

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
      const listObs = new win.MutationObserver(() => {
        if (pending || applying) return;
        pending = true;
        win.requestAnimationFrame(() => {
          pending = false;
          applying = true;
          try { processItems(); } finally { applying = false; }
        });
      });
      listObs.observe(msgList, { childList: true, subtree: true });

      const state = win.__materialWindowState;
      if (state) state.observers.push(listObs);
    }
  }

  _setupThreadTree(win, threadTree) {
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

    const state = win.__materialWindowState;
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
        }
      }
    };
  }
};
