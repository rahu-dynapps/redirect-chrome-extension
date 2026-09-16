import {
  MAX_MAPPINGS,
  describeMapping,
  isUsable,
  newMappingId,
  normalizeMapping,
  previewRedirect,
  requiredOrigins
} from '../lib/rules.js';
import { DEFAULT_SETTINGS, loadState, saveMappings, saveSettings } from '../lib/storage.js';

const $ = (selector) => document.querySelector(selector);
const rulesList = $('#rules');
const template = $('#rule-template');

let state = { mappings: [], settings: { ...DEFAULT_SETTINGS } };
let grantedOrigins = new Set();

init();

async function init() {
  state = await loadState();
  $('#global-enabled').checked = state.settings.enabled !== false;

  const prefill = new URLSearchParams(location.search).get('from');
  if (prefill) {
    state.mappings.push(blankMapping(prefill));
    await persistMappings({ silent: true });
  }

  await refreshPermissions();
  render();
  if (prefill) focusRule(state.mappings[state.mappings.length - 1].id, '.js-to');

  $('#add-rule').addEventListener('click', onAddRule);
  $('#global-enabled').addEventListener('change', onToggleGlobal);
  $('#grant-all').addEventListener('click', onGrantAll);
  $('#test-run').addEventListener('click', runTest);
  $('#test-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTest();
  });
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', onImportFile);
  chrome.permissions.onAdded?.addListener(onPermissionsChanged);
  chrome.permissions.onRemoved?.addListener(onPermissionsChanged);
}

function blankMapping(from = '') {
  return normalizeMapping({ id: newMappingId(), from, to: '', enabled: true }).mapping;
}

async function refreshPermissions() {
  const all = await chrome.permissions.getAll();
  grantedOrigins = new Set(all.origins ?? []);
}

async function onPermissionsChanged() {
  await refreshPermissions();
  render();
}

function hasPermissions(mapping) {
  if (!isUsable(mapping)) return true;
  return requiredOrigins(mapping).every((origin) => grantedOrigins.has(origin) || grantedOrigins.has('*://*/*'));
}

function render() {
  rulesList.textContent = '';
  for (const mapping of state.mappings) rulesList.append(renderRule(mapping));
  $('#empty-state').hidden = state.mappings.length > 0;

  const missing = state.mappings.filter((m) => m.enabled !== false && isUsable(m) && !hasPermissions(m));
  $('#permission-banner').hidden = missing.length === 0;
}

function renderRule(mapping) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.id = mapping.id;
  node.classList.toggle('is-disabled', mapping.enabled === false);

  const from = node.querySelector('.js-from');
  const to = node.querySelector('.js-to');
  from.value = mapping.fromPort ? `${mapping.fromHost}:${mapping.fromPort}` : mapping.fromHost;
  to.value = mapping.toPort ? `${mapping.toHost}:${mapping.toPort}` : mapping.toHost;
  node.querySelector('.js-enabled').checked = mapping.enabled !== false;
  node.querySelector('.js-subdomains').checked = mapping.includeSubdomains;
  node.querySelector('.js-https').checked = mapping.forceHttps;
  node.querySelector('.js-subframes').checked = mapping.includeSubframes;
  node.querySelector('.js-note').value = mapping.note ?? '';

  const commit = () => updateMapping(mapping.id, node);
  for (const selector of ['.js-from', '.js-to', '.js-note']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  for (const selector of ['.js-enabled', '.js-subdomains', '.js-https', '.js-subframes']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  node.querySelector('.js-up').addEventListener('click', () => moveMapping(mapping.id, -1));
  node.querySelector('.js-down').addEventListener('click', () => moveMapping(mapping.id, +1));
  node.querySelector('.js-delete').addEventListener('click', () => deleteMapping(mapping.id));

  showRuleMessage(node, mapping);
  return node;
}

function showRuleMessage(node, mapping) {
  const message = node.querySelector('.js-message');
  message.textContent = '';
  message.className = 'rule-message js-message';
  node.classList.remove('has-error');

  const { errors } = normalizeMapping({
    ...mapping,
    from: mapping.fromPort ? `${mapping.fromHost}:${mapping.fromPort}` : mapping.fromHost,
    to: mapping.toPort ? `${mapping.toHost}:${mapping.toPort}` : mapping.toHost
  });

  const incomplete = !mapping.fromHost || !mapping.toHost;
  if (errors.length && !incomplete) {
    message.textContent = errors.join(' ');
    node.classList.add('has-error');
    message.hidden = false;
    return;
  }
  if (incomplete) {
    message.textContent = 'Renseignez le domaine source et le domaine cible.';
    message.classList.add('warn');
    message.hidden = false;
    return;
  }
  if (mapping.enabled !== false && !hasPermissions(mapping)) {
    message.textContent = `Chrome doit être autorisé à accéder à ${mapping.fromHost} et ${mapping.toHost}.`;
    message.classList.add('warn');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = 'Autoriser';
    button.addEventListener('click', () => requestOrigins(requiredOrigins(mapping)));
    message.append(button);
    message.hidden = false;
    return;
  }
  message.hidden = true;
}

async function updateMapping(id, node) {
  const index = state.mappings.findIndex((m) => m.id === id);
  if (index === -1) return;
  const { mapping } = normalizeMapping({
    id,
    from: node.querySelector('.js-from').value,
    to: node.querySelector('.js-to').value,
    enabled: node.querySelector('.js-enabled').checked,
    includeSubdomains: node.querySelector('.js-subdomains').checked,
    forceHttps: node.querySelector('.js-https').checked,
    includeSubframes: node.querySelector('.js-subframes').checked,
    note: node.querySelector('.js-note').value
  });
  state.mappings[index] = mapping;
  await persistMappings();
  // Pas de demande d'autorisation automatique ici : Chrome exige un geste utilisateur intact,
  // or l'enregistrement asynchrone le consomme. Le bouton « Autoriser » de la règle s'en charge.
  render();
}

async function onAddRule() {
  if (state.mappings.length >= MAX_MAPPINGS) {
    setStatus(`Maximum de ${MAX_MAPPINGS} redirections atteint.`, true);
    return;
  }
  const mapping = blankMapping();
  state.mappings.push(mapping);
  await persistMappings({ silent: true });
  render();
  focusRule(mapping.id, '.js-from');
}

async function deleteMapping(id) {
  const mapping = state.mappings.find((m) => m.id === id);
  const label = mapping && isUsable(mapping) ? describeMapping(mapping) : 'cette redirection';
  if (isUsable(mapping) && !confirm(`Supprimer ${label} ?`)) return;
  state.mappings = state.mappings.filter((m) => m.id !== id);
  await persistMappings();
  render();
}

async function moveMapping(id, delta) {
  const index = state.mappings.findIndex((m) => m.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= state.mappings.length) return;
  const [mapping] = state.mappings.splice(index, 1);
  state.mappings.splice(target, 0, mapping);
  await persistMappings();
  render();
  focusRule(id, '.js-from');
}

async function onToggleGlobal(event) {
  state.settings = { ...state.settings, enabled: event.target.checked };
  await saveSettings(state.settings);
  setStatus(event.target.checked ? 'Redirections activées.' : 'Redirections mises en pause.');
}

async function onGrantAll() {
  const origins = new Set();
  for (const mapping of state.mappings) {
    if (mapping.enabled === false) continue;
    for (const origin of requiredOrigins(mapping)) origins.add(origin);
  }
  await requestOrigins([...origins]);
}

async function requestOrigins(origins) {
  const missing = origins.filter((origin) => !grantedOrigins.has(origin));
  if (!missing.length) return true;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: missing });
  } catch (error) {
    setStatus(`Autorisation impossible : ${error.message}`, true);
  }
  await refreshPermissions();
  render();
  if (granted) setStatus('Autorisations accordées.');
  return granted;
}

