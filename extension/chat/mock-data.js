/**
 * Vue messagerie (prototype) : jeu de donnees fictif pour essayer l interface
 * hors de Thunderbird (chat.html?demo). Personnes, adresses et domaines inventes.
 * Meme format que source-thunderbird.js.
 */
(function (global) {
  "use strict";

  var NOW = new Date();
  function at(daysAgo, hh, mm) {
    var d = new Date(NOW);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hh, mm || 0, 0, 0);
    return d;
  }

  var ACCOUNTS = [
    { id: "labo", name: "Labo", email: "moi@labo.example",
      folders: [{ id: "labo/inbox", name: "Boîte de réception", kind: "inbox" },
                { id: "labo/sent", name: "Envoyés", kind: "sent" },
                { id: "labo/archives", name: "Archives", kind: "archives" },
                { id: "labo/listes", name: "Listes", kind: "other" }] },
    { id: "asso", name: "Asso", email: "moi@asso.example",
      folders: [{ id: "asso/inbox", name: "Boîte de réception", kind: "inbox" },
                { id: "asso/sent", name: "Envoyés", kind: "sent" }] },
    { id: "perso", name: "Perso", email: "moi@perso.example",
      folders: [{ id: "perso/inbox", name: "Boîte de réception", kind: "inbox" },
                { id: "perso/sent", name: "Envoyés", kind: "sent" },
                { id: "perso/promos", name: "Promotions", kind: "other" }] }
  ];

  var CONTACTS = [
    { id: 1, name: "Claire Dubois", emails: ["claire.dubois@labo.example", "claire.d@perso.example"] },
    { id: 2, name: "Julie Moreau", emails: ["julie.moreau@perso.example"] }
  ];

  var P = {
    me_l: { name: "Moi", email: "moi@labo.example" },
    me_a: { name: "Moi", email: "moi@asso.example" },
    me_p: { name: "Moi", email: "moi@perso.example" },
    claire: { name: "Claire Dubois", email: "claire.dubois@labo.example" },
    claireP: { name: "Claire", email: "claire.d@perso.example" },
    alice: { name: "Alice Martin", email: "alice.martin@labo.example" },
    bruno: { name: "Bruno Petit", email: "bruno.petit@labo.example" },
    karim: { name: "Karim Haddad", email: "karim.haddad@labo.example" },
    lea: { name: "Léa Bernard", email: "lea@asso.example" },
    hugo: { name: "Hugo Leroy", email: "hugo.leroy@mail.example" },
    sam: { name: "Sam Girard", email: "sam.girard@mail.example" },
    julie: { name: "Julie Moreau", email: "julie.moreau@perso.example" },
    ed: { name: "École doctorale", email: "scolarite-ed@univ.example" },
    seminar: { name: "Séminaires astro", email: "seminaires@lists.univ.example" },
    paul: { name: "Paul Lambert", email: "paul.lambert@univ.example" },
    nina: { name: "Nina Rossi", email: "nina.rossi@univ.example" },
    news: { name: "Le Courrier des étoiles", email: "lettre@courrier-etoiles.example" },
    shop: { name: "Vélo Plus", email: "promo@veloplus.example" }
  };

  var seq = 0;
  function m(o) {
    seq++;
    return Object.assign({
      id: seq, headerMessageId: "demo" + seq + "@example",
      to: [], cc: [], bcc: [], references: [], inReplyTo: null,
      read: true, attachments: [], listId: null, isNewsletter: false
    }, o);
  }

  var M = [];
  function add(o) { var x = m(o); M.push(x); return x; }

  // --- Directe, deux comptes (le labo et l adresse perso de Claire) ---
  var c1 = add({ from: P.claire, to: [P.me_l], date: at(6, 9, 12), account: "labo", folder: "labo/inbox",
    subject: "Chapitre 3",
    text: "Bonjour,\n\nJ'ai relu le chapitre 3. La partie sur la calibration est claire, mais il manque une figure qui montre la dérive sur une nuit entière. Tu peux la tirer des mesures d'octobre ?\n\nOn en parle jeudi.\n\nClaire" });
  var c2 = add({ from: P.me_l, to: [P.claire], date: at(6, 10, 40), account: "labo", folder: "labo/sent",
    subject: "Re: Chapitre 3", inReplyTo: c1.headerMessageId,
    text: "Bonjour Claire,\n\nOui, je l'ajoute, j'ai les données de la nuit du 14.\n\nLe lun. 6 nov. 2026 à 09:12, Claire Dubois <claire.dubois@labo.example> a écrit :\n> Bonjour,\n> J'ai relu le chapitre 3." });
  add({ from: P.claire, to: [P.me_l], date: at(6, 10, 52), account: "labo", folder: "labo/inbox",
    subject: "Re: Chapitre 3", inReplyTo: c2.headerMessageId,
    text: "Parfait, merci !\n\n-- \nClaire Dubois\nLaboratoire d'exemple" });
  add({ from: P.claireP, to: [P.me_p], date: at(2, 19, 5), account: "perso", folder: "perso/inbox",
    subject: "Pot de départ de Marc",
    text: "Je t'écris ici car c'est une surprise : on fait un pot pour Marc vendredi à 17h, tu peux prévenir les doctorants sans qu'il le voie ?" });
  add({ from: P.me_p, to: [P.claireP], date: at(2, 21, 30), account: "perso", folder: "perso/sent",
    subject: "Re: Pot de départ de Marc",
    text: "Je m'en occupe 🙂" });
  add({ from: P.claire, to: [P.me_l], date: at(0, 8, 47), account: "labo", folder: "labo/inbox", read: false,
    subject: "Figure dérive",
    text: "La figure est très bien. Une seule remarque : mets l'axe des temps en heures locales, c'est plus lisible pour un jury.",
    attachments: [{ name: "fig3-12_annotee.pdf", size: 412000 }] });

  // --- Groupe dont les membres changent en route ---
  var g1 = add({ from: P.alice, to: [P.me_l, P.bruno], date: at(4, 14, 3), account: "labo", folder: "labo/inbox",
    subject: "Réservation du banc semaine prochaine",
    text: "Salut à tous,\n\nJe propose : moi lundi-mardi, Bruno mercredi, Vincent jeudi-vendredi. Ça vous va ?" });
  var g2 = add({ from: P.bruno, to: [P.alice, P.me_l], cc: [P.karim], date: at(4, 14, 26), account: "labo", folder: "labo/inbox",
    subject: "Re: Réservation du banc semaine prochaine", inReplyTo: g1.headerMessageId,
    text: "Ok pour moi. J'ajoute Karim, il a besoin du laser mercredi après-midi, on peut partager.\n\nLe jeu. 9 nov. 2026, Alice Martin a écrit :\n> Je propose : moi lundi-mardi" });
  var g3 = add({ from: P.karim, to: [P.alice, P.bruno, P.me_l], date: at(4, 15, 1), account: "labo", folder: "labo/inbox",
    subject: "Re: Réservation du banc semaine prochaine", inReplyTo: g2.headerMessageId,
    text: "Merci Bruno. Mercredi 14h-18h si possible." });
  var g4 = add({ from: P.me_l, to: [P.alice, P.karim], date: at(3, 9, 15), account: "labo", folder: "labo/sent",
    subject: "Re: Réservation du banc semaine prochaine", inReplyTo: g3.headerMessageId,
    text: "Bruno est en congé finalement, je retire son créneau. Karim, tu peux prendre tout mercredi." });
  var g5 = add({ from: P.alice, to: [P.me_l, P.karim], date: at(3, 9, 40), account: "labo", folder: "labo/inbox",
    subject: "Re: Réservation du banc semaine prochaine", inReplyTo: g4.headerMessageId,
    text: "Noté, je mets à jour le planning." });
  add({ from: P.karim, to: [P.me_l, P.alice], date: at(0, 11, 2), account: "labo", folder: "labo/inbox", read: false,
    subject: "Le laser ne démarre plus",
    text: "Je viens d'arriver, le contrôleur du laser affiche une erreur de température. Quelqu'un a touché au refroidissement hier ?",
    attachments: [{ name: "IMG_20261113_1058.jpg", size: 2300000 }] });
  add({ from: P.alice, to: [P.me_l, P.karim], date: at(0, 11, 9), account: "labo", folder: "labo/inbox", read: false,
    subject: "Re: Le laser ne démarre plus",
    text: "Pas moi. Regarde si la vanne du circuit d'eau est ouverte, elle avait été fermée pour la maintenance." });

  // --- Groupe de l asso, un message qui laisse quelqu un de cote ---
  var a1 = add({ from: P.lea, to: [P.me_a, P.hugo, P.sam], date: at(5, 18, 20), account: "asso", folder: "asso/inbox",
    subject: "Soirée du 29",
    text: "Coucou ! On a la salle pour le 29. Il nous faut quelqu'un pour la sono et quelqu'un pour les courses." });
  var a2 = add({ from: P.hugo, to: [P.lea, P.me_a, P.sam], date: at(5, 19, 2), account: "asso", folder: "asso/inbox",
    subject: "RE: Soirée du 29", inReplyTo: a1.headerMessageId,
    text: "Je prends la sono." });
  var a3 = add({ from: P.lea, to: [P.me_a, P.hugo], date: at(1, 12, 30), account: "asso", folder: "asso/inbox",
    subject: "RE: Soirée du 29", inReplyTo: a2.headerMessageId,
    text: "Sans Sam pour une fois : c'est son anniversaire le 29, on lui prépare un gâteau ? 🎂" });
  add({ from: P.me_a, to: [P.lea, P.hugo, P.sam], date: at(1, 13, 5), account: "asso", folder: "asso/sent",
    subject: "RE: Soirée du 29", inReplyTo: a3.headerMessageId,
    text: "Je fais les courses samedi matin, envoyez-moi ce qu'il manque." });

  // --- Directe perso, messages courts ---
  add({ from: P.julie, to: [P.me_p], date: at(1, 20, 14), account: "perso", folder: "perso/inbox",
    subject: "Photos de la rando", text: "Les photos de dimanche !",
    attachments: [{ name: "rando-1.jpg", size: 3100000 }, { name: "rando-2.jpg", size: 2900000 }, { name: "rando-3.jpg", size: 3400000 }] });
  add({ from: P.me_p, to: [P.julie], date: at(1, 20, 31), account: "perso", folder: "perso/sent",
    subject: "Re: Photos de la rando", text: "Superbes, merci ! La dernière est à encadrer." });
  add({ from: P.julie, to: [P.me_p], date: at(0, 7, 58), account: "perso", folder: "perso/inbox", read: false,
    subject: "Re: Photos de la rando", text: "Haha je t'en imprime une. Dîner samedi chez moi ?" });

  // --- Administratif ---
  add({ from: P.ed, to: [P.me_l], date: at(9, 16, 0), account: "labo", folder: "labo/archives",
    subject: "Comité de suivi individuel : à programmer avant le 15 décembre",
    text: "Madame, Monsieur,\n\nNous vous rappelons que le comité de suivi individuel doit se tenir avant le 15 décembre. Merci de déposer le rapport sur l'espace numérique au moins une semaine avant la réunion.\n\nPour rappel, le comité réunit deux membres extérieurs à l'encadrement, dont un spécialiste du domaine et un non-spécialiste. Le rapport doit présenter l'avancement des travaux, les formations suivies et le calendrier prévisionnel jusqu'à la soutenance.\n\nCordialement,\nLe service de scolarité" });

  // --- Liste de diffusion ---
  add({ from: P.paul, to: [P.seminar], date: at(7, 10, 0), account: "labo", folder: "labo/listes",
    listId: "<seminaires.lists.univ.example>", listName: "Séminaires astro",
    subject: "[sem-astro] Jeudi : imagerie à haut contraste",
    text: "Bonjour à toutes et à tous,\n\nJeudi à 11h, amphi B : Nina Rossi présentera ses travaux sur l'imagerie à haut contraste.\n\nPaul" });
  add({ from: P.nina, to: [P.seminar], date: at(2, 17, 45), account: "labo", folder: "labo/listes",
    listId: "<seminaires.lists.univ.example>", listName: "Séminaires astro",
    subject: "[sem-astro] Transparents de jeudi",
    text: "Merci pour vos questions ! Les transparents sont en pièce jointe.",
    attachments: [{ name: "rossi-haut-contraste.pdf", size: 8200000 }] });

  // --- Infolettres ---
  add({ from: P.news, to: [P.me_p], date: at(3, 7, 0), account: "perso", folder: "perso/inbox", isNewsletter: true,
    subject: "Novembre : les Léonides et une comète tardive",
    text: "Ce mois-ci, le pic des Léonides tombe la nuit du 17. Nous vous expliquons où regarder et à quelle heure." });
  add({ from: P.shop, to: [P.me_p], date: at(0, 6, 12), account: "perso", folder: "perso/promos", isNewsletter: true,
    subject: "-30 % sur les éclairages", text: "Les nuits raccourcissent : profitez de -30 % sur tous les éclairages." });

  // --- Notes a soi ---
  add({ from: P.me_l, to: [P.me_p], date: at(8, 22, 10), account: "labo", folder: "labo/sent",
    subject: "idée", text: "Tester le recuit des guides avant la caractérisation du prochain composant." });
  add({ from: P.me_p, to: [P.me_p], date: at(0, 9, 30), account: "perso", folder: "perso/sent",
    subject: "liste", text: "Racheter de la pâte thermique.\nRéserver le train pour le 20." });

  global.MaterialChatDemo = {
    accounts: ACCOUNTS,
    contacts: CONTACTS,
    messages: M
  };
})(typeof window !== "undefined" ? window : globalThis);
