// Service worker : maintient les règles declarativeNetRequest en phase avec le stockage
// et gère la dérogation « ne pas rediriger cet onglet ».
import { buildDnrRules, BYPASS_RULE_PRIORITY } from './lib/rules.js';
import { loadState, onStateChanged } from './lib/storage.js';

const BYPASS_RESOURCE_TYPES = ['main_frame', 'sub_frame'];

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
  const removeRuleIds = [ruleId];
  const addRules = enabled
    ? [
        {
          id: ruleId,
          priority: BYPASS_RULE_PRIORITY,
          action: { type: 'allow' },
          condition: { tabIds: [tabId], resourceTypes: BYPASS_RESOURCE_TYPES }
        }
      ]
    : [];
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

async function isTabBypassed(tabId) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((rule) => rule.id === tabId + 1);
}

chrome.runtime.onInstalled.addListener((details) => {
  syncRules();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => syncRules());
onStateChanged(() => syncRules());

// Le service worker peut être relancé sans événement d'installation : on resynchronise au chargement.
syncRules();

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId + 1] }).catch(() => {});
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
      default:
        sendResponse({ ok: false, error: 'unknown-message' });
    }
  })().catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true; // réponse asynchrone
});