async function persistMappings({ silent = false } = {}) {
  await saveMappings(state.mappings);
  if (!silent) setStatus('Enregistré.');
}

function focusRule(id, selector) {
  const node = rulesList.querySelector(`.rule[data-id="${CSS.escape(id)}"] ${selector}`);
  node?.focus();
}

function runTest() {
  const input = $('#test-input').value.trim();
  const result = $('#test-result');
  result.hidden = false;
  if (!input) {
    result.className = 'test-result ko';
    result.textContent = 'Saisissez une URL.';
    return;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const outcome = previewRedirect(candidate, state.mappings, state.settings);
  if (outcome.ok) {
    result.className = 'test-result ok';
    result.textContent = `→ ${outcome.url}`;
    if (!hasPermissions(outcome.mapping)) {
      result.className = 'test-result err';
      result.textContent += ' (autorisation manquante : la redirection ne s’appliquera pas)';
    }
    return;
  }
  result.className = outcome.reason === 'invalid-url' ? 'test-result err' : 'test-result ko';
  result.textContent = {
    'invalid-url': 'URL invalide.',
    'unsupported-scheme': 'Seules les URL http:// et https:// peuvent être redirigées.',
    paused: 'Les redirections sont en pause (interrupteur en haut de la page).',
    'no-match': 'Aucune redirection ne correspond : cette URL sera ouverte telle quelle.'
  }[outcome.reason];
}

function onExport() {
  const payload = JSON.stringify({ version: 1, mappings: state.mappings, settings: state.settings }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `redirections-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setIoResult(`${state.mappings.length} redirection(s) exportée(s).`, 'ok');
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed?.mappings;
    if (!Array.isArray(incoming)) throw new Error('format inattendu');

    const existing = new Set(state.mappings.map((m) => `${m.fromHost}:${m.fromPort}`));
    let added = 0;
    for (const raw of incoming) {
      const { mapping } = normalizeMapping({ ...raw, id: newMappingId() });
      if (!isUsable(mapping)) continue;
      const key = `${mapping.fromHost}:${mapping.fromPort}`;
      if (existing.has(key)) continue;
      existing.add(key);
      state.mappings.push(mapping);
      added += 1;
      if (state.mappings.length >= MAX_MAPPINGS) break;
    }
    await persistMappings({ silent: true });
    await refreshPermissions();
    render();
    setIoResult(
      added ? `${added} redirection(s) importée(s). Pensez à accorder les autorisations.` : 'Rien à importer (doublons ou entrées invalides).',
      added ? 'ok' : 'ko'
    );
  } catch (error) {
    setIoResult(`Import impossible : ${error.message}`, 'err');
  }
}

function setIoResult(text, kind) {
  const node = $('#io-result');
  node.hidden = false;
  node.className = `test-result ${kind}`;
  node.textContent = text;
}

let statusTimer;
function setStatus(text, isError = false) {
  const node = $('#status');
  node.textContent = text;
  node.style.color = isError ? 'var(--danger)' : 'var(--ok)';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    node.textContent = '';
  }, 2500);
}
