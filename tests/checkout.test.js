import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPendingSale,
  applyCashPayment,
  applyElectronicPayment,
  completeSale,
  failSale,
  buildSaleLines,
} from '../src/core/checkout.js';

const products = [
  { id: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, priceKES: 135, stock: 3 },
  { id: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, priceKES: 55, stock: 2 },
];
const cartItems = [
  { productId: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, unitPriceKES: 135, qty: 2 },
  { productId: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, unitPriceKES: 55, qty: 1 },
];
const common = { number: 'S-00001', id: 'sale-1', idempotencyKey: 'idem-1', createdAt: 1_700_000_000_000 };

test('buildSaleLines validates stock at checkout time', () => {
  const res = buildSaleLines(cartItems, products);
  assert.equal(res.ok, true);
  assert.equal(res.subtotalKES, 2 * 135 + 55);

  const bad = cartItems.map((i) => (i.productId === 'm' ? { ...i, qty: 9 } : i));
  const fail = buildSaleLines(bad, products);
  assert.equal(fail.ok, false);
  assert.match(fail.error, /Insufficient stock/);

  const ghost = [{ productId: 'x', name: 'Ghost', sku: 'X', barcode: null, unitPriceKES: 10, qty: 1 }];
  assert.equal(buildSaleLines(ghost, products).ok, false);
});

test('createPendingSale produces a pending sale with integer totals', () => {
  const res = createPendingSale({ cartItems, products, method: 'cash', ...common });
  assert.equal(res.ok, true);
  assert.equal(res.sale.status, 'pending');
  assert.equal(res.sale.totalKES, 325);
  assert.equal(res.sale.idempotencyKey, 'idem-1');
  assert.equal(res.sale.payment.method, 'cash');
  assert.throws(() => createPendingSale({ cartItems, products, method: 'crypto', ...common }), /Unknown payment method/);
});

test('cash flow: short tendering is rejected, change is exact', () => {
  const sale = createPendingSale({ cartItems, products, method: 'cash', ...common }).sale;
  const short = applyCashPayment(sale, { tenderedKES: 300 });
  assert.equal(short.ok, false);
  assert.match(short.error, /less than the total/);

  const ok = applyCashPayment(sale, { tenderedKES: 500 });
  assert.equal(ok.ok, true);
  assert.equal(ok.sale.payment.status, 'settled');
  assert.equal(ok.sale.payment.details.changeKES, 175);
  assert.throws(() => applyCashPayment(sale, { tenderedKES: 50.5 }), TypeError);
});

test('electronic settlement requires ref (and phone for M-Pesa)', () => {
  const mpesa = createPendingSale({ cartItems, products, method: 'mpesa', ...common }).sale;
  assert.equal(applyElectronicPayment(mpesa, { ref: 'S123' }).ok, false);
  const ok = applyElectronicPayment(mpesa, { ref: 'S1234567AB', phone: '0712345678' });
  assert.equal(ok.ok, true);
  assert.equal(ok.sale.payment.details.ref, 'S1234567AB');
  assert.equal(ok.sale.payment.details.phone, '0712345678');

  const card = createPendingSale({ cartItems, products, method: 'card', ...common }).sale;
  const cardOk = applyElectronicPayment(card, { ref: 'T77889900' });
  assert.equal(cardOk.ok, true);
  assert.equal(cardOk.sale.payment.details.phone, undefined);
});

test('completeSale requires settlement and emits negative stock movements', () => {
  const sale = createPendingSale({ cartItems, products, method: 'cash', ...common }).sale;
  assert.equal(completeSale(sale).ok, false); // not settled

  const settled = applyCashPayment(sale, { tenderedKES: 1000 }).sale;
  const done = completeSale(settled);
  assert.equal(done.ok, true);
  assert.equal(done.sale.status, 'completed');
  assert.equal(done.movements.length, 2);
  assert.deepEqual(
    done.movements.map((m) => [m.productId, m.delta, m.reason]).sort(),
    [
      ['b', -1, 'sale'],
      ['m', -2, 'sale'],
    ],
  );
  assert.equal(done.movements.every((m) => m.refId === 'sale-1'), true);
  assert.equal(completeSale(done.sale).ok, false); // cannot complete twice
});

test('failSale marks the attempt failed without touching stock', () => {
  const sale = createPendingSale({ cartItems, products, method: 'card', ...common }).sale;
  const res = failSale(sale, 'Customer cancelled at terminal');
  assert.equal(res.sale.status, 'failed');
  assert.equal(res.sale.failureReason, 'Customer cancelled at terminal');
  assert.equal(res.movements, undefined);
});
