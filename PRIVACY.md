# Privacy policy — Domain Redirect & Launch

*[Version française](PRIVACY.fr.md)* — _Last updated: 16 September 2026_

## In short

The extension **collects, transmits and sells no data**. It contains no tracker, no analytics and no
remote server. Everything it handles stays in your browser.

## What is stored, and where

The extension only stores what you type into its own options page:

| Data | Example | Storage |
| --- | --- | --- |
| Redirects | `helpdesk.example.com` → `app-1234.hosting.example.com` | `chrome.storage.sync` |
| Environments | `https://app-1234.hosting.example.com` | `chrome.storage.sync` |
| Searches | `Ticket` → `/tickets/{q}` | `chrome.storage.sync` |
| Preferences | last environment used, opening mode | `chrome.storage.sync` |

`chrome.storage.sync` is Chrome's own storage: this data stays in your profile and is synced across
your devices **by Chrome itself**, if you enabled sync. It never passes through any server belonging
to the extension's author, who has no access to it.

No browsing history is recorded. Values typed into the launcher (ticket numbers, identifiers) are
used to build the URL and then forgotten: they are never stored.

## Why each permission is requested

- **`declarativeNetRequest`** — applies the redirects. Rules are evaluated by Chrome itself; the
  extension does not see, read or log network requests.
- **`storage`** — saves your configuration (table above).
- **`tabs`** — reads the address of the active tab to show its status in the popup, and opens the
  URL built by the launcher. Page content is never read.
- **Site access** — requested **one domain at a time**, only for the source and target domains you
  type, at the moment you create a redirect. Chrome requires access to both before it allows the
  rewrite. Access to the whole web is never requested.

The extension injects no script into the pages you visit.

## Deleting your data

Removing an entry on the options page removes it from storage. Uninstalling the extension deletes
the whole configuration.

## Changes

Any change to this policy will be published in this file, in the project repository.

## Contact

For any question about this policy: **rdefrob@gmail.com**

Project repository: https://github.com/rahu-dynapps/redirect-chrome-extension
