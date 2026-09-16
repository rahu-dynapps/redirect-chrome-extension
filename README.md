# Domain Redirect & Launch — Chrome extension

*[Version française](README.fr.md)*

A Manifest V3 Chrome extension that does two everyday things:

1. **Domain redirect** — rewrites the domain of a URL **while keeping the path, query string and
   fragment**.
2. **Search launcher** — a keyboard shortcut opens a small window: type a ticket number (or any
   identifier) and the matching page opens on the environment you picked.

The original use case: users share links that use a public alias, while you work on the technical
URL of the instance (or the other way round).

```
https://helpdesk.example.com/tickets/42?debug=assets#tab=notes
        ↓
https://app-1234.hosting.example.com/tickets/42?debug=assets#tab=notes
```

The interface is available in **English** (default) and **French**; it follows your Chrome language.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the repository folder.
4. The options page opens on first install: add a redirect, then accept the permission prompt for
   both domains.

Also works on Edge, Brave, Opera and other Chromium-based browsers (≥ 108).

## 1. Redirects

### Options page → “Redirects” tab

- **Add a redirect**: source domain (the alias) → target domain. Both fields accept a bare hostname
  as well as a full URL pasted from an email — only the host is kept.
- **Include subdomains**: `*.helpdesk.example.com` is redirected to the target domain.
- **Force HTTPS**: `http://` URLs are redirected to `https://`.
- **Also redirect iframes**: by default only top-level navigation is redirected, which avoids
  breaking embedded content.
- **Order**: the first redirect whose source domain matches wins; reorder with the ↑ ↓ arrows.
- **Test a URL**: paste a URL and see the computed destination without navigating.

### Popup (toolbar icon)

- State of the current tab (domain, redirect applied or not).
- **Open `alias` without redirect**: reach the source domain without being redirected — useful to
  visit the alias itself. The bypass only applies to that tab and disappears when it closes.
- **Redirect this domain to…**: creates a redirect pre-filled with the domain shown.
- Global switch to pause every redirect (`OFF` badge on the icon).

### How it works

The extension uses the `declarativeNetRequest` API: Chrome applies the rules itself, before the
request is even sent. The extension neither reads nor modifies page content.

```jsonc
{
  "action": { "type": "redirect", "redirect": { "transform": { "host": "app-1234.hosting.example.com" } } },
  "condition": {
    "regexFilter": "^https?://helpdesk\\.example\\.com(?::\\d+)?(?:[/?#].*)?$",
    "resourceTypes": ["main_frame"]
  }
}
```

`transform.host` replaces the host only: path, query and fragment are kept as they are (the fragment
never reaches the server — the browser re-applies it to the destination URL, so links such as
`#id=42&model=contact` keep working).

## 2. Search launcher

<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> by default (see below to change it) opens a small
window:

```
┌───────────────────────────────────────────────────────┐
│  1234                                                 │
│  Search: Ticket (t)        Environment: Production     │
│  → https://app-1234.hosting.example.com/tickets/1234   │
└───────────────────────────────────────────────────────┘
```

- <kbd>Enter</kbd> opens the URL in a new tab, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> in the active tab
  (the default order is configurable), <kbd>Esc</kbd> closes.
- <kbd>Alt</kbd>+<kbd>1…9</kbd> switches environment without leaving the keyboard.
- A **keyword** prefix picks the search: `t 1234` opens ticket 1234, `c 57` contact 57, whatever is
  selected in the dropdown.
- The resulting URL is previewed live under the input.

### Environments

An environment is a **base URL**: `https://app-1234.hosting.example.com`, a test instance, a local
server `http://localhost:8069`… A path prefix is supported (`https://erp.example.com/app`). The
launcher remembers the last environment used.

### Searches

A search is a **URL template containing `{q}`**, replaced by the value you type (URL-encoded):

| Search           | Template                                            |
| ---------------- | --------------------------------------------------- |
| Ticket           | `/tickets/{q}`                                       |
| Contact          | `/contacts/{q}`                                      |
| Hash-based app   | `/app#id={q}&model=ticket`                           |
| Full-text search | `/contacts?search={q}`                               |
| External tool    | `https://support.example.com/t/{q}` (absolute)       |

- A **relative** template is appended to the selected environment; an **absolute** one
  (`https://…`) ignores the environment.
- Each search can **pin an environment**, for a search that only makes sense on one of them.
- Three example searches are created on first install; edit or delete them freely.

### Choosing your shortcuts

The **“Configure shortcuts in Chrome”** button (Launcher tab) opens
`chrome://extensions/shortcuts`, where any combination can be assigned:

- `Open the search launcher` — <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> by default;
- `Quick shortcut 1 to 3` — no default key. Each one is bound in the options to a search and an
  environment, and opens the launcher straight onto it: for example <kbd>Alt</kbd>+<kbd>T</kbd> for
  “Ticket on production”.

## Permissions

- `declarativeNetRequest` — apply the redirect rules.
- `storage` — save redirects, environments and searches (synced with your Chrome account).
- `tabs` — read the active tab URL (popup) and open the URL built by the launcher.
- Site access — requested **one domain at a time**, only for the source and target of each redirect.
  Chrome requires both. A redirect without permission is flagged in orange on the options page with
  an “Allow” button. The launcher needs no site access at all.

## Known limitations

- Internal pages (`chrome://`, Chrome Web Store) cannot be redirected.
- Only `http://` and `https://` are supported.
- A redirect source must be a hostname (no path pattern); use the subdomains option to cover several
  hosts.
- Chrome caps the number of suggested default shortcuts: the quick shortcuts must be assigned
  manually.
- Up to 200 redirects, 30 environments, 50 searches.

## Development

```bash
npm test                      # unit tests of the pure logic (node:test)
npm run package               # validates the manifest and builds the Chrome Web Store ZIP
python3 tools/make_icons.py   # regenerates the PNG icons
```

```
manifest.json            # MV3: permissions, keyboard commands
_locales/{en,fr}/        # message catalogs (English is the default)
src/background.js        # service worker: DNR rules, per-tab bypass, launcher window
src/lib/rules.js         # pure redirect logic (parsing, DNR rules, preview)
src/lib/launcher.js      # pure launcher logic (environments, searches, URL building)
src/lib/i18n.js          # applies translations to the DOM
src/lib/storage.js       # chrome.storage.sync access
src/options/             # options page (Redirects / Launcher tabs)
src/popup/               # toolbar popup
src/launcher/            # launcher window
test/                    # tests for both logic modules
tools/make_icons.py      # icon generation
tools/package.py         # store limit checks + ZIP archive
store/listing.md         # texts and checklist for publishing
PRIVACY.md               # privacy policy
```

All matching and URL-building logic lives in `src/lib/`, free of `chrome.*` APIs, so it can be
covered by tests. User-facing strings live in `_locales/`; the logic modules return **error codes**
that the UI translates.

## Publishing to the Chrome Web Store

`npm run package` builds the archive to upload (`dist/`) and refuses to package if the manifest
breaks a store limit — description too long, missing icon, missing referenced file, remotely hosted
code, or a translation key used by the UI but absent from the default catalog.

Everything else — visibility, listing copy, permission justifications, privacy declarations,
screenshots — is laid out as a checklist in [`store/listing.md`](store/listing.md).

## Licence

[MIT](LICENSE).
