/**
 * Material-Thunderbird - WebExtension Experiment
 * Component: Material Assistant (Chrome Native Unsubscribe Banner & Material You Helpers)
 * Injects Material Design 3 enhancements directly into the Thunderbird chrome window:
 * 1. Automatic unsubscribe detection & native banner
 * 2. Contact initial letter on recipient avatar buttons ("Pour", "Copie à")
 * 3. Small text-sized sender avatar in multimessage view
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

// Normalize initial letter (removes quotes, accents, brackets)
function getInitialLetter(nameOrEmail) {
  if (!nameOrEmail) return "?";
  let cleaned = nameOrEmail.replace(/^["'<\s]+/, "").trim();
  if (!cleaned) return "?";
  
  // Normalize diacritics
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
  
  // Pattern: "DisplayName <email@domain.com>"
  const match = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    const displayName = match[1].replace(/^["']+|["']+$/g, "").trim();
    const email = match[2].trim();
    return { displayName, email };
  }
  
  // Pattern: purely an email address
  if (str.includes("@")) {
    return { displayName: "", email: str.replace(/[<>]/g, "").trim() };
  }
  
  return { displayName: str, email: "" };
}

const UNSUB_KEYWORDS = /unsubscribe|d[ée]sinscri|d[ée]sabonn|opt-?out|abmelden|annulla.*iscrizione|notification.*setting|manage.*preference|g[ée]rer.*abonnement|param[èe]tre.*notification|signoff|auto_signoff|sympa|diffusion/i;

const ESP_PATTERNS = [
  /researchgate\.net\/(?:account\/settings|.*unsubscribe)/i,
  /list-manage\.com\/unsubscribe/i,
  /mailchimp\.com\/unsubscribe/i,
  /sendinblue\.com/i,
  /brevo\.com\/optout/i,
  /substack\.com\/unsubscribe/i,
  /activehosted\.com\/proc\.php\?.*act=unsub/i,
  /constantcontact\.com/i,
  /hubspotemail\.net/i,
  /exacttarget\.com/i,
  /campaign-monitor\.com/i,
  /cmail\d+\.com\/t\//i,
  /auto_signoff/i,
  /signoff/i,
  /sympa/i
];

this.materialAssistant = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
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

    // 3. Hook Multimessage View & Message List
    const multimessagePane = win.document.getElementById("multimessage");
    if (multimessagePane) {
      multimessagePane.addEventListener("load", () => {
        if (multimessagePane.contentDocument) {
          this._setupMultimessageObserver(win, multimessagePane.contentDocument);
        }
      }, true);
    }

    // Also scan main window doc for multimessage elements
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

      // A. Check RFC 2369 List-Unsubscribe in currentHeaderData
      if (win.currentHeaderData) {
        const unsubHeader = win.currentHeaderData["list-unsubscribe"];
        if (unsubHeader && unsubHeader.headerValue) {
          const match = unsubHeader.headerValue.match(/<(https?:\/\/[^>]+)>/i);
          if (match) {
            unsubscribeUrl = match[1];
          }
        }
        const fromHeader = win.currentHeaderData["from"];
        if (fromHeader && fromHeader.headerValue) {
          senderName = fromHeader.headerValue;
        }
      }

      // B. Direct DOM scan of rendered email inside messagepane
      if (!unsubscribeUrl && messagePane && messagePane.contentDocument) {
        const bodyDoc = messagePane.contentDocument;
        const anchors = bodyDoc.querySelectorAll("a[href]");

        for (const a of anchors) {
          const href = (a.href || "").trim();
          const text = (a.textContent || "").trim();

          if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

          if (UNSUB_KEYWORDS.test(href) || UNSUB_KEYWORDS.test(text)) {
            unsubscribeUrl = href;
            break;
          }

          for (const pattern of ESP_PATTERNS) {
            if (pattern.test(href)) {
              unsubscribeUrl = href;
              break;
            }
          }
          if (unsubscribeUrl) break;
        }
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
          win.open(unsubscribeUrl, "_blank");
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

    // Insert banner directly between the header card and the message body for maximum visibility
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
      const recipientBoxes = doc.querySelectorAll("#expandedtoBox, #expandedccBox, #expandedbccBox, #expandedreply-toBox");

      recipientBoxes.forEach((box) => {
        const recipients = box.querySelectorAll(".header-recipient, mail-emailaddress, [emailAddress]");
        recipients.forEach((rec) => {
          const raw = rec.getAttribute("label") ||
                      rec.getAttribute("displayName") ||
                      rec.getAttribute("emailAddress") ||
                      rec.getAttribute("title") ||
                      rec.textContent || "";
          
          const { displayName, email } = parseNameAndEmail(raw);
          const resolvedString = displayName || email || "?";
          const letter = getInitialLetter(resolvedString);
          const hash = hashString((displayName || email || "").toLowerCase());
          const palette = M3_AVATAR_PALETTES[hash % M3_AVATAR_PALETTES.length];

          const btn = rec.querySelector(".recipient-address-book-button") ||
                      rec.querySelector(".recipient-avatar") ||
                      rec;
          btn.style.setProperty("--md-avatar-char", `"${letter}"`);
          btn.style.setProperty("--md-avatar-bg", palette.bg);
          btn.style.setProperty("--md-avatar-fg", palette.fg);
        });
      });
    } catch (e) {}
  }

  _setupMultimessageObserver(win, doc) {
    if (!doc) return;

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
          const { displayName, email } = parseNameAndEmail(rawText);
          const resolvedString = displayName || email || "?";
          const letter = getInitialLetter(resolvedString);
          const hash = hashString((displayName || email || "").toLowerCase());
          const palette = M3_AVATAR_PALETTES[hash % M3_AVATAR_PALETTES.length];

          // Directly style authorEl so .author::before receives crisp letter & tonal background
          authorEl.style.setProperty("--author-char", `"${letter}"`);
          authorEl.style.setProperty("--author-bg", palette.bg);
          authorEl.style.setProperty("--author-fg", palette.fg);
          authorEl.setAttribute("data-author", letter);
          if (!authorEl.getAttribute("title") && rawText) {
            authorEl.setAttribute("title", rawText);
          }
        }
      });
    };

    processItems();

    const msgList = doc.getElementById("messageList");
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
        // 1. Non-blocking Avatar Letter & Color Resolution
        if (!row.dataset.avatarResolved) {
          const cardContainer = row.querySelector(".card-container");
          const senderEl = row.querySelector(".sender");
          if (cardContainer && senderEl) {
            const senderText = senderEl.getAttribute("title") || senderEl.textContent || "";
            const letter = getInitialLetter(senderText);
            const hash = hashString(senderText.toLowerCase());
            const palette = M3_AVATAR_PALETTES[hash % M3_AVATAR_PALETTES.length];

            cardContainer.style.setProperty("--md-avatar-char", `"${letter}"`);
            cardContainer.style.setProperty("--md-avatar-bg", palette.bg);
            cardContainer.style.setProperty("--md-avatar-fg", palette.fg);

            row.classList.add("avatar-loaded");
            row.dataset.avatarResolved = "true";
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
    return {
      materialAssistant: {
        showUnsubscribeBanner: async (unsubscribeUrl, senderName) => {
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
