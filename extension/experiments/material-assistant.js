/**
 * Material-Thunderbird - WebExtension Experiment
 * Component: Material Assistant (Chrome Native Unsubscribe Banner & Material You Helpers)
 * Injects Material Design 3 enhancements directly into the Thunderbird chrome window:
 * 1. Automatic unsubscribe detection & native banner
 * 2. Unified Avatar Resolution (Address Book photo > Gravatar > Contact initial > Email initial)
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

// Pure JS Synchronous SHA-256 implementation for Gravatar lookups
function sha256Hex(ascii) {
  function rightRotate(v, a) {
    return (v >>> a) | (v << (32 - a));
  }
  const pow = Math.pow, maxWord = pow(2, 32);
  let i, j, result = '', words = [], asciiBitLength = ascii.length * 8, hash = [], k = [], primeCounter = 0, isComp = {};
  for (let c = 2; primeCounter < 64; c++) {
    if (!isComp[c]) {
      for (i = 0; i < 313; i += c) isComp[i] = c;
      hash[primeCounter] = (pow(c, 0.5) * maxWord) | 0;
      k[primeCounter++] = (pow(c, 1/3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (j = 0; j < words.length; ) {
    let w = words.slice(j, (j += 16));
    let oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      let w15 = w[i - 15], w2 = w[i - 2];
      let s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      let s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      let s1_2 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      let ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      let t1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + w[i];
      let maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      let t2 = s1_2 + maj;
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
      hash.length = 8;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++) {
    for (let b = 3; b >= 0; b--) {
      let byte = (hash[i] >> (b * 8)) & 255;
      result += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return result;
}

// In-memory Gravatar cache: email -> { found: boolean, url: string }
const gravatarCache = new Map();
const pendingGravatarCallbacks = new Map();

function checkGravatar(cleanEmail, onResolved) {
  if (!cleanEmail) return;
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
  pendingGravatarCallbacks.set(cleanEmail, onResolved ? [onResolved] : []);

  const hash = sha256Hex(cleanEmail);
  const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=80`;

  try {
    const img = new Image();
    img.onload = () => {
      gravatarCache.set(cleanEmail, { found: true, url: gravatarUrl });
      const cbs = pendingGravatarCallbacks.get(cleanEmail) || [];
      pendingGravatarCallbacks.delete(cleanEmail);
      cbs.forEach(cb => { try { cb(gravatarUrl); } catch(e){} });
    };
    img.onerror = () => {
      gravatarCache.set(cleanEmail, { found: false, url: null });
      pendingGravatarCallbacks.delete(cleanEmail);
    };
    img.src = gravatarUrl;
  } catch (e) {
    gravatarCache.set(cleanEmail, { found: false, url: null });
    pendingGravatarCallbacks.delete(cleanEmail);
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
 * Universal Avatar Resolution Pipeline
 * Priority 1: Address Book contact photo (card.photoURL)
 * Priority 2: Gravatar avatar (SHA-256 of lowercase email)
 * Priority 3: First letter of saved contact (card.displayName || displayName)
 * Priority 4: First letter of email address (cleanEmail)
 * Background color: derived strictly from hash of cleanEmail, guaranteed 100% consistent everywhere.
 */
