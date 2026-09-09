/**
 * Material-Thunderbird - Detecteur de desinscription (script de message)
 *
 * Ce script n affiche plus rien. Il analyse le message rendu et signale au script
 * d arriere-plan tout lien de desinscription trouve ; le bandeau est ensuite rendu
 * une seule fois dans la fenetre chrome.
 *
 * Les versions precedentes injectaient leur propre bandeau dans le corps du mail :
 * le contenu de expediteur pouvait le restyler, son bouton de fermeture en
 * gestionnaire inline etait bloque par la CSP du document de message, et il faisait
 * doublon avec le bandeau chrome.
 */

(function () {
  "use strict";

  if (window.__materialUnsubscribeDetectorInit) return;
  window.__materialUnsubscribeDetectorInit = true;

  var Rules = globalThis.MaterialUnsubscribeRules;
  if (!Rules) return;

  var attempts = 0;
  var MAX_ATTEMPTS = 5;
  var reported = false;

  function report(url) {
    if (reported || !url) return;
    reported = true;
    try {
      browser.runtime.sendMessage({ type: "material-unsubscribe-found", url: url });
    } catch (e) {
      // Le port peut etre ferme si le message a change entre-temps.
    }
  }

  function scan() {
    attempts++;
    var url = Rules.findInDocument(document);
    if (url) {
      report(url);
      return;
    }
    // Le corps peut arriver en plusieurs fois : on retente avec un recul croissant.
    if (attempts < MAX_ATTEMPTS) {
      window.setTimeout(scan, 200 * attempts);
    }
  }

  var schedule = window.requestIdleCallback || function (cb) { return window.setTimeout(cb, 60); };
  schedule(scan);
})();
