import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDnrRules,
  buildRegexFilter,
  normalizeMapping,
  parseHostInput,
  previewRedirect,
  requiredOrigins,
  reverseRedirect
} from '../src/lib/rules.js';

const mapping = (raw) => normalizeMapping(raw).mapping;

describe('parseHostInput', () => {
  it('accepte un domaine nu', () => {
    assert.deepEqual(parseHostInput('alias.client.fr'), { ok: true, host: 'alias.client.fr', port: '' });
  });

  it('extrait l’hôte d’une URL complète collée', () => {
    assert.deepEqual(parseHostInput('https://alias.client.fr/odoo/contacts?debug=1#id=42'), {
      ok: true,
      host: 'alias.client.fr',
      port: ''
    });
  });

  it('conserve le port et met en minuscules', () => {
    assert.deepEqual(parseHostInput('LOCALHOST:8069'), { ok: true, host: 'localhost', port: '8069' });
  });

  it('convertit les domaines internationalisés en punycode', () => {
    assert.equal(parseHostInput('société.fr').host, 'xn--socit-esab.fr');
  });

  it('rejette une saisie vide ou invalide', () => {
    assert.equal(parseHostInput('').ok, false);
    assert.equal(parseHostInput('pas un domaine').ok, false);
    assert.equal(parseHostInput('ftp://alias.client.fr').ok, false);
  });
});

describe('normalizeMapping', () => {
  it('signale une source et une cible identiques', () => {
    const { errors } = normalizeMapping({ from: 'a.fr', to: 'https://a.fr/web' });
    assert.ok(errors.some((e) => e.includes('identiques')));
  });

  it('remplit les valeurs par défaut', () => {
    const m = mapping({ from: 'alias.fr', to: 'cible.fr' });
    assert.equal(m.enabled, true);
    assert.equal(m.includeSubdomains, false);
    assert.equal(m.forceHttps, false);
    assert.ok(m.id);
  });
});

describe('previewRedirect', () => {
  const mappings = [mapping({ from: 'alias.client.fr', to: 'client-prod-1234.odoo.com' })];

  it('conserve le chemin, la requête et l’ancre', () => {
    const out = previewRedirect('https://alias.client.fr/odoo/action-42?debug=assets#id=7', mappings);
    assert.equal(out.ok, true);
    assert.equal(out.url, 'https://client-prod-1234.odoo.com/odoo/action-42?debug=assets#id=7');
  });

  it('conserve le schéma d’origine par défaut', () => {
    assert.equal(previewRedirect('http://alias.client.fr/web', mappings).url, 'http://client-prod-1234.odoo.com/web');
  });

  it('force HTTPS si demandé', () => {
    const forced = [mapping({ from: 'alias.client.fr', to: 'cible.odoo.com', forceHttps: true })];
    assert.equal(previewRedirect('http://alias.client.fr/web', forced).url, 'https://cible.odoo.com/web');
  });

  it('ignore les sous-domaines sauf si l’option est cochée', () => {
    assert.equal(previewRedirect('https://staging.alias.client.fr/', mappings).ok, false);
    const withSubs = [mapping({ from: 'alias.client.fr', to: 'cible.odoo.com', includeSubdomains: true })];
    assert.equal(previewRedirect('https://staging.alias.client.fr/web', withSubs).url, 'https://cible.odoo.com/web');
  });

  it('ne redirige pas un domaine qui se termine par la même chaîne', () => {
    const withSubs = [mapping({ from: 'client.fr', to: 'cible.odoo.com', includeSubdomains: true })];
    assert.equal(previewRedirect('https://autreclient.fr/', withSubs).ok, false);
  });

  it('gère les ports', () => {
    const withPort = [mapping({ from: 'localhost:8069', to: 'client-prod-1234.odoo.com' })];
    assert.equal(previewRedirect('http://localhost:8069/web', withPort).url, 'http://client-prod-1234.odoo.com/web');
    assert.equal(previewRedirect('http://localhost:8070/web', withPort).ok, false);
    const toPort = [mapping({ from: 'alias.client.fr', to: 'localhost:8069' })];
    assert.equal(previewRedirect('http://alias.client.fr/web', toPort).url, 'http://localhost:8069/web');
  });

  it('applique la première règle correspondante', () => {
    const ordered = [
      mapping({ from: 'alias.client.fr', to: 'premier.odoo.com' }),
      mapping({ from: 'alias.client.fr', to: 'second.odoo.com' })
    ];
    assert.equal(previewRedirect('https://alias.client.fr/', ordered).url, 'https://premier.odoo.com/');
  });

  it('ignore les redirections désactivées et la pause globale', () => {
    const off = [mapping({ from: 'alias.client.fr', to: 'cible.odoo.com', enabled: false })];
    assert.equal(previewRedirect('https://alias.client.fr/', off).reason, 'no-match');
    assert.equal(previewRedirect('https://alias.client.fr/', mappings, { enabled: false }).reason, 'paused');
  });

  it('refuse les schémas non http(s)', () => {
    assert.equal(previewRedirect('chrome://extensions', mappings).reason, 'unsupported-scheme');
    assert.equal(previewRedirect('pas-une-url', mappings).reason, 'invalid-url');
  });
});

