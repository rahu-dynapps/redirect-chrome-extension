# Redirection de domaines — extension Chrome

Redirige automatiquement certains noms de domaine vers un autre **en conservant le chemin, les
paramètres de requête et l'ancre** de l'URL.

Cas d'usage d'origine : dans Odoo, une base est accessible via l'URL de base fournie par Odoo.sh
(`client-prod-1234.odoo.com`) alors que les utilisateurs communiquent des liens contenant l'alias du
client (`odoo.client.fr`). L'extension réécrit l'hôte à la volée :

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

## Utilisation

### Page d'options

- **Ajouter une redirection** : domaine source (l'alias) → domaine cible. Les deux champs acceptent
  aussi bien `odoo.client.fr` qu'une URL complète collée depuis un mail : seul l'hôte est conservé.
- **Inclure les sous-domaines** : `*.odoo.client.fr` est redirigé vers le domaine cible.
- **Forcer HTTPS** : les URL en `http://` sont redirigées vers `https://`.
- **Rediriger aussi les iframes** : par défaut, seule la navigation principale est redirigée, ce qui
  évite de casser les contenus intégrés.
- **Ordre** : la première redirection dont le domaine source correspond l'emporte ; les flèches ↑ ↓
  permettent de réordonner.
- **Tester une URL** : colle une URL et affiche la destination calculée, sans naviguer.
- **Exporter / Importer** : partage des redirections au format JSON avec un collègue.

Les redirections sont enregistrées dans `chrome.storage.sync` : elles suivent le profil Chrome.

### Popup (icône de la barre d'outils)

- État de l'onglet courant (domaine, redirection appliquée ou non).
- **Ouvrir `alias` sans redirection** : accède au domaine source sans être redirigé — utile pour
  consulter l'alias lui-même. La dérogation ne vaut que pour cet onglet et disparaît à sa fermeture.
- **Rediriger ce domaine vers…** : crée une redirection pré-remplie avec le domaine affiché.
- Interrupteur global pour suspendre toutes les redirections (badge `OFF` sur l'icône).

## Fonctionnement

L'extension utilise l'API `declarativeNetRequest` : Chrome applique les règles lui-même, avant même
que la requête ne parte. L'extension ne lit ni ne modifie le contenu des pages, et ne voit pas
l'historique de navigation.

Chaque redirection produit une règle dynamique de ce type :

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

### Autorisations

- `declarativeNetRequest` : appliquer les règles de redirection.
- `storage` : enregistrer les redirections.
- `tabs` : connaître l'URL de l'onglet actif pour le popup.
- Accès aux sites : **demandé à la carte**, uniquement pour les domaines source et cible de chaque
  redirection. Chrome exige l'accès aux deux. Une redirection sans autorisation est signalée en
  orange dans la page d'options avec un bouton « Autoriser ».

### Limites connues

- Les pages internes (`chrome://`, Chrome Web Store) ne peuvent pas être redirigées.
- Seuls `http://` et `https://` sont pris en charge.
- Le domaine source doit être un nom d'hôte (pas de motif sur le chemin) ; utilisez l'option
  sous-domaines pour couvrir plusieurs hôtes.
- Maximum 200 redirections.

## Développement

```bash
npm test                 # tests unitaires de la logique de règles (node:test)
python3 tools/make_icons.py   # régénère les icônes PNG
```

Structure :

```
manifest.json            # MV3
src/background.js        # service worker : synchronise les règles, gère la dérogation par onglet
src/lib/rules.js         # logique pure (parsing, règles DNR, prévisualisation) — testée
src/lib/storage.js       # accès à chrome.storage.sync
src/options/             # page d'options
src/popup/               # popup de la barre d'outils
test/rules.test.js       # tests
tools/make_icons.py      # génération des icônes
```

Toute la logique de correspondance vit dans `src/lib/rules.js`, sans dépendance aux API `chrome.*`,
afin d'être couverte par les tests.
