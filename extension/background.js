/**
 * Material-Thunderbird - Background Service
 * Intelligent Unsubscribe Detection & Native Banner Controller
 */

(function () {
  "use strict";

  // Keywords for unsubscribe detection
  const UNSUB_KEYWORDS = /unsubscribe|d[ée]sinscri|d[ée]sabonn|opt-?out|abmelden|annulla.*iscrizione/i;

  // Major email newsletter providers & endpoint patterns
  const ESP_PATTERNS = [
    /list-manage\.com\/unsubscribe/i,
    /mailchimp\.com\/unsubscribe/i,
    /sendinblue\.com/i,
    /brevo\.com\/optout/i,
    /substack\.com\/unsubscribe/i,
    /activehosted\.com\/proc\.php\?.*act=unsub/i,
    /constantcontact\.com/i,
    /hubspotemail\.net/i,
    /exacttarget\.com/i,
    /campaign-monitor\.com/i,
    /cmail\d+\.com\/t\//i
  ];

  /**
   * Extracts unsubscribe URL from full message headers and parts
   */
  function extractUnsubscribeUrl(fullMessage) {
    if (!fullMessage) return null;

    // 1. Check List-Unsubscribe standard RFC 2369 header
    if (fullMessage.headers) {
      const unsubHeaders = fullMessage.headers["list-unsubscribe"] || fullMessage.headers["List-Unsubscribe"];
      if (Array.isArray(unsubHeaders) && unsubHeaders.length > 0) {
        for (const headerVal of unsubHeaders) {
          // Look for <http...> link first
          const httpMatch = headerVal.match(/<(https?:\/\/[^>]+)>/i);
          if (httpMatch) {
            return httpMatch[1];
          }
        }
      }
    }

    // 2. Recursively search text/html message parts for unsubscribe links
    let foundUrl = null;

    function scanParts(parts) {
      if (!parts || foundUrl) return;
      for (const part of parts) {
        if (part.body && typeof part.body === "string") {
          // Parse HTML anchors
          const linkMatches = part.body.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
          for (const match of linkMatches) {
            const href = match[1].trim();
            const text = match[2].replace(/<[^>]+>/g, "").trim();

            if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

            // Check if href or anchor text matches unsubscribe patterns
            if (UNSUB_KEYWORDS.test(href) || UNSUB_KEYWORDS.test(text)) {
              foundUrl = href;
              return;
            }

            for (const pattern of ESP_PATTERNS) {
              if (pattern.test(href)) {
                foundUrl = href;
                return;
              }
            }
          }
        }

        if (part.parts && Array.isArray(part.parts)) {
          scanParts(part.parts);
        }
      }
    }

    if (fullMessage.parts) {
      scanParts(fullMessage.parts);
    }

    return foundUrl;
  }

  // Register listener for displayed messages
  if (browser.messageDisplay && browser.messageDisplay.onMessageDisplayed) {
    browser.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
      try {
        // Reset banner from previous message
        if (browser.materialAssistant && browser.materialAssistant.hideUnsubscribeBanner) {
          await browser.materialAssistant.hideUnsubscribeBanner();
        }

        if (!message || !message.id) return;

        // Fetch full message headers and parts
        const fullMessage = await browser.messages.getFull(message.id);
        const unsubscribeUrl = extractUnsubscribeUrl(fullMessage);

        if (unsubscribeUrl && browser.materialAssistant && browser.materialAssistant.showUnsubscribeBanner) {
          const senderName = message.author || (fullMessage.headers && fullMessage.headers["from"] ? fullMessage.headers["from"][0] : "");
          await browser.materialAssistant.showUnsubscribeBanner(unsubscribeUrl, senderName);
        }
      } catch (err) {
        console.warn("[Material-Thunderbird] Error analyzing message for unsubscribe:", err);
      }
    });
  }

  // Hide banner on tab switch
  if (browser.tabs && browser.tabs.onActivated) {
    browser.tabs.onActivated.addListener(async () => {
      try {
        if (browser.materialAssistant && browser.materialAssistant.hideUnsubscribeBanner) {
          await browser.materialAssistant.hideUnsubscribeBanner();
        }
      } catch (e) {}
    });
  }

  // Register fallback messageDisplayScripts if supported
  try {
    if (browser.messageDisplayScripts) {
      browser.messageDisplayScripts.register({
        js: [{ file: "scripts/unsubscribe-detector.js" }]
      });
    }
  } catch (err) {
    // Non-fatal fallback
  }
})();
