/**
 * Material-Thunderbird - Material Design 3 (Material You)
 * Script: Thread Assistant (Non-blocking Avatar Resolver & Gravatar Fallback)
 * Runs asynchronously during idle frames to smoothly resolve avatars one by one
 * without locking the rendering pipeline:
 * 1. Default placeholder: crisp bonhomme contact icon
 * 2. Checks Gravatar API asynchronously (free, standard SHA-256)
 * 3. Fallback: Contact Name initial letter
 * 4. Fallback: Email address initial character
 * 5. Applies to main message list cards, header recipients, and multimessage view.
 */

(function () {
  "use strict";

  if (window.__materialThreadAssistantInit) return;
  window.__materialThreadAssistantInit = true;

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

  // In-memory cache for Gravatar lookups: email -> url (or null if 404)
  const gravatarCache = new Map();

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

  // Compute SHA-256 hex string via Web Crypto API
  async function sha256(str) {
    try {
      const buffer = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (e) {
      return null;
    }
  }

  // Check if a Gravatar photo exists for an email address (d=404 returns 404 if not found)
  async function resolveGravatar(email) {
    if (!email || !email.includes("@")) return null;
    const cleanEmail = email.trim().toLowerCase();

    if (gravatarCache.has(cleanEmail)) {
      return gravatarCache.get(cleanEmail);
    }

    const hash = await sha256(cleanEmail);
    if (!hash) {
      gravatarCache.set(cleanEmail, null);
      return null;
    }

    const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=80`;

    // Asynchronously test image load with timeout
    const exists = await new Promise((resolve) => {
      const img = new Image();
      let timer = setTimeout(() => {
        img.onload = img.onerror = null;
        resolve(false);
      }, 2500);

      img.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      img.src = gravatarUrl;
    });

    const result = exists ? gravatarUrl : null;
    gravatarCache.set(cleanEmail, result);
    return result;
  }

  /**
   * Universal Avatar Resolution Pipeline:
   * 1. Try Gravatar photo
   * 2. If no Gravatar, fallback to contact name initial letter
   * 3. If no contact name, fallback to email address initial character
   */
  async function applyResolvedAvatar(targetElement, rawNameOrEmail, options = {}) {
    if (!targetElement) return;

    const { displayName, email } = parseNameAndEmail(rawNameOrEmail);
    const gravatarUrl = await resolveGravatar(email);

    if (gravatarUrl) {
      // Gravatar found: display image
      targetElement.style.setProperty("--md-avatar-img", `url("${gravatarUrl}")`);
      targetElement.style.setProperty("--md-avatar-char", '""');
      if (options.multimessage) {
        targetElement.style.setProperty("--author-img", `url("${gravatarUrl}")`);
        targetElement.style.setProperty("--author-char", '""');
      }
    } else {
      // Fallback: Contact Name initial, or email initial
      const resolvedString = displayName || email || "?";
      const letter = getInitialLetter(resolvedString);
      const hash = hashString((displayName || email || "").toLowerCase());
      const palette = M3_AVATAR_PALETTES[hash % M3_AVATAR_PALETTES.length];

      targetElement.style.setProperty("--md-avatar-char", `"${letter}"`);
      targetElement.style.setProperty("--md-avatar-bg", palette.bg);
      targetElement.style.setProperty("--md-avatar-fg", palette.fg);
      targetElement.style.removeProperty("--md-avatar-img");

      if (options.multimessage) {
        targetElement.style.setProperty("--author-char", `"${letter}"`);
        targetElement.style.setProperty("--author-bg", palette.bg);
        targetElement.style.setProperty("--author-fg", palette.fg);
        targetElement.style.removeProperty("--author-img");
      }
    }

    if (options.onResolved) {
      options.onResolved();
    }
  }

  let isProcessing = false;
  const queue = new Set();

  function scheduleProcessing() {
    if (isProcessing) return;
    isProcessing = true;

    const requestIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 16));
    requestIdle((deadline) => {
      const timeRemaining = () => (deadline ? deadline.timeRemaining() > 1 : true);
      const batchSize = 16;
      let processed = 0;

      for (const row of Array.from(queue)) {
        if (!row.isConnected) {
          queue.delete(row);
          continue;
        }

        processThreadRow(row);
        queue.delete(row);
        processed++;

        if (processed >= batchSize || !timeRemaining()) {
          break;
        }
      }

      isProcessing = false;
      if (queue.size > 0) {
        scheduleProcessing();
      }
    });
  }

  function processThreadRow(row) {
    // 1. Non-blocking Avatar Resolution with Gravatar & initial fallback
    if (!row.dataset.avatarResolved) {
      const cardContainer = row.querySelector(".card-container");
      const senderEl = row.querySelector(".sender");
      
      if (cardContainer && senderEl) {
        const senderText = senderEl.getAttribute("title") || senderEl.textContent || "";
        applyResolvedAvatar(cardContainer, senderText, {
          onResolved: () => {
            row.classList.add("avatar-loaded");
            row.dataset.avatarResolved = "true";
          }
        });
      }
    }

    // 2. Twisty Unread Replies Detection
    const twisty = row.querySelector("button.twisty");
    if (twisty) {
      const hasUnread = twisty.classList.contains("has-unread") ||
                        twisty.getAttribute("data-properties")?.includes("unread") ||
                        row.getAttribute("data-properties")?.includes("unread") ||
                        row.classList.contains("unread") ||
                        twisty.getAttribute("aria-label")?.toLowerCase().includes("non lu") ||
                        twisty.getAttribute("aria-label")?.toLowerCase().includes("unread");
      if (hasUnread) {
        row.classList.add("has-unread-replies");
        twisty.classList.add("has-unread");
      } else {
        row.classList.remove("has-unread-replies");
      }
    }
  }

  // Recipient Initial Letter Avatars in Message Header
  function updateHeaderRecipientAvatars() {
    try {
      const recipientBoxes = document.querySelectorAll("#expandedtoBox, #expandedccBox, #expandedbccBox, #expandedreply-toBox");
      recipientBoxes.forEach((box) => {
        const recipients = box.querySelectorAll(".header-recipient, mail-emailaddress, [emailAddress]");
        recipients.forEach((rec) => {
          const rawNameOrEmail = rec.getAttribute("label") ||
                                 rec.getAttribute("displayName") ||
                                 rec.getAttribute("emailAddress") ||
                                 rec.getAttribute("title") ||
                                 rec.textContent || "";
          const btn = rec.querySelector(".recipient-address-book-button") ||
                      rec.querySelector(".recipient-avatar") ||
                      rec;
          applyResolvedAvatar(btn, rawNameOrEmail);
        });
      });
    } catch (e) {}
  }

  // Multimessage Initial Letter & Gravatar Avatars (18px text-sized)
  function updateMultimessageAvatars() {
    try {
      const docs = [document];
      const multimessage = document.getElementById("multimessage");
      if (multimessage && multimessage.contentDocument) {
        docs.push(multimessage.contentDocument);
      }

      docs.forEach((doc) => {
        const items = doc.querySelectorAll("#messageList > li");
        items.forEach((li) => {
          li.querySelectorAll(".unread-status, .unread-icon, .status-unread, [class*='unread-dot'], .multi-avatar").forEach((el) => {
            el.remove();
          });

          const authorEl = li.querySelector(".item-header .author");
          if (authorEl) {
            const authorText = authorEl.getAttribute("title") || authorEl.textContent || "";
            applyResolvedAvatar(authorEl, authorText, { multimessage: true });
          }
        });
      });
    } catch (e) {}
  }

  // Manage thread expansion: hide read replies if unread replies exist
  function updateThreadExpansion(threadTree) {
    if (!threadTree) return;
    const rows = threadTree.querySelectorAll("tr.card-layout");
    let currentParent = null;
    let currentParentHasUnread = false;
    let parentExpanded = false;
    let hiddenReadRows = [];
    let lastVisibleAnchor = null;

    rows.forEach((row) => {
      const isChild = row.getAttribute("data-properties")?.includes("thread-children");
      const isParent = !isChild && (row.classList.contains("children") || row.hasAttribute("aria-expanded"));
      const twisty = row.querySelector("button.twisty");

      if (isParent) {
        if (currentParent && hiddenReadRows.length > 0 && parentExpanded) {
          ensureShowAllButton(currentParent, lastVisibleAnchor || currentParent, hiddenReadRows);
        } else if (currentParent && !parentExpanded) {
          removeShowAllButton(currentParent);
        }

        currentParent = row;
        parentExpanded = row.getAttribute("aria-expanded") === "true";
        hiddenReadRows = [];
        lastVisibleAnchor = row;

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
          removeShowAllButton(currentParent);
        }
      } else if (isChild && currentParent && parentExpanded) {
        const isUnread = row.getAttribute("data-properties")?.includes("unread") || row.classList.contains("unread");

        if (currentParentHasUnread && !isUnread && !currentParent.dataset.showingAll) {
          row.classList.add("material-thread-read-hidden");
          hiddenReadRows.push(row);
        } else {
          row.classList.remove("material-thread-read-hidden");
          lastVisibleAnchor = row;
        }
      }
    });

    if (currentParent && hiddenReadRows.length > 0 && parentExpanded) {
      ensureShowAllButton(currentParent, lastVisibleAnchor || currentParent, hiddenReadRows);
    } else if (currentParent && !parentExpanded) {
      removeShowAllButton(currentParent);
    }
  }

  function ensureShowAllButton(parentRow, anchorRow, hiddenRows) {
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

  function removeShowAllButton(parentRow) {
    let sibling = parentRow.nextElementSibling;
    while (sibling && sibling.getAttribute("data-properties")?.includes("thread-children")) {
      sibling = sibling.nextElementSibling;
    }
    if (sibling && sibling.classList.contains("material-thread-toggle-row")) {
      sibling.remove();
    }
  }

  // MutationObserver to track newly rendered table rows smoothly
  function observeThreadTree() {
    const threadTree = document.getElementById("threadTree") || document.querySelector("table#threadTree");
    if (!threadTree) {
      setTimeout(observeThreadTree, 250);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      let hasNewRows = false;
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType === 1 && node.matches && (node.matches("tr.card-layout") || node.querySelector("tr.card-layout"))) {
            if (node.matches("tr.card-layout")) {
              queue.add(node);
            } else {
              node.querySelectorAll("tr.card-layout").forEach((r) => queue.add(r));
            }
            hasNewRows = true;
          }
        }
      }
      if (hasNewRows) {
        scheduleProcessing();
      }
      updateThreadExpansion(threadTree);
    });

    observer.observe(threadTree, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded", "class", "data-properties"] });

    // Initial pass on existing visible rows
    const existingRows = threadTree.querySelectorAll("tr.card-layout");
    existingRows.forEach((r) => queue.add(r));
    if (queue.size > 0) {
      scheduleProcessing();
    }
    updateThreadExpansion(threadTree);
  }

  function init() {
    observeThreadTree();
    updateHeaderRecipientAvatars();
    updateMultimessageAvatars();

    const msgHeaderView = document.getElementById("msgHeaderView") || document.getElementById("messageHeader");
    if (msgHeaderView) {
      const headerObs = new MutationObserver(() => {
        updateHeaderRecipientAvatars();
        updateMultimessageAvatars();
      });
      headerObs.observe(msgHeaderView, { childList: true, subtree: true });
    }

    const multimessage = document.getElementById("multimessage");
    if (multimessage) {
      multimessage.addEventListener("load", () => {
        updateMultimessageAvatars();
        if (multimessage.contentDocument) {
          const list = multimessage.contentDocument.getElementById("messageList");
          if (list) {
            const listObs = new MutationObserver(updateMultimessageAvatars);
            listObs.observe(list, { childList: true, subtree: true });
          }
        }
      }, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
