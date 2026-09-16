import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDnrRules,
  buildRegexFilter,
  compilePattern,
  compileTarget,
  normalizeMapping,
  parseHostInput,
  previewRedirect,
  requiredOrigins,
  reverseRedirect
} from '../src/lib/rules.js';

const mapping = (raw) => normalizeMapping(raw).mapping;

describe('parseHostInput', () => {
  it('accepte un domaine nu', () => {
    assert.deepEqual(parseHostInput('helpdesk.example.com'), { ok: true, host: 'helpdesk.example.com', port: '' });
  });

  it('extrait l’hôte d’une URL complète collée', () => {
    assert.deepEqual(parseHostInput('https://helpdesk.example.com/contacts?debug=1#id=42'), {
      ok: true,
      host: 'helpdesk.example.com',
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
    assert.equal(parseHostInput('').code, 'errHostEmpty');
    assert.equal(parseHostInput('pas un domaine').code, 'errHostInvalid');
    assert.equal(parseHostInput('ftp://helpdesk.example.com').code, 'errHostScheme');
  });
});

describe('normalizeMapping', () => {
  it('signale une source et une cible identiques', () => {
    const { errors } = normalizeMapping({ from: 'a.fr', to: 'https://a.fr/web' });
    assert.deepEqual(errors, [{ field: '', code: 'errSameHost', value: '' }]);
  });

  it('renvoie des codes d’erreur par champ, traduisibles par l’interface', () => {
    const { errors } = normalizeMapping({ from: 'pas un domaine', to: '' });
    assert.deepEqual(errors, [
      { field: 'from', code: 'errHostInvalid', value: 'pas un domaine' },
      { field: 'to', code: 'errHostEmpty', value: '' }
    ]);
  });

  it('remplit les valeurs par défaut', () => {
    const m = mapping({ from: 'alias.fr', to: 'target.fr' });
    assert.equal(m.enabled, true);
    assert.equal(m.includeSubdomains, false);
    assert.equal(m.forceHttps, false);
    assert.ok(m.id);
  });
});

describe('previewRedirect', () => {
  const mappings = [mapping({ from: 'helpdesk.example.com', to: 'app-1234.hosting.example.com' })];

  it('conserve le chemin, la requête et l’ancre', () => {
    const out = previewRedirect('https://helpdesk.example.com/tickets/42?debug=assets#id=7', mappings);
    assert.equal(out.ok, true);
    assert.equal(out.url, 'https://app-1234.hosting.example.com/tickets/42?debug=assets#id=7');
  });

  it('conserve le schéma d’origine par défaut', () => {
    assert.equal(previewRedirect('http://helpdesk.example.com/web', mappings).url, 'http://app-1234.hosting.example.com/web');
  });

  it('force HTTPS si demandé', () => {
    const forced = [mapping({ from: 'helpdesk.example.com', to: 'target.example.com', forceHttps: true })];
    assert.equal(previewRedirect('http://helpdesk.example.com/web', forced).url, 'https://target.example.com/web');
  });

  it('ignore les sous-domaines sauf si l’option est cochée', () => {
    assert.equal(previewRedirect('https://staging.helpdesk.example.com/', mappings).ok, false);
    const withSubs = [mapping({ from: 'helpdesk.example.com', to: 'target.example.com', includeSubdomains: true })];
    assert.equal(previewRedirect('https://staging.helpdesk.example.com/web', withSubs).url, 'https://target.example.com/web');
  });

  it('ne redirige pas un domaine qui se termine par la même chaîne', () => {
    const withSubs = [mapping({ from: 'example.com', to: 'target.example.com', includeSubdomains: true })];
    assert.equal(previewRedirect('https://notexample.com/', withSubs).ok, false);
  });

  it('gère les ports', () => {
    const withPort = [mapping({ from: 'localhost:8069', to: 'app-1234.hosting.example.com' })];
    assert.equal(previewRedirect('http://localhost:8069/web', withPort).url, 'http://app-1234.hosting.example.com/web');
    assert.equal(previewRedirect('http://localhost:8070/web', withPort).ok, false);
    const toPort = [mapping({ from: 'helpdesk.example.com', to: 'localhost:8069' })];
    assert.equal(previewRedirect('http://helpdesk.example.com/web', toPort).url, 'http://localhost:8069/web');
  });

  it('applique la première règle correspondante', () => {
    const ordered = [
      mapping({ from: 'helpdesk.example.com', to: 'first.example.com' }),
      mapping({ from: 'helpdesk.example.com', to: 'second.example.com' })
    ];
    assert.equal(previewRedirect('https://helpdesk.example.com/', ordered).url, 'https://first.example.com/');
  });

  it('ignore les redirections désactivées et la pause globale', () => {
    const off = [mapping({ from: 'helpdesk.example.com', to: 'target.example.com', enabled: false })];
    assert.equal(previewRedirect('https://helpdesk.example.com/', off).reason, 'no-match');
    assert.equal(previewRedirect('https://helpdesk.example.com/', mappings, { enabled: false }).reason, 'paused');
  });

  it('refuse les schémas non http(s)', () => {
    assert.equal(previewRedirect('chrome://extensions', mappings).reason, 'unsupported-scheme');
    assert.equal(previewRedirect('pas-une-url', mappings).reason, 'invalid-url');
  });
});

describe('reverseRedirect', () => {
  it('reconstruit l’URL alias depuis l’URL cible', () => {
    const mappings = [mapping({ from: 'helpdesk.example.com', to: 'app-1234.hosting.example.com' })];
    const out = reverseRedirect('https://app-1234.hosting.example.com/contacts?x=1#id=2', mappings);
    assert.equal(out.url, 'https://helpdesk.example.com/contacts?x=1#id=2');
  });

  it('renvoie null quand aucune règle ne cible ce domaine', () => {
    assert.equal(reverseRedirect('https://autre.odoo.com/', []), null);
  });
});

describe('buildDnrRules', () => {
  it('produit une règle de redirection par entrée active', () => {
    const rules = buildDnrRules([
      mapping({ from: 'helpdesk.example.com', to: 'app-1234.hosting.example.com' }),
      mapping({ from: 'vide.fr', to: '' }),
      mapping({ from: 'off.fr', to: 'target.fr', enabled: false })
    ]);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].action, {
      type: 'redirect',
      redirect: { transform: { host: 'app-1234.hosting.example.com' } }
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
    const [rule] = buildDnrRules([mapping({ from: 'localhost:8069', to: 'target.example.com' })]);
    assert.deepEqual(rule.action.redirect.transform, { host: 'target.example.com', port: '' });
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
    const m = mapping({ from: 'helpdesk.example.com', to: 'target.fr' });
    assert.ok(matches(m, 'https://helpdesk.example.com'));
    assert.ok(matches(m, 'https://helpdesk.example.com/'));
    assert.ok(matches(m, 'http://helpdesk.example.com:8069/web?a=1#b'));
    assert.ok(matches(m, 'https://HELPDESK.example.com/web'));
    assert.ok(!matches(m, 'https://staging.helpdesk.example.com/'));
    assert.ok(!matches(m, 'https://helpdesk.example.com.evil.com/'));
    assert.ok(!matches(m, 'https://autre.fr/?next=https://helpdesk.example.com/'));
  });

  it('accepte les sous-domaines quand l’option est cochée', () => {
    const m = mapping({ from: 'example.com', to: 'target.fr', includeSubdomains: true });
    assert.ok(matches(m, 'https://a.b.example.com/web'));
    assert.ok(matches(m, 'https://example.com/web'));
    assert.ok(!matches(m, 'https://notexample.com/web'));
  });

  it('exige le port quand il est précisé', () => {
    const m = mapping({ from: 'localhost:8069', to: 'target.fr' });
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
    assert.deepEqual(requiredOrigins(mapping({ from: 'alias.fr:8069', to: 'target.example.com' })), [
      '*://alias.fr/*',
      '*://target.example.com/*'
    ]);
  });

  it('ne demande rien pour une redirection incomplète', () => {
    assert.deepEqual(requiredOrigins(mapping({ from: 'alias.fr', to: '' })), []);
  });
});

describe('règles de motif d’URL', () => {
  // Cas réel : le chemin change entièrement et l'identifiant doit être reporté dans la cible.
  const portail = mapping({
    kind: 'pattern',
    pattern: 'helpdesk.example.com/**/my/tasks/{id}',
    target: 'https://app.example.com/web#id={id}&cids=1,6,5&model=project.task&view_type=form'
  });

  it('capture l’identifiant et reconstruit l’URL cible', () => {
    const out = previewRedirect(
      'https://helpdesk.example.com/fr/my/tasks/4009?access_token=91af9137-6639-4063-8b63-6de6a0255968',
      [portail]
    );
    assert.equal(out.ok, true);
    assert.equal(out.url, 'https://app.example.com/web#id=4009&cids=1,6,5&model=project.task&view_type=form');
  });

  it('« ** » entre deux barres obliques rend le préfixe de langue facultatif', () => {
    assert.equal(
      previewRedirect('https://helpdesk.example.com/my/tasks/4009', [portail]).url,
      'https://app.example.com/web#id=4009&cids=1,6,5&model=project.task&view_type=form'
    );
    assert.equal(
      previewRedirect('https://helpdesk.example.com/fr/portal/my/tasks/7', [portail]).url,
      'https://app.example.com/web#id=7&cids=1,6,5&model=project.task&view_type=form'
    );
  });

  it('ignore une URL dont le chemin ne correspond pas', () => {
    assert.equal(previewRedirect('https://helpdesk.example.com/my/orders/12', [portail]).ok, false);
    assert.equal(previewRedirect('https://autre.example.com/my/tasks/12', [portail]).ok, false);
  });

  it('abandonne la chaîne de requête sauf si la cible la reconstruit', () => {
    const avecJeton = mapping({
      kind: 'pattern',
      pattern: 'helpdesk.example.com/my/tasks/{id}',
      target: 'https://app.example.com/tasks/{id}?from=portal'
    });
    assert.equal(
      previewRedirect('https://helpdesk.example.com/my/tasks/9?access_token=abc', [avecJeton]).url,
      'https://app.example.com/tasks/9?from=portal'
    );
  });

  it('produit une règle declarativeNetRequest à substitution', () => {
    const [rule] = buildDnrRules([portail]);
    assert.deepEqual(rule.action, {
      type: 'redirect',
      redirect: {
        regexSubstitution: 'https://app.example.com/web#id=\\1&cids=1,6,5&model=project.task&view_type=form'
      }
    });
    assert.equal(
      rule.condition.regexFilter,
      '^https?://helpdesk\\.example\\.com(?::\\d+)?/(?:.*/)?my/tasks/([^/?#]+)(?:[?#].*)?$'
    );
    assert.ok(!/\(\?[=!<]/.test(rule.condition.regexFilter), 'pas de lookahead : RE2 ne le gère pas');
  });

  it('demande l’autorisation pour les deux hôtes', () => {
    assert.deepEqual(requiredOrigins(portail), ['*://helpdesk.example.com/*', '*://app.example.com/*']);
  });

  it('accepte plusieurs captures et un port', () => {
    const multi = mapping({
      kind: 'pattern',
      pattern: 'localhost:8069/{model}/{id}',
      target: 'https://app.example.com/web#model={model}&id={id}'
    });
    assert.equal(
      previewRedirect('http://localhost:8069/project.task/42', [multi]).url,
      'https://app.example.com/web#model=project.task&id=42'
    );
    assert.equal(previewRedirect('http://localhost:8070/project.task/42', [multi]).ok, false);
  });

  it('les jokers * et ** couvrent un segment ou n’importe quoi', () => {
    const joker = mapping({
      kind: 'pattern',
      pattern: 'helpdesk.example.com/*/docs/**',
      target: 'https://app.example.com/knowledge'
    });
    assert.equal(previewRedirect('https://helpdesk.example.com/fr/docs/a/b/c', [joker]).ok, true);
    assert.equal(previewRedirect('https://helpdesk.example.com/fr/other/a', [joker]).ok, false);
  });

  it('signale un motif ou une cible invalides', () => {
    assert.equal(compilePattern('').code, 'errPatternEmpty');
    assert.equal(compilePattern('*/my/tasks/{id}').code, 'errPatternHost');
    assert.equal(compilePattern('a.fr/{id}/{id}').code, 'errPatternDuplicate');
    assert.equal(compilePattern('a.fr/té/{id}').code, 'errPatternNonAscii');
    assert.equal(compileTarget('', []).code, 'errTargetEmpty');
    assert.equal(compileTarget('https://a.fr/{other}', ['id']).code, 'errTargetUnknownPlaceholder');
    assert.equal(compileTarget('https://{host}.fr/x', ['host']).code, 'errTargetHostPlaceholder');
  });

  it('complète le schéma manquant de la cible', () => {
    assert.equal(compileTarget('app.example.com/t/{id}', ['id']).template, 'https://app.example.com/t/{id}');
  });

  it('conserve les deux jeux de champs quand on change de type', () => {
    const { mapping: m } = normalizeMapping({
      kind: 'pattern',
      from: 'helpdesk.example.com',
      to: 'app.example.com',
      pattern: 'helpdesk.example.com/my/tasks/{id}',
      target: 'https://app.example.com/t/{id}'
    });
    assert.equal(m.fromHost, 'helpdesk.example.com');
    assert.equal(m.toHost, 'app.example.com');
    assert.equal(normalizeMapping({ ...m, kind: 'domain' }).errors.length, 0);
  });

  it('un motif invalide ne produit aucune règle', () => {
    assert.deepEqual(buildDnrRules([mapping({ kind: 'pattern', pattern: 'a.fr/{id}', target: '' })]), []);
  });
});
