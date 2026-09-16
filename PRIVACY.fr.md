# Politique de confidentialité — Redirection de domaines et lanceur

*[English version](PRIVACY.md)*

_Dernière mise à jour : 16 septembre 2026_

## En résumé

L'extension **ne collecte, ne transmet et ne revend aucune donnée**. Elle ne contient ni traceur, ni
outil de mesure d'audience, ni serveur distant. Tout ce qu'elle manipule reste dans votre navigateur.

## Données traitées et lieu de stockage

L'extension enregistre uniquement ce que vous saisissez vous-même dans sa page d'options :

| Donnée | Exemple | Stockage |
| --- | --- | --- |
| Redirections | `helpdesk.example.com` → `app-1234.hosting.example.com` | `chrome.storage.sync` |
| Environnements | `https://app-1234.hosting.example.com` | `chrome.storage.sync` |
| Recherches | `Ticket` → `/tickets/{q}` | `chrome.storage.sync` |
| Préférences | dernier environnement utilisé, mode d'ouverture | `chrome.storage.sync` |

`chrome.storage.sync` est le stockage de Chrome : ces données restent dans votre profil et sont
synchronisées entre vos appareils **par Chrome lui-même**, si vous avez activé la synchronisation.
Elles ne transitent par aucun serveur de l'éditeur de l'extension, qui n'y a aucun accès.

Aucun historique de navigation n'est enregistré. Les valeurs saisies dans le lanceur (numéros de
ticket, identifiants) servent à construire l'URL puis sont oubliées : elles ne sont jamais stockées.

## Pourquoi les autorisations demandées

- **`declarativeNetRequest`** — applique les redirections. Les règles sont évaluées par Chrome
  lui-même ; l'extension ne voit pas les requêtes réseau, ne les lit pas et ne les journalise pas.
- **`storage`** — enregistrer votre configuration (tableau ci-dessus).
- **`tabs`** — lire l'adresse de l'onglet actif pour afficher son état dans le popup, et ouvrir
  l'URL construite par le lanceur. Le contenu des pages n'est jamais lu.
- **Accès aux sites** — demandé **à la carte**, uniquement pour les domaines source et cible que
  vous saisissez, au moment où vous créez une redirection. Chrome exige l'accès aux deux pour
  autoriser la réécriture. Aucun accès n'est demandé pour l'ensemble du Web.

L'extension n'injecte aucun script dans les pages que vous consultez.

## Suppression des données

Supprimer une entrée dans la page d'options la supprime du stockage. Désinstaller l'extension
supprime l'intégralité de la configuration.

## Modifications

Toute évolution de cette politique sera publiée dans ce fichier, dans le dépôt du projet.

## Contact

Pour toute question relative à cette politique : **rdefrob@gmail.com**

Dépôt du projet : https://github.com/rahu-dynapps/redirect-chrome-extension
