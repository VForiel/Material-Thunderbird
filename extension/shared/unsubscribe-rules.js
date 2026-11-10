/**
 * Material-Thunderbird - Regles de detection de desinscription
 *
 * Source unique pour les trois contextes qui detectent un lien de desinscription :
 *   - extension/background.js               (en-tetes RFC 2369 + parties du message)
 *   - extension/scripts/unsubscribe-detector.js (DOM du message affiche)
 *   - extension/experiments/material-assistant.js (fenetre chrome)
 *
 * Ces trois copies avaient diverge : listes de mots-cles differentes, motifs FAI
 * differents, et validation absente cote chrome. Toute evolution se fait ici.
 */

(function (global) {
  "use strict";

  // Mots-cles a forte valeur : une correspondance exacte du libelle est decisive.
  var EXACT_KEYWORDS = [
    "desinscrire", "se desinscrire", "desinscription",
    "desabonner", "se desabonner", "desabonnement",
    "unsubscribe", "opt out", "opt-out", "leave this list",
    "abmelden", "darse de baja", "annulla iscrizione",
    "cancelar subscricao", "uitschrijven"
  ];

  // Indices plus faibles : ne suffisent pas seuls a declencher le bandeau.
  // "manage preferences" etait un mot-cle fort : les pieds de page des
  // courriels de compte (codes, alertes) le contiennent aussi.
  var SOFT_KEYWORDS = [
    "manage preferences", "manage your preferences", "preferences", "ne plus recevoir", "stop receiving", "email settings",
    "notification settings", "parametres de notification",
    "liste de diffusion", "gerer mon abonnement", "gerer vos abonnements"
  ];

  /**
   * Motifs de plateformes emailing.
   *
   * Chaque motif est ancre sur un chemin de desinscription. Les versions
   * precedentes contenaient /signoff/i et /sympa/i nus, qui declenchaient sur
   * n importe quelle URL contenant ces sous-chaines (par exemple
   * https://example.com/diffusion/article ou un hote nomme sympathique.com).
   */
  var ESP_PATTERNS = [
    /\/\/[^/]*list-manage\.com\/unsubscribe/i,
    /\/\/[^/]*mailchimp\.com\/unsubscribe/i,
    /\/\/[^/]*sendinblue\.com\/[^?]*(?:unsubscribe|optout)/i,
    /\/\/[^/]*brevo\.com\/[^?]*optout/i,
    /\/\/[^/]*substack\.com\/action\/disable_email/i,
    /\/\/[^/]*substack\.com\/[^?]*unsubscribe/i,
    /\/\/[^/]*activehosted\.com\/proc\.php\?[^#]*act=unsub/i,
    /\/\/[^/]*constantcontact\.com\/[^?]*(?:unsubscribe|optout)/i,
    /\/\/[^/]*hubspotemail\.net\/[^?]*unsubscribe/i,
    /\/\/[^/]*exacttarget\.com\/[^?]*unsub/i,
    /\/\/[^/]*campaign-monitor\.com\/[^?]*unsubscribe/i,
    /\/\/[^/]*cmail\d+\.com\/t\//i,
    /\/\/[^/]*researchgate\.net\/(?:account\/settings|[^?]*unsubscribe)/i,
    // Sympa et LISTSERV : /sympa/signoff/<liste>, ?SUBED1=...&A=SIGNOFF
    /\/sympa\/(?:sigrequest|signoff|auto_signoff)\//i,
    /[?&]A=SIGNOFF(?:&|$)/i,
    /\/(?:auto_)?signoff\//i
  ];

  // Indices dans l URL elle-meme.
  var HREF_HINTS = /(?:^|[/?&#._-])(?:unsubscribe|desinscription|desinscrire|desabonnement|desabonner|optout|opt-out|unsub)(?:[/?&#._-]|$)/i;

  var SCORE_THRESHOLD = 50;

  // Seuls http(s) sont ouvrables. Bloque javascript:, data:, file:, chrome: etc.
  function isSafeUrl(url) {
    if (typeof url !== "string") return false;
    var trimmed = url.trim();
    if (!trimmed) return false;
    // Rejette les caracteres de controle utilises pour masquer un schema.
    if (/[\x00-\x20\x7f]/.test(trimmed)) return false;
    return /^https?:\/\/[^/?#\s]+/i.test(trimmed);
  }

  // Retire accents et casse pour comparer des libelles multilingues.
  function normalize(text) {
    if (!text) return "";
    var s = String(text);
    if (typeof s.normalize === "function") {
      s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Les href extraits d un corps HTML brut contiennent des entites encodees.
  function decodeEntities(value) {
    if (!value) return "";
    return String(value)
      .replace(/&(?:amp|#38|#x26);/gi, "&")
      .replace(/&(?:lt|#60|#x3c);/gi, "<")
      .replace(/&(?:gt|#62|#x3e);/gi, ">")
      .replace(/&(?:quot|#34|#x22);/gi, "\"")
      .replace(/&(?:apos|#39|#x27);/gi, "'")
      .replace(/&(?:nbsp|#160|#xa0);/gi, " ");
  }

  /**
   * Note un lien candidat. Retourne 0 si le lien est inexploitable.
   * Les mots-cles ne sont comptes qu une fois pour eviter qu un meme libelle
   * cumule des points via plusieurs variantes qui se recouvrent.
   */
  function scoreLink(link) {
    var href = (link && link.href) || "";
    if (!isSafeUrl(href)) return 0;

    var text = normalize(link.text);
    var combined = normalize([link.text, link.title, link.aria].filter(Boolean).join(" "));
    var score = 0;
    var i;

    for (i = 0; i < EXACT_KEYWORDS.length; i++) {
      if (text === EXACT_KEYWORDS[i]) { score += 100; break; }
    }
    if (score === 0) {
      for (i = 0; i < EXACT_KEYWORDS.length; i++) {
        if (combined.indexOf(EXACT_KEYWORDS[i]) !== -1) { score += 60; break; }
      }
    }
    for (i = 0; i < SOFT_KEYWORDS.length; i++) {
      if (combined.indexOf(SOFT_KEYWORDS[i]) !== -1) { score += 25; break; }
    }
    if (HREF_HINTS.test(href)) score += 50;
    // Les motifs FAI sont ancres sur un chemin de desinscription explicite : une
    // correspondance suffit a elle seule, meme si le libelle du lien est generique
    // (souvent une image ou un simple "ici" dans les infolettres).
    for (i = 0; i < ESP_PATTERNS.length; i++) {
      if (ESP_PATTERNS[i].test(href)) { score += 60; break; }
    }
    return score;
  }

  /**
   * Choisit le meilleur lien parmi une liste de {href, text, title, aria}.
   * Retourne l URL ou null.
   */
  function findBestLink(candidates) {
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var score = scoreLink(candidates[i]);
      if (score > bestScore && score >= SCORE_THRESHOLD) {
        bestScore = score;
        best = candidates[i];
      }
    }
    return best ? best.href.trim() : null;
  }

  // Extrait les candidats d un document DOM rendu.
  function findInDocument(doc) {
    if (!doc || typeof doc.querySelectorAll !== "function") return null;
    var anchors = doc.querySelectorAll("a[href]");
    var candidates = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      candidates.push({
        href: a.href || "",
        text: a.textContent || "",
        title: a.getAttribute("title") || "",
        aria: a.getAttribute("aria-label") || ""
      });
    }
    return findBestLink(candidates);
  }

  // Extrait les candidats d un corps HTML brut (background, sans DOM).
  function findInHtml(html) {
    if (!html || typeof html !== "string") return null;
    var candidates = [];
    var re = /<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
    var hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;
    var match;
    while ((match = re.exec(html)) !== null) {
      var attrs = match[1];
      var hrefMatch = hrefRe.exec(attrs);
      if (!hrefMatch) continue;
      var href = decodeEntities(hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || "").trim();
      var titleMatch = /title\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      candidates.push({
        href: href,
        text: decodeEntities(match[2].replace(/<[^>]+>/g, " ")),
        title: titleMatch ? decodeEntities(titleMatch[1] || titleMatch[2]) : "",
        aria: ""
      });
    }
    return findBestLink(candidates);
  }

  /**
   * Extrait une URL http(s) d une valeur d en-tete List-Unsubscribe (RFC 2369).
   * L en-tete peut contenir plusieurs entrees, dont un mailto: qu on ignore.
   */
  function findInListUnsubscribeHeader(headerValue) {
    if (!headerValue) return null;
    var re = /<\s*(https?:\/\/[^>\s]+)\s*>/gi;
    var match;
    while ((match = re.exec(String(headerValue))) !== null) {
      var url = match[1].trim();
      if (isSafeUrl(url)) return url;
    }
    return null;
  }

  /**
   * Extrait l adresse mailto: d une valeur d en-tete List-Unsubscribe.
   * Sert de repli quand l en-tete ne propose aucune URL web (listes Sympa,
   * Mailman, LISTSERV) : le bandeau prepare alors un courriel, jamais envoye
   * sans que l utilisateur clique lui-meme sur Envoyer.
   */
  function findMailtoInListUnsubscribeHeader(headerValue) {
    if (!headerValue) return null;
    var match = /<\s*(mailto:[^>\s]+)\s*>/i.exec(String(headerValue));
    if (!match) return null;
    var value = match[1].trim();
    // Une adresse, eventuellement suivie de parametres (?subject=...).
    return /^mailto:[^@\s?]+@[^@\s?]+(?:\?.*)?$/i.test(value) ? value : null;
  }

  // ---------------------------------------------------------------------------
  // Classement du message
  //
  // La presence d un lien de desinscription ne suffit pas a reconnaitre une
  // infolettre. Les plateformes d envoi (Brevo, SendGrid...) ajoutent
  // List-Unsubscribe et meme List-Unsubscribe-Post a des courriels
  // transactionnels : un code de connexion Doctolib en porte un. Les listes de
  // diffusion en portent aussi, mais ce ne sont pas des infolettres. Le
  // bandeau distingue donc trois cas : infolettre, liste de diffusion, rien.
  // ---------------------------------------------------------------------------

  // Sujets et debuts de corps qui signalent un courriel transactionnel ou de
  // securite : codes, mots de passe, confirmations de compte, commandes.
  var TRANSACTIONAL_PATTERNS = [
    /\bcode\b.{0,40}\b(?:verification|securite|connexion|confirmation|validation|acces|activation|unique)\b/,
    /\b(?:verification|securite|connexion|confirmation|validation|acces|activation|login|security|sign[ -]?in|one[ -]?time)\b.{0,25}\bcode\b/,
    /\bverification code\b|\bsecurity code\b|\blogin code\b|\bpasscode\b|\bone[ -]time password\b|\botp\b|\b2fa\b|\btwo[ -]factor\b|\bdouble authentification\b|\bauthentification a deux facteurs\b/,
    /\bmot de passe\b|\bpassword\b|\breinitialis\w*\b|\breset your\b/,
    /\bconfirm(?:ez)? (?:votre|your) (?:adresse|e-?mail|inscription|compte|account|email address)\b/,
    /\bactiv(?:ez|ate) (?:votre|your) (?:compte|account)\b/,
    /\bnouvelle connexion\b|\bnew (?:sign[ -]?in|login)\b|\balerte de securite\b|\bsecurity alert\b/,
    /\bvotre commande\b|\byour order\b|\bconfirmation de commande\b|\border confirmation\b|\bfacture\b|\binvoice\b|\breceipt\b|\brecu de paiement\b|\bexpedition de votre\b|\byour (?:package|parcel) (?:has|is)\b/
  ];

  // Un code a usage unique : 4 a 8 chiffres, isoles, pres du mot code.
  var OTP_IN_TEXT = /\bcode\b[^0-9]{0,80}\b\d{4,8}\b|\b\d{4,8}\b[^0-9]{0,40}\bcode\b/;

  function isTransactional(subject, text) {
    var s = normalize(subject);
    var i;
    for (i = 0; i < TRANSACTIONAL_PATTERNS.length; i++) {
      if (TRANSACTIONAL_PATTERNS[i].test(s)) return true;
    }
    // Le debut du corps seulement : une infolettre peut parler de mots de passe
    // dans un article, un courriel de code le dit des les premieres lignes.
    var t = normalize(String(text || "").slice(0, 700));
    if (OTP_IN_TEXT.test(t)) return true;
    for (i = 0; i < 3; i++) {
      if (TRANSACTIONAL_PATTERNS[i].test(t)) return true;
    }
    return false;
  }

  // Lit un en-tete dans un objet { nom-en-minuscules: [valeurs] } ou { nom: valeur }.
  function headerValue(headers, name) {
    if (!headers) return "";
    var value = headers[name];
    if (Array.isArray(value)) return value.length ? String(value[0]) : "";
    return value ? String(value) : "";
  }

  /**
   * Nom lisible d une liste a partir de List-Id (RFC 2919) :
   *   "Seminaires du labo <seminaires.labo.example.org>" -> "Seminaires du labo"
   *   "<ashra-france.groupes.renater.fr>"               -> "ashra-france"
   */
  function listNameFrom(listId) {
    if (!listId) return "";
    var text = String(listId);
    var phrase = text.replace(/<[^>]*>/g, "").replace(/^["'\s]+|["'\s]+$/g, "");
    if (phrase) return phrase;
    var id = /<([^>]+)>/.exec(text);
    return id ? id[1].split(".")[0] : "";
  }

  // Cle stable d un message pour les choix de l utilisateur.
  function listKeyFrom(listId) {
    var id = /<([^>]+)>/.exec(String(listId || ""));
    return id ? id[1].trim().toLowerCase() : "";
  }

  // Logiciels de listes de discussion reconnaissables dans leurs en-tetes.
  var LIST_SOFTWARE = /\bsympa\b|mailman|listserv|groups\.google|googlegroups|groups\.io|\/wws\b|\/lists?\//i;

  // Adresse electronique nue d un en-tete From.
  function emailFrom(from) {
    var text = String(from || "");
    var angle = /<([^>]+)>/.exec(text);
    var raw = (angle ? angle[1] : text).trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+$/.test(raw) ? raw : "";
  }

  /**
   * Classe un message pour le bandeau.
   *
   * details : {
   *   headers : en-tetes en minuscules (format de messages.getFull),
   *   subject : sujet,
   *   text    : debut du corps en texte brut,
   *   bodyUrl : lien trouve dans le corps HTML (findInHtml), facultatif
   * }
   *
   * Retourne null, ou { kind: "newsletter" | "list", url, mailto, oneClick,
   * listName, key } ; key identifie l expediteur ou la liste pour
   * "Ne plus proposer".
   */
  function classifyMessage(details) {
    details = details || {};
    var h = details.headers || {};
    var listUnsub = headerValue(h, "list-unsubscribe");
    var listUnsubPost = headerValue(h, "list-unsubscribe-post");
    var listId = headerValue(h, "list-id");
    var listPost = headerValue(h, "list-post");
    var precedence = normalize(headerValue(h, "precedence"));
    var listHelp = headerValue(h, "list-help");

    var url = findInListUnsubscribeHeader(listUnsub);
    var mailto = findMailtoInListUnsubscribeHeader(listUnsub);
    var oneClick = !!url && /list-unsubscribe\s*=\s*one-click/i.test(listUnsubPost);

    // 1. Liste de discussion : un List-Id et une adresse de publication, ou un
    //    logiciel de listes reconnaissable. Les infolettres portent parfois un
    //    List-Id (Mailchimp), jamais de List-Post.
    var isDiscussionList = !!listId && (
      (listPost && !/^\s*no\b/i.test(listPost)) ||
      precedence === "list" ||
      LIST_SOFTWARE.test(listUnsub + " " + listHelp)
    );
    if (isDiscussionList) {
      if (!url && !mailto) return null;
      return {
        kind: "list",
        url: url,
        mailto: url ? null : mailto,
        oneClick: oneClick,
        listName: listNameFrom(listId),
        key: "list:" + listKeyFrom(listId)
      };
    }

    // 2. Courriel transactionnel ou de securite : jamais de bandeau, meme si la
    //    plateforme d envoi a ajoute List-Unsubscribe.
    if (isTransactional(details.subject, details.text)) return null;

    // 3. Infolettre : il faut un signal d envoi en masse dans les en-tetes. Le
    //    corps sert a trouver le lien, plus a decider seul.
    var bulk = !!listUnsub || !!listUnsubPost || precedence === "bulk" ||
               !!headerValue(h, "feedback-id") || !!headerValue(h, "x-campaign") ||
               !!headerValue(h, "x-campaign-id") || !!headerValue(h, "x-mailgun-tag") ||
               !!headerValue(h, "x-mc-user") || !!headerValue(h, "x-sg-eid");
    if (!bulk) return null;

    if (!url && details.bodyUrl && isSafeUrl(details.bodyUrl)) url = details.bodyUrl;
    if (!url && !mailto) {
      // Le lien viendra peut-etre du DOM rendu : le message est bien une
      // infolettre, seul le lien manque encore.
      return { kind: "newsletter", url: null, mailto: null, oneClick: false, listName: "",
               key: "from:" + emailFrom(headerValue(h, "from")) };
    }
    return {
      kind: "newsletter",
      url: url,
      mailto: url ? null : mailto,
      oneClick: oneClick,
      listName: "",
      key: "from:" + emailFrom(headerValue(h, "from"))
    };
  }

  var api = {
    EXACT_KEYWORDS: EXACT_KEYWORDS,
    SOFT_KEYWORDS: SOFT_KEYWORDS,
    ESP_PATTERNS: ESP_PATTERNS,
    SCORE_THRESHOLD: SCORE_THRESHOLD,
    isSafeUrl: isSafeUrl,
    normalize: normalize,
    decodeEntities: decodeEntities,
    scoreLink: scoreLink,
    findBestLink: findBestLink,
    findInDocument: findInDocument,
    findInHtml: findInHtml,
    findInListUnsubscribeHeader: findInListUnsubscribeHeader,
    findMailtoInListUnsubscribeHeader: findMailtoInListUnsubscribeHeader,
    isTransactional: isTransactional,
    listNameFrom: listNameFrom,
    emailFrom: emailFrom,
    classifyMessage: classifyMessage
  };

  global.MaterialUnsubscribeRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
