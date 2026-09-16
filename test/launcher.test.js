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
    const e = env({ baseUrl: 'app-1234.hosting.example.com' });
    assert.equal(e.baseUrl, 'https://app-1234.hosting.example.com');
    assert.equal(e.label, 'app-1234.hosting.example.com');
  });

  it('conserve un préfixe de chemin sans slash final', () => {
    assert.equal(env({ baseUrl: 'https://erp.example.com/odoo/' }).baseUrl, 'https://erp.example.com/odoo');
  });

  it('conserve le port', () => {
    assert.equal(env({ baseUrl: 'http://localhost:8069' }).baseUrl, 'http://localhost:8069');
  });

  it('signale une URL vide ou invalide par un code', () => {
    assert.deepEqual(normalizeEnvironment({ baseUrl: '' }).errors, [{ code: 'errBaseUrlEmpty', value: '' }]);
    assert.deepEqual(normalizeEnvironment({ baseUrl: 'ftp://x.fr' }).errors, [
      { code: 'errBaseUrlInvalid', value: 'ftp://x.fr' }
    ]);
  });

  it('laisse le libellé vide quand rien ne permet de le déduire', () => {
    assert.equal(env({ baseUrl: '' }).label, '');
  });
});

describe('normalizeSearch', () => {
  it('exige le jeton {q}', () => {
    assert.deepEqual(normalizeSearch({ label: 'Ticket', template: '/tickets/' }).errors, [
      { code: 'errTemplateNoPlaceholder', value: '' }
    ]);
    assert.equal(normalizeSearch({ label: 'Ticket', template: '/tickets/{q}' }).errors.length, 0);
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
  const environment = env({ baseUrl: 'https://app-1234.hosting.example.com' });

  it('remplace {q} dans un modèle relatif', () => {
    const out = buildLaunchUrl({ search: search({ template: '/tickets/{q}' }), environment, query: '1234' });
    assert.deepEqual(out, { ok: true, url: 'https://app-1234.hosting.example.com/tickets/1234' });
  });

  it('gère les URL Odoo à ancre', () => {
    const out = buildLaunchUrl({
      search: search({ template: '/web#id={q}&model=ticket&view_type=form' }),
      environment,
      query: '42'
    });
    assert.equal(out.url, 'https://app-1234.hosting.example.com/web#id=42&model=ticket&view_type=form');
  });

  it('encode la valeur saisie', () => {
    const out = buildLaunchUrl({ search: search({ template: '/contacts?q={q}' }), environment, query: 'Dupont & Fils' });
    assert.equal(out.url, 'https://app-1234.hosting.example.com/contacts?q=Dupont%20%26%20Fils');
  });

  it('ajoute le slash manquant et respecte le préfixe de chemin', () => {
    const withPath = env({ baseUrl: 'https://erp.example.com/app' });
    const out = buildLaunchUrl({ search: search({ template: 'tickets/{q}' }), environment: withPath, query: '7' });
    assert.equal(out.url, 'https://erp.example.com/app/tickets/7');
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
  const searches = [search({ keyword: 't', template: '/tickets/{q}' }), search({ keyword: 'c', template: '/contacts/{q}' })];

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
    env({ id: 'env_prod', label: 'Prod', baseUrl: 'https://prod.example.com' }),
    env({ id: 'env_test', label: 'Test', baseUrl: 'https://test.example.com' })
  ];
  const searches = [
    search({ id: 's_ticket', keyword: 't', template: '/tickets/{q}' }),
    search({ id: 's_contact', keyword: 'c', template: '/contacts/{q}' }),
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
    assert.equal(out.result.url, 'https://test.example.com/contacts/1234');
  });

  it('le mot-clé prend le pas sur la recherche active', () => {
    const out = resolveLaunch({ text: 't 99', searches, environments, activeSearchId: 's_contact', activeEnvironmentId: 'env_prod' });
    assert.equal(out.matchedKeyword, true);
    assert.equal(out.result.url, 'https://prod.example.com/tickets/99');
  });

  it('un environnement épinglé l’emporte sur la sélection courante', () => {
    const out = resolveLaunch({ text: 'st 5', searches, environments, activeSearchId: 's_ticket', activeEnvironmentId: 'env_prod' });
    assert.equal(out.pinnedEnvironment, true);
    assert.equal(out.result.url, 'https://test.example.com/status/5');
  });

  it('retombe sur le premier élément si la sélection est obsolète', () => {
    const out = resolveLaunch({ text: '7', searches, environments, activeSearchId: 'inconnu', activeEnvironmentId: 'inconnu' });
    assert.equal(out.result.url, 'https://prod.example.com/tickets/7');
  });

  it('signale l’absence de recherche configurée', () => {
    const out = resolveLaunch({ text: '7', searches: [], environments, activeSearchId: '', activeEnvironmentId: '' });
    assert.equal(out.result.error, 'no-search');
  });
});
