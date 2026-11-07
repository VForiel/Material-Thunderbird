/**
 * extension/material-theme.css est un fichier genere : scripts/build.ps1 y
 * concatene les memes sources que chrome/userChrome.css. Rien ne verifiait que le
 * fichier commis correspondait encore a chrome/, alors que son propre en-tete
 * previent qu il ne faut pas le modifier a la main.
 *
 * La liste des sources n est pas recopiee ici : elle est lue dans build.ps1, qui
 * reste la seule reference.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build.ps1");
const CHROME = path.join(ROOT, "chrome");
const GENERATED = path.join(ROOT, "extension", "material-theme.css");

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function sourcesFromBuildScript() {
  const script = read(BUILD);
  const block = /\$Sources\s*=\s*@\(([\s\S]*?)\)/.exec(script);
  if (!block) throw new Error("liste $Sources introuvable dans scripts/build.ps1");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

let failures = 0;
function fail(message) {
  failures++;
  console.log("  FAIL " + message);
}

console.log("--- extension/material-theme.css is in sync with chrome/ ---");

const sources = sourcesFromBuildScript();
console.log(`  ${sources.length} sources listed by build.ps1`);

let expected = "";
for (const rel of sources) {
  const file = path.join(CHROME, rel);
  if (!fs.existsSync(file)) {
    fail(`build.ps1 lists ${rel}, which does not exist under chrome/`);
    continue;
  }
  expected += `/* ===== ${rel} ===== */\n` + read(file).replace(/\s+$/, "") + "\n\n";
}

// build.ps1 enveloppe les sources dans @-moz-document ... { } : on compare ce
// qu il y a entre l accolade ouvrante et l accolade fermante finale.
const wrapped = read(GENERATED);
const open = wrapped.indexOf("@-moz-document ");
const close = wrapped.lastIndexOf("}\n");
if (open === -1 || close === -1) fail("extension/material-theme.css is not wrapped in @-moz-document");
const generated = wrapped.slice(wrapped.indexOf("{\n", open) + 2, close).replace(/^\n/, "");
const bodyStart = generated.indexOf("/* ===== ");
if (bodyStart === -1) {
  fail("no source marker in extension/material-theme.css: was it generated?");
} else if (generated.slice(bodyStart) !== expected) {
  const actualLines = generated.slice(bodyStart).split("\n");
  const expectedLines = expected.split("\n");
  let at = 0;
  while (at < actualLines.length && actualLines[at] === expectedLines[at]) at++;
  fail(
    "extension/material-theme.css does not match chrome/. Re-run scripts/build.ps1.\n" +
      `       first difference at body line ${at + 1}\n` +
      `       generated: ${JSON.stringify(actualLines[at])}\n` +
      `       expected:  ${JSON.stringify(expectedLines[at])}`
  );
}

// La feuille du theme et celle de la personnalisation doivent viser les memes
// documents.
const scope = /@-moz-document ([^{]+) \{/.exec(wrapped);
const experiment = read(path.join(ROOT, "extension", "experiments", "material-assistant.js"));
const list = /const CHROME_DOCUMENTS = \[([\s\S]*?)\]/.exec(experiment);
const experimentScope = list ? [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).join(", ") : null;
if (!scope || scope[1].trim() !== experimentScope) {
  fail("@-moz-document scope differs between build.ps1 and CHROME_DOCUMENTS");
}

// message-content.css reprend chrome/userContent.css.
const messageCss = read(path.join(ROOT, "extension", "message-content.css"));
if (!messageCss.endsWith(read(path.join(CHROME, "userContent.css")).replace(/\s+$/, "") + "\n")) {
  fail("extension/message-content.css does not match chrome/userContent.css. Re-run scripts/build.ps1.");
}

console.log(failures === 0 ? "\n1 passed, 0 failed" : `\n0 passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
