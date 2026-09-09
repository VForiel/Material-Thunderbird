/**
 * Deux garde-fous sur les feuilles de style du theme.
 *
 * 1. colors-dark.css declare la palette sombre deux fois -- une fois pour le mode
 *    sombre du systeme, une fois pour le cas ou Thunderbird impose lui-meme un
 *    theme sombre. Les deux blocs avaient diverge dans les deux sens, laissant a
 *    chaque mode des valeurs claires pour ce qui manquait chez lui.
 *
 * 2. Les initiales accentuees de avatars.css avaient ete abimees par un aller-
 *    retour UTF-8 / Windows-1252 : 84 sequences ou un caractere valait U+00C3
 *    suivi d un caractere Windows-1252, et donc autant de selecteurs qui ne
 *    pouvaient plus matcher. Le motif est reconnaissable, on le refuse.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHROME = path.join(ROOT, "chrome");

let pass = 0;
let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
  } else {
    failures++;
    console.log("  FAIL " + name + (detail ? "\n       " + detail : ""));
  }
}

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function cssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(p));
    else if (entry.name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Corps d une regle, repere par son selecteur suivi de son accolade ouvrante. */
function blockBody(text, selectorWithBrace) {
  const start = text.indexOf(selectorWithBrace);
  if (start === -1) return null;
  const open = start + selectorWithBrace.length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

function declarations(body) {
  const map = new Map();
  for (const m of body.matchAll(/^\s*(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

console.log("--- colors-dark.css: both dark blocks declare the same palette ---");

const dark = read(path.join(CHROME, "tokens", "colors-dark.css"));
const mediaBody = blockBody(dark, '\n  :root:not([lwt-theme-brighttext="false"]) {');
const brightBody = blockBody(dark, '\n:root[lwt-theme-brighttext="true"] {');

check("the @media dark block is present", mediaBody !== null);
check("the lwt-theme-brighttext block is present", brightBody !== null);

if (mediaBody && brightBody) {
  const media = declarations(mediaBody);
  const bright = declarations(brightBody);

  const onlyMedia = [...media.keys()].filter((k) => !bright.has(k));
  const onlyBright = [...bright.keys()].filter((k) => !media.has(k));
  const differing = [...media.keys()].filter((k) => bright.has(k) && media.get(k) !== bright.get(k));

  check("no token is missing from the brighttext block", onlyMedia.length === 0, onlyMedia.join(", "));
  check("no token is missing from the @media block", onlyBright.length === 0, onlyBright.join(", "));
  check(
    "every shared token has the same value",
    differing.length === 0,
    differing.map((k) => `${k}: ${media.get(k)} vs ${bright.get(k)}`).join("\n       ")
  );
  check("the palette is not empty", media.size > 50, `only ${media.size} tokens`);
}

console.log("--- no UTF-8 / Windows-1252 corruption in the stylesheets ---");

for (const file of cssFiles(CHROME)) {
  const text = read(file);
  const hits = [];
  for (let i = 0; i < text.length - 1; i++) {
    // U+00C3 suivi d un caractere non ASCII : la signature du double encodage.
    if (text.charCodeAt(i) === 0x00c3 && text.charCodeAt(i + 1) > 127) {
      hits.push(text.slice(0, i).split("\n").length);
    }
  }
  check(
    path.relative(ROOT, file).replace(/\\/g, "/"),
    hits.length === 0,
    hits.length ? `${hits.length} sequence(s), first at line ${hits[0]}` : ""
  );
}

console.log(`\n${pass} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
