import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct, searchProducts } from '../src/core/catalog.js';
import { ean13WithCheck } from '../src/core/barcodes.js';

const existing = [
  { id: 'a', name: 'Mandi Rice (1kg)', sku: 'STP-003', barcode: ean13WithCheck('629104150003'), category: 'Staples', priceKES: 165, stock: 10 },
  { id: 'b', name: 'Aqua Water (50cl)', sku: 'DRK-001', barcode: ean13WithCheck('629104150001'), category: 'Drinks', priceKES: 40, stock: 5 },
];

const base = {
  name: 'Milk (1L)',
  sku: 'DRY-001',
  barcode: '96385074',
  category: 'Dairy',
  priceKES: 135,
  stock: 20,
};

test('validateProduct accepts a valid product', () => {
  const res = validateProduct(base, existing);
  assert.equal(res.ok, true);
  assert.equal(res.value.barcode, '96385074');
  assert.equal(res.value.sku, 'DRY-001');
});

test('validateProduct enforces name, sku, price and stock rules', () => {
  let res = validateProduct({ ...base, name: 'M' }, existing);
  assert.equal(res.ok, false);
  assert.ok(res.errors.name);

  res = validateProduct({ ...base, sku: 'bad sku!' }, existing);
  assert.equal(res.ok, false);
  assert.ok(res.errors.sku);

  res = validateProduct({ ...base, priceKES: 10.5 }, existing);
  assert.equal(res.ok, false);
  assert.ok(res.errors.priceKES);

  res = validateProduct({ ...base, stock: -1 }, existing);
  assert.equal(res.ok, false);
  assert.ok(res.errors.stock);

  res = validateProduct({ ...base, category: '' }, existing);
  assert.ok(res.errors.category);
});

test('validateProduct rejects duplicate SKU and barcode, ignores self when editing', () => {
  let res = validateProduct({ ...base, sku: 'STP-003' }, existing);
  assert.equal(res.ok, false);
  assert.match(res.errors.sku, /already in use/);

  res = validateProduct({ ...base, barcode: existing[1].barcode }, existing);
  assert.equal(res.ok, false);
  assert.match(res.errors.barcode, /already registered/);

  // Editing product b with its own SKU/barcode is fine.
  res = validateProduct({ ...base, sku: 'DRK-001', barcode: existing[1].barcode }, existing, 'b');
  assert.equal(res.ok, true);
});

test('validateProduct accepts string price input and optional barcode', () => {
  const res = validateProduct({ ...base, barcode: '', priceKES: ' 1,350 ' }, existing);
  assert.equal(res.ok, true);
  assert.equal(res.value.priceKES, 1350);
  assert.equal(res.value.barcode, null);
});

test('validateProduct rejects invalid checksums on known formats', () => {
  const res = validateProduct({ ...base, barcode: '5901234123458' }, existing);
  assert.equal(res.ok, false);
  assert.match(res.errors.barcode, /check digit/);
});

test('searchProducts ranks barcode exact, prefix, sku and name', () => {
  let res = searchProducts(existing, existing[0].barcode);
  assert.deepEqual(res.map((p) => p.id), ['a']);

  res = searchProducts(existing, '629104');
  assert.equal(res.length, 2);
  assert.deepEqual(res.map((p) => p.id).sort(), ['a', 'b']);

  res = searchProducts(existing, 'stp');
  assert.deepEqual(res.map((p) => p.id), ['a']);

  res = searchProducts(existing, 'water');
  assert.deepEqual(res.map((p) => p.id), ['b']);

  res = searchProducts(existing, '   ');
  assert.equal(res.length, 2);
});
