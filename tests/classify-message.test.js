// Classement des messages pour le bandeau : infolettre, liste de diffusion ou rien.
//
// Les en-tetes ci-dessous ont ete releves sur de vrais courriels recus en
// novembre 2026, adresses et jetons remplaces. Les plateformes d envoi (Brevo
// ici) ajoutent List-Unsubscribe, et meme List-Unsubscribe-Post, a des courriels
// de code de connexion : seul le contenu permet de les ecarter.
const R = require("../extension/shared/unsubscribe-rules.js");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${name}\n       got:      ${JSON.stringify(actual)}\n       expected: ${JSON.stringify(expected)}`); }
}

const brevoHeaders = (extra) => Object.assign({
  "from": ["\"Service\" <no-reply@service.example>"],
  "list-unsubscribe": ["<https://list-unsubscribe.me/tr/un/li/TOKEN>"],
  "list-unsubscribe-post": ["List-Unsubscribe=One-Click"],
  "feedback-id": ["172.246.7.70:4074909_-1:4074909:Sendinblue"]
}, extra || {});
const kind = (d) => { const r = R.classifyMessage(d); return r ? r.kind : null; };

console.log("--- transactional mail never gets a banner, even with List-Unsubscribe ---");
check("medical booking login code (subject)",
  kind({ headers: brevoHeaders(), subject: "Votre code de vérification Doctolib",
         text: "Voici votre code de vérification pour vous connecter : 231757" }), null);
check("estate agency code (subject)",
  kind({ headers: brevoHeaders(), subject: "Code 360739 connexion dossier locataire", text: "" }), null);
check("health insurance security code",
  kind({ headers: brevoHeaders(), subject: "Code de sécurité pour votre compte ameli",
         text: "Utilisez ce code de sécurité valable 15 minutes 285697" }), null);
check("benefits office login code",
  kind({ headers: brevoHeaders(), subject: "Votre code de vérification de connexion", text: "" }), null);
check("signup code only in body",
  kind({ headers: brevoHeaders(), subject: "Inscription à WikiMasters",
         text: "Confirmez votre inscription. Votre code de vérification Wiki Masters : 774842" }), null);
check("telecom security notice in body",
  kind({ headers: brevoHeaders(), subject: "Information RED",
         text: "Votre demande de code de sécurité confidentiel. Cher client, une demande sécurisée..." }), null);
check("english otp",
  kind({ headers: brevoHeaders(), subject: "Your one-time passcode", text: "" }), null);
check("bare code in body",
  kind({ headers: brevoHeaders(), subject: "Connexion", text: "Votre code : 482913" }), null);
check("password reset",
  kind({ headers: brevoHeaders(), subject: "Réinitialisation de votre mot de passe", text: "" }), null);
check("new sign-in alert",
  kind({ headers: brevoHeaders(), subject: "Security alert: new sign-in on Windows", text: "" }), null);
check("order confirmation",
  kind({ headers: brevoHeaders(), subject: "Confirmation de commande n°4521", text: "" }), null);
check("newsletter about passwords stays a newsletter",
  kind({ headers: brevoHeaders(), subject: "5 conseils pour vos mots de passe",
         text: "Ce mois-ci, la sécurité de vos comptes." }), "newsletter");

console.log("--- discussion lists get their own discreet banner ---");
const sympa = {
  "from": ["Une Collègue <ashra-france@groupes.example.fr>"],
  "list-id": ["<ashra-france.groupes.example.fr>"],
  "list-unsubscribe": ["<mailto:sympa@groupes.example.fr?subject=unsubscribe%20ashra-france>"],
  "list-post": ["<mailto:ashra-france@groupes.example.fr>"],
  "list-help": ["<mailto:sympa@groupes.example.fr?subject=help>"],
  "precedence": ["list"]
};
const s = R.classifyMessage({ headers: sympa, subject: "[ASHRA-France] HRA seminars", text: "Dear all," });
check("sympa kind",   s && s.kind, "list");
check("sympa name",   s && s.listName, "ashra-france");
check("sympa mailto", s && s.mailto, "mailto:sympa@groupes.example.fr?subject=unsubscribe%20ashra-france");
check("sympa no url", s && s.url, null);
check("sympa key",    s && s.key, "list:ashra-france.groupes.example.fr");
check("a list stays a list whatever the subject",
  kind({ headers: sympa, subject: "Re: code de vérification du pipeline", text: "" }), "list");

const ggroups = {
  "from": ["Someone <someone@example.org>"],
  "list-id": ["Optics Club <optics-club.googlegroups.com>"],
  "list-unsubscribe": ["<mailto:optics-club+unsubscribe@googlegroups.com>, <https://groups.google.com/d/optout>"],
  "list-post": ["<mailto:optics-club@googlegroups.com>"]
};
const g = R.classifyMessage({ headers: ggroups, subject: "Meeting tomorrow", text: "" });
check("google group kind", g && g.kind, "list");
check("google group name", g && g.listName, "Optics Club");
check("google group url",  g && g.url, "https://groups.google.com/d/optout");
check("google group no mailto when url", g && g.mailto, null);

console.log("--- newsletters ---");
const mailchimp = {
  "from": ["La Gazette <hello@gazette.example>"],
  "list-id": ["La Gazette <abc123.list-id.mcsv.net>"],
  "list-unsubscribe": ["<https://gazette.us2.list-manage.com/unsubscribe?u=1&id=2>, <mailto:unsub-1@mailchimp.example>"],
  "list-unsubscribe-post": ["List-Unsubscribe=One-Click"]
};
const m = R.classifyMessage({ headers: mailchimp, subject: "Les nouveautés de novembre", text: "Bonjour à tous" });
check("mailchimp kind (List-Id without List-Post)", m && m.kind, "newsletter");
check("mailchimp one-click", m && m.oneClick, true);
check("mailchimp url",       m && m.url, "https://gazette.us2.list-manage.com/unsubscribe?u=1&id=2");
check("mailchimp key",       m && m.key, "from:hello@gazette.example");

check("promo with header only",
  kind({ headers: { "from": ["App <info@app.example>"], "list-unsubscribe": ["<https://app.example/u/9>"] },
         subject: "All your chats are now in one place", text: "Hello there!" }), "newsletter");
check("no one-click without post header",
  R.classifyMessage({ headers: { "list-unsubscribe": ["<https://app.example/u/9>"] }, subject: "Promo", text: "" }).oneClick, false);
const mailtoOnly = R.classifyMessage({ headers: { "list-unsubscribe": ["<mailto:leave@shop.example>"] }, subject: "Promo", text: "" });
check("mailto-only newsletter", mailtoOnly && mailtoOnly.mailto, "mailto:leave@shop.example");

console.log("--- the body alone never decides ---");
check("personal mail with unsubscribe link in body",
  kind({ headers: { "from": ["Ami <ami@example.org>"] }, subject: "Re: week-end",
         text: "Je me suis désinscrit de leur liste", bodyUrl: "https://example.com/unsubscribe/7" }), null);
const bulk = R.classifyMessage({ headers: { "precedence": ["bulk"], "from": ["News <n@shop.example>"] },
  subject: "Soldes", text: "", bodyUrl: "https://shop.example/unsubscribe/7" });
check("bulk header + body link", bulk && bulk.url, "https://shop.example/unsubscribe/7");
check("unsafe body link ignored",
  R.classifyMessage({ headers: { "precedence": ["bulk"] }, subject: "Soldes", text: "", bodyUrl: "javascript:alert(1)" }).url, null);
check("bulk without any link waits for the DOM",
  R.classifyMessage({ headers: { "precedence": ["bulk"] }, subject: "Soldes", text: "" }).url, null);

console.log("--- header helpers ---");
check("mailto only",   R.findMailtoInListUnsubscribeHeader("<mailto:u@e.com?subject=unsub>"), "mailto:u@e.com?subject=unsub");
check("mailto absent", R.findMailtoInListUnsubscribeHeader("<https://e.com/u>"), null);
check("mailto junk",   R.findMailtoInListUnsubscribeHeader("<mailto:not-an-address>"), null);
check("email from",    R.emailFrom("\"A B\" <A.B@Example.org>"), "a.b@example.org");
check("email bare",    R.emailFrom("a@b.c"), "a@b.c");
check("manage preferences footer no longer fires",
  R.findBestLink([{ href: "https://account.example/settings", text: "Manage preferences" }]), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
