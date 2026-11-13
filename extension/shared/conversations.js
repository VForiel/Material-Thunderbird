/**
 * Material-Thunderbird - Vue messagerie : regroupement des courriels en conversations.
 *
 * PROTOTYPE (branche prototype/chat-view). Module pur, sans API Thunderbird :
 * la source de donnees (Thunderbird ou fictive) fournit des messages normalises,
 * ce module en tire des conversations facon messagerie instantanee. Teste par
 * tests/conversations.test.js.
 *
 * Message normalise attendu :
 *   { id, headerMessageId, inReplyTo, references: [],
 *     from: {name, email}, to: [{name, email}], cc: [...], bcc: [...],
 *     date: Date|number, subject, account, folderKind ("inbox"|"sent"|...),
 *     listId, isNewsletter, read, text, attachments: [{name, size}] }
 *
 * Regles (voir docs de la proposition) :
 *   1. Les participants d un message sont expediteur + destinataires + copies,
 *      moins les adresses de l utilisateur (toutes ses identites, tous comptes),
 *      chaque adresse ramenee a une personne (alias du carnet d adresses).
 *   2. Liste de discussion (List-Id)      -> une conversation par liste.
 *      Infolettre                          -> une conversation par expediteur, en lecture seule.
 *      Aucun autre participant             -> conversation « Notes a soi ».
 *      Un seul autre participant           -> conversation directe avec cette personne,
 *                                             quel que soit le fil ou le sujet.
 *      Plusieurs autres participants       -> groupe. Un groupe suit le fil
 *                                             (References / In-Reply-To), meme si les
 *                                             destinataires changent en route ; deux fils
 *                                             distincts avec exactement les memes
 *                                             participants forment un seul groupe.
 *   3. Dans un groupe, chaque changement d audience produit un evenement
 *      « X a ajoute Y » / « Y n est plus en copie » ; un message qui n est pas
 *      adresse a tous les membres porte la mention de son audience.
 */

