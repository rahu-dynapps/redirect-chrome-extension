// Accès centralisé au stockage de l'extension (chrome.storage.sync).
import { normalizeMapping } from './rules.js';

export const STORAGE_AREA = 'sync';
const KEY_MAPPINGS = 'mappings';
const KEY_SETTINGS = 'settings';

export const DEFAULT_SETTINGS = { enabled: true };

export async function loadState() {
  const raw = await chrome.storage.sync.get({ [KEY_MAPPINGS]: [], [KEY_SETTINGS]: DEFAULT_SETTINGS });
  const mappings = Array.isArray(raw[KEY_MAPPINGS])
    ? raw[KEY_MAPPINGS].map((m) => normalizeMapping(m).mapping)
    : [];
  return {
    mappings,
    settings: { ...DEFAULT_SETTINGS, ...(raw[KEY_SETTINGS] ?? {}) }
  };
}

export async function saveMappings(mappings) {
  await chrome.storage.sync.set({ [KEY_MAPPINGS]: mappings });
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [KEY_SETTINGS]: { ...DEFAULT_SETTINGS, ...settings } });
}

/** Notifie un changement pertinent (redirections ou activation globale). */
export function onStateChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== STORAGE_AREA) return;
    if (KEY_MAPPINGS in changes || KEY_SETTINGS in changes) callback();
  });
}
