# Chrome Web Store listing — ready-to-paste copy

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for, in the
order of the form. Quoted blocks are pasted as is.

> ✏️ = still to be done or decided.

---

## 0. Distribution plan

Nothing here is specific to one customer: the need (reaching the right URL of a web app from an
alias, opening a record from its ID) is shared by anyone juggling several environments. A public
release makes sense, but **in two steps**.

**Step 1 — publish as “unlisted”.** Even an unlisted extension goes through Google's review, so this
step validates the whole pipeline (account, archive, justifications, privacy policy) with low
stakes. Install by link, iron out the wrinkles for a few weeks, fix.

**Step 2 — flip to “public”** from the same item, once the configuration is stable. Nothing is lost:
users who already installed it keep the extension and its updates.

**Decisions taken**

- Owner account: **personal Google account** (`rdefrob@gmail.com`). The listing will show that
  account as the publisher.
- Licence: **MIT** — see [`LICENSE`](../LICENSE).
- Repository: currently private, to be made **public once the extension works in the wild**. The
  privacy policy URL below depends on it.
- Languages: the extension ships **English (default) + French** via `_locales/`. The store listing
  should be filled in both languages too (§3).

## 1. Before you start

- [ ] Two-step verification enabled on the Google account.
- [ ] Developer registration fee paid (**$5**, one time).
- [x] Contact e-mail: **rdefrob@gmail.com** (already in `PRIVACY.md`; also goes into the listing's
      “Developer e-mail” field — it is **shown publicly** there).
- [ ] ✏️ Repository made public, then `PRIVACY.md` reachable at a **public URL** (GitHub Pages, or
      the rendered file on github.com). The URL is required in the Privacy tab.

## 2. The archive to upload

```bash
npm run package      # produces dist/domain-redirect-v<version>.zip
```

The script refuses to package when the manifest breaks a store limit (name, description, version,
icons, missing referenced file, remotely hosted code, translation key missing from the default
catalog). The archive only contains `manifest.json`, `icons/`, `src/` and `_locales/` — no tests, no
tooling, no git history.

For every update: bump `version` in `manifest.json`, run `npm run package` again, upload.

## 3. Listing

The dashboard holds one listing per language. Fill in **English** first (default), then add the
**French** one.

### English

**Name** (24/75 characters)

> Domain Redirect & Launch

**Short description** (110/132 — same as the manifest)

> Redirects domains while keeping path and parameters, and opens a page from a typed ID via a keyboard shortcut.

**Category**: Workflow & Planning

**Detailed description**

> Two everyday gestures, one purpose: getting to the right page of your web app faster.
>
> ▸ DOMAIN REDIRECT
> People send you links that use one domain, while you work on another — a public alias versus the technical URL of an instance, production versus a test environment. The extension rewrites the domain on the fly and keeps everything else: path, query string and fragment.
>
> https://helpdesk.example.com/tickets/42?debug=assets#tab=notes
> becomes
> https://app-1234.hosting.example.com/tickets/42?debug=assets#tab=notes
>
> • Two kinds of rule: swap the whole domain, or match a URL pattern — capture an ID from the path and rebuild a completely different target URL
> • As many redirects as you need, each one switchable
> • Options for subdomains, forcing HTTPS, and iframes
> • Test a URL without navigating
> • One-off bypass: open the original domain without being redirected, for that tab only
>
> ▸ SEARCH LAUNCHER
> A keyboard shortcut opens a small window. Type a ticket number or an identifier, and the matching page opens on the environment you picked.
>
> • Custom URL templates: /tickets/{q}, /contacts/{q}, or any internal tool
> • Several environments (production, test, local server), switchable from the keyboard
> • Keywords: “t 1234” opens ticket 1234, “c 57” contact 57
> • Fully configurable shortcut, plus three direct shortcuts to a specific search
>
> ▸ PRIVACY
> No data collected, no tracker, no server. Redirects are applied by Chrome itself (declarativeNetRequest): the extension reads neither your page content nor your history. Site access is requested one domain at a time, when you create a redirect.
>
> Available in English and French.

**Single purpose**

> The extension has a single purpose: taking the user to the right URL of their web application, either by fixing the domain of an existing URL, or by building the URL from an identifier they type. Both features share the same domain configuration and the same navigation goal.

### Français

**Nom** (34/75 caractères)

> Redirection de domaines et lanceur

**Description courte** (115/132)

> Redirige des domaines en conservant chemin et paramètres, et ouvre une page depuis un identifiant saisi au clavier.

**Catégorie** : Workflow et planification

**Description détaillée**

