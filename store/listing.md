# Fiche Chrome Web Store — textes prêts à coller

Tout ce qui est demandé par le [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
dans l'ordre des champs du formulaire. Les blocs entre guillemets se collent tels quels.

> ✏️ = à compléter ou à décider avant l'envoi.

---

## 0. Stratégie de distribution recommandée

L'extension n'a rien de spécifique à un client : le besoin (atteindre la bonne URL d'une instance
métier depuis un alias, ouvrir un ticket par son numéro) est partagé par tous les intégrateurs. Une
diffusion publique se défend donc, mais en **deux temps** plutôt que d'emblée.

**Étape 1 — publier en « non répertoriée ».** Même une extension non répertoriée passe la revue
Google : l'étape valide donc tout le circuit (compte, archive, justifications, politique de
confidentialité) avec un enjeu faible. On installe par lien, on essuie les plâtres en interne
pendant quelques semaines, on corrige.

**Étape 2 — basculer en « publique »** depuis le même élément, une fois la configuration stabilisée
et les retours internes intégrés. Aucune perte : les utilisateurs déjà installés gardent l'extension
et ses mises à jour.

### Ce qu'il faut préparer en plus pour une diffusion publique

- **Compte propriétaire.** Une fiche publique affiche le nom du compte comme éditeur. Un compte
  Google Workspace Dynapps permet de faire **vérifier le domaine** et d'afficher `dynapps.fr` comme
  éditeur — nettement plus crédible qu'un compte personnel, et l'extension reste à l'entreprise si
  son auteur change de poste. À arbitrer selon que l'extension est un projet Dynapps ou personnel :
  le choix est difficile à défaire après publication (le transfert d'un élément entre comptes est
  laborieux).
- **Langue de la fiche.** Le nom et la fiche sont en français ; le public visé (intégrateurs Odoo)
  est largement international. Deux options : ajouter une fiche localisée en anglais dans le
  dashboard, et/ou internationaliser l'extension elle-même (`_locales/fr` + `_locales/en`,
  `default_locale` dans le manifest, libellés via `chrome.i18n.getMessage`). Un nom anglais ou
  neutre élargit l'audience.
- **Marque Odoo.** Ne **pas** faire figurer « Odoo » dans le nom de l'extension : c'est une marque
  déposée d'Odoo S.A. La mentionner dans la description pour décrire une compatibilité est usuel, à
  condition de ne laisser entendre aucune affiliation. Ajouter en fin de description :
  > Extension indépendante, sans lien ni affiliation avec Odoo S.A.
- **Support.** Une fiche publique amène avis, demandes et rapports de bugs. Prévoir où ils
  atterrissent (issues GitHub plutôt qu'une boîte mail personnelle) et le mentionner dans la fiche.
- **Dépôt public.** La politique de confidentialité doit être accessible par une URL publique. Si le
  dépôt est privé, GitHub Pages n'est pas disponible sans plan payant : le rendre public est le plus
  simple, et l'ouverture du code est un argument de confiance pour une extension qui manipule des
  URL.

## 1. Avant de commencer

- [ ] Compte Google **d'entreprise** (pas personnel) : c'est lui qui possédera l'extension.
- [ ] Validation en deux étapes activée sur ce compte.
- [ ] Frais d'inscription développeur payés (**5 $**, une seule fois).
- [ ] ✏️ Visibilité décidée :
  - **Non répertoriée** *(recommandé pour un usage interne)* : installable par lien uniquement.
  - **Publique** : référencée dans le store, revue la plus stricte.
  - **Privée** : réservée au domaine Google Workspace, nécessite de rattacher le compte au Workspace.
- [x] Adresse e-mail de contact : **rdefrob@gmail.com** (renseignée dans `PRIVACY.md`, à saisir aussi dans le champ « Adresse e-mail du développeur » de la fiche — elle y est **affichée publiquement**).
- [ ] `PRIVACY.md` publié à une **URL publique** (GitHub Pages, site Dynapps…) : l'URL est demandée
      dans l'onglet Confidentialité.

## 2. Archive à envoyer

```bash
npm run package      # produit dist/redirection-de-domaines-v<version>.zip
```

Le script refuse l'empaquetage si le manifest sort des limites du store (nom, description, version,
icônes, fichier manquant, code distant). L'archive ne contient que `manifest.json`, `icons/` et
`src/` — ni tests, ni outils, ni dépôt git.

À chaque mise à jour : incrémenter `version` dans `manifest.json`, relancer `npm run package`,
envoyer la nouvelle archive.

## 3. Fiche du store

**Nom** (23/75 caractères)

> Redirection de domaines

**Description courte** (115/132 caractères — reprise du manifest)

> Redirige des domaines en conservant chemin et paramètres, et ouvre un ticket ou une fiche via un raccourci clavier.

**Catégorie** : Workflow et planification — **Langue** : Français

**Description détaillée**

