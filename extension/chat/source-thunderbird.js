/**
 * Vue messagerie : lecture des vrais courriels par l API MailExtension.
 *
 * Deux seules ecritures, toutes deux voulues par l utilisateur : marquer lus
 * les messages d une conversation qu il ouvre (reglable), et envoyer la
 * reponse qu il a tapee. Rien n est deplace ni supprime.
 *
 * Deux temps, pour rester rapide sur des milliers de messages :
 *   1. loadHeaders() : en-tetes (messages.query par dossier) et References
 *      (experiment materialAssistant.getThreadInfo, lu dans la base des
 *      messages) : de quoi construire la liste des conversations ;
 *   2. loadDetails() : texte, List-Id, infolettre, pieces jointes, message par
 *      message, a l ouverture d une conversation puis en tache de fond.
 */
(function (global) {
  "use strict";

  var api = global.browser || global.messenger;
  var HIDDEN = ["junk", "trash", "drafts", "templates", "outbox"];

  function parseAddress(s) {
    var match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || "");
    if (match) return { name: match[1].trim(), email: match[2].trim() };
    return { name: "", email: String(s || "").trim() };
  }

  async function listAccounts() {
    var accounts = await api.accounts.list(true);
    return accounts.filter(function (a) { return a.type !== "rss" && a.type !== "nntp"; }).map(function (a) {
      var folders = [];
      (function walk(list, prefix) {
        (list || []).forEach(function (f) {
          var kind = (f.specialUse || [])[0] || "other";
          folders.push({
            id: f.id, name: prefix + f.name, kind: kind,
            // Par defaut : reception, envoyes, archives des vrais comptes.
            byDefault: a.type !== "none" && ["inbox", "sent", "archives"].indexOf(kind) >= 0
          });
          walk(f.subFolders, prefix + f.name + " › ");
        });
      })(a.folders, "");
      folders = folders.filter(function (f) { return HIDDEN.indexOf(f.kind) < 0; });
      var identities = (a.identities || []).map(function (i) { return { id: i.id, email: i.email, name: i.name }; });
      return {
        id: a.id, name: a.name,
        email: identities.length ? identities[0].email : a.name,
        identities: identities.map(function (i) { return i.email; }),
        identityIds: identities,
        folders: folders
      };
    }).filter(function (a) { return a.folders.length; });
  }

  function vcardValues(vcard, prop) {
    var out = [];
    String(vcard || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/).forEach(function (line) {
      var m = new RegExp("^(?:item\\d+\\.)?" + prop + "(?:;[^:]*)?:(.*)$", "i").exec(line);
      if (m && m[1].trim()) out.push(m[1].trim());
    });
    return out;
  }

  async function listContacts() {
    // Seuls les contacts a plusieurs adresses servent : ils fusionnent des personnes.
    var out = [];
    var books = await api.addressBooks.list(true);
    books.forEach(function (book) {
      (book.contacts || []).forEach(function (c) {
        var emails = vcardValues(c.vCard, "EMAIL");
        var p = c.properties || {};
        if (!emails.length) emails = [p.PrimaryEmail, p.SecondEmail].filter(Boolean);
        if (emails.length > 1) {
          out.push({ id: c.id, name: vcardValues(c.vCard, "FN")[0] || p.DisplayName || emails[0], emails: emails });
        }
      });
    });
    return out;
  }

  function toMessage(h, src) {
    return {
      id: h.id,
      headerMessageId: h.headerMessageId,
      from: parseAddress(h.author),
      to: (h.recipients || []).map(parseAddress),
      cc: (h.ccList || []).map(parseAddress),
      bcc: (h.bccList || []).map(parseAddress),
      date: h.date,
      subject: h.subject,
      account: src.accountId,
      folder: h.folder && h.folder.id,
      folderKind: src.kind,
      read: h.read,
      references: [], inReplyTo: null, listId: null, isNewsletter: false,
      text: "", attachments: [], loaded: false
    };
  }

  // References depuis la base des messages, par paquets.
  async function addThreadInfo(list) {
    if (!api.materialAssistant || !api.materialAssistant.getThreadInfo) return;
    var byId = {};
    list.forEach(function (m) { byId[m.id] = m; });
    for (var i = 0; i < list.length; i += 1000) {
      var info = await api.materialAssistant.getThreadInfo(list.slice(i, i + 1000).map(function (m) { return m.id; }));
      info.forEach(function (r) { if (byId[r.id]) byId[r.id].references = r.references; });
    }
  }

  async function loadHeaders(sources, sinceDate, onProgress) {
    if (!sources.length) return [];
    var byFolder = {};
    sources.forEach(function (s) { byFolder[s.folderId] = s; });
    var out = [];
    var query = { folderId: sources.map(function (s) { return s.folderId; }), messagesPerPage: 500 };
    if (sinceDate) query.fromDate = sinceDate;
    var page = await api.messages.query(query);
    for (;;) {
      page.messages.forEach(function (h) {
        out.push(toMessage(h, byFolder[h.folder && h.folder.id] || {}));
      });
      if (onProgress) onProgress(out.length);
      if (!page.id) break;
      page = await api.messages.continueList(page.id);
    }
    await addThreadInfo(out);
    return out;
  }

  /**
   * Evenements de Thunderbird : nouveaux courriels, changement d etat (lu),
   * suppression. sources() renvoie les dossiers affiches a cet instant.
   */
  function watch(sources, handlers) {
    var srcOf = function (folder) {
      return sources().filter(function (s) { return folder && s.folderId === folder.id; })[0] || null;
    };
    if (api.messages.onNewMailReceived) {
      api.messages.onNewMailReceived.addListener(async function (folder, list) {
        var src = srcOf(folder);
        if (!src) return;
        var added = [];
        var page = list;
        for (;;) {
          (page.messages || []).forEach(function (h) { added.push(toMessage(h, src)); });
          if (!page.id) break;
          page = await api.messages.continueList(page.id);
        }
        await addThreadInfo(added);
        handlers.added(added);
      });
    }
    if (api.messages.onUpdated) {
      api.messages.onUpdated.addListener(function (h, changed) {
        if (changed && "read" in changed) handlers.updated(h.id, { read: changed.read });
      });
    }
    if (api.messages.onDeleted) {
      api.messages.onDeleted.addListener(function (list) {
        handlers.deleted((list.messages || []).map(function (h) { return h.id; }));
      });
    }
  }

  async function htmlToText(html) {
    if (api.messengerUtilities && api.messengerUtilities.convertToPlainText) {
      // Retire d abord les citations, que la conversion garderait.
      var doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll(".gmail_quote, .moz-cite-prefix, blockquote, #divRplyFwdMsg, #appendonsend ~ *, .moz-signature").forEach(function (n) { n.remove(); });
      return api.messengerUtilities.convertToPlainText(doc.body.innerHTML);
    }
    return new DOMParser().parseFromString(html, "text/html").body.textContent;
  }

  /**
   * Les messages venus du cache portent l identifiant d une session
   * precedente : on le retrouve par le Message-ID avant toute action.
   */
  async function resolve(message) {
    if (!message.stale) return message;
    try {
      var page = await api.messages.query({ headerMessageId: message.headerMessageId });
      var found = (page.messages || []).filter(function (h) { return h.folder && h.folder.id === message.folder; })[0] ||
        (page.messages || [])[0];
      if (found) message.id = found.id;
    } catch (e) {
      // Introuvable : on garde l ancien identifiant, l action echouera proprement.
    }
    message.stale = false;
    return message;
  }

  async function loadDetails(message) {
    if (message.loaded) return message;
    message.loaded = true;
    try {
      await resolve(message);
      var full = await api.messages.getFull(message.id, { decodeContent: false });
      var h = full.headers || {};
      var first = function (k) { return (h[k] || [])[0] || null; };
      message.listId = first("list-id") && first("list-post") ? first("list-id") : null;
      if (message.listId) {
        var name = /^\s*"?([^"<]+?)"?\s*</.exec(message.listId);
        // Sans nom (Sympa : « <ete.sympa-n.oca.eu> »), le moteur prend la premiere etiquette.
        if (name) message.listName = name[1];
      }
      var parts = await api.messages.listInlineTextParts(message.id);
      var plain = parts.filter(function (p) { return /text\/plain/i.test(p.contentType); })[0];
      var html = parts.filter(function (p) { return /text\/html/i.test(p.contentType); })[0];
      if (plain) message.text = plain.content;
      else if (html) message.text = await htmlToText(html.content);
      if (global.MaterialUnsubscribeRules) {
        // Comme le bandeau : le lien du corps HTML complete l en-tete List-Unsubscribe.
        var bodyUrl = html ? global.MaterialUnsubscribeRules.findInHtml(html.content) : null;
        var verdict = global.MaterialUnsubscribeRules.classifyMessage({
          headers: h, subject: message.subject, text: message.text, bodyUrl: bodyUrl
        });
        message.isNewsletter = !!verdict && verdict.kind === "newsletter";
        if (verdict && (verdict.url || verdict.mailto)) {
          message.unsubscribe = { url: verdict.url || "", mailto: verdict.mailto || "", oneClick: !!verdict.oneClick };
        }
      }
      var atts = await api.messages.listAttachments(message.id);
      message.attachments = atts.map(function (a) {
        return { name: a.name, size: a.size, contentType: a.contentType, partName: a.partName };
      });
    } catch (e) {
      console.warn("[Material-Thunderbird] Lecture du message impossible :", message.id, e);
    }
    return message;
  }

  /**
   * Repond a un message et l envoie aussitot (choix de Vincent : envoi direct
   * depuis la vue). Le corps est le seul texte saisi, sans citation : la vue
   * montre « en reponse a » a la place. La fenetre de redaction s ouvre le temps
   * de l envoi ; si l envoi echoue, elle reste ouverte avec le texte.
   */
  async function sendReply(message, text, replyType, identityId, recipients) {
    var details = { plainTextBody: text, isPlainText: true };
    if (identityId) details.identityId = identityId;
    if (recipients) { details.to = recipients; details.cc = []; }
    await resolve(message);
    var tab = await api.compose.beginReply(message.id, replyType || "replyToAll", details);
    return api.compose.sendMessage(tab.id, { mode: "sendNow" });
  }

  /** Marque des messages comme lus : la seule modification que fait la vue. */
  function markRead(messages) {
    return Promise.all(messages.map(function (m) {
      return resolve(m).then(function () { return api.messages.update(m.id, { read: true }); }).catch(function () {});
    }));
  }

  /** Vignette d une image jointe : URL locale (blob:) du fichier. */
  async function attachmentUrl(message, attachment) {
    await resolve(message);
    var file = await api.messages.getAttachmentFile(message.id, attachment.partName);
    return URL.createObjectURL(file);
  }

  async function openMessage(message) {
    await resolve(message);
    return api.messageDisplay.open({ messageId: message.id, location: "tab" });
  }

  /** Desinscription d une infolettre, par l experiment (memes voies que le bandeau). */
  function unsubscribe(details) {
    if (!api.materialAssistant || !api.materialAssistant.unsubscribe) return Promise.resolve("unavailable");
    return api.materialAssistant.unsubscribe(details);
  }

  // ---------- Cache ----------
  // En-tetes et details deja lus, pour afficher la vue tout de suite a la
  // prochaine ouverture ; la vraie lecture suit en tache de fond.
  var CACHE_VERSION = 2; // 2 : lien de desinscription trouve aussi dans le corps
  var TEXT_LIMIT = 20000;

  async function loadCache() {
    try {
      var c = (await api.storage.local.get("chatCache")).chatCache;
      if (!c || c.version !== CACHE_VERSION) return null;
      c.messages.forEach(function (m) { m.date = new Date(m.date); m.stale = true; });
      return c;
    } catch (e) { return null; }
  }

  function saveCache(sourcesKey, messages) {
    var slim = messages.filter(function (m) { return !m.sendState; }).map(function (m) {
      var copy = Object.assign({}, m);
      copy.date = +m.date;
      if (copy.text && copy.text.length > TEXT_LIMIT) copy.text = copy.text.slice(0, TEXT_LIMIT);
      delete copy.stale;
      return copy;
    });
    return api.storage.local.set({ chatCache: { version: CACHE_VERSION, sourcesKey: sourcesKey, savedAt: Date.now(), messages: slim } })
      .catch(function (e) { console.warn("[Material-Thunderbird] Cache de la vue non enregistre :", e); });
  }

  async function loadSettings() {
    try { return (await api.storage.local.get("chatView")).chatView || null; } catch (e) { return null; }
  }
  function saveSettings(settings) {
    return api.storage.local.set({ chatView: settings }).catch(function () {});
  }

  global.MaterialChatThunderbird = {
    available: !!(api && api.messages && api.accounts),
    listAccounts: listAccounts,
    listContacts: listContacts,
    loadHeaders: loadHeaders,
    loadDetails: loadDetails,
    sendReply: sendReply,
    markRead: markRead,
    attachmentUrl: attachmentUrl,
    openMessage: openMessage,
    unsubscribe: unsubscribe,
    watch: watch,
    loadCache: loadCache,
    saveCache: saveCache,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
})(typeof window !== "undefined" ? window : globalThis);
