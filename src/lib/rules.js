// Fonctions pures partagées par le service worker, les pages d'options/popup et les tests.
// Aucun appel aux API chrome.* ici : ce module doit rester exécutable sous Node.
//
// Deux types de redirection :
//   « domain »  — échange d'hôte, le reste de l'URL est conservé tel quel ;
//   « pattern » — motif d'URL avec captures {nom}, réécrit vers un modèle d'URL complet.

export const REDIRECT_RULE_PRIORITY_BASE = 1;
export const BYPASS_RULE_PRIORITY = 1000000;
export const MAX_MAPPINGS = 200;
export const MAX_PLACEHOLDERS = 9; // declarativeNetRequest ne connaît que \1 à \9

const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
// Jetons du motif : /**/ (segments optionnels), {nom} (capture), ** (tout), * (dans un segment).
const PATTERN_TOKEN_RE = /\/\*\*\/|\{([a-zA-Z][a-zA-Z0-9_]*)\}|\*\*|\*/g;

/**
 * Accepte aussi bien « helpdesk.example.com » qu'une URL complète collée depuis un mail
 * (« https://helpdesk.example.com/tickets/42?debug=1 ») et n'en garde que l'hôte + le port.
 * Les erreurs sont renvoyées sous forme de code : la traduction est faite par l'interface.
 * @returns {{ok: true, host: string, port: string} | {ok: false, code: string, value: string}}
 */
export function parseHostInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, code: 'errHostEmpty', value: '' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, code: 'errHostInvalid', value: input };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, code: 'errHostScheme', value: input };
  }
  // new URL() se charge de la mise en minuscules et de la conversion IDN (punycode).
  const host = url.hostname;
  if (!HOSTNAME_RE.test(host)) {
    return { ok: false, code: 'errHostInvalid', value: input };
  }
  if (url.port && !/^\d{1,5}$/.test(url.port)) {
    return { ok: false, code: 'errHostPort', value: input };
  }
  return { ok: true, host, port: url.port || '' };
}

/**
 * Normalise une redirection saisie dans l'interface. Les deux jeux de champs (domaine et motif)
 * sont conservés afin de ne rien perdre quand on bascule d'un type à l'autre ; seul le type actif
 * est validé.
 * @returns {{mapping: object, errors: Array<{field: string, code: string, value: string}>}}
 */
