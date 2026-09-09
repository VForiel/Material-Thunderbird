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
    "manage preferences", "manage your preferences",
    "abmelden", "darse de baja", "annulla iscrizione",
    "cancelar subscricao", "uitschrijven"
  ];

  // Indices plus faibles : ne suffisent pas seuls a declencher le bandeau.
  var SOFT_KEYWORDS = [
    "preferences", "ne plus recevoir", "stop receiving", "email settings",
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
    findInListUnsubscribeHeader: findInListUnsubscribeHeader
  };

  global.MaterialUnsubscribeRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
