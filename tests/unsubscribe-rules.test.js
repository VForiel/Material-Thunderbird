const R = require("../extension/shared/unsubscribe-rules.js");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${name}\n       got:      ${JSON.stringify(actual)}\n       expected: ${JSON.stringify(expected)}`); }
}

console.log("--- isSafeUrl: only http(s) may be opened ---");
check("https ok",        R.isSafeUrl("https://example.com/unsub"), true);
check("http ok",         R.isSafeUrl("http://example.com/unsub"),  true);
check("javascript:",     R.isSafeUrl("javascript:alert(1)"),       false);
check("data: html",      R.isSafeUrl("data:text/html;base64,PHNjcmlwdD4="), false);
check("file:",           R.isSafeUrl("file:///C:/Windows/System32/calc.exe"), false);
check("chrome:",         R.isSafeUrl("chrome://browser/content/browser.xhtml"), false);
check("resource:",       R.isSafeUrl("resource://gre/modules/Services.jsm"), false);
check("mailto:",         R.isSafeUrl("mailto:x@y.z"),              false);
check("scheme w/ tab",   R.isSafeUrl("java\tscript:alert(1)"),     false);
check("leading ctrl",    R.isSafeUrl("\u0001https://example.com"), false);
check("empty",           R.isSafeUrl(""),                          false);
check("null",            R.isSafeUrl(null),                        false);
check("protocol-rel",    R.isSafeUrl("//example.com/unsub"),       false);

console.log("--- false positives reported in review ---");
const fp = (href, text) => R.findBestLink([{ href, text: text || "En savoir plus" }]);
check("sympathique.com host", fp("https://sympathique.com/article/42"), null);
check("/diffusion/ path",     fp("https://example.com/diffusion/article-du-jour"), null);
check("word signoff in slug", fp("https://blog.example.com/the-signoff-of-a-ceo"), null);
check("plain marketing link", fp("https://shop.example.com/products/soldes"), null);
check("constantcontact home", fp("https://www.constantcontact.com/index.jsp"), null);
check("sendinblue tracking",  fp("https://r.sendinblue.com/tr/cl/abc123"), null);

console.log("--- true positives that must still fire ---");
const tp = (href, text) => R.findBestLink([{ href, text }]);
check("exact fr label",   tp("https://n.example.com/u/9f2", "Se désinscrire"), "https://n.example.com/u/9f2");
check("exact en label",   tp("https://n.example.com/u/9f2", "Unsubscribe"),    "https://n.example.com/u/9f2");
check("german label",     tp("https://n.example.com/u/9f2", "Abmelden"),       "https://n.example.com/u/9f2");
check("href hint only",   tp("https://example.com/unsubscribe?id=7", "Cliquez ici"), "https://example.com/unsubscribe?id=7");
check("mailchimp esp",    tp("https://x.us2.list-manage.com/unsubscribe?u=1&id=2", "ici"), "https://x.us2.list-manage.com/unsubscribe?u=1&id=2");
check("sympa signoff",    tp("https://listes.univ.fr/sympa/signoff/seminaire", "ici"), "https://listes.univ.fr/sympa/signoff/seminaire");
check("listserv signoff", tp("https://lists.example.org/cgi?SUBED1=L&A=SIGNOFF", "ici"), "https://lists.example.org/cgi?SUBED1=L&A=SIGNOFF");
check("cmail redirect",   tp("https://cmail19.com/t/j-u-abc/", "ici"), "https://cmail19.com/t/j-u-abc/");

console.log("--- soft keyword alone must not fire, but with href hint it does ---");
check("soft only",        fp("https://example.com/settings", "Préférences"), null);
check("soft + href hint", tp("https://example.com/optout/9", "Préférences"), "https://example.com/optout/9");

console.log("--- unsafe href never wins even with perfect label ---");
check("javascript label", fp("javascript:alert(1)", "Se désinscrire"), null);
check("data label",       fp("data:text/html,<h1>x", "Unsubscribe"),   null);

console.log("--- List-Unsubscribe header (RFC 2369) ---");
check("mailto then http", R.findInListUnsubscribeHeader("<mailto:u@e.com>, <https://e.com/u/1>"), "https://e.com/u/1");
check("http only",        R.findInListUnsubscribeHeader("<https://e.com/u/2>"), "https://e.com/u/2");
check("mailto only",      R.findInListUnsubscribeHeader("<mailto:u@e.com>"), null);
check("junk",             R.findInListUnsubscribeHeader("not a header"), null);

console.log("--- raw HTML body scan (entities must be decoded) ---");
check("entity decode",
  R.findInHtml('<p><a href="https://e.com/u?a=1&amp;b=2">Unsubscribe</a></p>'),
  "https://e.com/u?a=1&b=2");
check("unquoted href",
  R.findInHtml('<a href=https://e.com/unsubscribe/7 >Se désinscrire</a>'),
  "https://e.com/unsubscribe/7");
check("nested markup in label",
  R.findInHtml('<a href="https://e.com/u/8"><span><b>Unsubscribe</b></span></a>'),
  "https://e.com/u/8");
check("ignores javascript href",
  R.findInHtml('<a href="javascript:void(0)">Unsubscribe</a>'),
  null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