export function normalizeMapping(raw) {
  const kind = raw?.kind === 'pattern' ? 'pattern' : 'domain';
  const from = parseHostInput(raw?.from ?? raw?.fromHost ?? '');
  const to = parseHostInput(raw?.to ?? raw?.toHost ?? '');

  const mapping = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newMappingId(),
    enabled: raw?.enabled !== false,
    kind,
    fromHost: from.ok ? from.host : String(raw?.from ?? raw?.fromHost ?? '').trim(),
    fromPort: from.ok ? from.port : '',
    toHost: to.ok ? to.host : String(raw?.to ?? raw?.toHost ?? '').trim(),
    toPort: to.ok ? to.port : '',
    includeSubdomains: raw?.includeSubdomains === true,
    forceHttps: raw?.forceHttps === true,
    pattern: String(raw?.pattern ?? '').trim(),
    target: String(raw?.target ?? '').trim(),
    includeSubframes: raw?.includeSubframes === true,
    note: typeof raw?.note === 'string' ? raw.note.slice(0, 200) : ''
  };

  const errors = [];
  if (kind === 'pattern') {
    const compiled = compilePattern(mapping.pattern);
    if (!compiled.ok) errors.push({ field: 'pattern', code: compiled.code, value: compiled.value ?? '' });
    const target = compileTarget(mapping.target, compiled.ok ? compiled.names : []);
    if (!target.ok) errors.push({ field: 'target', code: target.code, value: target.value ?? '' });
  } else {
    if (!from.ok) errors.push({ field: 'from', code: from.code, value: from.value });
    if (!to.ok) errors.push({ field: 'to', code: to.code, value: to.value });
    if (from.ok && to.ok && hostKey(mapping.fromHost, mapping.fromPort) === hostKey(mapping.toHost, mapping.toPort)) {
      errors.push({ field: '', code: 'errSameHost', value: '' });
    }
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
  if (mapping?.kind === 'pattern') return `${mapping.pattern} → ${mapping.target}`;
  return `${hostKey(mapping.fromHost, mapping.fromPort)} → ${hostKey(mapping.toHost, mapping.toPort)}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Dans une substitution declarativeNetRequest, seul l'antislash est un caractère spécial. */
function escapeSubstitution(value) {
  return value.replace(/\\/g, '\\\\');
}

/* ------------------------------------------------------------------ motifs d'URL */

/**
 * Compile un motif saisi par l'utilisateur en expression régulière RE2 (sans lookahead).
 *
 * Exemple : « helpdesk.example.com/[**]/my/tasks/{id} » (sans les crochets) devient
 * « ^https?://helpdesk\.example\.com(?::\d+)?/(?:.*[/])?my/tasks/([^/?#]+)(?:[?#].*)?$ ».
 *
 * Jetons : {nom} capture un segment, `*` remplace une portion de segment, `**` n'importe quoi,
 * et `**` entouré de barres obliques un nombre quelconque de segments, y compris aucun.
 * @returns {{ok: true, regex: string, names: string[], host: string} | {ok: false, code, value}}
 */
export function compilePattern(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, code: 'errPatternEmpty', value: '' };

  const schemeMatch = /^(https?):\/\//i.exec(input);
  const scheme = schemeMatch ? `${schemeMatch[1].toLowerCase()}://` : 'https?://';
  const rest = schemeMatch ? input.slice(schemeMatch[0].length) : input;

  const separator = rest.search(/[/?#]/);
  const hostPart = separator === -1 ? rest : rest.slice(0, separator);
  const pathPart = separator === -1 ? '' : rest.slice(separator);

  const host = parseHostInput(hostPart);
  if (!host.ok) return { ok: false, code: 'errPatternHost', value: hostPart };

  const names = [];
  let body = '';
  let last = 0;
  for (const match of pathPart.matchAll(PATTERN_TOKEN_RE)) {
    body += escapeRegex(pathPart.slice(last, match.index));
    if (match[0] === '/**/') {
      body += '/(?:.*/)?';
    } else if (match[1]) {
      if (names.includes(match[1])) return { ok: false, code: 'errPatternDuplicate', value: match[1] };
      names.push(match[1]);
      body += '([^/?#]+)';
    } else {
      body += match[0] === '**' ? '.*' : '[^/?#]*';
    }
    last = match.index + match[0].length;
  }
  body += escapeRegex(pathPart.slice(last));

  if (names.length > MAX_PLACEHOLDERS) {
    return { ok: false, code: 'errPatternTooMany', value: String(MAX_PLACEHOLDERS) };
  }

  const port = host.port ? `:${host.port}` : '(?::\\d+)?';
  // Sans point d'interrogation ni ancre dans le motif, la chaîne de requête est ignorée.
  const tail = /[?#]/.test(pathPart) ? '' : '(?:[?#].*)?';
  const regex = `^${scheme}${escapeRegex(host.host)}${port}${body}${tail}$`;

  // declarativeNetRequest n'accepte que des expressions régulières ASCII.
  if (/[^\x00-\x7F]/.test(regex)) return { ok: false, code: 'errPatternNonAscii', value: input };

  return { ok: true, regex, names, host: host.host };
}

/**
 * Compile le modèle d'URL cible en chaîne de substitution declarativeNetRequest (\1, \2…).
 * @returns {{ok: true, substitution: string, template: string, host: string} | {ok: false, code, value}}
 */
export function compileTarget(raw, names = []) {
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, code: 'errTargetEmpty', value: '' };

  const template = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const hostPart = template.slice(template.indexOf('://') + 3).split(/[/?#]/)[0];
  if (hostPart.includes('{')) return { ok: false, code: 'errTargetHostPlaceholder', value: hostPart };

  let substitution = '';
  let last = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const index = names.indexOf(match[1]);
    if (index === -1) return { ok: false, code: 'errTargetUnknownPlaceholder', value: match[1] };
    substitution += escapeSubstitution(template.slice(last, match.index)) + `\\${index + 1}`;
    last = match.index + match[0].length;
  }
  substitution += escapeSubstitution(template.slice(last));

  let sample;
  try {
    sample = new URL(template.replace(PLACEHOLDER_RE, '1'));
  } catch {
    return { ok: false, code: 'errTargetInvalid', value: input };
  }
  if (!/^https?:$/.test(sample.protocol)) return { ok: false, code: 'errTargetInvalid', value: input };

  return { ok: true, substitution, template, host: sample.hostname };
}

/* --------------------------------------------------------------- règles et aperçu */

/** Une redirection n'est utilisable que si ses champs actifs sont valides. */
export function isUsable(mapping) {
  if (!mapping) return false;
  if (mapping.kind === 'pattern') {
    const compiled = compilePattern(mapping.pattern);
    return compiled.ok && compileTarget(mapping.target, compiled.names).ok;
  }
  return Boolean(
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
  if (mapping.kind === 'pattern') return compilePattern(mapping.pattern).regex;
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
      redirect:
        mapping.kind === 'pattern'
          ? { regexSubstitution: compileTarget(mapping.target, compilePattern(mapping.pattern).names).substitution }
          : { transform: buildTransform(mapping) }
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
  if (mapping.kind === 'pattern') {
    const source = compilePattern(mapping.pattern);
    const target = compileTarget(mapping.target, source.names);
    return [`*://${source.host}/*`, `*://${target.host}/*`];
  }
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

/** Applique une règle de motif à une URL. Renvoie l'URL réécrite, ou null si le motif ne matche pas. */
function applyPattern(url, mapping) {
  const compiled = compilePattern(mapping.pattern);
  if (!compiled.ok) return null;
  const match = new RegExp(compiled.regex, 'i').exec(url.toString());
  if (!match) return null;

  const target = compileTarget(mapping.target, compiled.names);
  if (!target.ok) return null;

  PLACEHOLDER_RE.lastIndex = 0;
  const result = target.template.replace(PLACEHOLDER_RE, (_, name) => match[compiled.names.indexOf(name) + 1] ?? '');
  try {
    return new URL(result).toString();
  } catch {
    return null;
  }
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

    if (mapping.kind === 'pattern') {
      const rewritten = applyPattern(url, mapping);
      if (rewritten) return { ok: true, mapping, url: rewritten };
      continue;
    }

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
 * Utilisé par le bouton « Ouvrir sans redirection » du popup. Sans objet pour les motifs d'URL,
 * dont la réécriture n'est pas réversible.
 */
export function reverseRedirect(inputUrl, mappings) {
  let url;
  try {
    url = new URL(String(inputUrl ?? '').trim());
  } catch {
    return null;
  }
  for (const mapping of mappings ?? []) {
    if (mapping.enabled === false || mapping.kind === 'pattern' || !isUsable(mapping)) continue;
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
