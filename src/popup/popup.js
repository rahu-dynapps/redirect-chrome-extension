import { isUsable, previewRedirect, requiredOrigins, reverseRedirect } from '../lib/rules.js';
import { DEFAULT_SETTINGS, loadState, saveSettings } from '../lib/storage.js';

const $ = (selector) => document.querySelector(selector);

let state = { mappings: [], settings: { ...DEFAULT_SETTINGS } };
let tab = null;

init();

async function init() {
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
    setState('Cette page ne peut pas être redirigée.');
    return;
  }
  $('#host').textContent = url.host;

  const bypassed = await getTabBypass(tab.id);
  const incoming = previewRedirect(url.toString(), state.mappings, state.settings);
  const origin = reverseRedirect(url.toString(), state.mappings);

  if (incoming.ok) {
    // La page n'aurait pas dû s'afficher sur ce domaine : redirection inactive ou contournée.
    if (bypassed) {
      setState('Redirection désactivée pour cet onglet.');
      showButton(primary, 'Réactiver la redirection', async () => {
        await setTabBypass(tab.id, false, incoming.url);
        window.close();
      });
    } else if (state.settings.enabled === false) {
      setState('Redirections en pause : cette URL serait redirigée.');
      showButton(primary, 'Ouvrir la version redirigée', () => openUrl(incoming.url));
    } else if (!(await hasPermissions(incoming.mapping))) {
      setState('Autorisation manquante pour appliquer la redirection.');
      showButton(primary, 'Autoriser les domaines', async () => {
        await chrome.permissions.request({ origins: requiredOrigins(incoming.mapping) });
        await renderCurrentTab();
      });
    } else {
      setState('Redirection en cours…');
    }
    return;
  }

  if (origin) {
    setState(`Domaine cible de ${origin.mapping.fromHost}.`, true);
    showButton(primary, `Ouvrir ${origin.mapping.fromHost} sans redirection`, async () => {
      await setTabBypass(tab.id, true, origin.url);
      window.close();
    });
    if (bypassed) {
      showButton(secondary, 'Réactiver la redirection pour cet onglet', async () => {
        await setTabBypass(tab.id, false);
        chrome.tabs.reload(tab.id);
        window.close();
      });
    }
    return;
  }

  if (bypassed) {
    setState('Redirections désactivées pour cet onglet.');
    showButton(primary, 'Réactiver la redirection pour cet onglet', async () => {
      await setTabBypass(tab.id, false);
      chrome.tabs.reload(tab.id);
      window.close();
    });
    return;
  }

  setState('Aucune redirection pour ce domaine.');
  showButton(primary, `Rediriger ${url.hostname} vers…`, () => {
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
