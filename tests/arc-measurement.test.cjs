const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'arc-measurement.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'contact.html'), 'utf8');
const contactScript = html.match(/<script>\s*(async function sendMessage\(\)[\s\S]*?)<\/script>/)[1];

function harness(saved, blockedStorage = false) {
  const calls = [], scripts = [], nodes = {};
  function element() {
    const children = {};
    return { style: {}, hidden: false, disabled: false, value: 'exemple',
      setAttribute() {}, addEventListener() {}, appendChild() {},
      querySelector(selector) { return children[selector] ||= element(); } };
  }
  const document = { readyState: 'complete',
    head: { appendChild(el) { if (el.src) scripts.push(el.src); } },
    body: { appendChild() {} }, createElement: element,
    addEventListener() {}, getElementById(id) { return nodes[id] ||= element(); }
  };
  let value = saved === undefined ? null : JSON.stringify(saved);
  const window = { localStorage: {
    getItem() { if (blockedStorage) throw Error('blocked'); return value; },
    setItem(_, next) { if (blockedStorage) throw Error('blocked'); value = next; }
  }, crypto: { randomUUID() { return 'synthetic-test-id'; } } };
  const context = vm.createContext({ window, document, console, dataLayer: [],
    alert() {}, fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }) });
  new vm.Script(source).runInContext(context);
  function attachSDK() { window.oaiq = (...args) => calls.push(args); }
  return { window, context, document, nodes, calls, scripts, attachSDK };
}

async function runTests() {
  const passed = [];
  async function test(name, fn) { await fn(); passed.push(name); }
  await test('Aucune mesure ni requête SDK sans accord', () => {
    const h = harness();
    assert.equal(h.scripts.length, 0);
    assert.equal(h.window.arcMeasurement.trackLead(), false);
  });
  await test('Le refus ne charge pas le SDK', () => {
    const h = harness(); h.window.arcMeasurement.setConsent(false);
    assert.equal(h.scripts.length, 0);
    assert.equal(h.window.arcMeasurement.trackLead(), false);
  });
  await test('Le consentement précède init et un seul SDK est chargé', () => {
    const h = harness(); h.window.arcMeasurement.setConsent(true);
    const commands = Array.from(h.window.oaiq.q, args => Array.from(args));
    assert.deepEqual(commands.map(x => x[0]), ['consent', 'init']);
    h.window.arcMeasurement.setConsent(true);
    assert.equal(h.scripts.length, 1);
  });
  await test('Une demande réussie est dédupliquée sans contenu du formulaire', () => {
    const h = harness(); h.window.arcMeasurement.setConsent(true); h.attachSDK();
    assert.equal(h.window.arcMeasurement.trackLead(), true);
    assert.equal(h.window.arcMeasurement.trackLead(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][1], 'lead_created');
    assert.equal(JSON.stringify(h.calls[0][2]), '{"type":"customer_action"}');
    assert.equal(h.calls[0][3].opt_out, true);
  });
  await test('Le retrait du consentement bloque les événements suivants', () => {
    const h = harness(); h.window.arcMeasurement.setConsent(true); h.attachSDK();
    h.window.arcMeasurement.setConsent(false);
    assert.equal(h.window.arcMeasurement.trackLead(), false);
    assert.deepEqual(h.calls, [['consent', false]]);
  });
  await test('Un accord valide est repris sur la page suivante', () => {
    const h = harness({ allowed: true, expires: Date.now() + 60000 });
    assert.equal(h.scripts.length, 1);
  });
  await test('Un refus ou un accord expiré ne charge pas le SDK', () => {
    assert.equal(harness({ allowed: false, expires: Date.now() + 60000 }).scripts.length, 0);
    assert.equal(harness({ allowed: true, expires: Date.now() - 1 }).scripts.length, 0);
  });
  await test('Le stockage bloqué ne casse ni le choix ni le formulaire', () => {
    const h = harness(undefined, true);
    assert.equal(h.scripts.length, 0);
    h.window.arcMeasurement.setConsent(true);
    assert.equal(h.scripts.length, 1);
  });
  for (const [label, response, expected] of [
    ['succès confirmé', { ok: true, data: { ok: true } }, 1],
    ['erreur serveur', { ok: false, data: { error: 'test' } }, 0],
    ['simulation sans e-mail', { ok: true, data: { ok: true, warning: 'simulation' } }, 0]
  ]) {
    await test('Formulaire réel : ' + label, async () => {
      const h = harness();
      h.window.arcMeasurement.setConsent(true); h.attachSDK();
      h.document.getElementById('f-email').value = 'synthetic@example.test';
      h.context.fetch = async () => ({ ok: response.ok, json: async () => response.data });
      new vm.Script(contactScript).runInContext(h.context);
      await h.context.sendMessage();
      assert.equal(h.calls.filter(x => x[0] === 'measure').length, expected);
      if (expected) assert.equal(h.document.getElementById('form-success').style.display, 'block');
      assert.ok(!JSON.stringify(h.calls).includes('synthetic@example.test'));
    });
  }
  await test('Un e-mail invalide ne produit ni envoi ni conversion', async () => {
    const h = harness(); let requests = 0;
    h.window.arcMeasurement.setConsent(true); h.attachSDK();
    h.document.getElementById('f-email').value = 'invalide';
    h.context.fetch = async () => { requests++; throw Error('must not send'); };
    new vm.Script(contactScript).runInContext(h.context);
    await h.context.sendMessage();
    assert.equal(requests, 0); assert.equal(h.calls.length, 0);
  });
  await test('Une panne du SDK ne casse pas la confirmation du formulaire', async () => {
    const h = harness(); h.window.arcMeasurement.setConsent(true);
    h.window.oaiq = () => { throw Error('synthetic SDK failure'); };
    h.document.getElementById('f-email').value = 'synthetic@example.test';
    new vm.Script(contactScript).runInContext(h.context);
    await h.context.sendMessage();
    assert.equal(h.document.getElementById('form-success').style.display, 'block');
  });
  await test('Toutes les pages publiques prévues chargent une seule fois le suivi', () => {
    for (const name of ['contact', 'home', 'ppl', 'accueil', 'laflotte', 'leclub', 'postppl', 'aerodrome', 'ppv']) {
      const page = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
      assert.equal((page.match(/src="\/arc-measurement.js"/g) || []).length, 1);
    }
    assert.ok(!source.includes('appointment_scheduled'));
    assert.ok(!source.includes('order_created'));
  });
  return passed;
}
module.exports = runTests;
if (require.main === module) runTests().then(passed => {
  console.log(passed.length + ' tests réussis');
  passed.forEach(name => console.log('✓ ' + name));
}).catch(error => { console.error(error); process.exitCode = 1; });
