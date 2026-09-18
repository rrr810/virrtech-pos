// VirrTech Duka POS — auto-fill lookup for unknown barcodes (pure logic).
// Every test injects a faked fetch: zero real network in the suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupBarcode, draftFromProduct } from '../src/core/productLookup.js';

const BARCODE = '6291041500033'; // EAN-13 → last 6 digits "500033"
const EXACT_URL = (host) =>
  `https://${host}/api/v2/product/${BARCODE}.json?fields=code,product_name,product_name_en,generic_name,generic_name_en,brands,categories_tags,quantity`;

/** A fake fetch that records every call and delegates to a per-URL handler. */
function fakeFetch(handler) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  fn.calls = calls;
  return fn;
}
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const notFound = () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) });

test('draftFromProduct composes "Brand name (quantity)" and derives the category', () => {
  const product = {
    product_name: 'Cocoa Spread',
    brands: 'Nutella, Ferrero',
    quantity: '400 g',
    categories_tags: ['en:spreads', 'en:breakfasts'],
  };
  const draft = draftFromProduct(product, { barcode: BARCODE, existingSkus: [] });
  assert.equal(draft.name, 'Nutella Cocoa Spread (400 g)');
  assert.equal(draft.sku, 'AUTO-500033');
  assert.equal(draft.category, 'Spreads'); // first "en:" tag, dashes→spaces, titleized

  // No duplicated brand or quantity when the base name already carries them.
  const dup = draftFromProduct(
    { product_name: 'Nutella Cocoa Spread (400 g)', brands: 'Nutella', quantity: '400 g' },
    { barcode: BARCODE },
  );
  assert.equal(dup.name, 'Nutella Cocoa Spread (400 g)');
});

test('draftFromProduct falls back to generic_name and rejects junk', () => {
  // Missing/short product_name → generic_name carries the name.
  const d = draftFromProduct({ product_name: 'x', generic_name: 'Milk' }, { barcode: BARCODE });
  assert.ok(d);
  assert.equal(d.name, 'Milk');

  // Null product, and a name shorter than 2 characters → null draft.
  assert.equal(draftFromProduct(null, { barcode: BARCODE }), null);
  assert.equal(draftFromProduct({ product_name: 'x' }, { barcode: BARCODE }), null);
  assert.equal(draftFromProduct({ brands: 'Only A Brand', quantity: '1 L' }, { barcode: BARCODE }), null);
});

test('names are truncated to 120 characters with an ellipsis', () => {
  const draft = draftFromProduct(
    { product_name: `Super Premium ${'Excellent'.repeat(20)}`, brands: 'BigBrand', quantity: '1 kg' },
    { barcode: BARCODE },
  );
  assert.ok(draft.name.length <= 120, `name too long: ${draft.name.length}`);
  assert.ok(draft.name.endsWith('…'), 'truncation must end with …');
  assert.ok(draft.name.startsWith('BigBrand Super Premium'));
});

test('SKU is AUTO-<last 6 digits> and bumps -2/-3 on collision', () => {
  const product = { product_name: 'Milk (1L)' };
  assert.equal(draftFromProduct(product, { barcode: BARCODE, existingSkus: [] }).sku, 'AUTO-500033');
  assert.equal(
    draftFromProduct(product, { barcode: BARCODE, existingSkus: ['AUTO-500033'] }).sku,
    'AUTO-500033-2',
  );
  assert.equal(
    draftFromProduct(product, { barcode: BARCODE, existingSkus: ['AUTO-500033', 'AUTO-500033-2'] }).sku,
    'AUTO-500033-3',
  );
  // Collisions are case-insensitive (SKUs are normalized to uppercase).
  assert.equal(
    draftFromProduct(product, { barcode: BARCODE, existingSkus: ['auto-500033'] }).sku,
    'AUTO-500033-2',
  );
});

test('status:0 (not in that database) resolves to null after trying every endpoint', async () => {
  const f = fakeFetch(() => ok({ status: 0, product: null }));
  const res = await lookupBarcode(BARCODE, { fetchImpl: f });
  assert.equal(res, null);
  assert.deepEqual(
    f.calls.map((c) => new URL(c.url).hostname),
    ['world.openfoodfacts.org', 'world.openbeautyfacts.org', 'world.openproductsfacts.org'],
  );
});

test('tries endpoints in order and reports the source that answered', async () => {
  const f = fakeFetch((url) =>
    url.includes('openbeautyfacts')
      ? ok({ status: 1, product: { product_name: 'Shampoo', categories_tags: ['en:shampoos'] } })
      : notFound(),
  );
  const res = await lookupBarcode(BARCODE, { fetchImpl: f });
  assert.ok(res, 'expected a draft from Open Beauty Facts');
  assert.equal(res.name, 'Shampoo');
  assert.equal(res.sourceLabel, 'Open Beauty Facts');
  // Food answered 404 first, beauty was found, the third endpoint is untouched.
  assert.deepEqual(
    f.calls.map((c) => new URL(c.url).hostname),
    ['world.openfoodfacts.org', 'world.openbeautyfacts.org'],
  );
  assert.equal(f.calls[0].url, EXACT_URL('world.openfoodfacts.org'));
});

test('safe-when-broken: hanging fetch, offline, bad JSON, whitespace and garbage codes', async () => {
  // A fetch that hangs and ignores the AbortSignal: the race must resolve
  // null via the timeout (timeoutMs 30 keeps the test fast), per endpoint.
  const hanging = () => new Promise(() => {});
  const t0 = Date.now();
  assert.equal(await lookupBarcode(BARCODE, { fetchImpl: hanging, timeoutMs: 30 }), null);
  assert.ok(Date.now() - t0 < 2000, 'a hanging fetch must not block the manual flow');

  // Rejection (offline) and a body that is not valid JSON → null.
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  assert.equal(await lookupBarcode(BARCODE, { fetchImpl: offline }), null);
  const badJson = () =>
    Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  assert.equal(await lookupBarcode(BARCODE, { fetchImpl: badJson }), null);

  // Whitespace and garbage codes never hit fetch at all.
  for (const bad of ['', '   ', '12 34', 'not a barcode!!', 'abc']) {
    const f = fakeFetch(() => ok({}));
    assert.equal(await lookupBarcode(bad, { fetchImpl: f }), null);
    assert.equal(f.calls.length, 0, `code ${JSON.stringify(bad)} must not reach the network`);
  }
});

test('raw scanned text is trimmed before it is used in the URL', async () => {
  const f = fakeFetch((url) =>
    url.includes(`/product/${BARCODE}.json`)
      ? ok({ status: 1, product: { product_name: 'Milk', brands: 'DairyFarm', quantity: '1 L' } })
      : notFound(),
  );
  const res = await lookupBarcode(`  ${BARCODE}  `, { fetchImpl: f });
  assert.ok(res);
  assert.equal(res.name, 'DairyFarm Milk (1 L)');
  assert.equal(f.calls[0].url, EXACT_URL('world.openfoodfacts.org'));
});
