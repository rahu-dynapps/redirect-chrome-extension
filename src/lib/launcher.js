// Lanceur de recherche : logique pure (aucun appel chrome.*), partagée par la fenêtre du lanceur,
// la page d'options et les tests.

export const MAX_ENVIRONMENTS = 30;
export const MAX_SEARCHES = 50;
export const QUICK_SLOTS = ['quick-1', 'quick-2', 'quick-3'];

/** Exemples installés au premier lancement (modifiables/supprimables depuis les options). */
export const EXAMPLE_SEARCHES = [
  { labelKey: 'exampleSearchTicket', keyword: 't', template: '/tickets/{q}' },
  { labelKey: 'exampleSearchContact', keyword: 'c', template: '/contacts/{q}' },
  { labelKey: 'exampleSearchOrder', keyword: 'o', template: '/orders/{q}' }
];

const PLACEHOLDER_RE = /\{q\}/g;

export function newId(prefix = 'x') {
  const rand = globalThis.crypto?.randomUUID?.();
  return rand ? `${prefix}_${rand}` : `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Un environnement = une base d'URL (instance de production, environnement de test…).
 * Accepte « app-1234.hosting.example.com » comme « https://app-1234.hosting.example.com/app ».
 */
export function normalizeEnvironment(raw) {
  const errors = [];
  const rawBase = String(raw?.baseUrl ?? '').trim();
  let baseUrl = '';

  if (rawBase) {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`;
    try {
      const url = new URL(withScheme);
      if (!/^https?:$/.test(url.protocol)) throw new Error('scheme');
      if (!url.hostname) throw new Error('host');
      // On conserve un éventuel préfixe de chemin, sans le « / » final.
      baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      errors.push({ code: 'errBaseUrlInvalid', value: rawBase });
    }
  } else {
    errors.push({ code: 'errBaseUrlEmpty', value: '' });
  }

  const label = String(raw?.label ?? '').trim().slice(0, 60);
  return {
    environment: {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : newId('env'),
      label: label || hostOf(baseUrl),
      baseUrl
    },
    errors
  };
}

function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

/**
 * Une recherche = un modèle d'URL contenant {q}, relatif à l'environnement
 * (« /tickets/{q} ») ou absolu (« https://support.example.com/t/{q} »).
 */
export function normalizeSearch(raw) {
  const errors = [];
  const template = String(raw?.template ?? '').trim();
  if (!template) errors.push({ code: 'errTemplateEmpty', value: '' });
  else if (!hasPlaceholder(template)) errors.push({ code: 'errTemplateNoPlaceholder', value: '' });

  // Modèles spécifiques à un environnement : une valeur vide retombe sur le modèle par défaut.
  const overrides = {};
  const rawOverrides = raw?.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
  for (const [environmentId, value] of Object.entries(rawOverrides)) {
    const specific = String(value ?? '').trim();
    if (!specific) continue;
    overrides[environmentId] = specific;
    if (!hasPlaceholder(specific)) {
      errors.push({ code: 'errOverrideNoPlaceholder', value: '', environmentId });
    }
  }

  const keyword = String(raw?.keyword ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  return {
    search: {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : newId('s'),
      label: String(raw?.label ?? '').trim().slice(0, 60),
      keyword: keyword.slice(0, 16),
      template,
      overrides,
      // Un environnement épinglé : cette recherche l'utilise toujours, quel que soit le choix courant.
      environmentId: typeof raw?.environmentId === 'string' ? raw.environmentId : ''
    },
    errors
  };
}

function hasPlaceholder(template) {
  PLACEHOLDER_RE.lastIndex = 0;
  const ok = PLACEHOLDER_RE.test(String(template ?? ''));
  PLACEHOLDER_RE.lastIndex = 0;
  return ok;
}

export function isSearchUsable(search) {
  return hasPlaceholder(search?.template);
}

/** Modèle d'URL à employer : celui de l'environnement s'il existe, sinon le modèle par défaut. */
export function templateFor(search, environment) {
  const specific = environment?.id ? search?.overrides?.[environment.id] : '';
  return specific || search?.template || '';
}

/** Nombre d'environnements pour lesquels la recherche a un modèle spécifique. */
export function countOverrides(search) {
  return Object.keys(search?.overrides ?? {}).length;
}

export function isAbsoluteTemplate(template) {
  return /^https?:\/\//i.test(String(template ?? ''));
}

/** Construit l'URL finale à ouvrir. */
export function buildLaunchUrl({ search, environment, query }) {
  const value = String(query ?? '').trim();
  const template = templateFor(search, environment);
  if (!hasPlaceholder(template)) return { ok: false, error: 'invalid-search' };
  if (!value) return { ok: false, error: 'empty-query' };

  const absolute = isAbsoluteTemplate(template);
  if (!absolute && !environment?.baseUrl) return { ok: false, error: 'missing-environment' };

  PLACEHOLDER_RE.lastIndex = 0;
  const path = template.replace(PLACEHOLDER_RE, encodeURIComponent(value));
  const raw = absolute ? path : `${environment.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return { ok: false, error: 'unsupported-scheme' };
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, error: 'invalid-url' };
  }
}

/**
 * Saisie du lanceur : « t 1234 » sélectionne la recherche dont le mot-clé est « t ».
 * Sans mot-clé reconnu, la recherche active est conservée.
 */
export function parseLauncherInput(text, searches) {
  const input = String(text ?? '');
  const match = /^(\S+)[ \t]+(.*)$/.exec(input.trim());
  if (match) {
    const [, token, rest] = match;
    const search = (searches ?? []).find((s) => s.keyword && s.keyword === token.toLowerCase());
    if (search) return { search, query: rest.trim(), matchedKeyword: true };
  }
  return { search: null, query: input.trim(), matchedKeyword: false };
}

/** Recherche/environnement à utiliser pour une saisie, en tenant compte des mots-clés et de l'épinglage. */
export function resolveLaunch({ text, searches, environments, activeSearchId, activeEnvironmentId }) {
  const parsed = parseLauncherInput(text, searches);
  const usable = (searches ?? []).filter(isSearchUsable);
  const search =
    parsed.search ?? usable.find((s) => s.id === activeSearchId) ?? usable[0] ?? null;

  const pinned = search?.environmentId
    ? (environments ?? []).find((e) => e.id === search.environmentId)
    : null;
  const environment =
    pinned ?? (environments ?? []).find((e) => e.id === activeEnvironmentId) ?? (environments ?? [])[0] ?? null;

  return {
    search,
    environment,
    template: search ? templateFor(search, environment) : '',
    query: parsed.query,
    matchedKeyword: parsed.matchedKeyword,
    pinnedEnvironment: Boolean(pinned),
    result: search ? buildLaunchUrl({ search, environment, query: parsed.query }) : { ok: false, error: 'no-search' }
  };
}

/** Code d'erreur du lanceur → clé de message traduite par l'interface. */
export const LAUNCH_ERROR_KEYS = {
  'no-search': 'launchErrNoSearch',
  'invalid-search': 'launchErrInvalidSearch',
  'empty-query': 'launchErrEmptyQuery',
  'missing-environment': 'launchErrMissingEnvironment',
  'unsupported-scheme': 'launchErrUnsupportedScheme',
  'invalid-url': 'launchErrInvalidUrl'
};
