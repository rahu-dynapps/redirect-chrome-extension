// Fonctions pures partagées par le service worker, les pages d'options/popup et les tests.
// Aucun appel aux API chrome.* ici : ce module doit rester exécutable sous Node.

export const REDIRECT_RULE_PRIORITY_BASE = 1;
export const BYPASS_RULE_PRIORITY = 1000000;
export const MAX_MAPPINGS = 200;

const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Accepte aussi bien « alias.client.fr » qu'une URL complète collée depuis un mail
 * (« https://alias.client.fr/odoo/contacts?debug=1 ») et n'en garde que l'hôte + le port.
 * @returns {{ok: true, host: string, port: string} | {ok: false, error: string}}
 */
export function parseHostInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, error: 'Indiquez un nom de domaine.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: `« ${input} » n'est pas un nom de domaine valide.` };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, error: 'Seuls les domaines en http:// et https:// sont pris en charge.' };
  }
  // new URL() se charge de la mise en minuscules et de la conversion IDN (punycode).
  const host = url.hostname;
  if (!HOSTNAME_RE.test(host)) {
    return { ok: false, error: `« ${input} » n'est pas un nom de domaine valide.` };
  }
  if (url.port && !/^\d{1,5}$/.test(url.port)) {
    return { ok: false, error: `Port invalide dans « ${input} ».` };
  }
  return { ok: true, host, port: url.port || '' };
}

/** Normalise une redirection saisie dans l'interface. */
export function normalizeMapping(raw) {
  const from = parseHostInput(raw?.from ?? raw?.fromHost ?? '');
  const to = parseHostInput(raw?.to ?? raw?.toHost ?? '');
  const errors = [];
  if (!from.ok) errors.push(`Domaine source : ${from.error}`);
  if (!to.ok) errors.push(`Domaine cible : ${to.error}`);

  const mapping = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newMappingId(),
    enabled: raw?.enabled !== false,
    fromHost: from.ok ? from.host : String(raw?.from ?? raw?.fromHost ?? '').trim(),
    fromPort: from.ok ? from.port : '',
    toHost: to.ok ? to.host : String(raw?.to ?? raw?.toHost ?? '').trim(),
    toPort: to.ok ? to.port : '',
    includeSubdomains: raw?.includeSubdomains === true,
    forceHttps: raw?.forceHttps === true,
    includeSubframes: raw?.includeSubframes === true,
    note: typeof raw?.note === 'string' ? raw.note.slice(0, 200) : ''
  };

  if (!errors.length && hostKey(mapping.fromHost, mapping.fromPort) === hostKey(mapping.toHost, mapping.toPort)) {
    errors.push('Le domaine source et le domaine cible sont identiques.');
  }
  return { mapping, errors };
}

