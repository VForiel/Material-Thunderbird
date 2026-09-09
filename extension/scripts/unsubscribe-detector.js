/**
 * Material-Thunderbird - Material Design 3 (Material You)
 * Script: Non-blocking Unsubscribe Link Detector
 * Detects unsubscribe links (mots-clés, regex, ESP réputés) and renders
 * an elevated Material You action banner above the email content.
 */

(function () {
  "use strict";

  // Prevent double execution in the same message document
  if (window.__materialUnsubscribeDetectorInit) return;
  window.__materialUnsubscribeDetectorInit = true;

  // Progressive non-blocking scans (retries handle streaming and delayed email DOMs)
  let attempts = 0;
  const maxAttempts = 6;

  function tryScan() {
    attempts++;
    const found = scanAndRenderUnsubscribe();
    if (!found && attempts < maxAttempts) {
      setTimeout(tryScan, 200 * attempts);
    }
  }

  const scheduleScan = window.requestIdleCallback || ((cb) => setTimeout(cb, 60));
  scheduleScan(tryScan);

  function scanAndRenderUnsubscribe() {
    if (document.getElementById("material-unsubscribe-banner")) return true;

    const links = Array.from(document.querySelectorAll("a[href]"));
    if (!links.length) return false;

    let bestMatch = null;
    let highestScore = 0;

    // Detection keywords (multilingual: FR, EN, DE, ES, IT)
    // Detection keywords (multilingual: FR, EN, DE, ES, IT)
    const exactKeywords = [
      "désinscrire", "désinscription", "se désinscrire", "désabonner", "désabonnement", "se désabonner",
      "unsubscribe", "opt out", "opt-out", "leave this list", "manage preferences",
      "abmelden", "darse de baja", "annulla iscrizione", "signoff", "auto_signoff"
    ];

    const softKeywords = [
      "préférences", "preferences", "ne plus recevoir", "stop receiving", "email settings",
      "liste de diffusion", "diffusion", "sympa"
    ];

    // Known email newsletter providers & unsubscribe endpoints
    const espPatterns = [
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
      /cmail\d+\.com\/t\//i,
      /auto_signoff/i,
      /signoff/i,
      /sympa/i
    ];

    for (const link of links) {
      const text = (link.textContent || "").trim().toLowerCase();
      const href = link.href || "";
      const title = (link.getAttribute("title") || "").toLowerCase();
      const aria = (link.getAttribute("aria-label") || "").toLowerCase();
      const combinedText = `${text} ${title} ${aria}`;

      if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

      let score = 0;

      // Check text content
      for (const kw of exactKeywords) {
        if (text === kw) score += 100;
        else if (combinedText.includes(kw)) score += 60;
      }

      for (const sk of softKeywords) {
        if (combinedText.includes(sk)) score += 25;
      }

      // Check URL parameters / path
      if (/unsubscribe|desinscri|desabonn|optout|opt-out/i.test(href)) {
        score += 50;
      }

      // Check ESP signatures
      for (const pattern of espPatterns) {
        if (pattern.test(href)) {
          score += 40;
          break;
        }
      }

      if (score > highestScore && score >= 50) {
        highestScore = score;
        bestMatch = { link, href, text: link.textContent.trim() };
      }
    }

    if (bestMatch && bestMatch.href) {
      renderBanner(bestMatch.href);
      return true;
    }
    return false;
  }

  function renderBanner(unsubscribeUrl) {
    const banner = document.createElement("div");
    banner.id = "material-unsubscribe-banner";
    banner.className = "material-unsubscribe-card";

    banner.innerHTML = `
      <style>
        .material-unsubscribe-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background-color: #f0f4f9;
          color: #1f1f1f;
          border-radius: 12px;
          padding: 10px 16px;
          margin: 10px 14px 14px 14px;
          font-family: -apple-system, "Google Sans", "Roboto", "Segoe UI", sans-serif;
          font-size: 13px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
          gap: 12px;
          box-sizing: border-box;
          animation: materialBannerSlide 200ms cubic-bezier(0.2, 0, 0, 1) forwards;
        }
        @media (prefers-color-scheme: dark) {
          .material-unsubscribe-card {
            background-color: #1d2023;
            color: #e2e2e5;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          }
        }
        @keyframes materialBannerSlide {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .material-unsub-left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .material-unsub-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background-color: #d3e3fd;
          color: #041e49;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        @media (prefers-color-scheme: dark) {
          .material-unsub-icon {
            background-color: #004a77;
            color: #c2e7ff;
          }
        }
        .material-unsub-details {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .material-unsub-title {
          font-weight: 700;
          font-size: 13px;
          line-height: 1.2;
        }
        .material-unsub-desc {
          color: #444746;
          font-size: 11.5px;
        }
        @media (prefers-color-scheme: dark) {
          .material-unsub-desc {
            color: #c4c7c5;
          }
        }
        .material-unsub-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .material-unsub-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background-color: #0B57D0;
          color: #ffffff !important;
          border-radius: 9999px;
          padding: 6px 14px;
          font-weight: 600;
          font-size: 12px;
          text-decoration: none !important;
          cursor: pointer;
          transition: background-color 150ms ease, transform 150ms ease;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        .material-unsub-btn:hover {
          background-color: #0842a0;
          transform: translateY(-1px);
        }
        @media (prefers-color-scheme: dark) {
          .material-unsub-btn {
            background-color: #a8c7fa;
            color: #00315b !important;
          }
          .material-unsub-btn:hover {
            background-color: #c2e7ff;
          }
        }
        .material-unsub-close {
          background: transparent;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #444746;
          cursor: pointer;
          font-size: 14px;
          transition: background-color 150ms ease;
        }
        .material-unsub-close:hover {
          background-color: rgba(0, 0, 0, 0.08);
        }
        @media (prefers-color-scheme: dark) {
          .material-unsub-close {
            color: #c4c7c5;
          }
          .material-unsub-close:hover {
            background-color: rgba(255, 255, 255, 0.12);
          }
        }
      </style>
      <div class="material-unsub-left">
        <div class="material-unsub-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </div>
        <div class="material-unsub-details">
          <span class="material-unsub-title">Courrier commercial / Infolettre</span>
          <span class="material-unsub-desc">Un lien de désinscription a été détecté pour cet expéditeur.</span>
        </div>
      </div>
      <div class="material-unsub-actions">
        <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" rel="noopener noreferrer" class="material-unsub-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
          </svg>
          Se désinscrire
        </a>
        <button type="button" class="material-unsub-close" title="Ignorer cette suggestion" onclick="this.closest('#material-unsubscribe-banner').remove();">✕</button>
      </div>
    `;

    // Insert at the top of the body or before the first element
    if (document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
