/**
 * Material-Thunderbird - Background Service
 * Detection de desinscription et pilotage du bandeau natif.
 *
 * Les regles de detection vivent dans shared/unsubscribe-rules.js, charge avant ce
 * script par manifest.json. Le bandeau lui-meme est rendu une seule fois, dans la
 * fenetre chrome, par experiment materialAssistant.
 *
 * Ce script est le seul a decider s il y a un lien de desinscription. L experiment
 * menait en parallele sa propre detection sur mutation de l en-tete, et son
 * chemin negatif retirait le bandeau : la passe tardive pouvait donc effacer un
 * bandeau que ce script venait de demander, apres quoi bannerTabId restait pose
 * et le repli DOM etait ignore -- plus aucun bandeau pour ce message. L experiment
 * ne fait plus qu afficher et masquer sur demande.
 */

(function () {
  "use strict";

  var Rules = globalThis.MaterialUnsubscribeRules;
  if (!Rules) {
    console.error("[Material-Thunderbird] shared/unsubscribe-rules.js non charge.");
    return;
  }

  // Onglet pour lequel un bandeau est affiche, afin de ne pas masquer le bandeau
  // d un autre onglet lors d un simple changement de selection.
  var bannerTabId = null;

  // Expediteur du dernier message affiche, par onglet. Le script de message ne voit
  // que le corps rendu : il ne peut pas nommer l expediteur, et le bandeau retombait
  // donc sur "Cet expediteur" chaque fois que le lien venait du DOM et non de
  // l en-tete. Cette table lui prete le nom deja lu ici.
  var senderByTab = new Map();

  function normalizeTabId(value) {
    return typeof value === "number" ? value : null;
  }

  function hasAssistant() {
    return typeof browser !== "undefined" &&
           browser.materialAssistant &&
           typeof browser.materialAssistant.showUnsubscribeBanner === "function";
  }

  async function hideBanner() {
    bannerTabId = null;
    if (!hasAssistant()) return;
    try {
      await browser.materialAssistant.hideUnsubscribeBanner();
    } catch (e) {
      // La fenetre chrome peut etre en cours de fermeture.
    }
  }

  async function showBanner(url, senderName, tabId) {
    if (!Rules.isSafeUrl(url)) return;
    if (!hasAssistant()) return;
    // Pose avant l attente, pas apres : le repli DOM ne s execute que si
    // bannerTabId est nul, et il pouvait donc s intercaler pendant l appel pour
    // afficher un second bandeau par-dessus celui-ci.
    bannerTabId = normalizeTabId(tabId);
    try {
      await browser.materialAssistant.showUnsubscribeBanner(url, senderName || "", bannerTabId);
    } catch (e) {
      bannerTabId = null;
      console.warn("[Material-Thunderbird] Affichage du bandeau impossible :", e);
    }
  }

  /**
   * Cherche une URL de desinscription dans un message complet.
   * 1. En-tete List-Unsubscribe (RFC 2369), la source la plus fiable.
   * 2. A defaut, les parties text/html du corps.
   */
  function extractUnsubscribeUrl(fullMessage) {
    if (!fullMessage) return null;

    if (fullMessage.headers) {
      // Thunderbird normalise les noms d en-tete en minuscules.
      var values = fullMessage.headers["list-unsubscribe"];
      if (Array.isArray(values)) {
        for (var i = 0; i < values.length; i++) {
          var fromHeader = Rules.findInListUnsubscribeHeader(values[i]);
          if (fromHeader) return fromHeader;
        }
      }
    }

    var found = null;

    // Le parcours s arrete des qu une correspondance est trouvee. Sans ce garde-fou
    // dans la boucle, une partie soeur traitee ensuite ecrasait le resultat.
    function scanParts(parts) {
      if (!parts || found) return;
      for (var i = 0; i < parts.length && !found; i++) {
        var part = parts[i];
        var type = (part.contentType || "").toLowerCase();
        if (typeof part.body === "string" && part.body && type.indexOf("text/") === 0) {
          var url = Rules.findInHtml(part.body);
          if (url) { found = url; return; }
        }
        if (Array.isArray(part.parts)) scanParts(part.parts);
      }
    }

    if (Array.isArray(fullMessage.parts)) scanParts(fullMessage.parts);
    return found;
  }

  function senderFromMessage(message, fullMessage) {
    if (message && message.author) return message.author;
    if (fullMessage && fullMessage.headers && Array.isArray(fullMessage.headers["from"])) {
      return fullMessage.headers["from"][0] || "";
    }
    return "";
  }

  if (browser.messageDisplay && browser.messageDisplay.onMessageDisplayed) {
    browser.messageDisplay.onMessageDisplayed.addListener(async function (tab, message) {
      try {
        await hideBanner();
        if (!message || !message.id) return;

        var tabId = normalizeTabId(tab && tab.id);
        var fullMessage = await browser.messages.getFull(message.id);
        var senderName = senderFromMessage(message, fullMessage);
        if (tabId !== null) senderByTab.set(tabId, senderName);

        var url = extractUnsubscribeUrl(fullMessage);
        if (url) {
          await showBanner(url, senderName, tabId);
        }
      } catch (err) {
        console.warn("[Material-Thunderbird] Analyse du message impossible :", err);
      }
    });
  }

  /**
   * Repli : le script de message signale un lien trouve dans le DOM rendu, que
   * getFull ne voit pas toujours (corps charge a distance, parties encodees).
   * Le bandeau reste rendu dans la fenetre chrome, jamais dans le corps du mail.
   */
  if (browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(function (msg, sender) {
      if (!msg || msg.type !== "material-unsubscribe-found") return;
      if (bannerTabId !== null) return; // l en-tete a deja fourni un lien
      var tabId = normalizeTabId(sender && sender.tab && sender.tab.id);
      showBanner(msg.url, tabId !== null ? senderByTab.get(tabId) : "", tabId);
    });
  }

  // Un changement d onglet doit masquer le bandeau du message precedent.
  if (browser.tabs && browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(function (info) {
      if (bannerTabId !== null && info && info.tabId === bannerTabId) return;
      hideBanner();
    });
  }

  // Sans cela senderByTab grossit pour toute la duree de la session.
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(function (tabId) {
      senderByTab.delete(tabId);
      if (bannerTabId === tabId) bannerTabId = null;
    });
  }

  // Le script de message est enregistre une seule fois par demarrage.
  if (browser.messageDisplayScripts) {
    browser.messageDisplayScripts
      .register({
        js: [
          { file: "shared/unsubscribe-rules.js" },
          { file: "scripts/unsubscribe-detector.js" }
        ]
      })
      .catch(function (err) {
        console.warn("[Material-Thunderbird] Enregistrement du script de message impossible :", err);
      });
  }
})();
