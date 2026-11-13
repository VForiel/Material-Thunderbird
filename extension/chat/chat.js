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
    merges: [],             // personnes reunies a la main : [{ id, name, emails }]
    groupMerges: {},        // groupes reunis a la main : { cleSource: cleCible }
    markRead: true,         // ouvrir une conversation marque ses messages comme lus
    extraMe: [],            // autres adresses de l utilisateur (anciennes, alias)
    replyTarget: null,      // message auquel on repond, choisi dans la conversation
    thumbs: {},             // vignettes d images deja lues
    expanded: {},           // messages deplies
    data: null,
    status: ""
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
  // Avatars : initiales tout de suite, puis l image (photo du carnet, logo de
  // marque, Gravatar) quand l experiment la donne. Une personne peut avoir
  // plusieurs adresses : la premiere qui a une image l emporte.
  var avatarCache = {};      // adresse -> url, null (rien) ; absente = pas encore demandee
  var avatarQueue = [];
  var avatarTimer = null;

  function avatarUrl(p) {
    for (var i = 0; i < p.emails.length; i++) if (avatarCache[p.emails[i]]) return avatarCache[p.emails[i]];
    return null;
  }

  function wantAvatar(p) {
    if (DEMO || !TB.getAvatars) return;
    p.emails.forEach(function (e) {
      if (!(e in avatarCache) && avatarQueue.indexOf(e) < 0) avatarQueue.push(e);
    });
    if (!avatarTimer && avatarQueue.length) avatarTimer = setTimeout(fetchAvatars, 50);
  }

  async function fetchAvatars() {
    var batch = avatarQueue.splice(0, 40);
    batch.forEach(function (e) { avatarCache[e] = null; });
    try {
      var found = await TB.getAvatars(batch);
      Object.keys(found || {}).forEach(function (e) { avatarCache[e] = found[e]; });
    } catch (e) { /* sans avatars */ }
    avatarTimer = null;
    paintAvatars();
    if (avatarQueue.length) avatarTimer = setTimeout(fetchAvatars, 50);
  }

  function paintAvatars() {
    document.querySelectorAll(".avatar[data-person]").forEach(function (node) {
      var p = state.data && state.data.people.get(node.getAttribute("data-person"));
      var url = p && avatarUrl(p);
      if (url && node.getAttribute("data-img") !== url) {
        node.setAttribute("data-img", url);
        node.style.backgroundImage = "url(\"" + url.replace(/"/g, "%22") + "\")";
        node.classList.add("img");
      }
    });
  }

  function avatar(personKey, small) {
    var p = state.data.people.get(personKey);
    var node = el("div", { class: "avatar" + (small ? " sm" : ""), style: "--h:" + hue(personKey),
      text: initials(p.name), title: p.name, "data-person": personKey });
    var url = avatarUrl(p);
    if (url) {
      node.setAttribute("data-img", url);
      node.style.backgroundImage = "url(\"" + url.replace(/"/g, "%22") + "\")";
      node.classList.add("img");
    } else {
      wantAvatar(p);
    }
    return node;
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

  // « Vous » = identites des comptes, adresses ajoutees a la main, et toute
  // adresse qui expedie depuis un dossier Envoyes.
  function meAddresses() {
    var out = myAddresses().concat(state.extraMe);
    state.messages.forEach(function (m) {
      if (m.folderKind === "sent" && m.from && m.from.email) out.push(m.from.email);
    });
    return out;
  }

  function rebuild() {
    var since = state.periodDays ? Date.now() - state.periodDays * DAY : 0;
    var visible = state.messages.filter(function (m) {
      return state.sources[m.folder] !== false && +m.date >= since;
    });
    state.data = C.buildConversations(visible, {
      me: meAddresses(),
      meNames: identityNames(),
      contacts: state.contacts.concat(state.merges),
      groupMerges: state.groupMerges,
      includeNewsletters: state.includeNewsletters
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.append(s);
    });
  }

  function setStatus(text) { state.status = text; renderStatus(); }

  async function load() {
    if (DEMO) {
      await loadScript("mock-data.js");
      var demo = window.MaterialChatDemo;
      state.accounts = demo.accounts;
      state.contacts = demo.contacts;
      state.messages = demo.messages;
    } else {
      var saved = await TB.loadSettings();
      if (saved) {
        state.sources = saved.sources || {};
        state.includeNewsletters = saved.includeNewsletters !== false;
        state.periodDays = saved.periodDays === undefined ? 180 : saved.periodDays;
        state.names = saved.names || {};
        state.merges = saved.merges || [];
        state.groupMerges = saved.groupMerges || {};
        state.markRead = saved.markRead !== false;
        state.extraMe = saved.extraMe || [];
      }
      setStatus("Lecture des comptes…");
      state.accounts = await retryWhileStarting(TB.listAccounts, "Lecture des comptes");
      state.contacts = await retryWhileStarting(TB.listContacts, "Lecture des contacts").catch(function () { return []; });
    }
    state.accounts.forEach(function (a) {
      a.folders.forEach(function (f) {
        if (!(f.id in state.sources)) {
          state.sources[f.id] = f.byDefault !== undefined ? f.byDefault : HIDDEN_FOLDERS.indexOf(f.kind) < 0;
        }
      });
    });
    if (!DEMO) {
      // Cache : la vue s affiche tout de suite avec ce qu on savait a la
      // derniere ouverture, puis se met a jour avec la vraie lecture.
      var cache = await TB.loadCache();
      if (cache && cache.sourcesKey === sourcesKey()) {
        state.messages = cache.messages;
        state.fromCache = true;
        rebuild();
        render();
      }
      await loadFromThunderbird();
      startWatching();
    }
    rebuild();
  }

  function currentSources() {
    var sources = [];
    state.accounts.forEach(function (a) {
      a.folders.forEach(function (f) {
        if (state.sources[f.id]) sources.push({ accountId: a.id, folderId: f.id, kind: f.kind });
      });
    });
    return sources;
  }

  function sourcesKey() {
    return currentSources().map(function (s) { return s.folderId; }).sort().join("|") + "#" + state.periodDays;
  }

  var saveTimer = null;
  function scheduleSave() {
    if (DEMO) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { TB.saveCache(sourcesKey(), state.messages); }, 3000);
  }

  // Nouveaux courriels, etat lu change ailleurs, suppression : la vue suit.
  var watching = false;
  function startWatching() {
    if (watching || !TB.watch) return;
    watching = true;
    TB.watch(currentSources, {
      added: function (list) {
        var known = {};
        state.messages.forEach(function (m) { known[m.id] = true; });
        var fresh = list.filter(function (m) { return !known[m.id]; });
        if (!fresh.length) return;
        state.messages = state.messages.concat(fresh);
        refresh();
        Promise.all(fresh.map(TB.loadDetails)).then(function () { refresh(); scheduleSave(); });
      },
      updated: function (id, changes) {
        var m = state.messages.filter(function (x) { return x.id === id && !x.stale; })[0];
        if (!m) return;
        Object.assign(m, changes);
        refresh();
        scheduleSave();
      },
      deleted: function (ids) {
        var before = state.messages.length;
        state.messages = state.messages.filter(function (m) { return ids.indexOf(m.id) < 0 || m.stale; });
        if (state.messages.length !== before) { refresh(); scheduleSave(); }
      }
    });
  }

  // Juste apres le demarrage de Thunderbird, une requete peut ne jamais
  // repondre : on la relance (jusqu a 4 fois, 10 s chacune).
  async function retryWhileStarting(fn, label) {
    for (var attempt = 1; ; attempt++) {
      if (attempt > 1) setStatus("Thunderbird démarre : " + label.toLowerCase() + ", nouvel essai (" + attempt + ")…");
      var timer;
      var timeout = new Promise(function (resolve) { timer = setTimeout(resolve, 10000, "timeout"); });
      var result = await Promise.race([fn(), timeout]);
      clearTimeout(timer);
      if (result !== "timeout") return result;
      if (attempt >= 4) throw new Error(label + " : pas de réponse de Thunderbird");
    }
  }

  function saveSettings() {
    if (DEMO) return;
    TB.saveSettings({ sources: state.sources, includeNewsletters: state.includeNewsletters,
      periodDays: state.periodDays, names: state.names, merges: state.merges,
      groupMerges: state.groupMerges, markRead: state.markRead, extraMe: state.extraMe });
  }

  async function loadFromThunderbird() {
    var sources = currentSources();
    var previous = state.messages;
    var since = state.periodDays ? new Date(Date.now() - state.periodDays * DAY) : undefined;
    // Au demarrage de Thunderbird (onglet restaure), la premiere requete peut
    // ne jamais repondre : on la relance si rien n est arrive en 15 s.
    for (var attempt = 1; ; attempt++) {
      setStatus(attempt > 1 ? "Thunderbird démarre, nouvel essai (" + attempt + ")…"
        : state.fromCache ? "Mise à jour…" : "Lecture des en-têtes…");
      var progressed = false;
      var timer;
      var timeout = new Promise(function (resolve) { timer = setTimeout(resolve, 15000, null); });
      var headers = TB.loadHeaders(sources, since, function (n) {
        progressed = true;
        setStatus((state.fromCache ? "Mise à jour : " : "") + n + " courriels lus…");
      });
      var result = await Promise.race([headers, timeout.then(function () { return progressed ? headers : null; })]);
      clearTimeout(timer);
      if (result || attempt >= 4) { state.messages = result || previous; break; }
    }
    // Reprend les details deja lus (texte, liste, infolettre, pieces jointes) :
    // seuls les nouveaux courriels seront ouverts.
    var known = {};
    previous.forEach(function (m) { if (m.loaded && m.headerMessageId) known[m.headerMessageId] = m; });
    state.messages.forEach(function (m) {
      var old = known[m.headerMessageId];
      if (!old || m === old) return;
      ["text", "listId", "listName", "isNewsletter", "unsubscribe", "attachments"].forEach(function (k) {
        if (old[k] !== undefined) m[k] = old[k];
      });
      m.loaded = true;
    });
    state.fromCache = false;
    setStatus("");
    refresh();
    scheduleSave();
    enrich();
  }

  // En tache de fond : texte et classement (liste, infolettre) des messages
  // les plus recents, pour que la liste se range sans attendre les ouvertures.
  var enrichRun = 0;
  async function enrich() {
    var run = ++enrichRun;
    // Les 400 plus recents, puis ceux d entre eux pas encore lus (et non
    // l inverse, qui irait chercher toujours plus loin a chaque ouverture).
    var todo = state.messages.slice().sort(function (a, b) { return +b.date - +a.date; })
      .slice(0, 400).filter(function (m) { return !m.loaded; });
    for (var i = 0; i < todo.length; i += 8) {
      if (run !== enrichRun) return;
      await Promise.all(todo.slice(i, i + 8).map(TB.loadDetails));
      if ((i / 8) % 6 === 5 || i + 8 >= todo.length) {
        state.status = "Analyse des messages récents : " + Math.min(i + 8, todo.length) + " / " + todo.length;
        refresh();
      }
    }
    setStatus("");
    scheduleSave();
  }

  async function loadConversationDetails(c) {
    var todo = c.items.filter(function (it) { return it.type === "message" && !it.message.loaded; })
      .map(function (it) { return it.message; });
    if (!todo.length) return;
    for (var i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(TB.loadDetails));
    refresh();
    scheduleSave();
  }

  // Reconstruit et redessine en gardant la position de lecture.
  function refresh() {
    var box = $(".messages");
    var atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    var top = box ? box.scrollTop : 0;
    rebuild();
    render();
    box = $(".messages");
    if (box) box.scrollTop = atBottom ? box.scrollHeight : top;
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
    renderStatus();
  }

  function renderStatus() {
    var line = $("#sources-line");
    if (!line) return;
    var on = 0, total = 0;
    state.accounts.forEach(function (a) { a.folders.forEach(function (f) { total++; if (state.sources[f.id]) on++; }); });
    line.textContent = state.status ||
      (state.accounts.length + " comptes · " + on + " dossiers sur " + total + " · " +
       state.messages.length + " courriels" + (DEMO ? " · données fictives" : ""));
  }

  // ---------- Conversation ouverte ----------

  function find(key) {
    return state.data.conversations.filter(function (c) { return c.key === key; })[0];
  }

  function open(key) {
    state.current = key;
    state.replyTarget = null;
    var c = find(key);
    if (c && !DEMO) loadConversationDetails(c);
    // Ouvrir une conversation marque ses messages comme lus, comme une messagerie.
    if (c && state.markRead) {
      var unread = c.items.filter(function (it) { return it.type === "message" && !it.mine && !it.message.read; })
        .map(function (it) { return it.message; });
      unread.forEach(function (m) { m.read = true; });
      if (unread.length && !DEMO) TB.markRead(unread);
      if (unread.length) rebuild();
    }
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

  var renderedKey = null;
  function renderThread() {
    var main = $("#thread");
    // Redessiner la meme conversation (Afficher la suite, Repondre a, envoi)
    // garde la position de lecture ; la zone neuve repartirait du haut.
    var oldBox = $(".messages");
    var keepScroll = oldBox && renderedKey === state.current ? oldBox.scrollTop : null;
    renderedKey = state.current;
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
        it.replyTo ? quote(it.replyTo) : null,
        it.subject ? el("div", { class: "bubble-subject", text: it.subject }) : null,
        it.body ? el("div", { class: "body" + (long && !expanded ? " clamped" : ""), text: it.body })
          : m.loaded === false ? el("div", { class: "body loading", text: "…" }) : null,
        long ? el("button", { class: "more", text: expanded ? "Réduire" : "Afficher la suite",
          onclick: function () { state.expanded[m.id] = !expanded; renderThread(); } }) : null,
        images(m),
        m.attachments.some(function (a) { return !isImage(a); }) ? el("div", { class: "files" }, m.attachments.filter(function (a) { return !isImage(a); }).map(function (a) {
          return el("span", { class: "file", title: a.name }, [icon("file"), el("span", { text: a.name }), el("small", { text: size(a.size) })]);
        })) : null,
        el("div", { class: "meta" }, [
          it.missing.length ? el("span", { class: "tag warn", title: "Ce message n’a pas été envoyé à tout le groupe", text: "sans " + names(it.missing) }) : null,
          bccTag(it),
          // Le compte n est rappele que lorsqu il change d un message a l autre.
          multiAccount && m.account !== lastAccount ? el("span", { class: "tag", title: "Reçu ou envoyé par le compte " + accountName(m.account) }, [accountDot(m.account), document.createTextNode(accountName(m.account))]) : null,
          m.sendState ? el("span", { class: m.sendState === "failed" ? "send-failed" : "", text: SEND_LABELS[m.sendState] }) : null,
          el("span", { text: hhmm(m.date) })
        ]),
        el("div", { class: "hover-actions" }, [
          c.kind !== "newsletter" ? el("button", { class: "icon-btn", title: "Répondre à ce message", onclick: function () { chooseReply(it); } }, [icon("reply")]) : null,
          el("button", { class: "icon-btn", title: "Ouvrir ce courriel dans Thunderbird", onclick: function () { openInThunderbird(m); } }, [icon("open")])
        ])
      ]);
      box.append(el("div", {
        class: "row-msg" + (it.mine ? " mine" : "") + (first ? " first" : " cont") + (last ? " last" : "") + (m.sendState === "sending" ? " pending" : ""),
        "data-mid": m.headerMessageId
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
    if (keepScroll !== null) box.scrollTop = keepScroll;
  }

  var SEND_LABELS = { sending: "envoi…", sent: "envoyé", failed: "échec : la fenêtre de rédaction est restée ouverte", demo: "envoi simulé" };

  function quote(r) {
    // « En reponse a » : cliquer va au message cite, dans cette conversation
    // ou dans celle ou il se trouve (reponse privee a un message de groupe).
    var who = r.sender === "me" ? "Vous" : C.firstName(state.data.people.get(r.sender));
    return el("button", {
      class: "quote", style: r.sender === "me" ? null : "--h:" + hue(r.sender),
      title: "Aller au message cité",
      onclick: function () {
        if (r.conv) { open(r.conv); }
        jumpTo(r.headerMessageId);
      }
    }, [
      el("span", { class: "quote-who", text: who + (r.conv ? " · " + (state.names[r.conv] || r.convTitle) : "") }),
      el("span", { class: "quote-text", text: r.text || "…" })
    ]);
  }

  function jumpTo(headerMessageId) {
    var row = Array.prototype.filter.call(document.querySelectorAll(".row-msg"), function (n) {
      return n.getAttribute("data-mid") === headerMessageId;
    })[0];
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  function isImage(a) {
    return /^image\//i.test(a.contentType || "") || (!a.contentType && /\.(jpe?g|png|gif|webp|heic)$/i.test(a.name));
  }

  // Logos de signature (reseaux sociaux, etablissement) : petites images
  // jointes au corps, qu on ne montre pas en vignette.
  function isSignatureImage(a) {
    return a.size > 0 && a.size < 30000;
  }

  function identityNames() {
    var out = [];
    state.accounts.forEach(function (a) {
      (a.identityIds || []).forEach(function (i) { if (i.name) out.push(i.name); });
    });
    return out;
  }

  function images(m) {
    var list = m.attachments.filter(function (a) { return isImage(a) && !isSignatureImage(a); });
    if (!list.length) return null;
    return el("div", { class: "thumbs" + (list.length === 1 ? " single" : "") }, list.map(function (a) {
      var key = m.id + "/" + (a.partName || a.name);
      var box = el("button", { class: "thumb", title: a.name + " · " + size(a.size), onclick: function () { openInThunderbird(m); } });
      if (state.thumbs[key]) {
        box.append(el("img", { src: state.thumbs[key], alt: a.name, loading: "lazy" }));
      } else if (DEMO) {
        box.classList.add("placeholder");
        box.style.setProperty("--h", hue(a.name));
        box.append(el("span", { text: a.name }));
      } else {
        box.classList.add("placeholder");
        box.append(el("span", { text: a.name }));
        TB.attachmentUrl(m, a).then(function (url) {
          state.thumbs[key] = url;
          box.classList.remove("placeholder");
          box.replaceChildren(el("img", { src: url, alt: a.name }));
        }).catch(function () {});
      }
      return box;
    }));
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
    if (c.kind === "newsletter") return renderUnsubscribe(c);
    var target = state.replyTarget && state.replyTarget.conv === c.key ? state.replyTarget.item : null;
    var last = target || lastMessage(c);
    var reSubject = /^re\s*:/i.test(last.message.subject) ? last.message.subject : "Re: " + C.normalizeSubject(last.message.subject);
    var identity = el("select", { title: "Adresse d’envoi" }, myAddresses().map(function (a) {
      return el("option", { value: a, text: a });
    }));
    // L adresse du courriel peut differer de l identite par la casse, ou etre
    // une ancienne adresse : on retombe sur l identite du compte.
    var wanted = C.normalizeEmail(identityFor(c));
    var lastAccount = state.accounts[accountIndex(lastMessage(c).message.account)];
    identity.value = myAddresses().filter(function (a) { return C.normalizeEmail(a) === wanted; })[0] ||
      (lastAccount && lastAccount.email) || myAddresses()[0];
    var mode = c.kind === "group" || c.kind === "list"
      ? el("select", { title: "Destinataires" }, [
          el("option", { value: "replyToAll", text: c.kind === "list" ? "À la liste" : "À tout le groupe" }),
          el("option", { value: "replyToSender", text: "À " + personName((target && !target.mine ? target : lastMessage(c, true)).sender) + " seulement" })
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
      submit(c, area.value.trim(), identity.value, mode ? mode.value : "replyToAll", reSubject, target);
    });
    var replying = target ? el("div", { class: "replying" }, [
      el("div", { class: "replying-text" }, [
        el("b", { text: "En réponse à " + personName(target.sender) }),
        el("span", { text: (target.body || target.message.subject || "").replace(/\s+/g, " ").slice(0, 160) })
      ]),
      el("button", { class: "icon-btn", title: "Ne plus répondre à ce message", onclick: function () { state.replyTarget = null; renderThread(); } }, [icon("close")])
    ]) : null;
    return el("div", { class: "composer" }, [
      replying,
      el("div", { class: "composer-meta" }, [
        el("span", { text: "De" }), identity,
        mode,
        el("span", { class: "subject", title: reSubject, text: "· " + reSubject })
      ]),
      el("div", { class: "composer-box" }, [area, send])
    ]);
  }

  // ---------- Desinscription (infolettres) ----------
  // Memes voies que le bandeau : un clic (RFC 8058) apres confirmation, sinon
  // la page de l expediteur, sinon un brouillon mailto que l utilisateur envoie.

  var UNSUB_RESULTS = {
    done: "Désinscription envoyée. Les prochains envois peuvent mettre quelques jours à s’arrêter.",
    opened: "Page de désinscription ouverte dans un onglet.",
    draft: "Brouillon de désinscription ouvert : relisez-le puis envoyez-le.",
    failed: "La désinscription a échoué.",
    unavailable: "Aucun moyen de désinscription trouvé dans ces courriels."
  };

  function unsubscribeInfo(c) {
    for (var i = c.items.length - 1; i >= 0; i--) {
      var it = c.items[i];
      if (it.type === "message" && it.message.unsubscribe) return it.message.unsubscribe;
    }
    return null;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  function renderUnsubscribe(c) {
    state.unsub = state.unsub || {};
    var st = state.unsub[c.key] || { phase: "idle" };
    var info = unsubscribeInfo(c);
    var box = el("div", { class: "readonly" });
    var set = function (next) { state.unsub[c.key] = next; renderThread(); };
    var run = async function (details) {
      set({ phase: "busy" });
      var result = DEMO ? (details.oneClick ? "done" : "opened") : await TB.unsubscribe(details);
      set({ phase: "result", result: result, details: details });
    };

    if (!info) {
      var loading = c.items.some(function (it) { return it.type === "message" && it.message.loaded === false; });
      box.append(el("span", { text: loading ? "Recherche du lien de désinscription…" : UNSUB_RESULTS.unavailable }));
      return box;
    }
    var host = hostOf(info.url) || (info.mailto || "").replace(/^mailto:/i, "").split("?")[0];

    if (st.phase === "busy") {
      box.append(el("span", { text: "Désinscription en cours…" }));
    } else if (st.phase === "confirm") {
      box.append(
        el("span", { text: "Se désinscrire immédiatement auprès de " + host + " ?" }),
        el("button", { class: "btn text", text: "Annuler", onclick: function () { set({ phase: "idle" }); } }),
        el("button", { class: "btn filled", text: "Confirmer", onclick: function () { run(info); } }));
    } else if (st.phase === "result") {
      box.append(el("span", { class: st.result === "failed" ? "send-failed" : "", text: UNSUB_RESULTS[st.result] || st.result }));
      if (st.result === "failed" && info.url) {
        box.append(el("button", { class: "btn outlined", text: "Ouvrir la page", onclick: function () {
          run({ url: info.url, oneClick: false });
        } }));
      }
    } else {
      var label = info.url ? (info.oneClick ? "Se désinscrire" : "Ouvrir la page de désinscription") : "Préparer le courriel de désinscription";
      box.append(
        el("span", { title: host, text: "Infolettre de " + title(c) + (info.oneClick ? " · désinscription en un clic" : "") }),
        el("button", { class: "btn outlined", text: label, onclick: function () {
          if (info.url && info.oneClick) set({ phase: "confirm" }); else run(info);
        } }));
    }
    return box;
  }

  function chooseReply(it) {
    state.replyTarget = { conv: state.current, item: it };
    renderThread();
    var area = $(".composer textarea");
    if (area) area.focus();
  }

  async function submit(c, text, from, replyType, subject, target) {
    // Message vise : celui choisi, sinon le dernier ; pour une reponse privee,
    // le dernier message d un autre membre, pas le sien.
    var last = target && !(replyType === "replyToSender" && target.mine)
      ? target.message : lastMessage(c, replyType === "replyToSender").message;
    // Bulle affichee tout de suite ; le vrai courriel arrivera dans Envoyes.
    var to;
    var mine = myAddresses().map(C.normalizeEmail);
    var notMe = function (a) { return a && mine.indexOf(C.normalizeEmail(a.email)) < 0; };
    if (replyType === "replyToSender") to = [last.from].filter(notMe);
    else if (c.kind === "list") to = last.to;
    else {
      // Groupe : on ecrit aux membres actuels, pas aux destinataires d alors du
      // message cite (qui peuvent inclure des membres retires depuis).
      var current = lastMessage(c).message;
      to = [current.from].concat(current.to, current.cc).filter(notMe);
    }
    if (!to.length) to = last.to;
    var dedup = {};
    to = to.filter(function (a) { var k = C.normalizeEmail(a.email); if (dedup[k]) return false; dedup[k] = true; return true; });
    var account = state.accounts.filter(function (a) { return (a.identities || [a.email]).indexOf(from) >= 0; })[0] ||
      state.accounts[accountIndex(last.account)];
    state.messages.push({
      id: "local" + Date.now(), headerMessageId: "local" + Date.now() + "@example",
      from: { name: "Moi", email: from }, to: to, cc: [], bcc: [],
      inReplyTo: last.headerMessageId, references: (last.references || []).concat([last.headerMessageId]),
      date: new Date(), subject: subject, text: text, read: true, attachments: [],
      account: account.id, folder: (account.folders.filter(function (f) { return f.kind === "sent"; })[0] || account.folders[0]).id,
      listId: c.kind === "list" ? last.listId : null, listName: last.listName,
      loaded: true, sendState: DEMO ? "demo" : "sending"
    });
    var local = state.messages[state.messages.length - 1];
    state.replyTarget = null;
    rebuild();
    // Une reponse privee dans un groupe part dans la conversation directe : on la suit.
    var target = state.data.conversations.filter(function (x) {
      return x.items.some(function (it) { return it.type === "message" && it.message === local; });
    })[0];
    state.current = target ? target.key : c.key;
    render();
    var box = $(".messages");
    box.scrollTop = box.scrollHeight;
    $(".composer textarea").focus();
    if (DEMO) return;
    var identityId = null;
    state.accounts.forEach(function (a) {
      (a.identityIds || []).forEach(function (i) { if (i.email === from) identityId = i.id; });
    });
    try {
      // Destinataires imposes seulement en groupe (en direct et en liste,
      // Thunderbird calcule deja les bons).
      var recipients = c.kind === "group" && replyType === "replyToAll"
        ? to.map(function (a) { return a.name ? a.name + " <" + a.email + ">" : a.email; }) : null;
      await TB.sendReply(last, text, replyType, identityId, recipients);
      local.sendState = "sent";
    } catch (err) {
      console.error("[Material-Thunderbird] Envoi impossible :", err);
      local.sendState = "failed";
    }
    refresh();
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
          saveSettings();
          render();
        } })
      ]), el("p", { text: "Les groupes de courriels n’ont pas de nom : par défaut, les prénoms des membres." }));
    }

    if (c.members.length) {
      panel.append(el("h3", { text: c.kind === "group" ? "Membres actuels" : "Contact" }));
      c.members.forEach(function (k) {
        var p = state.data.people.get(k);
        panel.append(el("div", { class: "member" }, [avatar(k), el("div", { class: "member-who" }, [
          el("div", { text: p.name }),
          el("div", { class: "addr", text: p.emails.join("\n") })
        ]), el("button", { class: "btn text small", text: "C’est moi", title: "Ces adresses sont à vous : ne plus les compter comme un autre participant",
          onclick: function () {
            p.emails.forEach(function (e) { if (state.extraMe.indexOf(e) < 0) state.extraMe.push(e); });
            saveSettings(); rebuild();
            if (!find(state.current)) state.current = null;
            render();
          } })]));
      });
      if (state.data.people.get(c.members[0]).emails.length > 1) {
        panel.append(el("p", { text: "Plusieurs adresses réunies grâce au carnet d’adresses." }));
      }
    }

    panel.append(renderMerge(c));

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

  // Fusion a la main : une personne avec une autre (adresses reunies), ou un
  // groupe avec un autre. Memorise dans les reglages de la vue.
  function renderMerge(c) {
    var wrap = el("div", {});
    // append(null) ecrirait « null » : on filtre.
    var add = function () { wrap.append.apply(wrap, Array.prototype.filter.call(arguments, Boolean)); };
    if (c.kind !== "direct" && c.kind !== "group") return wrap;
    var others = state.data.conversations.filter(function (x) { return x.kind === c.kind && x.key !== c.key; });
    var select = el("select", { "aria-label": "Fusionner avec" }, [el("option", { value: "", text: "Choisir…" })].concat(
      others.map(function (x) { return el("option", { value: x.key, text: title(x) }); })));
    var undo = null;
    if (c.kind === "direct") {
      var mine = state.data.people.get(c.members[0]).emails;
      var involved = state.merges.filter(function (mg) { return mg.emails.some(function (e) { return mine.indexOf(e) >= 0; }); });
      if (involved.length) undo = function () { state.merges = state.merges.filter(function (mg) { return involved.indexOf(mg) < 0; }); };
    } else {
      var sources = Object.keys(state.groupMerges).filter(function (k) { return state.groupMerges[k] === c.key; });
      if (sources.length) undo = function () { sources.forEach(function (k) { delete state.groupMerges[k]; }); };
    }
    add(
      el("h3", { text: c.kind === "direct" ? "Même personne que…" : "Fusionner avec le groupe…" }),
      el("div", { class: "rename" }, [select, el("button", { class: "btn tonal", text: "Fusionner", onclick: function () {
        var other = others.filter(function (x) { return x.key === select.value; })[0];
        if (!other) return;
        if (c.kind === "direct") {
          var a = state.data.people.get(c.members[0]), b = state.data.people.get(other.members[0]);
          state.merges.push({ id: "merge-" + Date.now(), name: a.contact || !b.contact ? a.name : b.name,
            emails: a.emails.concat(b.emails.filter(function (e) { return a.emails.indexOf(e) < 0; })) });
        } else {
          state.groupMerges[other.key] = c.key;
        }
        saveSettings(); rebuild(); render();
      } })]),
      undo ? el("button", { class: "btn text", text: "Annuler les fusions", onclick: function () { undo(); saveSettings(); rebuild(); render(); } }) : null
    );
    return wrap;
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
    $("#opt-read").checked = state.markRead;
    $("#opt-me").value = state.extraMe.join("\n");
    $("#sources-dialog").showModal();
  }

  $("#sources-dialog").addEventListener("close", async function () {
    if (this.returnValue !== "ok") return;
    document.querySelectorAll("#sources-form [data-folder]").forEach(function (b) { state.sources[b.dataset.folder] = b.checked; });
    state.includeNewsletters = $("#opt-news").checked;
    state.periodDays = +$("#opt-period").value;
    state.markRead = $("#opt-read").checked;
    state.extraMe = $("#opt-me").value.split(/[\s,;]+/).map(C.normalizeEmail).filter(function (e) { return /@/.test(e); });
    saveSettings();
    if (!DEMO) { render(); await loadFromThunderbird(); }
    rebuild();
    if (state.current && !find(state.current)) state.current = null;
    render();
  });

  // ---------- Evenements globaux ----------

  function render() { renderList(); renderThread(); renderInfo(); }

  $("#sources-btn").addEventListener("click", openSources);

  // Actualiser : releve le courrier de tous les comptes (comme le bouton
  // Relever de Thunderbird), puis relit les dossiers affiches.
  var refreshing = false;
  $("#refresh-btn").addEventListener("click", async function () {
    if (refreshing) return;
    refreshing = true;
    var btn = this;
    btn.classList.add("spinning");
    btn.disabled = true;
    try {
      if (DEMO) {
        await new Promise(function (r) { setTimeout(r, 600); });
      } else {
        setStatus("Relève du courrier…");
        await TB.getNewMail();
        await loadFromThunderbird();
      }
    } catch (err) {
      console.error("[Material-Thunderbird] Actualisation impossible :", err);
      setStatus("Erreur : " + (err && err.message || err));
    } finally {
      refreshing = false;
      btn.classList.remove("spinning");
      btn.disabled = false;
    }
  });
  $("#search").addEventListener("input", function () { state.query = this.value; renderList(); });
  $("#filters").addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (!b) return;
    state.filter = b.dataset.filter;
    this.querySelectorAll("[data-filter]").forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
    renderList();
  });

  if (!DEMO && browser.materialAssistant && browser.materialAssistant.hideTabToolbar) {
    browser.materialAssistant.hideTabToolbar(location.href.split("?")[0]).catch(function () {});
  }

  load().catch(function (err) {
    console.error("[Material-Thunderbird] Vue messagerie :", err);
    setStatus("Erreur : " + (err && err.message || err));
  }).then(function () {
    var params = new URLSearchParams(location.search);
    // Parametres pour les captures : ?demo&open=<cle>&info=1&sources=1&filter=group
    if (params.get("filter")) $("[data-filter='" + params.get("filter") + "']").click();
    if (params.get("info")) state.info = true;
    if (params.get("open")) open(params.get("open")); else render();
    if (params.get("sources")) openSources();
  });
})();
