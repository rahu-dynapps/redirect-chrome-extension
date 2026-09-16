import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXPORT_VERSION, buildExport, importConfiguration } from '../src/lib/transfer.js';
import { templateFor } from '../src/lib/launcher.js';

const EMPTY = { mappings: [], environments: [], searches: [], launcher: {} };

// Configuration telle qu'exportée par l'extension : les recherches référencent les
// environnements par identifiant.
const EXPORTED = {
  version: 2,
  settings: { enabled: true },
  mappings: [
    {
      id: 'map_a',
      kind: 'pattern',
      pattern: 'helpdesk.example.com/**/my/tasks/{id}',
      target: 'https://app.example.com/web#id={id}&model=project.task',
      enabled: true
    },
    {
      id: 'map_b',
      kind: 'pattern',
      pattern: 'other.example.com/**/my/tasks/{id}',
      target: 'https://app.example.com/web#id={id}&model=project.task',
      enabled: true
    }
  ],
  environments: [
    { id: 'env_portal', label: 'Portail', baseUrl: 'https://portal.example.com/app' },
    { id: 'env_client', label: 'Client', baseUrl: 'https://client.example.com' }
  ],
  searches: [
    {
      id: 's_ticket',
      label: 'Ticket',
      keyword: 't',
      template: '/all-tasks/{q}',
      overrides: { env_client: '/web#id={q}&model=project.task&view_type=form' },
      environmentId: ''
    },
    { id: 's_contact', label: 'Contact', keyword: 'c', template: '/contacts/{q}', overrides: {}, environmentId: 'env_client' }
  ],
  launcher: {
    lastSearchId: 's_ticket',
    lastEnvironmentId: 'env_client',
    openIn: 'new-tab',
    slots: { 'quick-1': { searchId: 's_ticket', environmentId: 'env_portal' } }
  }
};

const environmentNamed = (state, label) => state.environments.find((e) => e.label === label);
const searchKeyed = (state, keyword) => state.searches.find((s) => s.keyword === keyword);

describe('buildExport', () => {
  it('embarque tout ce dont l’import a besoin', () => {
    const payload = buildExport({
      settings: { enabled: true },
      mappings: EXPORTED.mappings,
      environments: EXPORTED.environments,
      searches: EXPORTED.searches,
      launcher: EXPORTED.launcher
    });
    assert.equal(payload.version, EXPORT_VERSION);
    assert.deepEqual(Object.keys(payload).sort(), [
      'environments',
      'launcher',
      'mappings',
      'searches',
      'settings',
      'version'
    ]);
    assert.deepEqual(payload.searches[0].overrides, { env_client: '/web#id={q}&model=project.task&view_type=form' });
  });
});

describe('importConfiguration', () => {
  it('conserve le modèle propre à un environnement (régression : liens perdus)', () => {
    const out = importConfiguration(EMPTY, EXPORTED, 'replace');
    const client = environmentNamed(out, 'Client');
    const ticket = searchKeyed(out, 't');
    assert.equal(templateFor(ticket, client), '/web#id={q}&model=project.task&view_type=form');
    assert.equal(templateFor(ticket, environmentNamed(out, 'Portail')), '/all-tasks/{q}');
  });

  it('conserve l’environnement épinglé et les raccourcis rapides', () => {
    const out = importConfiguration(EMPTY, EXPORTED, 'replace');
    assert.equal(searchKeyed(out, 'c').environmentId, environmentNamed(out, 'Client').id);
    assert.deepEqual(out.launcher.slots['quick-1'], {
      searchId: searchKeyed(out, 't').id,
      environmentId: environmentNamed(out, 'Portail').id
    });
    assert.equal(out.launcher.lastEnvironmentId, environmentNamed(out, 'Client').id);
  });

  it('reporte les références sur un environnement déjà présent localement', () => {
    const current = {
      ...EMPTY,
      environments: [{ id: 'env_local', label: 'Déjà là', baseUrl: 'https://client.example.com' }]
    };
    const out = importConfiguration(current, EXPORTED, 'merge');
    assert.equal(out.environments.length, 2, 'le doublon d’URL de base n’est pas réimporté');
    assert.equal(templateFor(searchKeyed(out, 't'), { id: 'env_local' }), '/web#id={q}&model=project.task&view_type=form');
    assert.equal(searchKeyed(out, 'c').environmentId, 'env_local');
  });

  it('n’écrase rien en fusion et signale les doublons', () => {
    const current = importConfiguration(EMPTY, EXPORTED, 'replace');
    const again = importConfiguration(current, EXPORTED, 'merge');
    assert.deepEqual(again.counts, { mappings: 0, environments: 0, searches: 0, skipped: 6 });
    assert.equal(again.mappings.length, 2);
    assert.equal(again.searches.length, 2);
  });

  it('distingue deux redirections de motif sans domaine renseigné', () => {
    const out = importConfiguration(EMPTY, EXPORTED, 'merge');
    assert.equal(out.mappings.length, 2, 'deux motifs différents ne sont pas confondus');
  });

  it('remplace intégralement en mode replace', () => {
    const current = {
      mappings: [],
      environments: [{ id: 'env_old', label: 'Ancien', baseUrl: 'https://old.example.com' }],
      searches: [{ id: 's_old', label: 'Vieux', keyword: 'v', template: '/old/{q}', overrides: {} }],
      launcher: { slots: { 'quick-1': { searchId: 's_old', environmentId: 'env_old' } } }
    };
    const out = importConfiguration(current, EXPORTED, 'replace');
    assert.equal(out.environments.some((e) => e.id === 'env_old'), false);
    assert.equal(out.searches.some((s) => s.keyword === 'v'), false);
    assert.equal(out.launcher.slots['quick-1'].searchId, searchKeyed(out, 't').id);
  });

  it('en fusion, ne touche pas à un raccourci rapide déjà configuré', () => {
    const current = {
      ...EMPTY,
      searches: [{ id: 's_mine', label: 'Mien', keyword: 'm', template: '/mine/{q}', overrides: {} }],
      launcher: { slots: { 'quick-1': { searchId: 's_mine', environmentId: '' } } }
    };
    const out = importConfiguration(current, EXPORTED, 'merge');
    assert.equal(out.launcher.slots['quick-1'].searchId, 's_mine');
  });

  it('accepte un ancien export réduit à un tableau de redirections', () => {
    const out = importConfiguration(EMPTY, [{ from: 'a.example.com', to: 'b.example.com' }], 'merge');
    assert.equal(out.mappings.length, 1);
    assert.equal(out.counts.mappings, 1);
  });

  it('ignore les entrées invalides sans interrompre l’import', () => {
    const out = importConfiguration(
      EMPTY,
      {
        environments: [{ id: 'e1', label: 'KO', baseUrl: 'ftp://nope' }, { id: 'e2', label: 'OK', baseUrl: 'https://ok.example.com' }],
        searches: [{ id: 's1', keyword: 'x', template: 'sans jeton' }, { id: 's2', keyword: 'y', template: '/y/{q}' }]
      },
      'merge'
    );
    assert.deepEqual(out.environments.map((e) => e.label), ['OK']);
    assert.deepEqual(out.searches.map((s) => s.keyword), ['y']);
  });
});
