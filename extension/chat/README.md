# Vue messagerie : proposition et prototype

Branche locale `prototype/chat-view`, non poussée. La vue est branchée : le `.xpi` construit sur cette branche ajoute un
espace « Discussions » dans la barre des espaces (testé dans Thunderbird 160).

Essayer la maquette (données fictives) :

```
python -m http.server 8767 --directory D:/Material-Thunderbird
```

puis <http://localhost:8767/extension/chat/chat.html?demo>.

## Ce que fait la vue

Une deuxième façon de lire ses courriels, à côté de la vue classique : un onglet « Discussions » ouvert depuis la
barre des espaces (`spaces.create`, TB 114+), avec à gauche les conversations et à droite des bulles, façon Google
Messages. La vue classique reste la référence : chaque bulle peut s'y ouvrir (`messageDisplay.open`).

## Décisions de regroupement (shared/conversations.js)

| Cas | Conversation | Pourquoi |
|---|---|---|
| Un seul autre participant | **Directe** avec cette personne, tous fils, sujets et comptes confondus | C'est ce qu'on attend d'une messagerie : une personne, un fil |
| Plusieurs autres participants | **Groupe** qui suit le fil de courriels (References / In-Reply-To) | Les destinataires changent en route ; le fil, lui, reste le même |
| Deux fils distincts avec exactement les mêmes personnes | Un seul groupe, une ligne « Sujet : … » à chaque nouveau sujet | L'équipe qui s'écrit chaque semaine sur un sujet différent |
| Réponse privée dans un fil de groupe | Part dans la conversation **directe** | Même règle que WhatsApp : qui lit décide où ça va |
| Liste de diffusion (List-Id + List-Post) | Une conversation par liste | Comme un salon |
| Infolettre (`classifyMessage`, déjà dans le thème) | Une par expéditeur, **lecture seule**, bouton Se désinscrire ; masquables | Elles noieraient les vraies discussions |
| Courriel à soi-même | « Notes à soi » | Comme WhatsApp |

**Personne** = un contact du carnet (toutes ses adresses réunies) ou, à défaut, une adresse. **Vous** = toutes les
identités de tous les comptes choisis.

**Membres qui changent** :

- quelqu'un apparaît dans les destinataires → ligne « Bruno a ajouté Karim » ;
- un message qui oublie un membre ne le retire pas : il porte la mention « sans Sam » (cas typique : la surprise
  d'anniversaire) ;
- un membre oublié par deux messages de suite est retiré, et la ligne « Vous avez retiré Bruno » est placée avant le
  premier des deux ;
- le panneau Détails liste les membres actuels, les anciens, les comptes et dossiers concernés.

**Texte affiché** : seulement la partie nouvelle (citations « Le … a écrit : », lignes `>`, en-têtes Outlook et
signature `-- ` retirés), coupé à 8 lignes avec « Afficher la suite ».

## Sources (bouton réglages)

Comptes et dossiers cochés un par un, Envoyés compris (sans eux, pas de bulles à vous). Par défaut : tout sauf
indésirables, corbeille, brouillons, modèles et boîte d'envoi. Période : 3, 6, 12 mois ou tout. Quand une
conversation mêle plusieurs comptes, une étiquette de compte apparaît sur la bulle chaque fois que le compte change,
et des pastilles de couleur dans la liste.

## Répondre

- Envoi direct depuis la vue (`compose.beginReply` puis `compose.sendMessage`) : la fenêtre de rédaction s'ouvre le
  temps de l'envoi ; en cas d'échec elle reste ouverte avec le texte.
- Pas de citation dans le courriel : la vue affiche « en réponse à » (bouton Répondre au survol d'une bulle), comme
  WhatsApp et Google Messages. Cliquer sur la citation mène au message, même dans une autre conversation.
- Adresse d'envoi : celle qui a reçu le dernier message (modifiable).
- Groupe : « À tout le groupe » écrit aux membres actuels (pas aux destinataires d'alors du message cité, qui peuvent
  inclure un membre retiré), ou « À X seulement », qui bascule dans la conversation directe.

## Autres choix

- Ouvrir une conversation marque ses messages comme lus (réglable). C'est, avec l'envoi, la seule écriture de la vue.
- Images jointes en vignettes ; les images de moins de 30 ko (logos de signature) sont ignorées.
- Fusion à la main dans le panneau Détails : « Même personne que… » et « Fusionner avec le groupe… », annulables.
- Deux groupes qui finissent avec les mêmes membres sont réunis automatiquement.
- « Vous » : identités des comptes, expéditeurs des dossiers Envoyés, adresses portant le nom complet d'une identité,
  et « Mes autres adresses » (réglages, ou bouton « C'est moi » sur un membre).
- Doublons (même Message-ID dans deux dossiers, Gmail « Tous les messages ») affichés une fois.

## Technique

- `shared/conversations.js` : moteur pur, testé (`tests/conversations.test.js`).
- `chat/source-thunderbird.js` : en-têtes par `messages.query` (TB 121+), References lues dans la base des messages par
  l'experiment (`materialAssistant.getThreadInfo`), texte et List-Id à l'ouverture puis en tâche de fond pour les
  400 messages les plus récents (`getFull` sans décodage, `listInlineTextParts` TB 128+).
- Permissions ajoutées : `accountsRead`, `addressBooks` (lecture seule dans le code), `compose`, `compose.send`,
  `messagesUpdate` (état lu), `storage` (réglages de la vue).
- L'experiment masque la barre d'adresse de l'onglet (`hideTabToolbar`).
- `build.ps1` copie les jetons dans `chat/tokens/` (ignoré par git) et laisse `mock-data.js` et ce README hors du `.xpi`.

## Reste à faire

- Mise en cache de l'index (`storage.local`) et mise à jour par `messages.onNewMailReceived` : aujourd'hui tout est
  relu à chaque ouverture de l'onglet (environ 10 s pour 9 000 courriels).
- Envoi non testé sur de vrais courriels (volontairement), marquage lu non testé non plus.
- Bouton « Se désinscrire » des infolettres pas encore relié au bandeau existant.
- Repasser `strict_min_version` ou désactiver la vue sous TB 128.
