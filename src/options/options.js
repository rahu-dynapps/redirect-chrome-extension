import {
  MAX_MAPPINGS,
  describeMapping,
  isUsable,
  newMappingId,
  normalizeMapping,
  previewRedirect,
  requiredOrigins
} from '../lib/rules.js';
import {
  MAX_ENVIRONMENTS,
  MAX_SEARCHES,
  QUICK_SLOTS,
  isSearchUsable,
  normalizeEnvironment,
  normalizeSearch
} from '../lib/launcher.js';
import {
  DEFAULT_LAUNCHER,
  DEFAULT_SETTINGS,
  loadLauncher,
  loadState,
  saveEnvironments,
  saveLauncher,
  saveMappings,
  saveSearches,
  saveSettings
} from '../lib/storage.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state = {
  mappings: [],
  settings: { ...DEFAULT_SETTINGS },
  environments: [],
  searches: [],
  launcher: { ...DEFAULT_LAUNCHER }
};
let grantedOrigins = new Set();

init();

async function init() {
  const [redirectState, launcherState] = await Promise.all([loadState(), loadLauncher()]);
  state = { ...redirectState, ...launcherState };
  $('#global-enabled').checked = state.settings.enabled !== false;
  $('#open-in').value = state.launcher.openIn === 'current-tab' ? 'current-tab' : 'new-tab';

  const prefill = new URLSearchParams(location.search).get('from');
  if (prefill) {
    state.mappings.push(blankMapping(prefill));
    await persistMappings({ silent: true });
  }

  await refreshPermissions();
  renderAll();
  if (prefill) focusRow('#rules', state.mappings.at(-1).id, '.js-to');

  activateTab(location.hash.replace('#', '') || 'redirections');
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  }
  window.addEventListener('hashchange', () => activateTab(location.hash.replace('#', '')));

  $('#add-rule').addEventListener('click', onAddRule);
  $('#global-enabled').addEventListener('change', onToggleGlobal);
  $('#grant-all').addEventListener('click', onGrantAll);
  $('#test-run').addEventListener('click', runTest);
  $('#test-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runTest();
  });
  $('#add-environment').addEventListener('click', onAddEnvironment);
  $('#add-search').addEventListener('click', onAddSearch);
  $('#open-in').addEventListener('change', async (event) => {
    state.launcher = { ...state.launcher, openIn: event.target.value };
    await saveLauncher(state.launcher);
    setStatus('Enregistré.');
  });
  $('#open-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', onImportFile);
  chrome.permissions.onAdded?.addListener(onPermissionsChanged);
  chrome.permissions.onRemoved?.addListener(onPermissionsChanged);
}

