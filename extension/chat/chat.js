/**
 * Vue messagerie (prototype) : interface.
 *
 * Hors Thunderbird (ou avec ?demo), lit mock-data.js ; dans Thunderbird, lit
 * les vrais courriels par source-thunderbird.js. Le regroupement est fait par
 * shared/conversations.js dans les deux cas.
 */
(function () {
  "use strict";

  var C = window.MaterialConversations;
  var TB = window.MaterialChatThunderbird;
  var DEMO = !TB.available || /[?&]demo\b/.test(location.search);
  var HIDDEN_FOLDERS = ["junk", "trash", "drafts", "templates", "outbox"];

  var state = {
    accounts: [], contacts: [], messages: [],
    sources: {},            // folderId -> bool
    includeNewsletters: true,
    periodDays: 180,
    filter: "all", query: "",
    current: null, info: false,
    names: {},              // noms donnes aux groupes par l utilisateur
    expanded: {},           // messages deplies
    data: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.append(c); });
    return node;
  }
  function icon(id) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    var u = document.createElementNS("http://www.w3.org/2000/svg", "use");
    u.setAttribute("href", "#i-" + id);
    s.append(u);
    return s;
  }

  // ---------- Petits utilitaires d affichage ----------

  function hue(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
    return h;
  }
  function initials(name) {
    var parts = String(name || "?").replace(/[^\p{L}\s'-]/gu, "").trim().split(/[\s'-]+/)
      .filter(function (w, i, all) { return all.length < 3 || !/^(le|la|les|l|de|du|des|d)$/i.test(w); });
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function avatar(personKey, small) {
    var p = state.data.people.get(personKey);
    return el("div", { class: "avatar" + (small ? " sm" : ""), style: "--h:" + hue(personKey), text: initials(p.name), title: p.name });
  }
  function convAvatar(c) {
    if (c.kind === "self") return el("div", { class: "avatar icon", text: "✎" });
    if (c.kind === "list") return el("div", { class: "avatar icon", text: "#" });
    if (c.kind === "group") {
      return el("div", { class: "avatar-stack" }, c.members.slice(0, 2).map(function (k) { return avatar(k); }));
    }
    return avatar(c.members[0]);
  }
  function accountIndex(id) {
    for (var i = 0; i < state.accounts.length; i++) if (state.accounts[i].id === id) return i;
    return 0;
  }
  function accountDot(id) {
    return el("span", { class: "acc-dot", style: "--acc: var(--acc-" + (accountIndex(id) % 4) + ")" });
  }
  function accountName(id) { return state.accounts[accountIndex(id)].name; }

  var DAY = 86400000;
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return +x; }
  function shortTime(d) {
    d = new Date(d);
    var diff = (startOfDay(Date.now()) - startOfDay(d)) / DAY;
    if (diff === 0) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (diff === 1) return "hier";
    if (diff < 7) return d.toLocaleDateString("fr-FR", { weekday: "short" });
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }
  function dayLabel(d) {
    var diff = (startOfDay(Date.now()) - startOfDay(d)) / DAY;
    if (diff === 0) return "Aujourd’hui";
    if (diff === 1) return "Hier";
    return new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  function hhmm(d) { return new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
  function size(bytes) {
    if (bytes > 1e6) return (bytes / 1e6).toFixed(1).replace(".", ",") + " Mo";
    return Math.round(bytes / 1e3) + " ko";
  }
  function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function names(keys) {
    var list = keys.map(function (k) { return k === "me" ? "vous" : C.firstName(state.data.people.get(k)); });
    if (list.length < 2) return list.join("");
    return list.slice(0, -1).join(", ") + " et " + list[list.length - 1];
  }
  function personName(k, capital) {
    if (k === "me") return capital ? "Vous" : "vous";
    return state.data.people.get(k).name;
  }
  function title(c) { return state.names[c.key] || c.title; }

  // ---------- Donnees ----------

  function myAddresses() {
    var out = [];
    state.accounts.forEach(function (a) { out = out.concat(a.identities || [a.email]); });
    return out;
  }

  function rebuild() {
    var since = state.periodDays ? Date.now() - state.periodDays * DAY : 0;
    var visible = state.messages.filter(function (m) {
      return state.sources[m.folder] !== false && +m.date >= since;
    });
    state.data = C.buildConversations(visible, {
      me: myAddresses(),
      contacts: state.contacts,
      includeNewsletters: state.includeNewsletters
    });
  }

  async function load() {
    if (DEMO) {
      var demo = window.MaterialChatDemo;
      state.accounts = demo.accounts;
      state.contacts = demo.contacts;
      state.messages = demo.messages;
    } else {
      state.accounts = await TB.listAccounts();
      state.contacts = await TB.listContacts();
    }
    state.accounts.forEach(function (a) {
      a.folders.forEach(function (f) {
        if (!(f.id in state.sources)) state.sources[f.id] = HIDDEN_FOLDERS.indexOf(f.kind) < 0;
      });
    });
    if (!DEMO) await loadFromThunderbird();
    rebuild();
  }

  async function loadFromThunderbird() {
    var sources = [];
    state.accounts.forEach(function (a) {
      a.folders.forEach(function (f) {
        if (state.sources[f.id]) sources.push({ accountId: a.id, folderId: f.id, kind: f.kind });
      });
    });
    var since = state.periodDays ? new Date(Date.now() - state.periodDays * DAY) : undefined;
    state.messages = await TB.loadHeaders(sources, since);
  }

  // ---------- Liste des conversations ----------

  function lastMessage(c, fromOthers) {
    for (var i = c.items.length - 1; i >= 0; i--) {
      var it = c.items[i];
      if (it.type === "message" && !(fromOthers && it.mine)) return it;
    }
    return fromOthers ? lastMessage(c) : null;
  }

  function matches(c) {
    if (state.filter !== "all" && c.kind !== state.filter && !(state.filter === "direct" && c.kind === "self")) return false;
    if (!state.query) return true;
    var q = fold(state.query);
    if (fold(title(c)).indexOf(q) >= 0) return true;
    return c.items.some(function (it) {
      if (it.type !== "message") return false;
      var m = it.message;
      return fold(it.body).indexOf(q) >= 0 || fold(m.subject).indexOf(q) >= 0 ||
        fold(m.from.email).indexOf(q) >= 0;
    });
  }

  function renderList() {
    var ul = $("#conv-list");
    ul.replaceChildren();
    var convs = state.data.conversations.filter(matches);
    if (!convs.length) ul.append(el("li", { class: "conv-last", style: "padding:16px", text: "Aucune conversation." }));
    convs.forEach(function (c) {
      var last = lastMessage(c);
      var prefix = "";
      if (last.mine) prefix = "Vous : ";
      else if (c.kind === "group" || c.kind === "list") prefix = C.firstName(state.data.people.get(last.sender)) + " : ";
      var text = c.kind === "newsletter" ? last.message.subject
        : (last.body || last.message.subject || "").replace(/\s+/g, " ");
      if (!last.body && last.message.attachments.length) text = "📎 " + last.message.attachments.length + " pièce(s) jointe(s)";
      var end = el("div", { class: "conv-end" }, [
        state.accounts.length > 1 ? el("span", { class: "acc-dots", title: c.accounts.map(accountName).join(", ") }, c.accounts.map(accountDot)) : null,
        c.unread ? el("span", { class: "badge", text: String(c.unread) }) : null
      ]);
      ul.append(el("li", {
        class: "conv" + (c.unread ? " unread" : ""),
        "aria-current": c.key === state.current ? "true" : null,
        onclick: function () { open(c.key); }
      }, [
        el("div", { class: "avatar-slot" }, [convAvatar(c)]),
        el("div", { class: "conv-title", text: title(c) }),
        el("div", { class: "conv-time", text: shortTime(c.lastDate) }),
        el("div", { class: "conv-last", text: prefix + text }),
        end
      ]));
    });
    var on = 0, total = 0;
    state.accounts.forEach(function (a) { a.folders.forEach(function (f) { total++; if (state.sources[f.id]) on++; }); });
    $("#sources-line").textContent = state.accounts.length + " comptes · " + on + " dossiers sur " + total +
      (DEMO ? " · données fictives" : "");
  }

  // ---------- Conversation ouverte ----------

  function find(key) {
    return state.data.conversations.filter(function (c) { return c.key === key; })[0];
  }

  function open(key) {
    state.current = key;
    var c = find(key);
    // Ouvrir la conversation marque ses messages comme lus (messages.update en vrai).
    if (c) c.items.forEach(function (it) { if (it.type === "message") it.message.read = true; });
    rebuild();
    $("#app").classList.add("open");
    render();
    var box = $(".messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function subtitle(c) {
    if (c.kind === "direct") {
      var p = state.data.people.get(c.members[0]);
      return p.emails.join(" · ");
    }
    if (c.kind === "group") return c.members.length + 1 + " membres : " + names(c.members.concat(["me"]));
    if (c.kind === "list") return "Liste de diffusion · " + (lastMessage(c).message.to[0] || {}).email;
    if (c.kind === "newsletter") return "Infolettre · " + state.data.people.get(c.members[0]).emails[0];
    return "Messages envoyés à vous-même";
  }

  function renderThread() {
    var main = $("#thread");
    main.replaceChildren();
    var c = state.current && find(state.current);
    if (!c) { main.append(el("div", { class: "empty", text: "Choisissez une conversation" })); return; }

    main.append(el("header", { class: "thread-head" }, [
      el("button", { class: "icon-btn back-btn", title: "Retour", onclick: function () { $("#app").classList.remove("open"); } }, [icon("back")]),
      convAvatar(c),
      el("div", { class: "who" }, [
        el("div", { class: "name", text: title(c) }),
        el("div", { class: "sub", text: subtitle(c) })
      ]),
      el("button", { class: "icon-btn", title: "Ouvrir le dernier courriel dans Thunderbird", onclick: function () { openInThunderbird(lastMessage(c).message); } }, [icon("open")]),
      el("button", { class: "icon-btn", title: "Détails", "aria-pressed": String(state.info), onclick: function () { state.info = !state.info; render(); } }, [icon("info")])
    ]));

    var box = el("div", { class: "messages" });
    var lastDay = null, prev = null, lastAccount = null;
    var multiAccount = c.accounts.length > 1;
    c.items.forEach(function (it, idx) {
      var day = startOfDay(it.type === "message" ? it.message.date : it.date);
      if (day !== lastDay) { box.append(el("div", { class: "day", text: dayLabel(day) })); lastDay = day; prev = null; }

      if (it.type === "members") {
        var parts = [];
        var who = personName(it.by, true);
        if (it.added.length) parts.push(who + (it.by === "me" ? " avez" : " a") + " ajouté " + names(it.added));
        if (it.removed.length) parts.push((parts.length ? "et retiré " : who + (it.by === "me" ? " avez" : " a") + " retiré ") + names(it.removed));
        box.append(el("div", { class: "event", text: parts.join(" ") }));
        prev = null;
        return;
      }
      if (it.type === "subject") {
        box.append(el("div", { class: "event subject" }, [document.createTextNode("Sujet : "), el("b", { text: it.subject })]));
        prev = null;
        return;
      }

      var m = it.message;
      var next = c.items[idx + 1];
      var first = !prev || prev.sender !== it.sender || +m.date - +prev.message.date > 10 * 60000;
      var last = !next || next.type !== "message" || next.sender !== it.sender ||
        +next.message.date - +m.date > 10 * 60000 || startOfDay(next.message.date) !== day;
      var showSender = !it.mine && (c.kind === "group" || c.kind === "list");

      var long = it.body.split("\n").length > 8 || it.body.length > 600;
      var expanded = state.expanded[m.id];
      var bubble = el("div", { class: "bubble" }, [
        showSender && first ? el("div", { class: "sender", style: "--h:" + hue(it.sender), text: personName(it.sender) }) : null,
        it.subject ? el("div", { class: "bubble-subject", text: it.subject }) : null,
        it.body ? el("div", { class: "body" + (long && !expanded ? " clamped" : ""), text: it.body }) : null,
        long ? el("button", { class: "more", text: expanded ? "Réduire" : "Afficher la suite",
          onclick: function () { state.expanded[m.id] = !expanded; renderThread(); } }) : null,
        m.attachments.length ? el("div", { class: "files" }, m.attachments.map(function (a) {
          return el("span", { class: "file", title: a.name }, [icon("file"), el("span", { text: a.name }), el("small", { text: size(a.size) })]);
        })) : null,
        el("div", { class: "meta" }, [
          it.missing.length ? el("span", { class: "tag warn", title: "Ce message n’a pas été envoyé à tout le groupe", text: "sans " + names(it.missing) }) : null,
          bccTag(it),
          // Le compte n est rappele que lorsqu il change d un message a l autre.
          multiAccount && m.account !== lastAccount ? el("span", { class: "tag", title: "Reçu ou envoyé par le compte " + accountName(m.account) }, [accountDot(m.account), document.createTextNode(accountName(m.account))]) : null,
          m.pending ? el("span", { text: "envoi simulé" }) : null,
          el("span", { text: hhmm(m.date) })
        ]),
        el("div", { class: "hover-actions" }, [
          el("button", { class: "icon-btn", title: "Ouvrir ce courriel dans Thunderbird", onclick: function () { openInThunderbird(m); } }, [icon("open")])
        ])
      ]);
      box.append(el("div", {
        class: "row-msg" + (it.mine ? " mine" : "") + (first ? " first" : " cont") + (last ? " last" : "") + (m.pending ? " pending" : "")
      }, [
        !it.mine && c.kind !== "direct" && c.kind !== "newsletter" && c.kind !== "self"
          ? el("div", { class: "avatar-slot" }, [last ? avatar(it.sender, true) : null]) : null,
        bubble
      ]));
      prev = it;
      lastAccount = m.account;
    });
    main.append(box);
    main.append(renderComposer(c));
  }

  function bccTag(it) {
    var bcc = it.mine ? (it.message.bcc || []) : [];
    if (!bcc.length) return null;
    return el("span", { class: "tag", text: "Cci : " + bcc.map(function (a) { return a.name || a.email; }).join(", ") });
  }

  // ---------- Saisie ----------

  function identityFor(c) {
    // On repond depuis l adresse a laquelle le dernier message est arrive.
    var mine = myAddresses().map(C.normalizeEmail);
    var last = lastMessage(c).message;
    var all = [last.from].concat(last.to, last.cc);
    for (var i = 0; i < all.length; i++) {
      if (all[i] && mine.indexOf(C.normalizeEmail(all[i].email)) >= 0) return all[i].email;
    }
    return state.accounts[accountIndex(last.account)].email;
  }

  function renderComposer(c) {
    if (c.kind === "newsletter") {
      return el("div", { class: "readonly" }, [
        el("span", { text: "Infolettre : pas de réponse depuis la vue." }),
        el("button", { class: "btn outlined", text: "Se désinscrire", title: "Même mécanisme que le bandeau de désinscription" })
      ]);
    }
    var last = lastMessage(c);
    var reSubject = /^re\s*:/i.test(last.message.subject) ? last.message.subject : "Re: " + C.normalizeSubject(last.message.subject);
    var identity = el("select", { title: "Adresse d’envoi" }, myAddresses().map(function (a) {
      return el("option", { value: a, text: a });
    }));
    identity.value = identityFor(c);
    var mode = c.kind === "group" || c.kind === "list"
      ? el("select", { title: "Destinataires" }, [
          el("option", { value: "replyToAll", text: c.kind === "list" ? "À la liste" : "À tout le groupe" }),
          el("option", { value: "replyToSender", text: "À " + personName(lastMessage(c, true).sender) + " seulement" })
        ])
      : null;
    var area = el("textarea", { rows: "1", placeholder: "Message", "aria-label": "Message" });
    var send = el("button", { class: "send-btn", title: "Envoyer (Ctrl+Entrée)", disabled: "" }, [icon("send")]);
    area.addEventListener("input", function () {
      area.style.height = "auto";
      area.style.height = Math.min(area.scrollHeight, 160) + "px";
      send.disabled = !area.value.trim();
    });
    area.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && area.value.trim()) send.click();
    });
    send.addEventListener("click", function () {
      submit(c, area.value.trim(), identity.value, mode ? mode.value : "replyToAll", reSubject);
    });
    return el("div", { class: "composer" }, [
      el("div", { class: "composer-meta" }, [
        el("span", { text: "De" }), identity,
        mode,
        el("span", { class: "subject", title: reSubject, text: "· " + reSubject })
      ]),
      el("div", { class: "composer-box" }, [area, send])
    ]);
  }

  function submit(c, text, from, replyType, subject) {
    // Reponse privee : au dernier message d un autre membre, pas au sien.
    var last = lastMessage(c, replyType === "replyToSender").message;
    if (!DEMO) { TB.reply(last, text, replyType); return; }
    // Demo : on fabrique le courriel qu enverrait Thunderbird.
    var to;
    var mine = myAddresses().map(C.normalizeEmail);
    var notMe = function (a) { return a && mine.indexOf(C.normalizeEmail(a.email)) < 0; };
    if (replyType === "replyToSender") to = [last.from].filter(notMe);
    else if (c.kind === "list") to = last.to;
    else to = [last.from].concat(last.to, last.cc).filter(notMe);
    if (!to.length) to = last.to;
    var account = state.accounts.filter(function (a) { return (a.identities || [a.email]).indexOf(from) >= 0; })[0];
    state.messages.push({
      id: "local" + Date.now(), headerMessageId: "local" + Date.now() + "@example",
      from: { name: "Moi", email: from }, to: to, cc: [], bcc: [],
      inReplyTo: last.headerMessageId, references: (last.references || []).concat([last.headerMessageId]),
      date: new Date(), subject: subject, text: text, read: true, attachments: [],
      account: account.id, folder: account.folders.filter(function (f) { return f.kind === "sent"; })[0].id,
      listId: c.kind === "list" ? last.listId : null, listName: last.listName, pending: true
    });
    rebuild();
    // Une reponse privee dans un groupe part dans la conversation directe : on la suit.
    var target = state.data.conversations.filter(function (x) {
      return x.items.some(function (it) { return it.type === "message" && it.message.pending && it.message.text === text; });
    })[0];
    state.current = target ? target.key : c.key;
    render();
    var box = $(".messages");
    box.scrollTop = box.scrollHeight;
    $(".composer textarea").focus();
  }

  function openInThunderbird(m) {
    if (DEMO) { alert("Dans Thunderbird, ce bouton ouvre le courriel « " + m.subject + " » dans un onglet (messageDisplay.open)."); return; }
    TB.openMessage(m);
  }

  // ---------- Panneau de details ----------

  function renderInfo() {
    var panel = $("#info");
    var c = state.current && find(state.current);
    panel.hidden = !state.info || !c;
    if (panel.hidden) return;
    panel.replaceChildren();
    panel.append(el("div", { class: "info-head" }, [
      el("h2", { text: "Détails" }),
      el("button", { class: "icon-btn", title: "Fermer", onclick: function () { state.info = false; render(); } }, [icon("close")])
    ]));

    if (c.kind === "group") {
      var input = el("input", { type: "text", value: title(c), "aria-label": "Nom du groupe" });
      panel.append(el("h3", { text: "Nom du groupe" }), el("div", { class: "rename" }, [
        input,
        el("button", { class: "btn tonal", text: "OK", onclick: function () {
          if (input.value.trim()) state.names[c.key] = input.value.trim(); else delete state.names[c.key];
          render();
        } })
      ]), el("p", { text: "Les groupes de courriels n’ont pas de nom : par défaut, les prénoms des membres." }));
    }

    if (c.members.length) {
      panel.append(el("h3", { text: c.kind === "group" ? "Membres actuels" : "Contact" }));
      c.members.forEach(function (k) {
        var p = state.data.people.get(k);
        panel.append(el("div", { class: "member" }, [avatar(k), el("div", {}, [
          el("div", { text: p.name }),
          el("div", { class: "addr", text: p.emails.join("\n") })
        ])]));
      });
      if (state.data.people.get(c.members[0]).emails.length > 1) {
        panel.append(el("p", { text: "Plusieurs adresses réunies grâce au carnet d’adresses." }));
      }
    }

    var former = [];
    c.items.forEach(function (it) { if (it.type === "members") former = former.concat(it.removed); });
    former = former.filter(function (k) { return c.members.indexOf(k) < 0; });
    if (former.length) {
      panel.append(el("h3", { text: "Anciens membres" }));
      former.forEach(function (k) {
        panel.append(el("div", { class: "member" }, [avatar(k, true), el("div", { text: state.data.people.get(k).name })]));
      });
    }

    panel.append(el("h3", { text: "Comptes" }));
    c.accounts.forEach(function (id) {
      panel.append(el("p", {}, [accountDot(id), document.createTextNode(" " + accountName(id) + " · " + state.accounts[accountIndex(id)].email)]));
    });
    var folders = [];
    c.items.forEach(function (it) { if (it.type === "message" && folders.indexOf(it.message.folder) < 0) folders.push(it.message.folder); });
    panel.append(el("h3", { text: "Dossiers" }), el("p", { text: folders.map(folderName).join(", ") }));
    var count = c.items.filter(function (it) { return it.type === "message"; }).length;
    panel.append(el("h3", { text: "Courriels" }), el("p", { text: count + " courriel" + (count > 1 ? "s" : "") }));
  }

  function folderName(id) {
    for (var i = 0; i < state.accounts.length; i++) {
      var a = state.accounts[i];
      for (var j = 0; j < a.folders.length; j++) if (a.folders[j].id === id) return a.name + " › " + a.folders[j].name;
    }
    return id;
  }

  // ---------- Dialogue des sources ----------

  function openSources() {
    var form = $("#sources-form");
    form.replaceChildren();
    state.accounts.forEach(function (a) {
      var boxes = a.folders.map(function (f) {
        return el("label", {}, [el("input", { type: "checkbox", "data-folder": f.id, checked: state.sources[f.id] ? "" : null }), document.createTextNode(" " + f.name)]);
      });
      var all = el("input", { type: "checkbox", checked: a.folders.some(function (f) { return state.sources[f.id]; }) ? "" : null });
      all.addEventListener("change", function () { boxes.forEach(function (b) { b.firstChild.checked = all.checked; }); });
      form.append(el("div", { class: "acc-block" }, [
        el("label", {}, [all, document.createTextNode(" "), accountDot(a.id), document.createTextNode(" " + a.name + " · " + a.email)]),
        el("div", { class: "folders" }, boxes)
      ]));
    });
    $("#opt-news").checked = state.includeNewsletters;
    $("#opt-period").value = String(state.periodDays);
    $("#sources-dialog").showModal();
  }

  $("#sources-dialog").addEventListener("close", async function () {
    if (this.returnValue !== "ok") return;
    document.querySelectorAll("#sources-form [data-folder]").forEach(function (b) { state.sources[b.dataset.folder] = b.checked; });
    state.includeNewsletters = $("#opt-news").checked;
    state.periodDays = +$("#opt-period").value;
    if (!DEMO) await loadFromThunderbird();
    rebuild();
    if (state.current && !find(state.current)) state.current = null;
    render();
  });

  // ---------- Evenements globaux ----------

  function render() { renderList(); renderThread(); renderInfo(); }

  $("#sources-btn").addEventListener("click", openSources);
  $("#search").addEventListener("input", function () { state.query = this.value; renderList(); });
  $("#filters").addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    this.querySelectorAll("[data-filter]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
    renderList();
  });
  $("#theme-btn").addEventListener("click", function () {
    var root = document.documentElement;
    var dark = root.getAttribute("lwt-theme-brighttext") === "true" ||
      (!root.hasAttribute("lwt-theme-brighttext") && matchMedia("(prefers-color-scheme: dark)").matches);
    root.setAttribute("lwt-theme-brighttext", dark ? "false" : "true");
  });

  load().then(function () {
    var params = new URLSearchParams(location.search);
    // Parametres pour les captures : ?demo&open=<cle>&info=1&sources=1&filter=group
    if (params.get("filter")) $("[data-filter='" + params.get("filter") + "']").click();
    if (params.get("info")) state.info = true;
    if (params.get("open")) open(params.get("open")); else render();
    if (params.get("sources")) openSources();
  });
})();
