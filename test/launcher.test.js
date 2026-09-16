import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildLaunchUrl,
  isSearchUsable,
  normalizeEnvironment,
  normalizeSearch,
  parseLauncherInput,
  resolveLaunch
} from '../src/lib/launcher.js';

const env = (raw) => normalizeEnvironment(raw).environment;
const search = (raw) => normalizeSearch(raw).search;

describe('normalizeEnvironment', () => {
  it('complète le schéma manquant et déduit un libellé', () => {
    const e = env({ baseUrl: 'client-prod-1234.odoo.com' });
    assert.equal(e.baseUrl, 'https://client-prod-1234.odoo.com');
    assert.equal(e.label, 'client-prod-1234.odoo.com');
  });

  it('conserve un préfixe de chemin sans slash final', () => {
    assert.equal(env({ baseUrl: 'https://erp.client.fr/odoo/' }).baseUrl, 'https://erp.client.fr/odoo');
  });

  it('conserve le port', () => {
    assert.equal(env({ baseUrl: 'http://localhost:8069' }).baseUrl, 'http://localhost:8069');
  });

  it('signale une URL vide ou invalide', () => {
    assert.ok(normalizeEnvironment({ baseUrl: '' }).errors.length);
    assert.ok(normalizeEnvironment({ baseUrl: 'ftp://x.fr' }).errors.length);
  });
});

describe('normalizeSearch', () => {
  it('exige le jeton {q}', () => {
    assert.ok(normalizeSearch({ label: 'Ticket', template: '/odoo/helpdesk/' }).errors.length);
    assert.equal(normalizeSearch({ label: 'Ticket', template: '/odoo/helpdesk/{q}' }).errors.length, 0);
  });

  it('nettoie le mot-clé', () => {
    assert.equal(search({ keyword: '  T icket ', template: '/{q}' }).keyword, 'ticket');
  });

  it('accepte plusieurs occurrences de {q}', () => {
    assert.equal(normalizeSearch({ template: '/web#id={q}&ref={q}' }).errors.length, 0);
    assert.ok(isSearchUsable(search({ template: '/web#id={q}&ref={q}' })));
  });
});

describe('buildLaunchUrl', () => {
  const environment = env({ baseUrl: 'https://client-prod-1234.odoo.com' });

  it('remplace {q} dans un modèle relatif', () => {
    const out = buildLaunchUrl({ search: search({ template: '/odoo/helpdesk/{q}' }), environment, query: '1234' });
    assert.deepEqual(out, { ok: true, url: 'https://client-prod-1234.odoo.com/odoo/helpdesk/1234' });
  });

  it('gère les URL Odoo à ancre', () => {
    const out = buildLaunchUrl({
      search: search({ template: '/web#id={q}&model=helpdesk.ticket&view_type=form' }),
      environment,
      query: '42'
    });
    assert.equal(out.url, 'https://client-prod-1234.odoo.com/web#id=42&model=helpdesk.ticket&view_type=form');
  });

  it('encode la valeur saisie', () => {
    const out = buildLaunchUrl({ search: search({ template: '/odoo/contacts?q={q}' }), environment, query: 'Dupont & Fils' });
    assert.equal(out.url, 'https://client-prod-1234.odoo.com/odoo/contacts?q=Dupont%20%26%20Fils');
  });

  it('ajoute le slash manquant et respecte le préfixe de chemin', () => {
    const withPath = env({ baseUrl: 'https://erp.client.fr/odoo' });
    const out = buildLaunchUrl({ search: search({ template: 'helpdesk/{q}' }), environment: withPath, query: '7' });
    assert.equal(out.url, 'https://erp.client.fr/odoo/helpdesk/7');
  });

  it('ignore l’environnement pour un modèle absolu', () => {
    const out = buildLaunchUrl({
      search: search({ template: 'https://support.example.com/t/{q}' }),
      environment: null,
      query: '9'
    });
    assert.equal(out.url, 'https://support.example.com/t/9');
  });

  it('refuse une saisie vide ou un environnement manquant', () => {
    assert.equal(buildLaunchUrl({ search: search({ template: '/{q}' }), environment, query: '  ' }).error, 'empty-query');
    assert.equal(
      buildLaunchUrl({ search: search({ template: '/{q}' }), environment: null, query: '1' }).error,
      'missing-environment'
    );
  });
});

describe('parseLauncherInput', () => {
  const searches = [search({ keyword: 't', template: '/odoo/helpdesk/{q}' }), search({ keyword: 'c', template: '/odoo/contacts/{q}' })];

  it('reconnaît un mot-clé en préfixe', () => {
    const out = parseLauncherInput('t 1234', searches);
    assert.equal(out.matchedKeyword, true);
    assert.equal(out.search.keyword, 't');
    assert.equal(out.query, '1234');
  });

  it('est insensible à la casse', () => {
    assert.equal(parseLauncherInput('C 42', searches).search.keyword, 'c');
  });

  it('laisse la saisie intacte sans mot-clé connu', () => {
    const out = parseLauncherInput('zz 42', searches);
    assert.equal(out.matchedKeyword, false);
    assert.equal(out.query, 'zz 42');
  });

  it('ne consomme pas un mot-clé sans valeur', () => {
    assert.equal(parseLauncherInput('t', searches).matchedKeyword, false);
    assert.equal(parseLauncherInput('t', searches).query, 't');
  });
});

describe('resolveLaunch', () => {
  const environments = [
    env({ id: 'env_prod', label: 'Prod', baseUrl: 'https://prod.odoo.com' }),
    env({ id: 'env_test', label: 'Test', baseUrl: 'https://test.odoo.com' })
  ];
  const searches = [
    search({ id: 's_ticket', keyword: 't', template: '/odoo/helpdesk/{q}' }),
    search({ id: 's_contact', keyword: 'c', template: '/odoo/contacts/{q}' }),
    search({ id: 's_statut', keyword: 'st', template: '/status/{q}', environmentId: 'env_test' })
  ];

  it('utilise la recherche et l’environnement actifs', () => {
    const out = resolveLaunch({
      text: '1234',
      searches,
      environments,
      activeSearchId: 's_contact',
      activeEnvironmentId: 'env_test'
    });
    assert.equal(out.result.url, 'https://test.odoo.com/odoo/contacts/1234');
  });

  it('le mot-clé prend le pas sur la recherche active', () => {
    const out = resolveLaunch({ text: 't 99', searches, environments, activeSearchId: 's_contact', activeEnvironmentId: 'env_prod' });
    assert.equal(out.matchedKeyword, true);
    assert.equal(out.result.url, 'https://prod.odoo.com/odoo/helpdesk/99');
  });

  it('un environnement épinglé l’emporte sur la sélection courante', () => {
    const out = resolveLaunch({ text: 'st 5', searches, environments, activeSearchId: 's_ticket', activeEnvironmentId: 'env_prod' });
    assert.equal(out.pinnedEnvironment, true);
    assert.equal(out.result.url, 'https://test.odoo.com/status/5');
  });

  it('retombe sur le premier élément si la sélection est obsolète', () => {
    const out = resolveLaunch({ text: '7', searches, environments, activeSearchId: 'inconnu', activeEnvironmentId: 'inconnu' });
    assert.equal(out.result.url, 'https://prod.odoo.com/odoo/helpdesk/7');
  });

  it('signale l’absence de recherche configurée', () => {
    const out = resolveLaunch({ text: '7', searches: [], environments, activeSearchId: '', activeEnvironmentId: '' });
    assert.equal(out.result.error, 'no-search');
  });
});