(function (global) {
  "use strict";

  var SUBJECT_PREFIX = /^\s*((re|fw|fwd|tr|aw|wg|r|rif|sv|vs|antw)(\[\d+\])?\s*:\s*|\[[^\]]{1,40}\]\s*)+/i;

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function normalizeSubject(subject) {
    var s = String(subject || "");
    var prev;
    do { prev = s; s = s.replace(SUBJECT_PREFIX, ""); } while (s !== prev);
    return s.trim();
  }

  /**
   * Resolveur de personnes : une personne = un contact du carnet (plusieurs
   * adresses possibles) ou, a defaut, une adresse seule.
   * contacts : [{ id, name, emails: [] }]
   */
  function makePeople(contacts) {
    var byEmail = {};
    var people = {};
    (contacts || []).forEach(function (c) {
      var key = "c:" + c.id;
      people[key] = { key: key, name: c.name, emails: c.emails.map(normalizeEmail), contact: true };
      c.emails.forEach(function (e) { byEmail[normalizeEmail(e)] = key; });
    });
    return {
      keyOf: function (addr) {
        var email = normalizeEmail(addr && addr.email);
        var key = byEmail[email] || "e:" + email;
        if (!people[key]) {
          people[key] = { key: key, name: (addr && addr.name) || email.split("@")[0], emails: [email], contact: false };
        } else if (!people[key].contact && addr && addr.name && people[key].name === email.split("@")[0]) {
          people[key].name = addr.name;
        }
        return key;
      },
      get: function (key) { return people[key]; }
    };
  }

  /** Union-find minimal pour relier les messages d un meme fil. */
  function makeThreads() {
    var parent = {};
    function find(x) {
      if (parent[x] === undefined) parent[x] = x;
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    return { find: find, union: union };
  }

  function diff(a, b) { return a.filter(function (x) { return b.indexOf(x) < 0; }); }

  /**
   * Partie nouvelle d un courriel en texte brut : retire la citation
   * (« Le ... a ecrit : », lignes en >, en-tete Outlook) et la signature « -- ».
   */
  function stripQuoted(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var next = lines[i + 1] || "";
      if (/^-- ?$/.test(line)) break;
      if (/^\s*-{2,}\s*(original message|message d'origine|message original|mail original|forwarded message|message transf[ée]r[ée])\s*-{2,}/i.test(line)) break;
      if (/^\s*(de|from)\s*:\s*\S/i.test(line) && /^\s*(envoy[ée]|sent|date|[àa]|to)\s*:/i.test(next)) break;
      // Attribution sur une ou deux lignes (Gmail coupe souvent apres la date).
      var attribution = line + " " + next;
      if (/^\s*(le|on|am|el|il)\b.{0,220}\b(a [ée]crit|wrote|schrieb|escribi[óo]|ha scritto)\s*:\s*$/i.test(line) ||
          (/^\s*(le|on)\b/i.test(line) && /\b(a [ée]crit|wrote)\s*:\s*$/i.test(attribution) && !/:\s*$/.test(line) && /:\s*$/.test(next) && next.length < 120)) {
        break;
      }
      if (/^\s*>/.test(line)) continue;
      out.push(line);
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    while (out.length && !out[0].trim()) out.shift();
    return out.join("\n");
  }

  /**
   * Construit les conversations.
   * options : { me: [emails], contacts: [...], includeNewsletters: bool }
   * Retour : [{ key, kind: "direct"|"group"|"list"|"newsletter"|"self",
   *             members: [personKey], title, items: [...], lastDate, unread,
   *             accounts: [..] }] triees de la plus recente a la plus ancienne.
   * items : { type: "message", message, mine, sender, audience?, body }
   *         { type: "members", by, added, removed, date }
   *         { type: "subject", subject, date }
   */
  function foldName(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function buildConversations(messages, options) {
    options = options || {};
    var result = buildOnce(messages, options);
    // Deux groupes qui finissent avec exactement les memes membres n en font
    // qu un, comme dans une messagerie : on les reunit et on recommence.
    if (options.autoMergeGroups === false) return result;
    var bySet = {};
    var merges = Object.assign({}, options.groupMerges || {});
    var found = false;
    result.conversations.forEach(function (c) {
      if (c.kind !== "group") return;
      var set = c.members.slice().sort().join("|");
      if (bySet[set]) { merges[c.key] = bySet[set]; found = true; } else { bySet[set] = c.key; }
    });
    if (!found) return result;
    return buildOnce(messages, Object.assign({}, options, { groupMerges: merges }));
  }

  function buildOnce(messages, options) {
    var me = (options.me || []).map(normalizeEmail);
    // Noms complets de l utilisateur : une adresse qui les porte est a lui
    // (ancienne adresse, redirection). Seulement des noms d au moins deux mots.
    var meNames = (options.meNames || []).map(foldName).filter(function (n) { return n.indexOf(" ") > 0; });
    var people = makePeople(options.contacts);
    var isMe = function (addr) {
      if (!addr) return false;
      return me.indexOf(normalizeEmail(addr.email)) >= 0 || (!!addr.name && meNames.indexOf(foldName(addr.name)) >= 0);
    };
    var threads = makeThreads();

    // Un meme courriel peut etre dans plusieurs dossiers (Gmail : reception et
    // « Tous les messages ») : on n en garde qu un, le premier recu.
    var seen = {};
    var msgs = messages.slice().sort(function (a, b) { return +a.date - +b.date; }).filter(function (m) {
      if (!m.headerMessageId) return true;
      if (seen[m.headerMessageId]) return false;
      seen[m.headerMessageId] = true;
      return true;
    });

    // 1. Fils : chaque message est relie a ses parents connus ou non.
    msgs.forEach(function (m) {
      var id = m.headerMessageId || m.id;
      threads.find(id);
      (m.references || []).concat(m.inReplyTo ? [m.inReplyTo] : []).forEach(function (ref) {
        threads.union(ref, id);
      });
    });

    // 2. Participants et cle de conversation de chaque message.
    var groupsByThread = {};   // racine de fil -> cle de groupe
    var groupsBySet = {};      // ensemble trie de participants -> cle de groupe
    var convs = {};

    function conv(key, kind) {
      if (!convs[key]) convs[key] = { key: key, kind: kind, members: [], items: [], accounts: [], unread: 0, lastDate: 0, _msgs: [] };
      return convs[key];
    }

    msgs.forEach(function (m) {
      var mine = isMe(m.from);
      var all = [m.from].concat(m.to || [], m.cc || [], mine ? (m.bcc || []) : []);
      var others = [];
      all.forEach(function (a) {
        if (!a || !a.email || isMe(a)) return;
        var k = people.keyOf(a);
        if (others.indexOf(k) < 0) others.push(k);
      });
      var root = threads.find(m.headerMessageId || m.id);
      var key, kind;

      if (m.listId) {
        key = "list:" + normalizeEmail(m.listId); kind = "list";
      } else if (m.isNewsletter && !mine) {
        if (options.includeNewsletters === false) return;
        key = "news:" + people.keyOf(m.from); kind = "newsletter";
      } else if (others.length === 0) {
        key = "self"; kind = "self";
      } else if (others.length === 1) {
        key = "direct:" + others[0]; kind = "direct";
      } else {
        var setKey = others.slice().sort().join("|");
        key = groupsByThread[root] || groupsBySet[setKey];
        if (!key) key = "group:" + root;
        groupsByThread[root] = key;
        if (!groupsBySet[setKey]) groupsBySet[setKey] = key;
        kind = "group";
        // Groupes reunis a la main par l utilisateur : { cleSource: cleCible }.
        var merges = options.groupMerges || {};
        for (var hops = 0; merges[key] && hops < 10; hops++) key = merges[key];
      }
      var c = conv(key, kind);
      c._msgs.push({ m: m, mine: mine, others: others });
    });

    // 3. Elements affiches : messages, changements de membres, changements de sujet.
    var list = Object.keys(convs).map(function (key) {
      var c = convs[key];
      var current = null;       // membres du groupe (hors utilisateur)
      var prevMissing = [];     // membres laisses de cote par le message precedent
      var prevItem = null;
      var subject = null;
      c._msgs.forEach(function (entry) {
        var m = entry.m;
        var sender = entry.mine ? "me" : people.keyOf(m.from);
        var sub = normalizeSubject(m.subject);
        var missing = [];

        if (c.kind === "group") {
          if (current === null) current = entry.others.slice();
          var added = diff(entry.others, current);
          if (added.length) {
            c.items.push({ type: "members", by: sender, added: added, removed: [], date: m.date });
            current = current.concat(added);
          }
          // Un message adresse a une partie du groupe ne retire personne : il
          // porte son audience (« sans Bob »). Un membre n est retire que
          // lorsque deux messages de suite le laissent de cote.
          // Le retrait est alors attribue au message precedent, celui qui a
          // laisse le membre de cote en premier, et affiche juste avant lui.
          missing = diff(current, entry.others);
          var gone = missing.filter(function (p) { return prevMissing.indexOf(p) >= 0; });
          if (gone.length) {
            var at = c.items.indexOf(prevItem);
            c.items.splice(at, 0, { type: "members", by: prevItem.sender, added: [], removed: gone, date: prevItem.message.date });
            prevItem.missing = diff(prevItem.missing, gone);
            current = diff(current, gone);
            missing = diff(missing, gone);
          }
          prevMissing = missing;
        }

        var subjectChanged = sub && sub !== subject;
        if (subjectChanged && c.kind !== "direct") {
          c.items.push({ type: "subject", subject: sub, date: m.date });
        }
        subject = sub || subject;

        prevItem = {
          type: "message",
          message: m,
          mine: entry.mine,
          sender: sender,
          // En direct, le sujet n a pas de ligne a lui : il s affiche en tete de bulle.
          subject: subjectChanged && c.kind === "direct" ? sub : null,
          missing: missing,
          body: stripQuoted(m.text)
        };
        c.items.push(prevItem);
        if (!entry.mine && !m.read) c.unread++;
        if (c.accounts.indexOf(m.account) < 0) c.accounts.push(m.account);
        c.lastDate = Math.max(c.lastDate, +m.date);
      });

      if (c.kind === "group") {
        c.members = current;
      } else if (c.kind === "direct") {
        c.members = [key.slice("direct:".length)];
      } else if (c.kind === "newsletter") {
        c.members = [key.slice("news:".length)];
      }

      c.title = titleOf(c, people);
      delete c._msgs;
      return c;
    });

    // 4. « En reponse a » : le message parent (In-Reply-To, sinon la derniere
    //    reference). Indique seulement quand il n est pas le message juste
    //    au-dessus, ou quand il est dans une autre conversation (reponse privee
    //    a un message de groupe, par exemple). Comme WhatsApp et Google Messages.
    var where = {};
    list.forEach(function (c) {
      c.items.forEach(function (it) {
        if (it.type === "message" && it.message.headerMessageId) where[it.message.headerMessageId] = { conv: c, item: it };
      });
    });
    list.forEach(function (c) {
      var prev = null;
      c.items.forEach(function (it) {
        if (it.type !== "message") return;
        var refs = it.message.references || [];
        var parentId = it.message.inReplyTo || refs[refs.length - 1];
        var parent = parentId && where[parentId];
        if (parent && parent.item !== prev) {
          it.replyTo = {
            headerMessageId: parentId,
            sender: parent.item.sender,
            text: (parent.item.body || parent.item.message.subject || "").replace(/\s+/g, " ").slice(0, 140),
            conv: parent.conv === c ? null : parent.conv.key,
            convTitle: parent.conv === c ? null : parent.conv.title
          };
        }
        prev = it;
      });
    });

    list.sort(function (a, b) { return b.lastDate - a.lastDate; });
    return { conversations: list, people: people };
  }

  function firstName(person) {
    var n = person.name || "";
    if (/@/.test(n)) return n.split("@")[0];
    return n.split(/\s+/)[0];
  }

  function titleOf(c, people) {
    if (c.kind === "self") return "Notes à soi";
    if (c.kind === "list") {
      var first = c.items.filter(function (i) { return i.type === "message"; })[0];
      if (first && first.message.listName) return first.message.listName;
      // List-Id sans nom (Sympa) : la premiere etiquette, « ete » pour <ete.sympa-n.oca.eu>.
      return c.key.slice(5).replace(/[<>]/g, "").split(".")[0];
    }
    if (c.kind === "direct" || c.kind === "newsletter") return people.get(c.members[0]).name;
    var names = c.members.map(function (k) { return firstName(people.get(k)); });
    if (names.length <= 3) return names.join(", ");
    return names.slice(0, 2).join(", ") + " et " + (names.length - 2) + " autres";
  }

  var api = {
    normalizeEmail: normalizeEmail,
    normalizeSubject: normalizeSubject,
    stripQuoted: stripQuoted,
    buildConversations: buildConversations,
    firstName: firstName
  };

  global.MaterialConversations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