function activateTab(name) {
  const tabs = ['redirections', 'lanceur'];
  const active = tabs.includes(name) ? name : 'redirections';
  for (const tab of $$('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === active));
  for (const panel of $$('.tab-panel')) panel.hidden = panel.dataset.panel !== active;
  if (location.hash.replace('#', '') !== active) history.replaceState(null, '', `#${active}`);
}

function renderAll() {
  renderRules();
  renderEnvironments();
  renderSearches();
  renderSlots();
  renderKnownHosts();
}

// --------------------------------------------------------------- redirections

function blankMapping(from = '') {
  return normalizeMapping({ id: newMappingId(), from, to: '', enabled: true }).mapping;
}

async function refreshPermissions() {
  const all = await chrome.permissions.getAll();
  grantedOrigins = new Set(all.origins ?? []);
}

async function onPermissionsChanged() {
  await refreshPermissions();
  renderRules();
}

function hasPermissions(mapping) {
  if (!isUsable(mapping)) return true;
  return requiredOrigins(mapping).every((origin) => grantedOrigins.has(origin) || grantedOrigins.has('*://*/*'));
}

function renderRules() {
  const list = $('#rules');
  list.textContent = '';
  for (const mapping of state.mappings) list.append(renderRule(mapping));
  $('#empty-state').hidden = state.mappings.length > 0;

  const missing = state.mappings.filter((m) => m.enabled !== false && isUsable(m) && !hasPermissions(m));
  $('#permission-banner').hidden = missing.length === 0;
  renderKnownHosts();
}

function renderRule(mapping) {
  const node = cloneTemplate('#rule-template', mapping.id);
  node.classList.toggle('is-disabled', mapping.enabled === false);

  node.querySelector('.js-from').value = withPort(mapping.fromHost, mapping.fromPort);
  node.querySelector('.js-to').value = withPort(mapping.toHost, mapping.toPort);
  node.querySelector('.js-enabled').checked = mapping.enabled !== false;
  node.querySelector('.js-subdomains').checked = mapping.includeSubdomains;
  node.querySelector('.js-https').checked = mapping.forceHttps;
  node.querySelector('.js-subframes').checked = mapping.includeSubframes;
  node.querySelector('.js-note').value = mapping.note ?? '';

  const commit = () => updateMapping(mapping.id, node);
  for (const selector of ['.js-from', '.js-to', '.js-note', '.js-enabled', '.js-subdomains', '.js-https', '.js-subframes']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  wireRowButtons(node, {
    onUp: () => moveItem('mappings', mapping.id, -1),
    onDown: () => moveItem('mappings', mapping.id, +1),
    onDelete: () => deleteMapping(mapping.id)
  });

  showMappingMessage(node, mapping);
  return node;
}

function withPort(host, port) {
  return port ? `${host}:${port}` : host ?? '';
}

function showMappingMessage(node, mapping) {
  const message = resetMessage(node);
  const { errors } = normalizeMapping({
    ...mapping,
    from: withPort(mapping.fromHost, mapping.fromPort),
    to: withPort(mapping.toHost, mapping.toPort)
  });
  const incomplete = !mapping.fromHost || !mapping.toHost;

  if (errors.length && !incomplete) {
    message.textContent = errors.join(' ');
    node.classList.add('has-error');
    message.hidden = false;
  } else if (incomplete) {
    message.textContent = 'Renseignez le domaine source et le domaine cible.';
    message.classList.add('warn');
    message.hidden = false;
  } else if (mapping.enabled !== false && !hasPermissions(mapping)) {
    message.textContent = `Chrome doit être autorisé à accéder à ${mapping.fromHost} et ${mapping.toHost}.`;
    message.classList.add('warn');
    message.append(
      button('Autoriser', () => requestOrigins(requiredOrigins(mapping)))
    );
    message.hidden = false;
  }
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
  renderRules();
}

async function onAddRule() {
  if (state.mappings.length >= MAX_MAPPINGS) {
    setStatus(`Maximum de ${MAX_MAPPINGS} redirections atteint.`, true);
    return;
  }
  const mapping = blankMapping();
  state.mappings.push(mapping);
  await persistMappings({ silent: true });
  renderRules();
  focusRow('#rules', mapping.id, '.js-from');
}

async function deleteMapping(id) {
  const mapping = state.mappings.find((m) => m.id === id);
  const label = mapping && isUsable(mapping) ? describeMapping(mapping) : 'cette redirection';
  if (isUsable(mapping) && !confirm(`Supprimer ${label} ?`)) return;
  state.mappings = state.mappings.filter((m) => m.id !== id);
  await persistMappings();
  renderRules();
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
  renderRules();
  if (granted) setStatus('Autorisations accordées.');
  return granted;
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

// ------------------------------------------------------------------- lanceur

function renderKnownHosts() {
  const datalist = $('#known-hosts');
  if (!datalist) return;
  datalist.textContent = '';
  const hosts = new Set();
  for (const mapping of state.mappings) {
    if (mapping.toHost) hosts.add(`https://${withPort(mapping.toHost, mapping.toPort)}`);
    if (mapping.fromHost) hosts.add(`https://${withPort(mapping.fromHost, mapping.fromPort)}`);
  }
  for (const host of hosts) {
    const option = document.createElement('option');
    option.value = host;
    datalist.append(option);
  }
}

function renderEnvironments() {
  const list = $('#environments');
  list.textContent = '';
  for (const environment of state.environments) list.append(renderEnvironment(environment));
  $('#environments-empty').hidden = state.environments.length > 0;
}

function renderEnvironment(environment) {
  const node = cloneTemplate('#environment-template', environment.id);
  node.querySelector('.js-label').value = environment.label ?? '';
  node.querySelector('.js-base').value = environment.baseUrl ?? '';

  const commit = () => updateEnvironment(environment.id, node);
  for (const selector of ['.js-label', '.js-base']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  wireRowButtons(node, {
    onUp: () => moveItem('environments', environment.id, -1),
    onDown: () => moveItem('environments', environment.id, +1),
    onDelete: () => deleteEnvironment(environment.id)
  });

  const { errors } = normalizeEnvironment(environment);
  if (errors.length) {
    const message = resetMessage(node);
    message.textContent = errors.join(' ');
    node.classList.add('has-error');
    message.hidden = false;
  }
  return node;
}

async function updateEnvironment(id, node) {
  const index = state.environments.findIndex((e) => e.id === id);
  if (index === -1) return;
  const { environment } = normalizeEnvironment({
    id,
    label: node.querySelector('.js-label').value,
    baseUrl: node.querySelector('.js-base').value
  });
  state.environments[index] = environment;
  await saveEnvironments(state.environments);
  setStatus('Enregistré.');
  renderEnvironments();
  renderSearches();
  renderSlots();
}

async function onAddEnvironment() {
  if (state.environments.length >= MAX_ENVIRONMENTS) {
    setStatus(`Maximum de ${MAX_ENVIRONMENTS} environnements atteint.`, true);
    return;
  }
  const { environment } = normalizeEnvironment({ label: '', baseUrl: '' });
  state.environments.push(environment);
  await saveEnvironments(state.environments);
  renderEnvironments();
  renderSearches();
  renderSlots();
  focusRow('#environments', environment.id, '.js-label');
}

async function deleteEnvironment(id) {
  const environment = state.environments.find((e) => e.id === id);
  if (environment?.baseUrl && !confirm(`Supprimer l'environnement « ${environment.label} » ?`)) return;
  state.environments = state.environments.filter((e) => e.id !== id);
  // Les recherches et raccourcis qui pointaient dessus retombent sur le choix du lanceur.
  state.searches = state.searches.map((s) => (s.environmentId === id ? { ...s, environmentId: '' } : s));
  state.launcher = {
    ...state.launcher,
    lastEnvironmentId: state.launcher.lastEnvironmentId === id ? '' : state.launcher.lastEnvironmentId,
    slots: Object.fromEntries(
      Object.entries(state.launcher.slots ?? {}).map(([key, slot]) => [
        key,
        slot?.environmentId === id ? { ...slot, environmentId: '' } : slot
      ])
    )
  };
  await Promise.all([saveEnvironments(state.environments), saveSearches(state.searches), saveLauncher(state.launcher)]);
  setStatus('Enregistré.');
  renderEnvironments();
  renderSearches();
  renderSlots();
}

function renderSearches() {
  const list = $('#searches');
  list.textContent = '';
  for (const search of state.searches) list.append(renderSearch(search));
  $('#searches-empty').hidden = state.searches.length > 0;
}

function renderSearch(search) {
  const node = cloneTemplate('#search-template', search.id);
  node.querySelector('.js-label').value = search.label ?? '';
  node.querySelector('.js-keyword').value = search.keyword ?? '';
  node.querySelector('.js-template').value = search.template ?? '';
  fillSelect(node.querySelector('.js-env'), state.environments, search.environmentId, {
    emptyLabel: 'Choisi dans le lanceur'
  });

  const commit = () => updateSearch(search.id, node);
  for (const selector of ['.js-label', '.js-keyword', '.js-template', '.js-env']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  wireRowButtons(node, {
    onUp: () => moveItem('searches', search.id, -1),
    onDown: () => moveItem('searches', search.id, +1),
    onDelete: () => deleteSearch(search.id)
  });

  const { errors } = normalizeSearch(search);
  const duplicate =
    search.keyword && state.searches.some((s) => s.id !== search.id && s.keyword === search.keyword);
  if (errors.length || duplicate) {
    const message = resetMessage(node);
    message.textContent = [...errors, duplicate ? `Le mot-clé « ${search.keyword} » est déjà utilisé.` : '']
      .filter(Boolean)
      .join(' ');
    node.classList.add('has-error');
    message.hidden = false;
  }
  return node;
}

async function updateSearch(id, node) {
  const index = state.searches.findIndex((s) => s.id === id);
  if (index === -1) return;
  const { search } = normalizeSearch({
    id,
    label: node.querySelector('.js-label').value,
    keyword: node.querySelector('.js-keyword').value,
    template: node.querySelector('.js-template').value,
    environmentId: node.querySelector('.js-env').value
  });
  state.searches[index] = search;
  await saveSearches(state.searches);
  setStatus('Enregistré.');
  renderSearches();
  renderSlots();
}

async function onAddSearch() {
  if (state.searches.length >= MAX_SEARCHES) {
    setStatus(`Maximum de ${MAX_SEARCHES} recherches atteint.`, true);
    return;
  }
  const { search } = normalizeSearch({ label: '', template: '' });
  state.searches.push(search);
  await saveSearches(state.searches);
  renderSearches();
  renderSlots();
  focusRow('#searches', search.id, '.js-label');
}

async function deleteSearch(id) {
  const search = state.searches.find((s) => s.id === id);
  if (isSearchUsable(search) && !confirm(`Supprimer la recherche « ${search.label} » ?`)) return;
  state.searches = state.searches.filter((s) => s.id !== id);
  state.launcher = {
    ...state.launcher,
    lastSearchId: state.launcher.lastSearchId === id ? '' : state.launcher.lastSearchId,
    slots: Object.fromEntries(
      Object.entries(state.launcher.slots ?? {}).map(([key, slot]) => [
        key,
        slot?.searchId === id ? { ...slot, searchId: '' } : slot
      ])
    )
  };
  await Promise.all([saveSearches(state.searches), saveLauncher(state.launcher)]);
  setStatus('Enregistré.');
  renderSearches();
  renderSlots();
}

function renderSlots() {
  const list = $('#slots');
  list.textContent = '';
  QUICK_SLOTS.forEach((command, index) => {
    const node = document.querySelector('#slot-template').content.firstElementChild.cloneNode(true);
    const slot = state.launcher.slots?.[command] ?? {};
    node.querySelector('.slot-name').textContent = `Raccourci rapide ${index + 1}`;
    fillSelect(node.querySelector('.js-search'), state.searches.filter(isSearchUsable), slot.searchId, {
      emptyLabel: 'Dernière utilisée'
    });
    fillSelect(node.querySelector('.js-env'), state.environments, slot.environmentId, {
      emptyLabel: 'Dernier utilisé'
    });
    for (const selector of ['.js-search', '.js-env']) {
      node.querySelector(selector).addEventListener('change', async () => {
        state.launcher = {
          ...state.launcher,
          slots: {
            ...state.launcher.slots,
            [command]: {
              searchId: node.querySelector('.js-search').value,
              environmentId: node.querySelector('.js-env').value
            }
          }
        };
        await saveLauncher(state.launcher);
        setStatus('Enregistré.');
      });
    }
    list.append(node);
  });
}

// ------------------------------------------------------------ import/export

function onExport() {
  const payload = JSON.stringify(
    {
      version: 2,
      mappings: state.mappings,
      settings: state.settings,
      environments: state.environments,
      searches: state.searches,
      launcher: state.launcher
    },
    null,
    2
  );
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `redirections-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setIoResult(
    `${state.mappings.length} redirection(s), ${state.environments.length} environnement(s) et ${state.searches.length} recherche(s) exportés.`,
    'ok'
  );
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const counts = { mappings: 0, environments: 0, searches: 0 };

    const incomingMappings = Array.isArray(parsed) ? parsed : parsed?.mappings;
    if (Array.isArray(incomingMappings)) {
      const known = new Set(state.mappings.map((m) => `${m.fromHost}:${m.fromPort}`));
      for (const raw of incomingMappings) {
        if (state.mappings.length >= MAX_MAPPINGS) break;
        const { mapping } = normalizeMapping({ ...raw, id: newMappingId() });
        const key = `${mapping.fromHost}:${mapping.fromPort}`;
        if (!isUsable(mapping) || known.has(key)) continue;
        known.add(key);
        state.mappings.push(mapping);
        counts.mappings += 1;
      }
    }

    if (Array.isArray(parsed?.environments)) {
      const known = new Set(state.environments.map((e) => e.baseUrl));
      for (const raw of parsed.environments) {
        if (state.environments.length >= MAX_ENVIRONMENTS) break;
        const { environment, errors } = normalizeEnvironment({ ...raw, id: undefined });
        if (errors.length || known.has(environment.baseUrl)) continue;
        known.add(environment.baseUrl);
        state.environments.push(environment);
        counts.environments += 1;
      }
    }

    if (Array.isArray(parsed?.searches)) {
      const known = new Set(state.searches.map((s) => s.template));
      for (const raw of parsed.searches) {
        if (state.searches.length >= MAX_SEARCHES) break;
        // Les identifiants d'environnement d'un autre poste n'ont pas de sens ici.
        const { search, errors } = normalizeSearch({ ...raw, id: undefined, environmentId: '' });
        if (errors.length || known.has(search.template)) continue;
        known.add(search.template);
        state.searches.push(search);
        counts.searches += 1;
      }
    }

    await Promise.all([
      saveMappings(state.mappings),
      saveEnvironments(state.environments),
      saveSearches(state.searches)
    ]);
    await refreshPermissions();
    renderAll();
    const total = counts.mappings + counts.environments + counts.searches;
    setIoResult(
      total
        ? `Importé : ${counts.mappings} redirection(s), ${counts.environments} environnement(s), ${counts.searches} recherche(s). Pensez à accorder les autorisations.`
        : 'Rien à importer (doublons ou entrées invalides).',
      total ? 'ok' : 'ko'
    );
  } catch (error) {
    setIoResult(`Import impossible : ${error.message}`, 'err');
  }
}

// -------------------------------------------------------------------- outils

function cloneTemplate(selector, id) {
  const node = document.querySelector(selector).content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  return node;
}

function wireRowButtons(node, { onUp, onDown, onDelete }) {
  node.querySelector('.js-up').addEventListener('click', onUp);
  node.querySelector('.js-down').addEventListener('click', onDown);
  node.querySelector('.js-delete').addEventListener('click', onDelete);
}

function resetMessage(node) {
  const message = node.querySelector('.js-message');
  message.textContent = '';
  message.className = 'rule-message js-message';
  node.classList.remove('has-error');
  return message;
}

function button(label, handler) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'btn';
  node.textContent = label;
  node.addEventListener('click', handler);
  return node;
}

function fillSelect(select, items, selectedId, { emptyLabel } = {}) {
  select.textContent = '';
  if (emptyLabel) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.append(option);
  }
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.baseUrl || 'Sans nom';
    select.append(option);
  }
  select.value = items.some((item) => item.id === selectedId) ? selectedId : '';
}

const LISTS = {
  mappings: { save: () => saveMappings(state.mappings), render: renderRules },
  environments: {
    save: () => saveEnvironments(state.environments),
    render: () => {
      renderEnvironments();
      renderSearches();
      renderSlots();
    }
  },
  searches: {
    save: () => saveSearches(state.searches),
    render: () => {
      renderSearches();
      renderSlots();
    }
  }
};

async function moveItem(listName, id, delta) {
  const list = state[listName];
  const index = list.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  await LISTS[listName].save();
  setStatus('Enregistré.');
  LISTS[listName].render();
  focusRow(`#${listName === 'mappings' ? 'rules' : listName}`, id, '.js-up');
}

async function persistMappings({ silent = false } = {}) {
  await saveMappings(state.mappings);
  if (!silent) setStatus('Enregistré.');
}

function focusRow(listSelector, id, fieldSelector) {
  document.querySelector(`${listSelector} [data-id="${CSS.escape(id)}"] ${fieldSelector}`)?.focus();
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
