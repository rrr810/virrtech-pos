import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustStock, movementReasonLabel, MOVEMENT_REASONS } from '../src/core/inventory.js';

const product = { id: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, priceKES: 135, stock: 10 };

test('adjustStock applies positive and negative adjustments', () => {
  const up = adjustStock(product, { delta: 5, note: 'Received delivery' });
  assert.equal(up.ok, true);
  assert.equal(up.product.stock, 15);
  assert.equal(up.movement.reason, 'adjustment');
  assert.equal(up.movement.delta, 5);

  const down = adjustStock(up.product, { delta: -4 });
  assert.equal(down.ok, true);
  assert.equal(down.product.stock, 11);
});

test('adjustStock never allows stock below zero', () => {
  const res = adjustStock(product, { delta: -11 });
  assert.equal(res.ok, false);
  assert.match(res.error, /cannot go below zero/);
  const exact = adjustStock(product, { delta: -10 });
  assert.equal(exact.ok, true);
  assert.equal(exact.product.stock, 0);
});

test('adjustStock rejects zero, fractional and unknown reasons', () => {
  assert.equal(adjustStock(product, { delta: 0 }).ok, false);
  assert.equal(adjustStock(product, { delta: 2.5 }).ok, false);
  assert.equal(adjustStock(product, { delta: 1, reason: 'theft' }).ok, false);
});

test('movement reasons map to human labels', () => {
  for (const r of MOVEMENT_REASONS) assert.ok(movementReasonLabel(r).length > 0);
  assert.equal(movementReasonLabel('sale'), 'Sale');
  assert.equal(movementReasonLabel('return'), 'Customer return');
});
