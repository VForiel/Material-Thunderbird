/**
 * Material-Thunderbird - reglages partages par le site et l apercu.
 *
 * Les memes reglages que la fenetre de personnalisation de l extension :
 * apparence (clair, sombre, systeme), couleur d accent, icones emojis, reponses
 * lues masquees et bandeau de desinscription. La page d accueil et l apercu
 * (dans son cadre ou en plein ecran) les lisent et les ecrivent au meme endroit,
 * et se previennent l un l autre par postMessage.
 *
 * PALETTES reprend PALETTES_CONFIG de extension/experiments/material-assistant.js ;
 * tests/site-sync.test.js verifie que les deux restent identiques.
 */
(function (global) {
  "use strict";

  // light / dark : primary, primary-container, secondary-container.
  var PALETTES = {
    blue:    { name: "Bleu Google", color: "#0b57d0",
               light: ["#0b57d0", "#d3e3fd", "#c2e7ff"], dark: ["#a8c7fa", "#004a77", "#004b72"] },
    emerald: { name: "Émeraude",    color: "#006a60",
               light: ["#006a60", "#74f8e5", "#cce8e3"], dark: ["#53dbc9", "#005048", "#334b46"] },
    purple:  { name: "Améthyste",   color: "#6750a4",
               light: ["#6750a4", "#eaddff", "#e8def8"], dark: ["#d0bcff", "#4f378b", "#4a4458"] },
    coral:   { name: "Corail",      color: "#9c4125",
               light: ["#9c4125", "#ffdbd1", "#f5ddd6"], dark: ["#ffb59f", "#7d2b11", "#5c2a1a"] }
  };

  var DEFAULTS = { mode: "auto", palette: "blue", emojis: false, hideRead: true, unsub: true };
  var STORAGE_KEY = "mt-settings";

  function sanitize(value) {
    var s = Object.assign({}, DEFAULTS);
    if (!value || typeof value !== "object") return s;
    if (value.mode === "light" || value.mode === "dark" || value.mode === "auto") s.mode = value.mode;
    if (PALETTES[value.palette]) s.palette = value.palette;
    ["emojis", "hideRead", "unsub"].forEach(function (key) {
      if (typeof value[key] === "boolean") s[key] = value[key];
    });
    return s;
  }

  // Le stockage peut etre indisponible (navigation privee, cadre isole) :
  // la page reste alors utilisable avec les reglages par defaut.
  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitize(JSON.parse(raw));
      // Anciennes cles du site, avant le bouton palette.
      var legacy = {};
      var theme = global.localStorage.getItem("mt-theme");
      var palette = global.localStorage.getItem("mt-palette");
      if (theme === "light" || theme === "dark") legacy.mode = theme;
      if (palette) legacy.palette = palette;
      return sanitize(legacy);
    } catch (e) {
      return sanitize(null);
    }
  }

  function save(settings) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(settings))); } catch (e) {}
  }

  function systemIsDark() {
    try { return global.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
  }

  function resolvedMode(settings) {
    return settings.mode === "auto" ? (systemIsDark() ? "dark" : "light") : settings.mode;
  }

  /**
   * Meme regle que paletteCss() dans l experiment : memes selecteurs que
   * chrome/tokens/, pour que la couleur choisie l emporte a specificite egale.
   */
  function paletteCss(key) {
    var pal = PALETTES[key] || PALETTES.blue;
    function block(values) {
      return "--md-sys-color-primary: " + values[0] + ";" +
             "--md-sys-color-primary-container: " + values[1] + ";" +
             "--md-sys-color-secondary-container: " + values[2] + ";";
    }
    return ":root, :root[lwt-theme-brighttext=\"false\"] {" + block(pal.light) + "}" +
           "@media (prefers-color-scheme: dark) { :root:not([lwt-theme-brighttext=\"false\"]) {" + block(pal.dark) + "} }" +
           ":root[lwt-theme-brighttext=\"true\"] {" + block(pal.dark) + "}";
  }

  /**
   * Applique les reglages a un document.
   * - Les jetons de chrome/tokens/ suivent l attribut lwt-theme-brighttext,
   *   exactement comme dans Thunderbird : "true" force le sombre, "false" le
   *   clair, son absence suit le systeme.
   * - Le site, qui a ses propres couleurs, lit data-theme et data-palette.
   */
  function apply(doc, settings) {
    var root = doc.documentElement;
    if (settings.mode === "auto") root.removeAttribute("lwt-theme-brighttext");
    else root.setAttribute("lwt-theme-brighttext", settings.mode === "dark" ? "true" : "false");
    root.setAttribute("data-theme", resolvedMode(settings));
    root.setAttribute("data-palette", settings.palette);
    root.classList.toggle("mt-emojis", !!settings.emojis);
    root.style.colorScheme = resolvedMode(settings);

    var style = doc.getElementById("mt-palette-override");
    if (!style) {
      style = doc.createElement("style");
      style.id = "mt-palette-override";
      doc.head.appendChild(style);
    }
    style.textContent = paletteCss(settings.palette);
  }

  // Suit le systeme quand l apparence est "Systeme".
  function watchSystem(callback) {
    try {
      var query = global.matchMedia("(prefers-color-scheme: dark)");
      if (query.addEventListener) query.addEventListener("change", callback);
    } catch (e) {}
  }

  global.MaterialSettings = {
    PALETTES: PALETTES,
    DEFAULTS: DEFAULTS,
    sanitize: sanitize,
    load: load,
    save: save,
    apply: apply,
    resolvedMode: resolvedMode,
    watchSystem: watchSystem
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.MaterialSettings;
})(typeof window !== "undefined" ? window : globalThis);
