// End-to-end orchestration tests: AppStore + core rules + (fake) IndexedDB.
// Covers the full cashier day: seed, product management, cart, cash + M-Pesa
// checkouts, declines, refunds with stock restore, and demo reset.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { FakeIndexedDB } from './helpers/fake-idb.js';

globalThis.indexedDB = new FakeIndexedDB();

const { AppStore } = await import('../src/state/store.js');

let store;

before(async () => {
  store = new AppStore();
  await store.init();
});

test('init seeds demo catalogue with valid barcodes and opening movements', () => {
  assert.equal(store.state.ready, true);
  assert.equal(store.state.products.length, 29);
  assert.equal(store.state.movements.length, 29);
  assert.ok(store.state.movements.every((m) => m.reason === 'initial'));
  assert.ok(store.state.cart.items.length === 0);
  assert.equal(store.state.saleCounter, 0);
  const rice = store.state.products.find((p) => p.sku === 'STP-003');
  assert.equal(rice.barcode.length, 13);
});

test('findByBarcode resolves EAN-13 codes, case-insensitively (scanner identity)', () => {
  const rice = store.state.products.find((p) => p.sku === 'STP-003');
  assert.equal(store.findByBarcode(rice.barcode).id, rice.id);
  assert.equal(store.findByBarcode(rice.barcode.toUpperCase()).id, rice.id);
  assert.equal(store.findByBarcode('0000000000000'), null);
  assert.equal(store.findByBarcode('  12  '), null);
});

