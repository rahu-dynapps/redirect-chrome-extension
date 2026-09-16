// Export et import de la configuration. Module pur : aucun appel chrome.*.
//
// Le point délicat est l'identité : les recherches référencent les environnements par leur
// identifiant (modèle propre à un environnement, environnement épinglé, raccourcis rapides).
// Un import qui régénère ces identifiants casse silencieusement tous ces liens.

import { MAX_MAPPINGS, isUsable, normalizeMapping } from './rules.js';
import {
  MAX_ENVIRONMENTS,
  MAX_SEARCHES,
  QUICK_SLOTS,
  isSearchUsable,
  newId,
  normalizeEnvironment,
  normalizeSearch
} from './launcher.js';
import { DEFAULT_LAUNCHER } from './storage.js';

export const EXPORT_VERSION = 3;

export function buildExport(state) {
  return {
    version: EXPORT_VERSION,
    settings: state.settings,
    mappings: state.mappings,
    environments: state.environments,
    searches: state.searches,
    launcher: state.launcher
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Clé de dédoublonnage : ce qui fait qu'une entrée est « la même » qu'une autre. */
function mappingKey(mapping) {
  return mapping.kind === 'pattern'
    ? `pattern:${mapping.pattern}`
    : `domain:${mapping.fromHost}:${mapping.fromPort}`;
}

function searchKey(search) {
  return search.keyword ? `keyword:${search.keyword}` : `template:${search.template}`;
}

/** Conserve l'identifiant du fichier s'il est libre, sinon en attribue un neuf. */
function freeId(candidate, taken, prefix) {
  return candidate && !taken.has(candidate) ? candidate : newId(prefix);
}

/**
 * Fusionne (ou remplace) la configuration courante avec le contenu d'un fichier exporté.
 * @param {object} current  état courant { mappings, environments, searches, launcher }
 * @param {object} payload  contenu du fichier JSON
 * @param {'merge'|'replace'} mode
 */
export function importConfiguration(current, payload, mode = 'merge') {
  const replace = mode === 'replace';
  const counts = { mappings: 0, environments: 0, searches: 0, skipped: 0 };

  const mappings = replace ? [] : [...toArray(current?.mappings)];
  const environments = replace ? [] : [...toArray(current?.environments)];
  const searches = replace ? [] : [...toArray(current?.searches)];
  const launcher = replace
    ? { ...DEFAULT_LAUNCHER, slots: {} }
    : { ...DEFAULT_LAUNCHER, ...(current?.launcher ?? {}), slots: { ...(current?.launcher?.slots ?? {}) } };

  // --- redirections
  const mappingKeys = new Set(mappings.map(mappingKey));
  for (const raw of toArray(Array.isArray(payload) ? payload : payload?.mappings)) {
    if (mappings.length >= MAX_MAPPINGS) break;
    const { mapping } = normalizeMapping(raw);
    if (!isUsable(mapping)) continue;
    if (mappingKeys.has(mappingKey(mapping))) {
      counts.skipped += 1;
      continue;
    }
    mappingKeys.add(mappingKey(mapping));
    mappings.push({ ...mapping, id: freeId(mapping.id, new Set(mappings.map((m) => m.id)), 'm') });
    counts.mappings += 1;
  }

  // --- environnements : traités en premier, les recherches s'appuient sur leurs identifiants
  const environmentIds = new Map(); // identifiant du fichier → identifiant local
  for (const raw of toArray(payload?.environments)) {
    if (environments.length >= MAX_ENVIRONMENTS) break;
    const { environment, errors } = normalizeEnvironment(raw);
    if (errors.length) continue;

    const twin = environments.find((e) => e.baseUrl === environment.baseUrl);
    if (twin) {
      environmentIds.set(environment.id, twin.id);
      counts.skipped += 1;
      continue;
    }
    const id = freeId(environment.id, new Set(environments.map((e) => e.id)), 'env');
    environmentIds.set(environment.id, id);
    environments.push({ ...environment, id });
    counts.environments += 1;
  }

  const resolveEnvironment = (id) =>
    environmentIds.get(id) ?? (environments.some((e) => e.id === id) ? id : '');

  // --- recherches, avec report des références d'environnement
  const searchIds = new Map();
  const searchKeys = new Set(searches.map(searchKey));
  for (const raw of toArray(payload?.searches)) {
    if (searches.length >= MAX_SEARCHES) break;

    const overrides = {};
    for (const [environmentId, template] of Object.entries(raw?.overrides ?? {})) {
      const local = resolveEnvironment(environmentId);
      if (local) overrides[local] = template;
    }
    const { search } = normalizeSearch({
      ...raw,
      overrides,
      environmentId: resolveEnvironment(raw?.environmentId)
    });
    if (!isSearchUsable(search)) continue;

    const twin = searches.find((s) => searchKey(s) === searchKey(search));
    if (twin) {
      searchIds.set(search.id, twin.id);
      counts.skipped += 1;
      continue;
    }
    const id = freeId(search.id, new Set(searches.map((s) => s.id)), 's');
    searchIds.set(search.id, id);
    searches.push({ ...search, id });
    counts.searches += 1;
  }

  const resolveSearch = (id) => searchIds.get(id) ?? (searches.some((s) => s.id === id) ? id : '');

  // --- préférences du lanceur
  const incoming = payload?.launcher;
  if (incoming) {
    if (replace) {
      launcher.openIn = incoming.openIn === 'current-tab' ? 'current-tab' : 'new-tab';
      launcher.lastSearchId = resolveSearch(incoming.lastSearchId);
      launcher.lastEnvironmentId = resolveEnvironment(incoming.lastEnvironmentId);
    }
    for (const slot of QUICK_SLOTS) {
      const slotValue = incoming.slots?.[slot];
      if (!slotValue) continue;
      const existing = launcher.slots[slot];
      // En fusion, un raccourci déjà configuré n'est pas écrasé.
      if (!replace && existing && (existing.searchId || existing.environmentId)) continue;
      launcher.slots[slot] = {
        searchId: resolveSearch(slotValue.searchId),
        environmentId: resolveEnvironment(slotValue.environmentId)
      };
    }
  }

  return { mappings, environments, searches, launcher, counts };
}
