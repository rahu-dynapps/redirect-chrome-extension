# Redirection de domaines + lanceur de recherche — extension Chrome

Extension Chrome (Manifest V3) qui rend deux services au quotidien :

1. **Redirection de domaines** — réécrit l'hôte d'une URL **en conservant le chemin, les paramètres de
   requête et l'ancre**.
2. **Lanceur de recherche** — un raccourci clavier ouvre une petite fenêtre : on saisit un numéro de
   ticket (ou tout autre identifiant), la page correspondante s'ouvre sur l'environnement choisi.

Cas d'usage d'origine : dans Odoo, une base est accessible via l'URL de base fournie par Odoo.sh
(`client-prod-1234.odoo.com`) alors que les utilisateurs communiquent des liens contenant l'alias du
client (`odoo.client.fr`).

```
https://odoo.client.fr/odoo/action-42?debug=assets#id=7
        ↓
https://client-prod-1234.odoo.com/odoo/action-42?debug=assets#id=7
```

## Installation

1. Cloner ou télécharger ce dépôt.
2. Ouvrir `chrome://extensions` et activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier du dépôt.
4. La page d'options s'ouvre automatiquement à la première installation : ajouter une redirection,
   puis accepter la demande d'autorisation d'accès aux deux domaines.

Fonctionne également sur Edge, Brave, Opera et les autres navigateurs basés sur Chromium (≥ 108).

## 1. Redirections

### Page d'options → onglet « Redirections »