test('product upsert validates and records opening stock movement', async () => {
  const bad = await store.upsertProduct({ name: 'X', sku: 'bad sku', barcode: '', category: '', priceKES: -1, stock: 0 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.sku && bad.errors.priceKES);

  const good = await store.upsertProduct({ name: 'Chai Mix (250g)', sku: 'DRK-006', barcode: 'CHAI-250', category: 'Drinks', priceKES: '120', stock: 15 });
  assert.equal(good.ok, true);
  const p = store.state.products.find((x) => x.id === good.id);
  assert.equal(p.stock, 15);
  assert.ok(store.state.movements[0].note === 'Opening stock');
  assert.equal(store.state.movements[0].delta, 15);

  // duplicate SKU rejected
  const dup = await store.upsertProduct({ name: 'Other', sku: 'DRK-006', barcode: '', category: 'Drinks', priceKES: 10, stock: 1 });
  assert.equal(dup.ok, false);
  assert.match(dup.errors.sku, /already in use/);
});

test('cart enforces stock; checkout is single-flight and idempotent', async () => {
  const rice = store.state.products.find((p) => p.sku === 'STP-003');
  const cola = store.state.products.find((p) => p.sku === 'DRK-002');
  const stockBefore = { rice: rice.stock, cola: cola.stock };

  let res = await store.addToCart(rice.id, 2);
  assert.equal(res.ok, true);
  res = await store.addToCart(cola.id, 1);
  assert.equal(res.ok, true);

  // over-stock rejected
  res = await store.addToCart(rice.id, rice.stock + 10);
  assert.equal(res.ok, false);
  assert.match(res.error, /Only \d+ in stock/);

  res = await store.setCartQty(rice.id, 999);
  assert.equal(res.ok, false);

  // scanning the exact barcode adds too (scanner path)
  const before = store.state.cart.items.find((i) => i.productId === cola.id).qty;
  res = await store.addToCart(cola.barcode, 1);
  assert.equal(res.ok, true);
  assert.equal(store.state.cart.items.find((i) => i.productId === cola.id).qty, before + 1);

  // begin checkout: pending sale + counter bump + single-flight guard
  const begin = await store.beginCheckout('cash');
  assert.equal(begin.ok, true);
  assert.equal(begin.sale.status, 'pending');
  assert.equal(begin.sale.number, 'S-00001');
  const again = await store.beginCheckout('cash');
  assert.equal(again.ok, false);
  assert.match(again.error, /already in progress/);

  // short cash rejected
  const total = begin.sale.totalKES;
  const short = await store.settleCash(total - 1);
  assert.equal(short.ok, false);

  // settle + complete: stock decremented, movements written, cart cleared
  const settled = await store.settleCash(total + 100);
  assert.equal(settled.sale.payment.details.changeKES, 100);
  const done = await store.completeActiveSale();
  assert.equal(done.ok, true);
  assert.equal(done.sale.status, 'completed');
  assert.equal(store.saleById(done.sale.id).status, 'completed');

  const riceAfter = store.state.products.find((p) => p.id === rice.id);
  const colaAfter = store.state.products.find((p) => p.id === cola.id);
  assert.equal(riceAfter.stock, stockBefore.rice - 2);
  assert.equal(colaAfter.stock, stockBefore.cola - 2); // 1 + 1 via barcode

  const saleMovements = store.state.movements.filter((m) => m.refId === done.sale.id && m.reason === 'sale');
  assert.equal(saleMovements.length, 2);
  assert.ok(saleMovements.every((m) => m.delta < 0));
  assert.equal(store.state.cart.items.length, 0);
  assert.equal(store.state.activeSaleId, null);

  // completing "again" is impossible: no active sale
  const twice = await store.completeActiveSale();
  assert.equal(twice.ok, false);
});

test('M-Pesa (simulated) checkout settles with phone + reference', async () => {
  const milk = store.state.products.find((p) => p.sku === 'DRY-001');
  const stockBefore = milk.stock;
  await store.addToCart(milk.id, 1);
  const begin = await store.beginCheckout('mpesa');
  assert.equal(begin.sale.number, 'S-00002');
  const bad = await store.settleElectronic({ ref: 'S123', approved: true });
  assert.equal(bad.ok, false); // phone required for mpesa
  const ok = await store.settleElectronic({ phone: '0712345678', ref: 'S9XKQ2M4PA', approved: true });
  assert.equal(ok.sale.payment.details.ref, 'S9XKQ2M4PA');
  const done = await store.completeActiveSale();
  assert.equal(done.sale.status, 'completed');
  assert.equal(store.state.products.find((p) => p.id === milk.id).stock, stockBefore - 1);
});

test('declined card payment fails the attempt without touching stock or cart', async () => {
  const soap = store.state.products.find((p) => p.sku === 'PCL-001');
  const stockBefore = soap.stock;
  await store.addToCart(soap.id, 1);
  const begin = await store.beginCheckout('card');
  const cancelled = await store.cancelActiveSale('Card payment declined by terminal');
  assert.equal(cancelled.sale.status, 'failed');
  assert.equal(store.saleById(begin.sale.id).status, 'failed');
  assert.equal(store.state.products.find((p) => p.id === soap.id).stock, stockBefore);
  assert.equal(store.state.cart.items.length, 1); // cart preserved
  await store.clearCart();
});

test('refunds: caps at purchased qty, restores stock, tracks sale status', async () => {
  const sale = store.state.sales.find((s) => s.number === 'S-00001');
  assert.ok(sale, 'S-00001 must exist');
  const [l1, l2] = sale.lines;

  const over = await store.createRefund(sale.id, [{ productId: l1.productId, qty: 99 }], { method: 'cash', reason: 'Customer return' });
  assert.equal(over.ok, false);
  assert.match(over.error, /left to refund/);

  // Partial refund of one unit from the first line.
  const partial = await store.createRefund(sale.id, [{ productId: l1.productId, qty: 1 }], { method: 'cash', reason: 'Customer return' });
  assert.equal(partial.ok, true);
  assert.equal(partial.sale.status, 'partially_refunded');
  assert.equal(partial.sale.refundTotalKES, l1.unitPriceKES);
  const stockAfterFirst = store.state.products.find((p) => p.id === l1.productId).stock;
  const returnMovements = store.state.movements.filter((m) => m.reason === 'return' && m.refId === sale.id);
  assert.equal(returnMovements.length, 1);
  assert.equal(returnMovements[0].delta, 1);

  // Refund the rest of both lines -> sale is fully refunded.
  const full = await store.createRefund(
    sale.id,
    [
      { productId: l1.productId, qty: l1.qty - 1 },
      { productId: l2.productId, qty: l2.qty },
    ],
    { method: 'cash', reason: 'Our error' },
  );
  assert.equal(full.ok, true);
  assert.equal(full.sale.status, 'refunded');
  assert.equal(full.sale.refundTotalKES, l1.unitPriceKES * l1.qty + l2.unitPriceKES * l2.qty);
  assert.equal(store.state.products.find((p) => p.id === l1.productId).stock, stockAfterFirst + (l1.qty - 1));

  const none = await store.createRefund(sale.id, [{ productId: l1.productId, qty: 1 }], { method: 'cash', reason: 'Customer return' });
  assert.equal(none.ok, false);
  assert.match(none.error, /cannot be refunded/);
});

test('stock adjustments cannot drive inventory negative', async () => {
  const salt = store.state.products.find((p) => p.sku === 'STP-006');
  const bad = await store.adjustStock(salt.id, -salt.stock - 1);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /cannot go below zero/);
  const ok = await store.adjustStock(salt.id, -5, 'Damaged in store');
  assert.equal(ok.ok, true);
  assert.equal(store.state.products.find((p) => p.id === salt.id).stock, salt.stock - 5);
});

test('resetDemo restores a pristine demo state', async () => {
  await store.resetDemo();
  assert.equal(store.state.products.length, 29);
  assert.equal(store.state.sales.length, 0);
  assert.equal(store.state.saleCounter, 0);
  assert.equal(store.state.cart.items.length, 0);
  assert.ok(store.state.movements.every((m) => m.reason === 'initial'));
});

test('shop settings validation', async () => {
  const bad = await store.setShop({ name: 'X', location: '', phone: 'not a phone!!' });
  assert.equal(bad.ok, false);
  const ok = await store.setShop({ name: 'Kimani Grocery', location: 'Eldoret, Kenya', phone: '0712 345 678' });
  assert.equal(ok.ok, true);
  assert.equal(store.state.shop.name, 'Kimani Grocery');
  await store.setShop({ name: 'VirrTech Duka', location: 'Eldoret, Kenya', phone: '0700 000 000' });
});
