# Guide d'installation de Material-Thunderbird

Material-Thunderbird est une extension Thunderbird : un seul fichier `.xpi` installe le thème
Material You, les boutons de personnalisation et de don, et l'assistant de désinscription.
Aucun script, aucune préférence à modifier, aucun fichier à copier dans le profil.

---

## Compatibilité

- **Mozilla Thunderbird** : 115+ (Supernova), 128+ (Nebula) et versions supérieures.
- **Systèmes d'exploitation** : Windows, macOS et Linux.

---

## Installer

1. Téléchargez **`material-thunderbird.xpi`** depuis le
   [site du projet](https://vforiel.github.io/Material-Thunderbird/).
2. Ouvrez-le avec Thunderbird : double-clic sur le fichier, ou glisser-déposer dans la fenêtre
   de Thunderbird. À défaut : **Paramètres** > **Modules complémentaires et thèmes**
   (`Ctrl + Maj + A`), roue crantée > **Installer un module depuis un fichier...**
3. Confirmez avec **Ajouter**.

Le thème s'applique aussitôt, sans redémarrage. Les versions suivantes s'installent ensuite
toutes seules : Thunderbird vérifie chaque jour le fichier `updates.json` publié sur le site.

> [!NOTE]
> Thunderbird prévient que le module aura « un accès complet et illimité ». C'est le cas de toute
> extension qui modifie l'interface de Thunderbird elle-même : l'extension n'envoie aucune donnée
> personnelle. Seuls les logos des marques sont téléchargés depuis le site de l'expéditeur
> (option désactivable, voir [CUSTOMIZATION.md](CUSTOMIZATION.md#2-avatars)).

---

## Personnaliser

Bouton palette dans la barre de gauche (au-dessus de la roue des paramètres), raccourci **`Alt+M`**,
ou **Outils > Personnaliser le thème Material (M3)...** : mode clair / sombre / système, couleur
d'accent, thème d'icônes (défaut, émojis ou moderne), avatars, fils de discussion et bandeau de désinscription. Les changements
s'appliquent immédiatement à toutes les fenêtres.

---

## Désinstaller

Au choix :
- dans la fenêtre de personnalisation, **Désinstaller…** ;
- dans le gestionnaire de modules (`Ctrl + Maj + A`), menu **…** de *Material You Thunderbird* >
  **Supprimer**.

Thunderbird retrouve aussitôt son apparence d'origine, y compris son mode clair / sombre.

---

## Vous aviez installé une ancienne version par script

Les versions précédentes s'installaient avec `Installer-Material-Thunderbird.bat`, qui copiait les
styles dans le dossier `chrome/` du profil et déclarait l'extension dans une politique de
Thunderbird. Pour passer à l'extension seule :

1. Installez le nouveau `.xpi` comme indiqué plus haut.
2. Dans la fenêtre de personnalisation, **Désinstaller…** retire aussi les fichiers que l'ancien
   script avait copiés dans le profil, puis propose de redémarrer. Réinstallez ensuite le `.xpi`.
3. Si l'ancien script avait déclaré l'extension par politique, supprimez, avec les droits
   administrateur, les fichiers `policies.json` et `material-thunderbird.xpi` du dossier
   `C:\Program Files\Mozilla Thunderbird\distribution\` : sinon Thunderbird réinstalle
   l'ancienne version à chaque démarrage et empêche sa suppression.

---

## Dépannage

### Le thème ne s'applique pas
Vérifiez dans le gestionnaire de modules (`Ctrl + Maj + A`) que *Material You Thunderbird* est
installé et activé.

### La liste des messages n'est pas sous forme de cartes
Cliquez sur le bouton de disposition en haut de la liste des messages et choisissez **Cartes**.