function resolveAvatarInfo(rawString, onGravatarResolved) {
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
      checkGravatar(cleanEmail, onGravatarResolved);
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
 * Regles de detection partagees avec background.js et le script de message.
 * Chargees depuis shared/unsubscribe-rules.js au demarrage de experiment ; sans
 * elles, aucune detection n a lieu cote chrome (le bandeau reste simplement absent).
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

  onShutdown(isAppShutdown) {
    if (this._windowListener) {
      Services.wm.removeListener(this._windowListener);
      this._windowListener = null;
    }
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

    // 1. Hook Message Pane for Unsubscribe detection & Header Recipient Avatars
    const messagePane = win.document.getElementById("messagepane");
    if (messagePane) {
      const handleMessageLoaded = () => {
        this._detectAndDisplayUnsubscribe(win);
        this._updateRecipientAvatars(win);
      };
      messagePane.addEventListener("load", handleMessageLoaded, true);
      messagePane.addEventListener("DOMContentLoaded", handleMessageLoaded, true);
    }

    // 2. Hook Message Header changes via MutationObserver
    const msgHeaderView = win.document.getElementById("msgHeaderView") || win.document.getElementById("messageHeader");
    if (msgHeaderView) {
      const headerObserver = new win.MutationObserver(() => {
        this._updateRecipientAvatars(win);
        this._detectAndDisplayUnsubscribe(win);
        win.setTimeout(() => this._detectAndDisplayUnsubscribe(win), 300);
      });
      headerObserver.observe(msgHeaderView, { childList: true, subtree: true });
    }

    // 3. Hook Multimessage View & Message List (robust browser detection)
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
        browser.addEventListener("load", attach, true);
        browser.addEventListener("DOMContentLoaded", attach, true);
        attach();
      });
    };
    hookMultimessage();
    win.addEventListener("select", () => win.setTimeout(hookMultimessage, 100), true);

    // Also observe the main document in case multimessage list is embedded
    this._setupMultimessageObserver(win, win.document);

    // 4. Hook Thread Tree for card avatars and thread collapsing
    const threadTree = win.document.getElementById("threadTree") || win.document.querySelector("table#threadTree");
    if (threadTree) {
      this._setupThreadTree(win, threadTree);
    }
  }

  _detectAndDisplayUnsubscribe(win) {
    try {
      const doc = win.document;
      const messagePane = doc.getElementById("messagepane");
      let unsubscribeUrl = null;
      let senderName = "";

      const rules = UnsubscribeRules;
      if (!rules) return;

      // A. En-tete List-Unsubscribe (RFC 2369), source la plus fiable.
      if (win.currentHeaderData) {
        const unsubHeader = win.currentHeaderData["list-unsubscribe"];
        if (unsubHeader && unsubHeader.headerValue) {
          unsubscribeUrl = rules.findInListUnsubscribeHeader(unsubHeader.headerValue);
        }
        const fromHeader = win.currentHeaderData["from"];
        if (fromHeader && fromHeader.headerValue) {
          senderName = fromHeader.headerValue;
        }
      }

      // B. A defaut, analyse du message rendu dans le volet de lecture.
      if (!unsubscribeUrl && messagePane && messagePane.contentDocument) {
        unsubscribeUrl = rules.findInDocument(messagePane.contentDocument);
      }

      // Le lien provient du courriel : il n est retenu que s il est ouvrable.
      if (unsubscribeUrl && !rules.isSafeUrl(unsubscribeUrl)) {
        unsubscribeUrl = null;
      }

      if (unsubscribeUrl) {
        this._renderUnsubscribeBanner(win, unsubscribeUrl, senderName);
      } else {
        this._removeUnsubscribeBanner(win);
      }
    } catch (e) {
      // Non-fatal inspection error
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

    const cleanSender = senderName ? senderName.replace(/[<>"]/g, "").trim() : "Cet expéditeur";

    banner.innerHTML = `
      <div class="material-unsub-left">
        <div class="material-unsub-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </div>
        <div class="material-unsub-details">
          <span class="material-unsub-title">Courrier commercial / Infolettre</span>
          <span class="material-unsub-desc">Un lien de désinscription a été détecté pour ${cleanSender}.</span>
        </div>
      </div>
      <div class="material-unsub-actions">
        <button type="button" class="material-unsub-btn" id="material-unsub-trigger-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
          </svg>
          Se désinscrire
        </button>
        <button type="button" class="material-unsub-close" id="material-unsub-close-btn" title="Ignorer">&times;</button>
      </div>
    `;

    const triggerBtn = banner.querySelector("#material-unsub-trigger-btn");
    if (triggerBtn) {
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
    }

    const closeBtn = banner.querySelector("#material-unsub-close-btn");
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        banner.remove();
      };
    }

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
          const avatarInfo = resolveAvatarInfo(rawFrom, (gravUrl) => {
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

          const avatarInfo = resolveAvatarInfo(raw, (gravUrl) => {
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

          const avatarInfo = resolveAvatarInfo(rawText, (gravUrl) => {
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
      const listObs = new win.MutationObserver(processItems);
      listObs.observe(msgList, { childList: true, subtree: true });
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
        // 1. Unified Avatar Resolution
        if (!row.dataset.avatarResolved) {
          const cardContainer = row.querySelector(".card-container");
          const senderEl = row.querySelector(".sender");
          if (cardContainer && senderEl) {
            const senderText = senderEl.getAttribute("title") || senderEl.textContent || "";
            if (senderText) {
              const avatarInfo = resolveAvatarInfo(senderText, (gravUrl) => {
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
              row.dataset.avatarResolved = "true";
            }
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

    const treeObserver = new win.MutationObserver(processRows);
    treeObserver.observe(threadTree, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded", "class", "data-properties"] });

    processRows();
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
        showUnsubscribeBanner: async (unsubscribeUrl, senderName) => {
          // L URL vient d un courriel via le script d arriere-plan : elle est
          // revalidee ici, au dernier point avant affichage d un bouton chrome.
          const rules = UnsubscribeRules;
          if (!rules || !rules.isSafeUrl(unsubscribeUrl)) return;
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) {
            const win = windows.getNext();
            this._renderUnsubscribeBanner(win, unsubscribeUrl, senderName);
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