- **Ajouter une redirection** : domaine source (l'alias) → domaine cible. Les deux champs acceptent
  aussi bien `odoo.client.fr` qu'une URL complète collée depuis un mail : seul l'hôte est conservé.
- **Inclure les sous-domaines** : `*.odoo.client.fr` est redirigé vers le domaine cible.
- **Forcer HTTPS** : les URL en `http://` sont redirigées vers `https://`.
- **Rediriger aussi les iframes** : par défaut, seule la navigation principale est redirigée, ce qui
  évite de casser les contenus intégrés.
- **Ordre** : la première redirection dont le domaine source correspond l'emporte ; les flèches ↑ ↓
  permettent de réordonner.
- **Tester une URL** : colle une URL et affiche la destination calculée, sans naviguer.

### Popup (icône de la barre d'outils)

- État de l'onglet courant (domaine, redirection appliquée ou non).
- **Ouvrir `alias` sans redirection** : accède au domaine source sans être redirigé — utile pour
  consulter l'alias lui-même. La dérogation ne vaut que pour cet onglet et disparaît à sa fermeture.
- **Rediriger ce domaine vers…** : crée une redirection pré-remplie avec le domaine affiché.
- Interrupteur global pour suspendre toutes les redirections (badge `OFF` sur l'icône).

### Fonctionnement

L'extension utilise l'API `declarativeNetRequest` : Chrome applique les règles lui-même, avant même
que la requête ne parte. L'extension ne lit ni ne modifie le contenu des pages.

```jsonc
{
  "action": { "type": "redirect", "redirect": { "transform": { "host": "client-prod-1234.odoo.com" } } },
  "condition": {
    "regexFilter": "^https?://odoo\\.client\\.fr(?::\\d+)?(?:[/?#].*)?$",
    "resourceTypes": ["main_frame"]
  }
}
```

`transform.host` ne remplace que l'hôte : chemin, paramètres et ancre sont conservés tels quels
(l'ancre n'est pas envoyée au serveur, le navigateur la réapplique à l'URL de destination — les liens
Odoo du type `#id=42&model=res.partner` restent donc valides).

## 2. Lanceur de recherche

<kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>O</kbd> (modifiable, voir plus bas) ouvre une petite fenêtre :

```
┌──────────────────────────────────────────────┐
│  1234                                        │
│  Recherche : Ticket (t)   Environnement : Prod │
│  → https://client-prod-1234.odoo.com/odoo/helpdesk/1234 │
└──────────────────────────────────────────────┘
```

- <kbd>Entrée</kbd> ouvre l'URL dans un nouvel onglet, <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> dans
  l'onglet actif (l'ordre par défaut est réglable dans les options), <kbd>Échap</kbd> ferme.
- <kbd>Alt</kbd>+<kbd>1…9</kbd> bascule d'environnement sans lâcher le clavier.
- Un **mot-clé** en préfixe choisit la recherche : `t 1234` ouvre le ticket 1234, `c 57` la fiche
  contact 57, quelle que soit la recherche sélectionnée dans la liste.
- L'URL finale est prévisualisée en direct sous le champ de saisie.

### Environnements

Un environnement est une **URL de base** : `https://client-prod-1234.odoo.com`, une base de test,
un poste local `http://localhost:8069`… Un préfixe de chemin est accepté
(`https://erp.client.fr/odoo`). Le lanceur mémorise le dernier environnement utilisé.

### Recherches

Une recherche est un **modèle d'URL contenant `{q}`**, remplacé par la valeur saisie (encodée) :

| Recherche            | Modèle                                                   |
| -------------------- | -------------------------------------------------------- |
| Ticket (Odoo 17+)    | `/odoo/helpdesk/{q}`                                      |
| Contact (Odoo 17+)   | `/odoo/contacts/{q}`                                      |
| Ticket (Odoo ≤ 16)   | `/web#id={q}&model=helpdesk.ticket&view_type=form`        |
| Recherche texte      | `/odoo/contacts?search={q}`                               |
| Outil externe        | `https://support.example.com/t/{q}` (modèle absolu)       |

- Un modèle **relatif** est ajouté à l'environnement sélectionné ; un modèle **absolu**
  (`https://…`) ignore l'environnement.
- Chaque recherche peut **épingler un environnement** : utile pour une recherche qui n'a de sens que
  sur un environnement précis (supervision, outil tiers…).
- Trois recherches d'exemple sont créées à la première installation ; elles sont modifiables et
  supprimables.

### Choisir ses raccourcis clavier

Le bouton **« Configurer les raccourcis dans Chrome »** (onglet « Lanceur ») ouvre
`chrome://extensions/shortcuts`, où n'importe quelle combinaison peut être attribuée :

- `Ouvrir le lanceur de recherche` — <kbd>Alt</kbd>+<kbd>Maj</kbd>+<kbd>O</kbd> par défaut ;
- `Raccourci rapide 1 à 3` — sans touche par défaut. Chacun s'associe dans les options à une
  recherche et à un environnement, et ouvre le lanceur directement dessus : par exemple
  <kbd>Alt</kbd>+<kbd>T</kbd> pour « Ticket sur la production ».

## Autorisations

- `declarativeNetRequest` : appliquer les règles de redirection.
- `storage` : enregistrer redirections, environnements et recherches (synchronisés avec le compte
  Chrome).
- `tabs` : connaître l'URL de l'onglet actif (popup) et ouvrir l'URL construite par le lanceur.
- Accès aux sites : **demandé à la carte**, uniquement pour les domaines source et cible de chaque
  redirection. Chrome exige l'accès aux deux. Une redirection sans autorisation est signalée en
  orange dans la page d'options avec un bouton « Autoriser ». Le lanceur, lui, ne nécessite aucune
  autorisation de site.

## Limites connues

- Les pages internes (`chrome://`, Chrome Web Store) ne peuvent pas être redirigées.
- Seuls `http://` et `https://` sont pris en charge.
- Le domaine source d'une redirection doit être un nom d'hôte (pas de motif sur le chemin) ;
  utilisez l'option sous-domaines pour couvrir plusieurs hôtes.
- Chrome limite le nombre de raccourcis proposés par défaut : les raccourcis rapides doivent être
  attribués manuellement.
- Maximum 200 redirections, 30 environnements, 50 recherches.

## Développement

```bash
npm test                      # tests unitaires de la logique pure (node:test)
python3 tools/make_icons.py   # régénère les icônes PNG
```

```
manifest.json            # MV3 : permissions, commandes clavier
src/background.js        # service worker : règles DNR, dérogation par onglet, fenêtre du lanceur
src/lib/rules.js         # logique pure des redirections (parsing, règles DNR, prévisualisation)
src/lib/launcher.js      # logique pure du lanceur (environnements, recherches, construction d'URL)
src/lib/storage.js       # accès à chrome.storage.sync
src/options/             # page d'options (onglets Redirections / Lanceur)
src/popup/               # popup de la barre d'outils
src/launcher/            # petite fenêtre du lanceur
test/                    # tests des deux modules de logique
tools/make_icons.py      # génération des icônes
```

Toute la logique de correspondance et de construction d'URL vit dans `src/lib/`, sans dépendance aux
API `chrome.*`, afin d'être couverte par les tests.
