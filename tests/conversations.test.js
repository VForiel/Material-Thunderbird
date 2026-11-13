// Vue messagerie (prototype) : regroupement des courriels en conversations.
const C = require("../extension/shared/conversations.js");

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else { fail++; console.log(`  FAIL ${name}\n       got:      ${JSON.stringify(actual)}\n       expected: ${JSON.stringify(expected)}`); }
}

const ME = ["moi@labo.example", "moi@perso.example"];
const A = { name: "Alice Martin", email: "alice@labo.example" };
const A2 = { name: "Alice", email: "alice.martin@perso.example" };
const B = { name: "Bruno Petit", email: "bruno@labo.example" };
const K = { name: "Karim Haddad", email: "karim@labo.example" };
const MEL = { name: "Moi", email: "moi@labo.example" };
const MEP = { name: "Moi", email: "moi@perso.example" };
let n = 0;
const msg = (o) => Object.assign({ id: ++n, headerMessageId: `m${n}@x`, to: [], cc: [], date: n * 1000, subject: "", text: "", account: "labo", read: true }, o);
const build = (msgs, opts) => C.buildConversations(msgs, Object.assign({ me: ME }, opts)).conversations;
const kinds = (convs) => convs.map((c) => c.kind + ":" + c.items.filter((i) => i.type === "message").length);

console.log("--- subject prefixes ---");
check("Re/TR/Fwd stack", C.normalizeSubject("RE: TR: Fwd: [phise] Réunion"), "Réunion");
check("Re[2]", C.normalizeSubject("Re[2]: Banc"), "Banc");

console.log("--- quoted text is removed ---");
check("french gmail attribution",
  C.stripQuoted("Ok pour jeudi.\n\nLe mer. 12 nov. 2026 à 10:02, Alice <a@x> a écrit :\n> Jeudi ?"), "Ok pour jeudi.");
check("english attribution", C.stripQuoted("Sure\nOn Tue, Bob wrote:\n> hi"), "Sure");
check("signature", C.stripQuoted("Merci !\n-- \nVincent"), "Merci !");
check("outlook header", C.stripQuoted("Vu.\n\nDe : Alice\nEnvoyé : lundi\nÀ : moi"), "Vu.");
check("inline > lines dropped", C.stripQuoted("> question ?\nréponse"), "réponse");

console.log("--- one other person = direct conversation, whatever the thread or account ---");
{
  const convs = build([
    msg({ from: A, to: [MEL], subject: "Banc" }),
    msg({ from: MEL, to: [A], subject: "Re: Banc" }),
    msg({ from: A, to: [MEP], subject: "Ciné ce soir ?", account: "perso" })
  ]);
  check("one direct conversation", kinds(convs), ["direct:3"]);
  check("both accounts listed", convs[0].accounts, ["labo", "perso"]);
  check("subject shown on the bubble that changes it",
    convs[0].items.map((i) => i.subject), ["Banc", null, "Ciné ce soir ?"]);
}

console.log("--- two addresses of one contact merge into one person ---");
{
  const contacts = [{ id: 1, name: "Alice Martin", emails: [A.email, A2.email] }];
  check("merged", kinds(build([msg({ from: A, to: [MEL] }), msg({ from: A2, to: [MEP] })], { contacts })), ["direct:2"]);
  check("not merged without contact", kinds(build([msg({ from: A, to: [MEL] }), msg({ from: A2, to: [MEP] })])), ["direct:1", "direct:1"]);
}

console.log("--- mail to oneself ---");
check("self", kinds(build([msg({ from: MEL, to: [MEP] })])), ["self:1"]);

