// Service worker : synchronise les règles declarativeNetRequest avec le stockage,
// gère la dérogation « ne pas rediriger cet onglet » et la fenêtre du lanceur.
import { BYPASS_RULE_PRIORITY, buildDnrRules } from './lib/rules.js';
import { EXAMPLE_SEARCHES, QUICK_SLOTS, normalizeSearch } from './lib/launcher.js';
import { loadState, loadLauncher, onStateChanged, saveSearches } from './lib/storage.js';

const BYPASS_RESOURCE_TYPES = ['main_frame', 'sub_frame'];
const LAUNCHER_WINDOW_KEY = 'launcherWindowId';
const LAUNCHER_SIZE = { width: 560, height: 300 };

// ---------------------------------------------------------------- redirections

async function syncRules() {
  const { mappings, settings } = await loadState();
  const rules = buildDnrRules(mappings, settings);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules
  });
  await updateBadge(settings, rules.length);
}

async function updateBadge(settings, ruleCount) {
  const paused = settings?.enabled === false;
  await chrome.action.setBadgeText({ text: paused ? 'OFF' : '' });
  if (paused) await chrome.action.setBadgeBackgroundColor({ color: '#9aa0b4' });
  await chrome.action.setTitle({
    title: paused
      ? 'Redirection de domaines — en pause'
      : `Redirection de domaines — ${ruleCount} redirection(s) active(s)`
  });
}

/** Une règle « allow » de session, limitée à un onglet, court-circuite les redirections. */
async function setTabBypass(tabId, enabled) {
  const ruleId = tabId + 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: enabled
      ? [
          {
            id: ruleId,
            priority: BYPASS_RULE_PRIORITY,
            action: { type: 'allow' },
            condition: { tabIds: [tabId], resourceTypes: BYPASS_RESOURCE_TYPES }
          }
        ]
      : []
  });
}

async function isTabBypassed(tabId) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((rule) => rule.id === tabId + 1);
}

// --------------------------------------------------------------------- lanceur

/** Ouvre (ou ramène au premier plan) la petite fenêtre du lanceur. */
async function openLauncher({ slot = '' } = {}) {
  const opener = await currentNormalWindow();
  const url = chrome.runtime.getURL(
    `src/launcher/launcher.html?opener=${opener?.id ?? ''}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`
  );

  const existingId = await getLauncherWindowId();
  if (existingId !== null) {
    try {
      const [tab] = await chrome.tabs.query({ windowId: existingId });
      if (tab) await chrome.tabs.update(tab.id, { url });
      await chrome.windows.update(existingId, { focused: true, drawAttention: true });
      return existingId;
    } catch {
      await chrome.storage.session.remove(LAUNCHER_WINDOW_KEY);
    }
  }

  const created = await chrome.windows.create({
    url,
    type: 'popup',
    focused: true,
    ...LAUNCHER_SIZE,
    ...centerOn(opener)
  });
  await chrome.storage.session.set({ [LAUNCHER_WINDOW_KEY]: created.id });
  return created.id;
}

function centerOn(win) {
  if (!win || typeof win.left !== 'number' || typeof win.width !== 'number') return {};
  return {
    left: Math.max(0, Math.round(win.left + (win.width - LAUNCHER_SIZE.width) / 2)),
    top: Math.max(0, Math.round(win.top + Math.min(160, (win.height - LAUNCHER_SIZE.height) / 3)))
  };
}

/** Fenêtre de navigation depuis laquelle le lanceur a été appelé (jamais le lanceur lui-même). */
async function currentNormalWindow() {
  try {
    const last = await chrome.windows.getLastFocused();
    if (last?.type === 'normal') return last;
    const all = await chrome.windows.getAll();
    return all.find((win) => win.type === 'normal' && win.focused) ?? all.find((win) => win.type === 'normal') ?? null;
  } catch {
    return null;
  }
}

async function getLauncherWindowId() {
  const stored = await chrome.storage.session.get(LAUNCHER_WINDOW_KEY);
  const id = stored?.[LAUNCHER_WINDOW_KEY];
  if (typeof id !== 'number') return null;
  try {
    await chrome.windows.get(id);
    return id;
  } catch {
    await chrome.storage.session.remove(LAUNCHER_WINDOW_KEY);
    return null;
  }
}

/** Ouvre l'URL construite par le lanceur dans la fenêtre de navigation d'origine. */
async function launchUrl({ url, mode = 'new-tab', openerWindowId }) {
  const windowId = Number(openerWindowId);
  const target = Number.isInteger(windowId) ? await windowOrNull(windowId) : await currentNormalWindow();

  if (!target) {
    await chrome.tabs.create({ url });
    return;
  }
  if (mode === 'current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, windowId: target.id });
    if (tab) await chrome.tabs.update(tab.id, { url });
    else await chrome.tabs.create({ windowId: target.id, url });
  } else {
    await chrome.tabs.create({ windowId: target.id, url, active: true });
  }
  await chrome.windows.update(target.id, { focused: true });
}

async function windowOrNull(windowId) {
  try {
    return await chrome.windows.get(windowId);
  } catch {
    return null;
  }
}

/** Au premier lancement seulement : quelques recherches d'exemple, modifiables ensuite. */
async function seedExamples() {
  const { searches } = await loadLauncher();
  if (searches.length) return;
  await saveSearches(EXAMPLE_SEARCHES.map((raw) => normalizeSearch(raw).search));
}

// ------------------------------------------------------------------ événements

chrome.runtime.onInstalled.addListener((details) => {
  syncRules();
  if (details.reason === 'install') {
    seedExamples().then(() => chrome.runtime.openOptionsPage());
  }
});
chrome.runtime.onStartup.addListener(() => syncRules());
onStateChanged(() => syncRules());

// Le service worker peut être relancé sans événement d'installation : on resynchronise au chargement.
syncRules();

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId + 1] }).catch(() => {});
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get(LAUNCHER_WINDOW_KEY);
  if (stored?.[LAUNCHER_WINDOW_KEY] === windowId) await chrome.storage.session.remove(LAUNCHER_WINDOW_KEY);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-launcher') openLauncher();
  else if (QUICK_SLOTS.includes(command)) openLauncher({ slot: command });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'set-tab-bypass': {
        await setTabBypass(message.tabId, message.enabled !== false);
        if (message.url) await chrome.tabs.update(message.tabId, { url: message.url });
        sendResponse({ ok: true });
        break;
      }
      case 'get-tab-bypass': {
        sendResponse({ ok: true, bypassed: await isTabBypassed(message.tabId) });
        break;
      }
      case 'open-launcher': {
        sendResponse({ ok: true, windowId: await openLauncher({ slot: message.slot }) });
        break;
      }
      case 'launch-url': {
        await launchUrl(message);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
    }
  })().catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // réponse asynchrone
});