> Deux gestes quotidiens, une seule finalité : arriver plus vite sur la bonne page de votre application web.
>
> ▸ REDIRECTION DE DOMAINES
> On vous envoie des liens sur un domaine alors que vous travaillez sur un autre — un alias public face à l'URL technique d'une instance, la production face à un environnement de test. L'extension réécrit le domaine à la volée et conserve tout le reste : chemin, paramètres de requête et ancre.
>
> https://helpdesk.example.com/tickets/42?debug=assets#tab=notes
> devient
> https://app-1234.hosting.example.com/tickets/42?debug=assets#tab=notes
>
> • Deux types de règle : échanger le domaine entier, ou faire correspondre un motif d'URL — capturer un identifiant dans le chemin et reconstruire une URL cible totalement différente
> • Autant de redirections que nécessaire, activables une par une
> • Option sous-domaines, forçage HTTPS, prise en compte des iframes
> • Test d'une URL sans naviguer
> • Dérogation ponctuelle : ouvrir le domaine d'origine sans être redirigé, pour cet onglet seulement
>
> ▸ LANCEUR DE RECHERCHE
> Un raccourci clavier ouvre une petite fenêtre. Vous tapez un numéro de ticket ou un identifiant, la page correspondante s'ouvre sur l'environnement choisi.
>
> • Modèles d'URL personnalisables : /tickets/{q}, /contacts/{q}, ou n'importe quel outil interne
> • Plusieurs environnements (production, test, poste local), basculables au clavier
> • Mots-clés : « t 1234 » ouvre le ticket 1234, « c 57 » la fiche contact 57
> • Raccourci entièrement configurable, plus trois raccourcis directs vers une recherche précise
>
> ▸ RESPECT DE LA VIE PRIVÉE
> Aucune donnée collectée, aucun traceur, aucun serveur. Les redirections sont appliquées par Chrome lui-même (declarativeNetRequest) : l'extension ne lit ni le contenu des pages, ni votre historique. L'accès aux sites est demandé domaine par domaine, au moment où vous créez une redirection.
>
> Disponible en français et en anglais.

**Finalité unique**

> L'extension a une finalité unique : amener l'utilisateur sur la bonne URL de son application web, soit en corrigeant le domaine d'une URL existante, soit en construisant l'URL à partir d'un identifiant saisi. Les deux fonctionnalités partagent la même configuration de domaines et le même objectif de navigation.

## 4. Permission justifications

Privacy tab → “Permission justification”. English is what the reviewer reads.

**`declarativeNetRequest`**

> Core functionality: applying the domain redirect rules defined by the user. This API lets Chrome evaluate the rules itself; the extension does not read network requests and has no access to them.

**`storage`**

> Saving the configuration entered by the user: redirects, environments, search templates and display preferences. No browsing data is written to it.

**`tabs`**

> Reading the active tab URL to tell the user, in the popup, whether a redirect applies and to offer the matching action; and opening the URL built by the launcher in the original tab or window. Page content is never read.

**Host permissions (`*://*/*`, declared as optional_host_permissions)**

> Chrome requires access to both the source and the target domain before it allows a redirect. Those domains are not known in advance: the user types them. The extension therefore never asks for access to the whole web at install time — it asks domain by domain, when the user creates a redirect, through chrome.permissions.request. No script is injected into pages.

**Remote code**: answer **No**. All code ships inside the archive; no external library, no CDN, no
`eval`.

## 5. Privacy declarations

- **Privacy policy URL**: ✏️ the public URL of `PRIVACY.md`.
- **Data usage**: tick **no** category (no personally identifiable information, health, financial,
  authentication, personal communications, location, web history, user activity or website
  content). The extension collects nothing.
- Tick the three certifications:
  - [ ] I do not sell or transfer user data to third parties, outside of the approved use cases.
  - [ ] I do not use or transfer user data for purposes unrelated to my item's single purpose.
  - [ ] I do not use or transfer user data to determine creditworthiness or for lending purposes.

## 6. Graphic assets

- [x] **128×128 icon** — `icons/icon128.png`, already in the right format.
- [ ] **1280×800 screenshots** (at least one, five maximum):
  1. the options page, “Redirects” tab, with two or three rules;
  2. the launcher window with the URL preview;
  3. the popup on a redirected page;
  4. the “Launcher” tab with environments and searches.
- [ ] **440×280 promo tile** (optional, improves the listing).

⚠️ **Do not use real customer names or domains in the screenshots.** Set up fictitious examples
(`helpdesk.example.com`, `app-1234.hosting.example.com`) before capturing. Take the screenshots with
Chrome in English, since that is the default listing.

To get the right dimensions: open the page in Chrome, DevTools (F12) → “Toggle device toolbar” →
custom size 1280×800 → ⋮ menu → “Capture screenshot”.

## 7. Submission and follow-up

1. Developer Dashboard → **New item** → upload the ZIP.
2. Fill in the Listing, Privacy and Distribution tabs (visibility chosen in §0).
3. **Submit for review.** Expect a few hours to a few days; a broad host permission can lengthen it.
4. If rejected, the exact reason arrives by e-mail: fix, bump the version, resubmit.
