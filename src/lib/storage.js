// Accès centralisé au stockage de l'extension (chrome.storage.sync).
import { normalizeMapping } from './rules.js';
import { QUICK_SLOTS, normalizeEnvironment, normalizeSearch } from './launcher.js';

export const STORAGE_AREA = 'sync';
const KEY_MAPPINGS = 'mappings';
const KEY_SETTINGS = 'settings';
const KEY_ENVIRONMENTS = 'environments';
const KEY_SEARCHES = 'searches';
const KEY_LAUNCHER = 'launcher';

export const DEFAULT_SETTINGS = { enabled: true };
export const DEFAULT_LAUNCHER = {
  lastSearchId: '',
  lastEnvironmentId: '',
  openIn: 'new-tab', // 'new-tab' | 'current-tab'
  slots: {} // { 'quick-1': { searchId, environmentId } }
};

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

export async function loadLauncher() {
  const raw = await chrome.storage.sync.get({
    [KEY_ENVIRONMENTS]: [],
    [KEY_SEARCHES]: [],
    [KEY_LAUNCHER]: DEFAULT_LAUNCHER
  });
  const launcher = { ...DEFAULT_LAUNCHER, ...(raw[KEY_LAUNCHER] ?? {}) };
  launcher.slots = { ...(launcher.slots ?? {}) };
  for (const key of Object.keys(launcher.slots)) {
    if (!QUICK_SLOTS.includes(key)) delete launcher.slots[key];
  }
  return {
    environments: toArray(raw[KEY_ENVIRONMENTS]).map((e) => normalizeEnvironment(e).environment),
    searches: toArray(raw[KEY_SEARCHES]).map((s) => normalizeSearch(s).search),
    launcher
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function saveMappings(mappings) {
  await chrome.storage.sync.set({ [KEY_MAPPINGS]: mappings });
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [KEY_SETTINGS]: { ...DEFAULT_SETTINGS, ...settings } });
}

export async function saveEnvironments(environments) {
  await chrome.storage.sync.set({ [KEY_ENVIRONMENTS]: environments });
}

export async function saveSearches(searches) {
  await chrome.storage.sync.set({ [KEY_SEARCHES]: searches });
}

export async function saveLauncher(launcher) {
  await chrome.storage.sync.set({ [KEY_LAUNCHER]: { ...DEFAULT_LAUNCHER, ...launcher } });
}

/** Notifie un changement des redirections ou de l'activation globale. */
export function onStateChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== STORAGE_AREA) return;
    if (KEY_MAPPINGS in changes || KEY_SETTINGS in changes) callback();
  });
}

export const LAUNCHER_KEYS = { KEY_ENVIRONMENTS, KEY_SEARCHES, KEY_LAUNCHER };
