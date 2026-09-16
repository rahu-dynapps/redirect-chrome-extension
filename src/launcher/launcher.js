import { LAUNCH_ERRORS, isSearchUsable, resolveLaunch } from '../lib/launcher.js';
import { loadLauncher, saveLauncher } from '../lib/storage.js';

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const openerWindowId = params.get('opener');
const slot = params.get('slot');

let state = { environments: [], searches: [], launcher: {} };
let active = { searchId: '', environmentId: '' };

init();

async function init() {
  state = await loadLauncher();
  const usableSearches = state.searches.filter(isSearchUsable);

  if (!usableSearches.length || !hasEnvironmentIfNeeded(usableSearches)) {
    showEmptyState(usableSearches);
    return;
  }

  const preset = slot ? state.launcher.slots?.[slot] : null;
  active.searchId = preset?.searchId || state.launcher.lastSearchId || usableSearches[0].id;
  active.environmentId = preset?.environmentId || state.launcher.lastEnvironmentId || state.environments[0]?.id || '';

  fillSelect($('#search'), usableSearches, active.searchId, (s) =>
    s.keyword ? `${s.label} (${s.keyword})` : s.label
  );
  fillSelect($('#environment'), state.environments, active.environmentId, (e) => e.label);

  $('#query').addEventListener('input', update);
  $('#query').addEventListener('keydown', onKeyDown);
  $('#search').addEventListener('change', (event) => {
    active.searchId = event.target.value;
    update();
    $('#query').focus();
  });
  $('#environment').addEventListener('change', (event) => {
    active.environmentId = event.target.value;
    update();
    $('#query').focus();
  });
  document.addEventListener('keydown', onGlobalKeyDown);

  $('#query').focus();
  update();
}

function hasEnvironmentIfNeeded(searches) {
  // Un modèle absolu se passe d'environnement ; sinon il en faut au moins un.
  return state.environments.length > 0 || searches.every((s) => /^https?:\/\//i.test(s.template));
}

function showEmptyState(usableSearches) {
  $('#form').hidden = true;
  $('#empty').hidden = false;
  $('#empty-detail').textContent = usableSearches.length
    ? 'Ajoutez au moins un environnement (l’URL de base de l’instance) pour lancer une recherche.'
    : 'Ajoutez une recherche (par exemple « Ticket » → /odoo/helpdesk/{q}) et un environnement.';
  $('#configure').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#lanceur') });
    window.close();
  });
  $('#configure').focus();
}

function currentResolution() {
  return resolveLaunch({
    text: $('#query').value,
    searches: state.searches.filter(isSearchUsable),
    environments: state.environments,
    activeSearchId: active.searchId,
    activeEnvironmentId: active.environmentId
  });
}

function update() {
  const resolution = currentResolution();
  const preview = $('#preview');

  // Le mot-clé saisi (« t 1234 ») prend la main sur les listes déroulantes : on le reflète.
  if (resolution.search) $('#search').value = resolution.search.id;
  const envSelect = $('#environment');
  envSelect.disabled = resolution.pinnedEnvironment;
  if (resolution.environment) envSelect.value = resolution.environment.id;
  envSelect.title = resolution.pinnedEnvironment
    ? 'Cette recherche utilise toujours cet environnement.'
    : '';

  if (resolution.result.ok) {
    preview.className = 'preview';
    preview.textContent = `→ ${resolution.result.url}`;
    return;
  }
  const message = LAUNCH_ERRORS[resolution.result.error] ?? 'Impossible de construire l’URL.';
  preview.className = resolution.result.error === 'empty-query' ? 'preview muted' : 'preview error';
  preview.textContent = message;
}

function onKeyDown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  launch(event.ctrlKey || event.metaKey ? 'current-tab' : 'new-tab');
}

function onGlobalKeyDown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    window.close();
    return;
  }
  // Alt+1…9 : bascule rapide d'environnement.
  if (event.altKey && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    const environment = state.environments[index];
    if (!environment) return;
    event.preventDefault();
    active.environmentId = environment.id;
    $('#environment').value = environment.id;
    update();
    $('#query').focus();
  }
}

async function launch(mode) {
  const resolution = currentResolution();
  if (!resolution.result.ok) {
    update();
    $('#query').focus();
    return;
  }
  await saveLauncher({
    ...state.launcher,
    lastSearchId: resolution.search.id,
    lastEnvironmentId: resolution.environment?.id ?? state.launcher.lastEnvironmentId ?? ''
  });
  await chrome.runtime.sendMessage({
    type: 'launch-url',
    url: resolution.result.url,
    mode,
    openerWindowId
  });
  window.close();
}

function fillSelect(select, items, selectedId, labelOf) {
  select.textContent = '';
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = labelOf(item);
    select.append(option);
  }
  if (items.some((item) => item.id === selectedId)) select.value = selectedId;
  else if (items.length) select.value = items[0].id;
}
