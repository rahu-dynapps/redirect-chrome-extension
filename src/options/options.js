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
  countOverrides,
  isSearchUsable,
  normalizeEnvironment,
  normalizeSearch
} from '../lib/launcher.js';
import { applyI18n, t } from '../lib/i18n.js';
import { buildExport, importConfiguration } from '../lib/transfer.js';
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
  applyI18n();
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
  await refreshRuleError();
  renderAll();
  chrome.storage.session.onChanged?.addListener(() => refreshRuleError());
  if (prefill) focusRow('#rules', state.mappings.at(-1).id, '.js-to');

  activateTab(location.hash.replace('#', '') || 'redirects');
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
    setStatus(t('statusSaved'));
  });
  $('#open-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  $('#export').addEventListener('click', onExport);
  $('#import-merge').addEventListener('click', () => pickImportFile('merge'));
  $('#import-replace').addEventListener('click', () => pickImportFile('replace'));
  $('#import-file').addEventListener('change', onImportFile);
  chrome.permissions.onAdded?.addListener(onPermissionsChanged);
  chrome.permissions.onRemoved?.addListener(onPermissionsChanged);
}

function activateTab(name) {
  const tabs = ['redirects', 'launcher'];
  const active = tabs.includes(name) ? name : 'redirects';
  for (const tab of $$('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === active));
  for (const panel of $$('.tab-panel')) panel.hidden = panel.dataset.panel !== active;
  if (location.hash.replace('#', '') !== active) history.replaceState(null, '', `#${active}`);
}

/** Signale une règle que Chrome a refusé d'appliquer : sans cela, l'échec est invisible. */
async function refreshRuleError() {
  const stored = await chrome.storage.session.get('ruleError');
  const error = stored?.ruleError;
  const banner = $('#rule-error-banner');
  const list = $('#rule-error-list');
  list.textContent = '';
  banner.hidden = !error;
  if (!error) return;

  const entries = error.failures?.length ? error.failures : [{ label: '', message: error.message }];
  for (const entry of entries) {
    const item = document.createElement('li');
    item.textContent = entry.label ? `${entry.label} — ${entry.message}` : entry.message;
    list.append(item);
  }
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
  return normalizeMapping({ id: newMappingId(), kind: 'domain', from, to: '', enabled: true }).mapping;
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
  node.dataset.kind = mapping.kind;

  node.querySelector('.js-kind').value = mapping.kind;
  node.querySelector('.js-from').value = withPort(mapping.fromHost, mapping.fromPort);
  node.querySelector('.js-to').value = withPort(mapping.toHost, mapping.toPort);
  node.querySelector('.js-pattern').value = mapping.pattern ?? '';
  node.querySelector('.js-target').value = mapping.target ?? '';
  node.querySelector('.js-enabled').checked = mapping.enabled !== false;
  node.querySelector('.js-subdomains').checked = mapping.includeSubdomains;
  node.querySelector('.js-https').checked = mapping.forceHttps;
  node.querySelector('.js-subframes').checked = mapping.includeSubframes;
  node.querySelector('.js-note').value = mapping.note ?? '';

  const commit = () => updateMapping(mapping.id, node);
  for (const selector of [
    '.js-kind',
    '.js-from',
    '.js-to',
    '.js-pattern',
    '.js-target',
    '.js-note',
    '.js-enabled',
    '.js-subdomains',
    '.js-https',
    '.js-subframes'
  ]) {
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
  const incomplete =
    mapping.kind === 'pattern' ? !mapping.pattern || !mapping.target : !mapping.fromHost || !mapping.toHost;

  if (errors.length && !incomplete) {
    message.textContent = errors.map(translateError).join(' ');
    node.classList.add('has-error');
    message.hidden = false;
  } else if (incomplete) {
    message.textContent = t('msgIncomplete');
    message.classList.add('warn');
    message.hidden = false;
  } else if (mapping.enabled !== false && !hasPermissions(mapping)) {
    const [sourceOrigin, targetOrigin] = requiredOrigins(mapping).map(originHost);
    message.textContent = t('msgMissingPermission', [sourceOrigin, targetOrigin]);
    message.classList.add('warn');
    message.append(button(t('btnAllow'), () => requestOrigins(requiredOrigins(mapping))));
    message.hidden = false;
  }
}

async function updateMapping(id, node) {
  const index = state.mappings.findIndex((m) => m.id === id);
  if (index === -1) return;
  const { mapping } = normalizeMapping({
    id,
    kind: node.querySelector('.js-kind').value,
    from: node.querySelector('.js-from').value,
    to: node.querySelector('.js-to').value,
    pattern: node.querySelector('.js-pattern').value,
    target: node.querySelector('.js-target').value,
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
    setStatus(t('statusMaxRedirects', [String(MAX_MAPPINGS)]), true);
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
  const label = mapping && isUsable(mapping) ? describeMapping(mapping) : t('thisRedirect');
  if (isUsable(mapping) && !confirm(t('confirmDelete', [label]))) return;
  state.mappings = state.mappings.filter((m) => m.id !== id);
  await persistMappings();
  renderRules();
}

async function onToggleGlobal(event) {
  state.settings = { ...state.settings, enabled: event.target.checked };
  await saveSettings(state.settings);
  setStatus(t(event.target.checked ? 'statusRedirectsOn' : 'statusRedirectsOff'));
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
    setStatus(t('statusPermissionError', [error.message]), true);
  }
  await refreshPermissions();
  renderRules();
  if (granted) setStatus(t('statusPermissionsGranted'));
  return granted;
}

function runTest() {
  const input = $('#test-input').value.trim();
  const result = $('#test-result');
  result.hidden = false;
  if (!input) {
    result.className = 'test-result ko';
    result.textContent = t('testEmpty');
    return;
  }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const outcome = previewRedirect(candidate, state.mappings, state.settings);
  if (outcome.ok) {
    result.className = 'test-result ok';
    result.textContent = `→ ${outcome.url}`;
    if (!hasPermissions(outcome.mapping)) {
      result.className = 'test-result err';
      result.textContent += ` ${t('testMissingPermission')}`;
    }
    return;
  }
  result.className = outcome.reason === 'invalid-url' ? 'test-result err' : 'test-result ko';
  result.textContent = t(
    {
      'invalid-url': 'testInvalidUrl',
      'unsupported-scheme': 'testUnsupportedScheme',
      paused: 'testPaused',
      'no-match': 'testNoMatch'
    }[outcome.reason]
  );
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
    message.textContent = errors.map(translateError).join(' ');
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
  setStatus(t('statusSaved'));
  renderEnvironments();
  renderSearches();
  renderSlots();
}

async function onAddEnvironment() {
  if (state.environments.length >= MAX_ENVIRONMENTS) {
    setStatus(t('statusMaxEnvironments', [String(MAX_ENVIRONMENTS)]), true);
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
  if (environment?.baseUrl && !confirm(t('confirmDeleteEnvironment', [labelOf(environment)]))) return;
  state.environments = state.environments.filter((e) => e.id !== id);
  // Les recherches et raccourcis qui pointaient dessus retombent sur le choix du lanceur.
  state.searches = state.searches.map((s) => {
    const { [id]: removed, ...overrides } = s.overrides ?? {};
    return { ...s, overrides, environmentId: s.environmentId === id ? '' : s.environmentId };
  });
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
  setStatus(t('statusSaved'));
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
    emptyLabel: t('envChosenInLauncher')
  });

  const commit = () => updateSearch(search.id, node);
  for (const selector of ['.js-label', '.js-keyword', '.js-template', '.js-env']) {
    node.querySelector(selector).addEventListener('change', commit);
  }
  renderOverrides(node, search, commit);
  wireRowButtons(node, {
    onUp: () => moveItem('searches', search.id, -1),
    onDown: () => moveItem('searches', search.id, +1),
    onDelete: () => deleteSearch(search.id)
  });

  const { errors } = normalizeSearch(search);
  for (const error of errors) {
    if (!error.environmentId) continue;
    node.querySelector(`.override-row[data-env-id="${CSS.escape(error.environmentId)}"]`)?.classList.add('has-error');
  }
  const duplicate =
    search.keyword && state.searches.some((s) => s.id !== search.id && s.keyword === search.keyword);
  if (errors.length || duplicate) {
    const message = resetMessage(node);
    message.textContent = [
      ...errors.map((error) =>
        error.environmentId
          ? t('errOverrideNoPlaceholder', [labelOf(state.environments.find((e) => e.id === error.environmentId))])
          : translateError(error)
      ),
      duplicate ? t('errDuplicateKeyword', [search.keyword]) : ''
    ]
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
  const overrides = {};
  for (const input of node.querySelectorAll('.js-override')) {
    overrides[input.dataset.envId] = input.value;
  }
  const { search } = normalizeSearch({
    id,
    label: node.querySelector('.js-label').value,
    keyword: node.querySelector('.js-keyword').value,
    template: node.querySelector('.js-template').value,
    environmentId: node.querySelector('.js-env').value,
    overrides
  });
  state.searches[index] = search;
  await saveSearches(state.searches);
  setStatus(t('statusSaved'));
  renderSearches();
  renderSlots();
}

/** Un champ par environnement : vide = le modèle par défaut de la recherche s'applique. */
function renderOverrides(node, search, commit) {
  const container = node.querySelector('.js-overrides');
  const count = countOverrides(search);
  node.querySelector('.js-overrides-count').textContent = count ? ` — ${t('overridesCount', [String(count)])}` : '';
  container.textContent = '';
  if (count) node.querySelector('.overrides').open = true;

  if (!state.environments.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('overridesNoEnvironments');
    container.append(empty);
    return;
  }

  for (const environment of state.environments) {
    const row = document.createElement('div');
    row.className = 'override-row';
    row.dataset.envId = environment.id;

    const label = document.createElement('span');
    label.textContent = labelOf(environment);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'js-override';
    input.dataset.envId = environment.id;
    input.spellcheck = false;
    input.value = search.overrides?.[environment.id] ?? '';
    input.placeholder = search.template || t('phTemplate');
    input.addEventListener('change', commit);

    row.append(label, input);
    container.append(row);
  }
}

async function onAddSearch() {
  if (state.searches.length >= MAX_SEARCHES) {
    setStatus(t('statusMaxSearches', [String(MAX_SEARCHES)]), true);
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
  if (isSearchUsable(search) && !confirm(t('confirmDeleteSearch', [labelOf(search)]))) return;
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
  setStatus(t('statusSaved'));
  renderSearches();
  renderSlots();
}

function renderSlots() {
  const list = $('#slots');
  list.textContent = '';
  QUICK_SLOTS.forEach((command, index) => {
    const node = document.querySelector('#slot-template').content.firstElementChild.cloneNode(true);
    applyI18n(node);
    const slot = state.launcher.slots?.[command] ?? {};
    node.querySelector('.slot-name').textContent = t('slotName', [String(index + 1)]);
    fillSelect(node.querySelector('.js-search'), state.searches.filter(isSearchUsable), slot.searchId, {
      emptyLabel: t('slotLastUsed')
    });
    fillSelect(node.querySelector('.js-env'), state.environments, slot.environmentId, {
      emptyLabel: t('slotLastUsed')
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
        setStatus(t('statusSaved'));
      });
    }
    list.append(node);
  });
}

// ------------------------------------------------------------ import/export

function onExport() {
  const payload = JSON.stringify(buildExport(state), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `redirections-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setIoResult(
    t('exportDone', [
      String(state.mappings.length),
      String(state.environments.length),
      String(state.searches.length)
    ]),
    'ok'
  );
}

let importMode = 'merge';
function pickImportFile(mode) {
  if (mode === 'replace' && !confirm(t('importReplaceConfirm'))) return;
  importMode = mode;
  $('#import-file').click();
}

async function onImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const result = importConfiguration(state, payload, importMode);
    state = { ...state, ...result };

    await Promise.all([
      saveMappings(state.mappings),
      saveEnvironments(state.environments),
      saveSearches(state.searches),
      saveLauncher(state.launcher)
    ]);
    $('#open-in').value = state.launcher.openIn === 'current-tab' ? 'current-tab' : 'new-tab';
    await refreshPermissions();
    renderAll();

    const { counts } = result;
    const added = counts.mappings + counts.environments + counts.searches;
    const skipped = counts.skipped ? ` ${t('importSkipped', [String(counts.skipped)])}` : '';
    setIoResult(
      added
        ? `${t('importDone', [String(counts.mappings), String(counts.environments), String(counts.searches)])}${skipped}`
        : `${t('importNothing')}${skipped}`,
      added ? 'ok' : 'ko'
    );
  } catch (error) {
    setIoResult(t('importFailed', [error.message]), 'err');
  }
}

// -------------------------------------------------------------------- outils

function cloneTemplate(selector, id) {
  const node = document.querySelector(selector).content.firstElementChild.cloneNode(true);
  applyI18n(node);
  node.dataset.id = id;
  return node;
}

/** « *://hote/* » → « hote », pour les messages d'autorisation. */
function originHost(origin) {
  return origin.replace(/^\*:\/\//, '').replace(/\/\*$/, '');
}

/** Libellé affichable d'un environnement ou d'une recherche, éventuellement sans nom. */
function labelOf(item) {
  return item?.label || item?.baseUrl || t('unnamed');
}

/** Code d'erreur d'un module de logique → message traduit, préfixé par le champ concerné. */
function translateError(error) {
  const message = t(error.code, error.value ? [error.value] : undefined);
  if (error.field === 'from') return t('errFieldSource', [message]);
  if (error.field === 'to') return t('errFieldTarget', [message]);
  return message;
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
    option.textContent = labelOf(item);
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
  setStatus(t('statusSaved'));
  LISTS[listName].render();
  focusRow(`#${listName === 'mappings' ? 'rules' : listName}`, id, '.js-up');
}

async function persistMappings({ silent = false } = {}) {
  await saveMappings(state.mappings);
  if (!silent) setStatus(t('statusSaved'));
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
