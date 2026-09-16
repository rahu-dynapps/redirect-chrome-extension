import { applyI18n, t } from '../lib/i18n.js';
import { isUsable, previewRedirect, requiredOrigins, reverseRedirect } from '../lib/rules.js';
import { DEFAULT_SETTINGS, loadState, saveSettings } from '../lib/storage.js';

const $ = (selector) => document.querySelector(selector);

let state = { mappings: [], settings: { ...DEFAULT_SETTINGS } };
let tab = null;

init();

async function init() {
  applyI18n();
  [state, [tab]] = await Promise.all([
    loadState(),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);

  $('#global-enabled').checked = state.settings.enabled !== false;
  $('#global-enabled').addEventListener('change', async (event) => {
    state.settings = { ...state.settings, enabled: event.target.checked };
    await saveSettings(state.settings);
    await renderCurrentTab();
  });
  $('#open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  $('#open-launcher').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'open-launcher' });
    window.close();
  });
  showLauncherShortcut();

  await renderCurrentTab();
}

async function renderCurrentTab() {
  const primary = $('#primary');
  const secondary = $('#secondary');
  primary.hidden = true;
  secondary.hidden = true;
  primary.onclick = null;
  secondary.onclick = null;

  const url = safeUrl(tab?.url);
  if (!url || !/^https?:$/.test(url.protocol)) {
    $('#host').textContent = '—';
    setState(t('popupNotRedirectable'));
    return;
  }
  $('#host').textContent = url.host;

  const bypassed = await getTabBypass(tab.id);
  const incoming = previewRedirect(url.toString(), state.mappings, state.settings);
  const origin = reverseRedirect(url.toString(), state.mappings);

  if (incoming.ok) {
    // La page n'aurait pas dû s'afficher sur ce domaine : redirection inactive ou contournée.
    if (bypassed) {
      setState(t('popupBypassedThis'));
      showButton(primary, t('popupReenable'), async () => {
        await setTabBypass(tab.id, false, incoming.url);
        window.close();
      });
    } else if (state.settings.enabled === false) {
      setState(t('popupPausedWouldRedirect'));
      showButton(primary, t('popupOpenRedirected'), () => openUrl(incoming.url));
    } else if (!(await hasPermissions(incoming.mapping))) {
      setState(t('popupMissingPermission'));
      showButton(primary, t('popupAllowDomains'), async () => {
        await chrome.permissions.request({ origins: requiredOrigins(incoming.mapping) });
        await renderCurrentTab();
      });
    } else {
      setState(t('popupRedirecting'));
    }
    return;
  }

  if (origin) {
    setState(t('popupTargetOf', [origin.mapping.fromHost]), true);
    showButton(primary, t('popupOpenWithout', [origin.mapping.fromHost]), async () => {
      await setTabBypass(tab.id, true, origin.url);
      window.close();
    });
    if (bypassed) {
      showButton(secondary, t('popupReenableTab'), async () => {
        await setTabBypass(tab.id, false);
        chrome.tabs.reload(tab.id);
        window.close();
      });
    }
    return;
  }

  if (bypassed) {
    setState(t('popupBypassedAll'));
    showButton(primary, t('popupReenableTab'), async () => {
      await setTabBypass(tab.id, false);
      chrome.tabs.reload(tab.id);
      window.close();
    });
    return;
  }

  setState(t('popupNoRedirect'));
  showButton(primary, t('popupCreateRedirect', [url.hostname]), () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`src/options/options.html?from=${encodeURIComponent(url.host)}`)
    });
    window.close();
  });
}

function showButton(node, label, handler) {
  node.textContent = label;
  node.hidden = false;
  node.onclick = handler;
}

function setState(text, ok = false) {
  const node = $('#state');
  node.textContent = text;
  node.classList.toggle('ok', ok);
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function hasPermissions(mapping) {
  if (!isUsable(mapping)) return true;
  return chrome.permissions.contains({ origins: requiredOrigins(mapping) });
}

async function getTabBypass(tabId) {
  const response = await chrome.runtime.sendMessage({ type: 'get-tab-bypass', tabId });
  return response?.bypassed === true;
}

async function setTabBypass(tabId, enabled, url) {
  await chrome.runtime.sendMessage({ type: 'set-tab-bypass', tabId, enabled, url });
}

function openUrl(url) {
  chrome.tabs.update(tab.id, { url });
  window.close();
}

/** Affiche le raccourci réellement attribué au lanceur (l'utilisateur peut l'avoir changé). */
async function showLauncherShortcut() {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'open-launcher')?.shortcut;
  if (shortcut) {
    const hint = document.createElement('span');
    hint.className = 'shortcut';
    hint.textContent = ` (${shortcut})`;
    $('#open-launcher').append(hint);
  }
}