describe('reverseRedirect', () => {
  it('reconstruit l’URL alias depuis l’URL cible', () => {
    const mappings = [mapping({ from: 'alias.client.fr', to: 'client-prod-1234.odoo.com' })];
    const out = reverseRedirect('https://client-prod-1234.odoo.com/odoo/contacts?x=1#id=2', mappings);
    assert.equal(out.url, 'https://alias.client.fr/odoo/contacts?x=1#id=2');
  });

  it('renvoie null quand aucune règle ne cible ce domaine', () => {
    assert.equal(reverseRedirect('https://autre.odoo.com/', []), null);
  });
});

describe('buildDnrRules', () => {
  it('produit une règle de redirection par entrée active', () => {
    const rules = buildDnrRules([
      mapping({ from: 'alias.client.fr', to: 'client-prod-1234.odoo.com' }),
      mapping({ from: 'vide.fr', to: '' }),
      mapping({ from: 'off.fr', to: 'cible.fr', enabled: false })
    ]);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].action, {
      type: 'redirect',
      redirect: { transform: { host: 'client-prod-1234.odoo.com' } }
    });
    assert.deepEqual(rules[0].condition.resourceTypes, ['main_frame']);
    assert.equal(rules[0].id, 1);
  });

  it('donne une priorité décroissante pour respecter l’ordre de la liste', () => {
    const rules = buildDnrRules([
      mapping({ from: 'a.fr', to: 'x.fr' }),
      mapping({ from: 'b.fr', to: 'y.fr' })
    ]);
    assert.ok(rules[0].priority > rules[1].priority);
    assert.deepEqual(rules.map((r) => r.id), [1, 2]);
  });

  it('supprime le port de la cible quand seule la source en a un', () => {
    const [rule] = buildDnrRules([mapping({ from: 'localhost:8069', to: 'cible.odoo.com' })]);
    assert.deepEqual(rule.action.redirect.transform, { host: 'cible.odoo.com', port: '' });
  });

  it('ajoute les iframes quand l’option est cochée', () => {
    const [rule] = buildDnrRules([mapping({ from: 'a.fr', to: 'b.fr', includeSubframes: true })]);
    assert.deepEqual(rule.condition.resourceTypes, ['main_frame', 'sub_frame']);
  });

  it('ne produit aucune règle quand les redirections sont en pause', () => {
    assert.deepEqual(buildDnrRules([mapping({ from: 'a.fr', to: 'b.fr' })], { enabled: false }), []);
  });
});

describe('buildRegexFilter', () => {
  const matches = (m, url) => new RegExp(buildRegexFilter(m), 'i').test(url);

  it('couvre l’URL entière et n’accepte que l’hôte exact', () => {
    const m = mapping({ from: 'alias.client.fr', to: 'cible.fr' });
    assert.ok(matches(m, 'https://alias.client.fr'));
    assert.ok(matches(m, 'https://alias.client.fr/'));
    assert.ok(matches(m, 'http://alias.client.fr:8069/web?a=1#b'));
    assert.ok(matches(m, 'https://ALIAS.client.fr/web'));
    assert.ok(!matches(m, 'https://staging.alias.client.fr/'));
    assert.ok(!matches(m, 'https://alias.client.fr.evil.com/'));
    assert.ok(!matches(m, 'https://autre.fr/?next=https://alias.client.fr/'));
  });

  it('accepte les sous-domaines quand l’option est cochée', () => {
    const m = mapping({ from: 'client.fr', to: 'cible.fr', includeSubdomains: true });
    assert.ok(matches(m, 'https://a.b.client.fr/web'));
    assert.ok(matches(m, 'https://client.fr/web'));
    assert.ok(!matches(m, 'https://autreclient.fr/web'));
  });

  it('exige le port quand il est précisé', () => {
    const m = mapping({ from: 'localhost:8069', to: 'cible.fr' });
    assert.ok(matches(m, 'http://localhost:8069/web'));
    assert.ok(!matches(m, 'http://localhost/web'));
    assert.ok(!matches(m, 'http://localhost:8070/web'));
  });

  it('n’utilise pas de syntaxe non supportée par RE2', () => {
    const filter = buildRegexFilter(mapping({ from: 'a.fr', to: 'b.fr', includeSubdomains: true }));
    assert.ok(!/\(\?[=!<]/.test(filter), 'pas de lookahead/lookbehind');
  });
});

describe('requiredOrigins', () => {
  it('demande la source et la cible, sans port', () => {
    assert.deepEqual(requiredOrigins(mapping({ from: 'alias.fr:8069', to: 'cible.odoo.com' })), [
      '*://alias.fr/*',
      '*://cible.odoo.com/*'
    ]);
  });

  it('ne demande rien pour une redirection incomplète', () => {
    assert.deepEqual(requiredOrigins(mapping({ from: 'alias.fr', to: '' })), []);
  });
});
