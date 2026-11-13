# Vue messagerie : proposition et prototype

Branche locale `prototype/chat-view`, rien de branché dans le manifeste : la vue ne s'installe pas encore avec le `.xpi`.

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

- Adresse d'envoi : celle qui a reçu le dernier message (modifiable).
- Groupe : « À tout le groupe » ou « À X seulement » ; une réponse privée bascule dans la conversation directe.
- Sujet : celui du dernier message, en « Re: ».
- Prototype : la réponse ouvre la fenêtre de rédaction de Thunderbird préremplie (`compose.beginReply`). Envoi direct
  depuis la vue (`compose.sendMessage`) à décider.

## Technique

- `shared/conversations.js` : moteur pur, testé (`tests/conversations.test.js`).
- `chat/source-thunderbird.js` : lecture par l'API MailExtension, **pas encore exécutée dans Thunderbird**.
  En-têtes seuls pour la liste (`messages.query` par dossier, TB 121+), corps et en-têtes de fil à l'ouverture
  (`getFull`, `listInlineTextParts` TB 128+). Il faudrait donc **TB 128 minimum** pour cette vue (le thème reste 115+,
  la vue se désactive en dessous).
- Limite : `MessageHeader` ne donne ni References ni In-Reply-To. Sans eux la liste ne peut rattacher les fils de
  groupe qu'à l'ouverture. Solution envisagée : les lire dans la base des messages par l'experiment
  `materialAssistant` (nsIMsgDBHdr), sans ouvrir chaque courriel. Index mis en cache (`storage.local`) et tenu à jour
  par `messages.onNewMailReceived`.
- Permissions en plus : `accountsRead`, `addressBooks`, `compose` (+ `compose.send` si envoi direct).
- Intégration : déclarer l'espace dans `background.js`, copier les jetons dans `chat/tokens/` au build,
  exclure `mock-data.js` et ce README du `.xpi`.

## Questions ouvertes

1. Envoi direct depuis la vue, ou toujours passer par la fenêtre de rédaction ?
2. Ouvrir une conversation la marque-t-elle comme lue (comme une messagerie) ?
3. Citation : la réponse envoyée doit-elle inclure le message cité (usage courriel) ou non (usage messagerie) ?
4. Fusion manuelle de deux personnes ou de deux groupes, en plus du carnet d'adresses ?
5. Pièces jointes : simples étiquettes, ou vignettes pour les images ?
