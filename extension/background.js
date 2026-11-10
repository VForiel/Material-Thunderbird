/**
 * Material-Thunderbird - Background Service
 * Classement des messages et pilotage du bandeau de desinscription.
 *
 * Les regles vivent dans shared/unsubscribe-rules.js, charge avant ce script par
 * manifest.json. Le bandeau lui-meme est rendu une seule fois, dans la fenetre
 * chrome, par l experiment materialAssistant, qui garde aussi les choix de
 * l utilisateur (bandeau desactive, message ou expediteur ignore).
 *
 * Ce script est le seul a decider s il faut un bandeau, et lequel :
 * - "newsletter" : infolettre ou courriel commercial ;
 * - "list"       : liste de diffusion, bandeau discret ;
 * - rien         : courriel personnel ou transactionnel (codes, mots de passe,
 *                  commandes), meme si la plateforme d envoi a ajoute
 *                  List-Unsubscribe.
 * Le lien trouve dans le corps par le script de message ne sert qu a completer
 * un message deja reconnu comme infolettre, jamais a en reconnaitre un.
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

  // Dernier message affiche par onglet, avec son classement. Le script de
  // message ne voit que le corps rendu : il ne peut ni nommer l expediteur ni
  // savoir si le message est une infolettre. Cette table lui prete ce qui a
  // deja ete lu ici.
  var pendingByTab = new Map();

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

  async function showBanner(entry, tabId) {
    var c = entry.classification;
    if (!c || (!Rules.isSafeUrl(c.url) && !c.mailto)) return;
    if (!hasAssistant()) return;
    // Pose avant l attente, pas apres : le repli DOM ne s execute que si
    // bannerTabId est nul, et il pouvait donc s intercaler pendant l appel pour
    // afficher un second bandeau par-dessus celui-ci.
    bannerTabId = normalizeTabId(tabId);
    try {
      await browser.materialAssistant.showUnsubscribeBanner({
        kind: c.kind,
        url: c.url || "",
        mailto: c.mailto || "",
        oneClick: !!c.oneClick,
        listName: c.listName || "",
        senderName: entry.senderName || "",
        key: c.key || "",
        messageId: entry.messageId || "",
        tabId: bannerTabId === null ? -1 : bannerTabId
      });
    } catch (e) {
      bannerTabId = null;
      console.warn("[Material-Thunderbird] Affichage du bandeau impossible :", e);
    }
  }

  // Retire balises, styles et entites d un corps HTML pour en lire le debut.
  function htmlToText(html) {
    return Rules.decodeEntities(String(html)
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Parcourt les parties d un message complet et retourne le debut du texte
   * (text/plain de preference) et le meilleur lien de desinscription du HTML.
   */
  function readBody(fullMessage) {
    var plain = "";
    var html = "";
    var bodyUrl = null;

    function scanParts(parts) {
      if (!parts) return;
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        var type = (part.contentType || "").toLowerCase();
        if (typeof part.body === "string" && part.body) {
          if (type === "text/plain" && !plain) plain = part.body;
          if (type === "text/html") {
            if (!html) html = part.body;
            // Le parcours garde le premier lien trouve : une partie soeur
            // traitee ensuite l ecrasait.
            if (!bodyUrl) bodyUrl = Rules.findInHtml(part.body);
          }
        }
        if (Array.isArray(part.parts)) scanParts(part.parts);
      }
    }

    if (fullMessage && Array.isArray(fullMessage.parts)) scanParts(fullMessage.parts);
    var text = plain ? plain.replace(/\s+/g, " ").trim() : (html ? htmlToText(html) : "");
    return { text: text.slice(0, 2000), bodyUrl: bodyUrl };
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
      var tabId = normalizeTabId(tab && tab.id);
      try {
        await hideBanner();
        if (tabId !== null) pendingByTab.delete(tabId);
        if (!message || !message.id) return;

        var fullMessage = await browser.messages.getFull(message.id);
        var headers = (fullMessage && fullMessage.headers) || {};
        var body = readBody(fullMessage);
        var classification = Rules.classifyMessage({
          headers: headers,
          subject: message.subject || (headers.subject && headers.subject[0]) || "",
          text: body.text,
          bodyUrl: body.bodyUrl
        });

        var entry = {
          classification: classification,
          senderName: senderFromMessage(message, fullMessage),
          messageId: message.headerMessageId || ""
        };
        if (tabId !== null) pendingByTab.set(tabId, entry);

        if (classification && (classification.url || classification.mailto)) {
          await showBanner(entry, tabId);
        }
      } catch (err) {
        console.warn("[Material-Thunderbird] Analyse du message impossible :", err);
      }
    });
  }

  /**
   * Repli : le script de message signale un lien trouve dans le DOM rendu, que
   * getFull ne voit pas toujours (corps charge a distance, parties encodees).
   * Il ne sert qu a un message deja classe comme infolettre sans lien connu.
   */
  if (browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(function (msg, sender) {
      if (!msg || msg.type !== "material-unsubscribe-found") return;
      if (bannerTabId !== null) return; // l en-tete a deja fourni un lien
      var tabId = normalizeTabId(sender && sender.tab && sender.tab.id);
      var entry = tabId !== null ? pendingByTab.get(tabId) : null;
      var c = entry && entry.classification;
      if (!c || c.url || c.mailto || !Rules.isSafeUrl(msg.url)) return;
      c.url = msg.url;
      showBanner(entry, tabId);
    });
  }

  // Un changement d onglet doit masquer le bandeau du message precedent.
  if (browser.tabs && browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(function (info) {
      if (bannerTabId !== null && info && info.tabId === bannerTabId) return;
      hideBanner();
    });
  }

  // Sans cela pendingByTab grossit pour toute la duree de la session.
  if (browser.tabs && browser.tabs.onRemoved) {
    browser.tabs.onRemoved.addListener(function (tabId) {
      pendingByTab.delete(tabId);
      if (bannerTabId === tabId) bannerTabId = null;
    });
  }

  // Le script de message est enregistre une seule fois par demarrage.
  // Thunderbird 128+ fournit scripting.messageDisplay ; messageDisplayScripts
  // n existe plus dans les versions recentes (159 refuse meme la permission),
  // il ne sert plus que de repli pour les versions 115 a 127.
  // Le meme enregistrement applique message-content.css (tire par build.ps1 de
  // chrome/userContent.css) au corps des courriels.
  var detectorFiles = ["shared/unsubscribe-rules.js", "scripts/unsubscribe-detector.js"];
  var messageCss = ["message-content.css"];
  var registration = null;
  if (browser.scripting && browser.scripting.messageDisplay) {
    registration = browser.scripting.messageDisplay.registerScripts([
      { id: "material-unsubscribe-detector", js: detectorFiles, css: messageCss }
    ]);
  } else if (browser.messageDisplayScripts) {
    registration = browser.messageDisplayScripts.register({
      js: detectorFiles.map(function (file) { return { file: file }; }),
      css: messageCss.map(function (file) { return { file: file }; })
    });
  }
  if (registration) {
    registration.catch(function (err) {
      console.warn("[Material-Thunderbird] Enregistrement du script de message impossible :", err);
    });
  }
})();
