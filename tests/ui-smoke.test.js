// Real-DOM smoke tests: boots the actual app inside happy-dom against the
// fake IndexedDB, then drives the primary cashier interactions exactly like
// a person on a phone would. Catches runtime-wiring bugs that static tests
// miss — null element selectors, async store results consumed synchronously,
// doubled status text, etc.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { FakeIndexedDB } from './helpers/fake-idb.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const window = new Window({ url: 'http://localhost:8080/', width: 1280, height: 900 });
const document = window.document;

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// Globals that app code touches unqualified. Keep navigator minimal: no
// serviceWorker key, so the SW registration branch is skipped.
define('window', window);
define('document', document);
define('location', window.location);
define('history', window.history);
define('navigator', { onLine: true, userAgent: 'node-happy-dom' });
define('matchMedia', (q) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
}));
define('HTMLElement', window.HTMLElement);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('KeyboardEvent', window.KeyboardEvent);
define('indexedDB', new FakeIndexedDB());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, msg, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(10);
  }
  throw new Error(msg);
}
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

before(async () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8').replace(
    /<script[^>]*src="[^"]*"[^>]*>\s*<\/script>/,
    '',
  );
  const inner = html.match(/<html[^>]*>([\s\S]*)<\/html>/)[1];
  document.documentElement.innerHTML = inner;

  await import('../src/main.js');

  await waitUntil(
    () => document.getElementById('splash').hidden || document.querySelector('.splash-error'),
    'app never finished booting (splash still visible)',
  );
});

test('boots without the startup error screen', () => {
  assert.ok(!document.querySelector('.splash-error'), `boot error: ${document.querySelector('.splash-error')?.textContent}`);
});

test('register view renders the full demo catalogue', () => {
  assert.equal(document.querySelectorAll('#reg-results [data-add]').length, 29);
});

test('status pill shows exactly one Online label (no doubled text)', () => {
  const pill = document.getElementById('net-status');
  assert.equal(pill.querySelector('.net-txt').textContent, 'Online');
  assert.equal(pill.querySelector('.net-dot').textContent.trim(), '');
});

test('tapping Add on a product tile puts it in the cart', async () => {
  const tile = document.querySelector('#reg-results [data-add]');
  const name = tile.dataset.add;
  assert.ok(name, 'tile carries a product id');
  click(tile);
  await waitUntil(() => document.querySelectorAll('.cart-line').length === 1, 'cart line never appeared');
  assert.equal(document.getElementById('cart-count').textContent.trim(), '1 item');
  assert.match(document.getElementById('cart-total').textContent, /KSh/);
  assert.equal(document.getElementById('checkout-btn').disabled, false);
  assert.ok(document.querySelector('.toast-success'), 'expected a success toast');
  assert.ok(!document.querySelector('.toast-error'), `unexpected error toast: ${document.querySelector('.toast-error')?.textContent}`);
});

test('quantity + button increments the cart line', async () => {
  click(document.querySelector('.cart-line [data-inc]'));
  await waitUntil(
    () => document.querySelector('.cart-line .qty-val')?.textContent.trim() === '2',
    'qty did not increase',
  );
  assert.ok(!document.querySelector('.toast-error'), `unexpected error toast: ${document.querySelector('.toast-error')?.textContent}`);
});

test('every tab mounts and renders without runtime errors', async () => {
  for (const name of ['catalogue', 'sales', 'dashboard', 'settings', 'register']) {
    click(document.querySelector(`[data-nav="${name}"]`));
    await sleep(30);
    assert.equal(document.getElementById(`view-${name}`).hidden, false, `${name} view did not activate`);
    assert.ok(!document.querySelector('.toast-error'), `error toast while rendering ${name}: ${document.querySelector('.toast-error')?.textContent}`);
    assert.ok(!document.querySelector('.splash-error'), `crash while rendering ${name}`);
  }
  assert.equal(document.querySelectorAll('#cat-list .product-card').length, 29, 'catalogue list wrong size');
  assert.ok(document.querySelector('#dash-stats .stat-card'), 'dashboard stats empty');
});

test('settings: saving shop details persists', async () => {
  click(document.querySelector('[data-nav="settings"]'));
  await sleep(30);
  document.getElementById('shop-name').value = 'Test Mamma Duka';
  document.getElementById('shop-location').value = 'Eldoret, Kenya';
  document.querySelector('#shop-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitUntil(() => document.querySelector('.toast-success'), 'no success toast after shop save');
  assert.ok(!document.querySelector('.toast-error'), `unexpected error toast: ${document.querySelector('.toast-error')?.textContent}`);
});

test('catalogue: new product form saves and appears in the list', async () => {
  click(document.querySelector('[data-nav="catalogue"]'));
  await sleep(30);
  const beforeCount = document.querySelectorAll('#cat-list .product-card').length;
  click(document.querySelector('[data-new-product]'));
  await waitUntil(() => document.querySelector('#pf-name'), 'product form modal did not open');
  const set = (id, value) => {
    document.getElementById(id).value = value;
  };
  set('pf-name', 'Test Spa Water 500ml');
  set('pf-sku', 'TST-901');
  set('pf-barcode', '4006381333931');
  set('pf-category', 'Beverages');
  set('pf-price', '49');
  set('pf-stock', '10');
  document.querySelector('form[data-product-form]').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await waitUntil(() => document.querySelectorAll('#cat-list .product-card').length === beforeCount + 1, 'new product not listed');
  assert.ok(!document.querySelector('.toast-error'), `unexpected error toast: ${document.querySelector('.toast-error')?.textContent}`);
});