> Deux gestes quotidiens, une seule finalité : arriver plus vite sur la bonne page de votre outil métier.
>
> ▸ REDIRECTION DE DOMAINES
> Vos utilisateurs vous envoient des liens contenant un alias, alors que vous travaillez sur l'URL technique de l'instance (ou l'inverse). L'extension réécrit le domaine à la volée et conserve tout le reste : chemin, paramètres de requête et ancre.
>
> https://odoo.client.fr/odoo/action-42?debug=assets#id=7
> devient
> https://client-prod-1234.odoo.com/odoo/action-42?debug=assets#id=7
>
> • Autant de redirections que nécessaire, activables une par une
> • Option sous-domaines, forçage HTTPS, prise en compte des iframes
> • Test d'une URL sans naviguer
> • Dérogation ponctuelle : ouvrir le domaine d'origine sans être redirigé, pour cet onglet seulement
>
> ▸ LANCEUR DE RECHERCHE
> Un raccourci clavier ouvre une petite fenêtre. Vous tapez un numéro de ticket ou un identifiant, la page correspondante s'ouvre sur l'environnement choisi.
>
> • Modèles d'URL personnalisables : /odoo/helpdesk/{q}, /odoo/contacts/{q}, ou n'importe quel outil interne
> • Plusieurs environnements (production, test, poste local), basculables au clavier
> • Mots-clés : « t 1234 » ouvre le ticket 1234, « c 57 » la fiche contact 57
> • Raccourci entièrement configurable, plus trois raccourcis directs vers une recherche précise
>
> ▸ RESPECT DE LA VIE PRIVÉE
> Aucune donnée collectée, aucun traceur, aucun serveur. Les redirections sont appliquées par Chrome lui-même (declarativeNetRequest) : l'extension ne lit ni le contenu des pages, ni votre historique. L'accès aux sites est demandé domaine par domaine, au moment où vous créez une redirection.

**Finalité unique** (champ « Single purpose »)

> L'extension a une finalité unique : amener l'utilisateur sur la bonne URL de son outil métier, soit en corrigeant le domaine d'une URL existante, soit en construisant l'URL à partir d'un identifiant saisi. Les deux fonctionnalités partagent la même configuration de domaines et le même objectif de navigation.

## 4. Justification des autorisations

À coller dans l'onglet « Confidentialité » → « Justification des autorisations ».

**`declarativeNetRequest`**

> Cœur de la fonctionnalité : appliquer les règles de redirection de domaine définies par l'utilisateur. Cette API laisse Chrome évaluer les règles lui-même ; l'extension ne lit pas les requêtes réseau et n'y a pas accès.

**`storage`**

> Enregistrer la configuration saisie par l'utilisateur : redirections, environnements, modèles de recherche et préférences d'affichage. Aucune donnée de navigation n'y est écrite.

**`tabs`**

> Lire l'URL de l'onglet actif pour indiquer dans le popup si une redirection s'applique et proposer la bonne action, et ouvrir l'URL construite par le lanceur dans l'onglet ou la fenêtre d'origine. Le contenu des pages n'est jamais lu.

**Autorisations d'accès aux sites (`*://*/*`, déclarées en optional_host_permissions)**

> Chrome exige l'accès au domaine source et au domaine cible pour autoriser une redirection. Ces domaines ne sont pas connus à l'avance : ils sont saisis par l'utilisateur. L'extension ne demande donc jamais l'accès à l'ensemble du Web à l'installation : elle demande l'autorisation domaine par domaine, au moment où l'utilisateur crée une redirection, via chrome.permissions.request. Aucun script n'est injecté dans les pages.

**Code hébergé à distance** : répondre **Non**. Tout le code est contenu dans l'archive ; aucune
bibliothèque externe, aucun CDN, aucun `eval`.

## 5. Déclarations de confidentialité

- **URL de la politique de confidentialité** : ✏️ l'URL publique de `PRIVACY.md`.
- **Utilisation des données** : ne cocher **aucune** catégorie (ni informations personnelles, ni
  santé, ni finances, ni authentification, ni communications personnelles, ni localisation, ni
  historique de navigation, ni activité utilisateur, ni contenu de site web). L'extension ne
  collecte rien.
- Cocher les trois attestations :
  - [ ] Je ne vends ni ne transfère les données à des tiers, hors cas d'usage approuvés.
  - [ ] Je n'utilise ni ne transfère les données à des fins sans rapport avec la finalité unique.
  - [ ] Je n'utilise ni ne transfère les données pour établir une solvabilité ou accorder des prêts.

## 6. Ressources graphiques

- [x] **Icône 128×128** — `icons/icon128.png`, déjà au format attendu.
- [ ] **Capture d'écran 1280×800** (au moins une, cinq au maximum) :
  1. la page d'options, onglet « Redirections », avec deux ou trois règles ;
  2. la fenêtre du lanceur avec la prévisualisation de l'URL ;
  3. le popup sur une page redirigée ;
  4. l'onglet « Lanceur » avec environnements et recherches.
- [ ] **Vignette promotionnelle 440×280** (facultative, améliore la présentation).

⚠️ **N'utilisez pas de noms ou de domaines de clients réels dans les captures.** Configurez des
exemples fictifs (`odoo.client.fr`, `client-prod-1234.odoo.com`) avant de photographier l'écran.

Pour produire une capture aux bonnes dimensions : ouvrir la page dans une fenêtre Chrome, DevTools
(F12) → icône « Toggle device toolbar » → dimensions personnalisées 1280×800 → menu ⋮ → « Capture
screenshot ».

## 7. Envoi et suivi

1. Developer Dashboard → **Nouvel élément** → envoyer le ZIP.
2. Remplir les onglets Fiche, Confidentialité, Distribution (visibilité choisie en §1).
3. **Envoyer pour examen.** Comptez de quelques heures à quelques jours ; une autorisation d'accès
   large peut allonger le délai.
4. En cas de refus, le motif précis est indiqué par e-mail : corriger, incrémenter la version,
   renvoyer.

## 8. Alternative sans store

Pour un déploiement strictement interne, la policy Chrome Enterprise `ExtensionInstallForcelist`
permet d'installer l'extension sur les postes gérés sans passer par le store public — à étudier avec
l'administrateur du parc si Dynapps gère ses navigateurs par GPO/Workspace.
