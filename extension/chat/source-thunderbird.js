/**
 * Vue messagerie (prototype) : lecture des vrais courriels par l API MailExtension.
 *
 * NON TESTE DANS THUNDERBIRD. Necessite Thunderbird 128+ (messages.query par
 * dossier : 121, listInlineTextParts : 128) et les permissions accountsRead,
 * messagesRead, addressBooks (fusion des alias), compose (+ compose.send pour
 * envoyer depuis la vue).
 *
 * Deux temps, pour rester rapide sur des milliers de messages :
 *   1. loadHeaders() : en-tetes seuls (messages.query), de quoi construire la
 *      liste des conversations ;
 *   2. loadDetails(ids) : a l ouverture d une conversation, corps texte et
 *      en-tetes de fil (References, In-Reply-To, List-Id) message par message.
 *
 * Point faible connu : MessageHeader ne donne ni References ni In-Reply-To. Sans
 * eux, deux fils de groupe aux participants differents ne se rattachent qu a
 * l ouverture. A terme, l experiment materialAssistant peut lire ces champs
 * dans la base des messages (nsIMsgDBHdr) sans ouvrir chaque courriel.
 */
(function (global) {
  "use strict";

  var api = global.browser || global.messenger;

  function parseAddress(s) {
    // « Nom <adresse> » ou « adresse » ; messengerUtilities.parseMailboxString
    // (TB 137) fera mieux pour les cas tordus (virgules entre guillemets).
    var match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || "");
    if (match) return { name: match[1].trim(), email: match[2].trim() };
    return { name: "", email: String(s || "").trim() };
  }

  async function listAccounts() {
    var accounts = await api.accounts.list(true);
    return accounts.filter(function (a) { return a.type !== "none" && a.type !== "rss"; }).map(function (a) {
      var folders = [];
      (function walk(list) {
        (list || []).forEach(function (f) {
          var use = (f.specialUse || [])[0];
          folders.push({ id: f.id, name: f.name, kind: use || "other" });
          walk(f.subFolders);
        });
      })(a.folders);
      return {
        id: a.id, name: a.name,
        email: (a.identities[0] || {}).email,
        identities: a.identities.map(function (i) { return i.email; }),
        folders: folders
      };
    });
  }

  async function listContacts() {
    // Personnes du carnet ayant plusieurs adresses : seules utiles a la fusion.
    var out = [];
    var books = await api.addressBooks.list(true);
    books.forEach(function (book) {
      (book.contacts || []).forEach(function (c) {
        var p = c.properties || {};
        var emails = [p.PrimaryEmail, p.SecondEmail].filter(Boolean);
        if (emails.length > 1) out.push({ id: c.id, name: p.DisplayName || emails[0], emails: emails });
      });
    });
    return out;
  }

  async function loadHeaders(sources, sinceDate) {
    // sources : [{ accountId, folderId, kind }]
    var folderIds = sources.map(function (s) { return s.folderId; });
    var kinds = {};
    sources.forEach(function (s) { kinds[s.folderId] = s; });
    var out = [];
    var page = await api.messages.query({ folderId: folderIds, fromDate: sinceDate, messagesPerPage: 500 });
    for (;;) {
      page.messages.forEach(function (h) {
        var src = kinds[h.folder.id] || {};
        out.push({
          id: h.id,
          headerMessageId: h.headerMessageId,
          from: parseAddress(h.author),
          to: h.recipients.map(parseAddress),
          cc: h.ccList.map(parseAddress),
          bcc: h.bccList.map(parseAddress),
          date: h.date,
          subject: h.subject,
          account: src.accountId,
          folder: h.folder.id,
          folderKind: src.kind,
          read: h.read,
          references: [], inReplyTo: null, listId: null, isNewsletter: false,
          text: "", attachments: []
        });
      });
      if (!page.id) break;
      page = await api.messages.continueList(page.id);
    }
    return out;
  }

  async function loadDetails(message) {
    var full = await api.messages.getFull(message.id);
    var h = full.headers || {};
    var first = function (k) { return (h[k] || [])[0] || null; };
    message.inReplyTo = first("in-reply-to");
    message.references = (first("references") || "").split(/\s+/).filter(Boolean)
      .map(function (r) { return r.replace(/^<|>$/g, ""); });
    if (message.inReplyTo) message.inReplyTo = message.inReplyTo.replace(/^<|>$/g, "");
    message.listId = first("list-id") && first("list-post") ? first("list-id") : null;
    var parts = await api.messages.listInlineTextParts(message.id);
    var plain = parts.filter(function (p) { return p.contentType === "text/plain"; })[0];
    if (plain) {
      message.text = plain.content;
    } else if (parts[0]) {
      // Repli HTML : texte brut sans balises. A remplacer par
      // messengerUtilities.convertToPlainText (TB 137).
      var doc = new DOMParser().parseFromString(parts[0].content, "text/html");
      doc.querySelectorAll(".gmail_quote, blockquote, #divRplyFwdMsg, #appendonsend ~ *").forEach(function (n) { n.remove(); });
      message.text = doc.body.innerText;
    }
    if (global.MaterialUnsubscribeRules) {
      var verdict = global.MaterialUnsubscribeRules.classifyMessage({ headers: h, subject: message.subject, text: message.text });
      message.isNewsletter = !!verdict && verdict.kind === "newsletter";
    }
    var atts = await api.messages.listAttachments(message.id);
    message.attachments = atts.map(function (a) { return { name: a.name, size: a.size, partName: a.partName }; });
    return message;
  }

  async function reply(message, text, replyType) {
    var tab = await api.compose.beginReply(message.id, replyType || "replyToAll", { plainTextBody: text, isPlainText: true });
    // Prototype : on laisse la fenetre de redaction ouverte pour relecture.
    // Version finale : compose.sendMessage(tab.id) apres confirmation dans la vue.
    return tab;
  }

  function openMessage(message) {
    return api.messageDisplay.open({ messageId: message.id, location: "tab" });
  }

  global.MaterialChatThunderbird = {
    available: !!(api && api.messages && api.accounts),
    listAccounts: listAccounts,
    listContacts: listContacts,
    loadHeaders: loadHeaders,
    loadDetails: loadDetails,
    reply: reply,
    openMessage: openMessage
  };
})(typeof window !== "undefined" ? window : globalThis);
