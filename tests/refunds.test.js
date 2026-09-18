import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingSale, applyCashPayment, completeSale } from '../src/core/checkout.js';
import { buildRefund, applyRefund, remainingQty, refundableLineCount } from '../src/core/refunds.js';

const products = [
  { id: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, priceKES: 135, stock: 3 },
  { id: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, priceKES: 55, stock: 2 },
];
const cartItems = [
  { productId: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, unitPriceKES: 135, qty: 2 },
  { productId: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, unitPriceKES: 55, qty: 1 },
];

function completedSale() {
  const pending = createPendingSale({
    cartItems,
    products,
    number: 'S-00002',
    id: 'sale-2',
    idempotencyKey: 'idem-2',
    createdAt: 1_700_000_100_000,
    method: 'cash',
  }).sale;
  const settled = applyCashPayment(pending, { tenderedKES: 325 }).sale;
  return completeSale(settled).sale;
}

test('buildRefund uses original sale prices and validates quantities', () => {
  const sale = completedSale();
  const ok = buildRefund({
    sale,
    items: [{ productId: 'm', qty: 1 }],
    id: 'r1',
    createdAt: 1_700_000_200_000,
    method: 'cash',
    reason: 'Customer return',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.refund.totalKES, 135);
  assert.equal(ok.refund.lines[0].unitPriceKES, 135);

  const tooMany = buildRefund({ sale, items: [{ productId: 'm', qty: 3 }], id: 'r2', createdAt: 1, method: 'cash', reason: 'Customer return' });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /Only 2 of Milk/);

  const noReason = buildRefund({ sale, items: [{ productId: 'm', qty: 1 }], id: 'r3', createdAt: 1, method: 'cash', reason: '  ' });
  assert.equal(noReason.ok, false);
});

test('partial refund leaves status partially_refunded and tracks remaining', () => {
  const sale = completedSale();
  const built = buildRefund({ sale, items: [{ productId: 'b', qty: 1 }], id: 'r1', createdAt: 1, method: 'cash', reason: 'Our error' });
  const applied = applyRefund(sale, built.refund);
  assert.equal(applied.sale.status, 'partially_refunded');
  assert.equal(applied.sale.refundTotalKES, 55);
  assert.equal(remainingQty(applied.sale, 'b'), 0);
  assert.equal(remainingQty(applied.sale, 'm'), 2);
  assert.equal(refundableLineCount(applied.sale), 1);
  assert.deepEqual(
    applied.movements.map((m) => [m.productId, m.delta, m.reason]),
    [['b', 1, 'return']],
  );
});

test('full refund across multiple refunds marks the sale refunded', () => {
  let sale = completedSale();
  let built = buildRefund({ sale, items: [{ productId: 'b', qty: 1 }], id: 'r1', createdAt: 1, method: 'cash', reason: 'Our error' });
  sale = applyRefund(sale, built.refund).sale;
  built = buildRefund({ sale, items: [{ productId: 'm', qty: 2 }], id: 'r2', createdAt: 2, method: 'mpesa', reason: 'Expired product', ref: 'RF123' });
  assert.equal(built.ok, true);
  const applied = applyRefund(sale, built.refund);
  assert.equal(applied.sale.status, 'refunded');
  assert.equal(applied.sale.refundTotalKES, 55 + 270);
  assert.equal(refundableLineCount(applied.sale), 0);

  const again = buildRefund({ sale: applied.sale, items: [{ productId: 'm', qty: 1 }], id: 'r3', createdAt: 3, method: 'cash', reason: 'Customer return' });
  assert.equal(again.ok, false);
  assert.match(again.error, /cannot be refunded/);
});

test('pending or failed sales cannot be refunded', () => {
  const pending = createPendingSale({
    cartItems,
    products,
    number: 'S-00003',
    id: 'sale-3',
    idempotencyKey: 'idem-3',
    createdAt: 1,
    method: 'cash',
  }).sale;
  const res = buildRefund({ sale: pending, items: [{ productId: 'm', qty: 1 }], id: 'r', createdAt: 2, method: 'cash', reason: 'Customer return' });
  assert.equal(res.ok, false);
});