export function newMappingId() {
  const rand = globalThis.crypto?.randomUUID?.();
  return rand ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function hostKey(host, port) {
  return port ? `${host}:${port}` : host;
}

export function describeMapping(mapping) {
  return `${hostKey(mapping.fromHost, mapping.fromPort)} → ${hostKey(mapping.toHost, mapping.toPort)}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Une redirection n'est utilisable que si les deux domaines ont été correctement saisis. */
export function isUsable(mapping) {
  return Boolean(
    mapping &&
      HOSTNAME_RE.test(mapping.fromHost || '') &&
      HOSTNAME_RE.test(mapping.toHost || '') &&
      hostKey(mapping.fromHost, mapping.fromPort) !== hostKey(mapping.toHost, mapping.toPort)
  );
}

/**
 * Expression régulière (syntaxe RE2, sans lookahead) utilisée comme condition de la règle
 * declarativeNetRequest. Elle couvre l'URL entière pour éviter toute correspondance partielle.
 */
export function buildRegexFilter(mapping) {
  const host = escapeRegex(mapping.fromHost);
  const hostPart = mapping.includeSubdomains ? `(?:[a-z0-9-]+\\.)*${host}` : host;
  const portPart = mapping.fromPort ? `:${mapping.fromPort}` : '(?::\\d+)?';
  return `^https?://${hostPart}${portPart}(?:[/?#].*)?$`;
}

/** Transformation appliquée à l'URL : seul l'hôte (et éventuellement le port/schéma) change. */
export function buildTransform(mapping) {
  const transform = { host: mapping.toHost };
  if (mapping.toPort) {
    transform.port = mapping.toPort;
  } else if (mapping.fromPort) {
    // La source portait un port explicite, la cible non : on le supprime.
    transform.port = '';
  }
  if (mapping.forceHttps) transform.scheme = 'https';
  return transform;
}

/**
 * Construit les règles dynamiques declarativeNetRequest.
 * Les priorités décroissent avec l'ordre de la liste : la première redirection qui correspond gagne.
 */
export function buildDnrRules(mappings, settings = { enabled: true }) {
  if (settings?.enabled === false) return [];
  const usable = (mappings ?? []).filter((m) => m.enabled !== false && isUsable(m)).slice(0, MAX_MAPPINGS);
  return usable.map((mapping, index) => ({
    id: index + 1,
    priority: REDIRECT_RULE_PRIORITY_BASE + (usable.length - index),
    action: {
      type: 'redirect',
      redirect: { transform: buildTransform(mapping) }
    },
    condition: {
      regexFilter: buildRegexFilter(mapping),
      isUrlFilterCaseSensitive: false,
      resourceTypes: mapping.includeSubframes ? ['main_frame', 'sub_frame'] : ['main_frame']
    }
  }));
}

/** Les origines dont l'extension a besoin (source ET cible) pour pouvoir rediriger. */
export function requiredOrigins(mapping) {
  if (!isUsable(mapping)) return [];
  return [`*://${mapping.fromHost}/*`, `*://${mapping.toHost}/*`];
}

export function originsFor(mappings) {
  const origins = new Set();
  for (const mapping of mappings ?? []) {
    if (mapping.enabled === false) continue;
    for (const origin of requiredOrigins(mapping)) origins.add(origin);
  }
  return [...origins];
}

function hostMatches(hostname, mapping) {
  if (hostname === mapping.fromHost) return true;
  return mapping.includeSubdomains && hostname.endsWith(`.${mapping.fromHost}`);
}

/**
 * Reproduit côté JS ce que fera declarativeNetRequest : sert au champ « Tester une URL »,
 * au popup et aux tests. Renvoie l'URL de destination ou la raison de la non-correspondance.
 */
export function previewRedirect(inputUrl, mappings, settings = { enabled: true }) {
  let url;
  try {
    url = new URL(String(inputUrl ?? '').trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: 'unsupported-scheme' };
  if (settings?.enabled === false) return { ok: false, reason: 'paused' };

  for (const mapping of mappings ?? []) {
    if (mapping.enabled === false || !isUsable(mapping)) continue;
    if (!hostMatches(url.hostname, mapping)) continue;
    if (mapping.fromPort && url.port !== mapping.fromPort) continue;

    const out = new URL(url.toString());
    out.hostname = mapping.toHost;
    if (mapping.toPort) out.port = mapping.toPort;
    else if (mapping.fromPort) out.port = '';
    if (mapping.forceHttps) out.protocol = 'https:';
    return { ok: true, mapping, url: out.toString() };
  }
  return { ok: false, reason: 'no-match' };
}

/**
 * Chemin inverse : depuis une URL déjà redirigée, reconstruit l'URL d'origine (alias).
 * Utilisé par le bouton « Ouvrir sans redirection » du popup.
 */
export function reverseRedirect(inputUrl, mappings) {
  let url;
  try {
    url = new URL(String(inputUrl ?? '').trim());
  } catch {
    return null;
  }
  for (const mapping of mappings ?? []) {
    if (mapping.enabled === false || !isUsable(mapping)) continue;
    if (url.hostname !== mapping.toHost) continue;
    if (mapping.toPort && url.port !== mapping.toPort) continue;

    const out = new URL(url.toString());
    out.hostname = mapping.fromHost;
    if (mapping.fromPort) out.port = mapping.fromPort;
    else if (mapping.toPort) out.port = '';
    return { mapping, url: out.toString() };
  }
  return null;
}