console.log("--- group follows its thread while recipients change ---");
{
  const m1 = msg({ from: A, to: [MEL, B], subject: "Mesures" });
  const m2 = msg({ from: B, to: [A, MEL, K], subject: "Re: Mesures", inReplyTo: m1.headerMessageId });
  const m3 = msg({ from: MEL, to: [A, K], subject: "Re: Mesures", inReplyTo: m2.headerMessageId, references: [m1.headerMessageId] });
  const m4 = msg({ from: A, to: [MEL, K], subject: "Re: Mesures", inReplyTo: m3.headerMessageId });
  const convs = build([m1, m2, m3, m4]);
  check("one group", kinds(convs), ["group:4"]);
  const g = convs[0];
  const events = g.items.filter((i) => i.type === "members").map((e) => ({ by: e.by, added: e.added, removed: e.removed }));
  check("Karim added by Bruno; Bruno left out twice = removed by whoever left him out first",
    events, [{ by: "e:bruno@labo.example", added: ["e:karim@labo.example"], removed: [] },
             { by: "me", added: [], removed: ["e:bruno@labo.example"] }]);
  check("removal shown just before the message that started it",
    g.items.map((i) => i.type).slice(-3), ["members", "message", "message"]);
  check("no audience mention once the removal is confirmed",
    g.items.filter((i) => i.type === "message").map((i) => i.missing), [[], [], [], []]);
  check("final members", g.members, ["e:alice@labo.example", "e:karim@labo.example"]);
  check("title from first names", g.title, "Alice, Karim");
}

console.log("--- a single message without one member only carries its audience ---");
{
  const m1 = msg({ from: A, to: [MEL, B, K], subject: "Cadeau" });
  const m2 = msg({ from: A, to: [MEL, K], subject: "Re: Cadeau", inReplyTo: m1.headerMessageId });
  const m3 = msg({ from: K, to: [MEL, A, B], subject: "Re: Cadeau", inReplyTo: m2.headerMessageId });
  const g = build([m1, m2, m3])[0];
  check("no member event", g.items.filter((i) => i.type === "members").length, 0);
  check("audience on the partial message", g.items.filter((i) => i.type === "message").map((i) => i.missing), [[], ["e:bruno@labo.example"], []]);
}

console.log("--- a private reply inside a group thread goes to the direct conversation ---");
{
  const m1 = msg({ from: A, to: [MEL, B], subject: "Pot" });
  const m2 = msg({ from: B, to: [MEL], subject: "Re: Pot", inReplyTo: m1.headerMessageId });
  check("group + direct", kinds(build([m1, m2])).sort(), ["direct:1", "group:1"]);
}

console.log("--- separate threads with the same people form one group ---");
{
  const convs = build([
    msg({ from: A, to: [MEL, B], subject: "Réunion lundi" }),
    msg({ from: B, to: [MEL, A], subject: "Article" })
  ]);
  check("one group", kinds(convs), ["group:2"]);
  check("subject lines", convs[0].items.filter((i) => i.type === "subject").map((i) => i.subject), ["Réunion lundi", "Article"]);
}

console.log("--- lists and newsletters ---");
{
  const convs = build([
    msg({ from: A, to: [{ email: "phise@lists.example" }], listId: "<phise.lists.example>", listName: "phise" }),
    msg({ from: B, to: [{ email: "phise@lists.example" }], listId: "<phise.lists.example>", listName: "phise" }),
    msg({ from: { name: "Journal", email: "news@journal.example" }, to: [MEL], isNewsletter: true })
  ]);
  check("list + newsletter", kinds(convs).sort(), ["list:2", "newsletter:1"]);
  check("newsletters can be hidden",
    kinds(build([msg({ from: { email: "news@journal.example" }, to: [MEL], isNewsletter: true })], { includeNewsletters: false })), []);
}

console.log("--- unread count and order ---");
{
  const convs = build([
    msg({ from: A, to: [MEL], read: false }),
    msg({ from: B, to: [MEL], read: false }),
    msg({ from: B, to: [MEL], read: false })
  ]);
  check("most recent first", convs.map((c) => c.title), ["Bruno Petit", "Alice Martin"]);
  check("unread", convs.map((c) => c.unread), [2, 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
