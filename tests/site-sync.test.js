// L apercu du site doit montrer les vraies couleurs de l extension :
// - docs/theme/tokens/ est une copie exacte de chrome/tokens/ (scripts/build.ps1) ;
// - les palettes de docs/theme/settings.js sont celles de l experiment.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${name}${detail ? "\n       " + detail : ""}`); }
}

console.log("--- docs/theme/tokens mirrors chrome/tokens ---");
const tokenDir = path.join(root, "chrome", "tokens");
for (const file of fs.readdirSync(tokenDir).filter((f) => f.endsWith(".css"))) {
  const source = fs.readFileSync(path.join(tokenDir, file), "utf8");
  const copyPath = path.join(root, "docs", "theme", "tokens", file);
  const copy = fs.existsSync(copyPath) ? fs.readFileSync(copyPath, "utf8") : null;
  check(`${file} copied`, copy === source, "run scripts/build.ps1 to refresh docs/theme/tokens/");
}

console.log("--- site palettes match the extension ---");
const settings = require(path.join(root, "docs", "theme", "settings.js"));
const experiment = fs.readFileSync(path.join(root, "extension", "experiments", "material-assistant.js"), "utf8");
const block = /const PALETTES_CONFIG = \{([\s\S]*?)\n\};/.exec(experiment);
check("PALETTES_CONFIG found", !!block);
if (block) {
  const entries = {};
  const re = /(\w+):\s*\{[^}]*?color:\s*"([^"]+)"[\s\S]*?light:\s*\[([^\]]+)\],\s*dark:\s*\[([^\]]+)\]/g;
  let m;
  const list = (s) => s.split(",").map((v) => v.trim().replace(/"/g, ""));
  while ((m = re.exec(block[1])) !== null) {
    entries[m[1]] = { color: m[2], light: list(m[3]), dark: list(m[4]) };
  }
  check("same palette keys",
    JSON.stringify(Object.keys(entries)) === JSON.stringify(Object.keys(settings.PALETTES)),
    `${Object.keys(entries)} vs ${Object.keys(settings.PALETTES)}`);
  for (const key of Object.keys(entries)) {
    const site = settings.PALETTES[key] || {};
    check(`${key} values`,
      JSON.stringify({ color: site.color, light: site.light, dark: site.dark }) === JSON.stringify(entries[key]));
  }
}

console.log("--- settings sanitising ---");
check("defaults", JSON.stringify(settings.sanitize(null)) === JSON.stringify(settings.DEFAULTS));
check("unknown palette dropped", settings.sanitize({ palette: "neon" }).palette === "blue");
check("valid values kept", settings.sanitize({ mode: "dark", palette: "coral", icons: "emoji" }).palette === "coral");
check("Modern icons by default", settings.sanitize({}).icons === "modern");
check("unknown icon theme dropped", settings.sanitize({ icons: "neon" }).icons === "modern");
check("old emojis option kept", settings.sanitize({ emojis: true }).icons === "emoji");
check("explicit icon theme wins", settings.sanitize({ emojis: true, icons: "default" }).icons === "default");

console.log("--- preview icons match the extension ---");
const previewIcons = require(path.join(root, "docs", "theme", "icons.js")).ICONS ||
  globalThis.MaterialIcons.ICONS;
function iconTable(name) {
  const body = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(experiment);
  const table = {};
  if (body) {
    const re = /(\w+):\s*"([^"]+)"/g;
    let e;
    while ((e = re.exec(body[1]))) table[e[1]] = e[2];
  }
  return table;
}
const outline = iconTable("MATERIAL_ICONS");
const filled = iconTable("MATERIAL_ICONS_FILLED");
// Symbole de l apercu -> role dans l extension.
const ROLE = { inbox: "inbox", drafts: "drafts", send: "sent", archive: "archive", junk: "junk",
  delete: "trash", folder: "folder", mail: "mail", person: "contacts", calendar: "calendar",
  task: "tasks", chat: "chat", palette: "palette", settings: "settings", refresh: "sync",
  reply: "reply", forward: "forward", heart: "heart" };
for (const [id, pair] of Object.entries(previewIcons)) {
  const role = ROLE[id];
  check(`${id} outline`, !!role && outline[role] === pair[0]);
  check(`${id} filled`, !!role && filled[role] === pair[1]);
}
check("non-boolean ignored", settings.sanitize({ unsub: "no" }).unsub === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
