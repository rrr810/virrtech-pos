import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSaleNumber, dayStats, salesInWindow, netSaleKES, startOfDay } from '../src/core/sales.js';

test('formatSaleNumber pads to S-00001', () => {
  assert.equal(formatSaleNumber(1), 'S-00001');
  assert.equal(formatSaleNumber(42), 'S-00042');
  assert.equal(formatSaleNumber(123456), 'S-123456');
  assert.throws(() => formatSaleNumber(0), RangeError);
});

function mkSale({ id, day, hour, method, totalKES, lines, status = 'completed', refundTotalKES = 0 }) {
  const d = new Date(day);
  d.setHours(hour, 15, 0, 0);
  return {
    id,
    number: id,
    createdAt: d.getTime(),
    status,
    lines,
    subtotalKES: totalKES,
    totalKES,
    refundTotalKES,
    payment: { method, status: 'settled', details: {} },
    refunds: [],
  };
}

const day = '2026-09-18';
const sales = [
  mkSale({ id: 'a', day, hour: 8, method: 'cash', totalKES: 200, lines: [{ productId: 'x', name: 'X', sku: 'X', barcode: null, unitPriceKES: 100, qty: 2, lineTotalKES: 200 }] }),
  mkSale({ id: 'b', day, hour: 9, method: 'mpesa', totalKES: 400, lines: [{ productId: 'y', name: 'Y', sku: 'Y', barcode: null, unitPriceKES: 200, qty: 2, lineTotalKES: 400 }] }),
  mkSale({ id: 'c', day, hour: 9, method: 'card', totalKES: 300, lines: [{ productId: 'x', name: 'X', sku: 'X', barcode: null, unitPriceKES: 100, qty: 3, lineTotalKES: 300 }], refundTotalKES: 100 }),
  mkSale({ id: 'p', day, hour: 10, method: 'cash', totalKES: 999, lines: [], status: 'pending' }),
  mkSale({ id: 'y1', day: '2026-09-19', hour: 12, method: 'cash', totalKES: 500, lines: [] }),
];

test('dayStats aggregates only completed sales for the given day', () => {
  const stats = dayStats(sales, startOfDay(new Date(day + 'T00:00:00')));
  assert.equal(stats.count, 3);
  assert.equal(stats.totalKES, 900);
  assert.equal(stats.itemsSold, 7);
  assert.equal(stats.refundedKES, 100);
  assert.equal(stats.avgKES, 300);
  assert.deepEqual(stats.byMethod, { cash: 200, mpesa: 400, card: 300 });
  assert.equal(stats.byHour[8], 200);
  assert.equal(stats.byHour[9], 700);
  assert.equal(stats.byHour.length, 24);
});

test('dayStats ranks top products by quantity', () => {
  const stats = dayStats(sales, startOfDay(new Date(day + 'T00:00:00')));
  assert.deepEqual(stats.topProducts[0], { name: 'X', qty: 5, revenueKES: 500 });
  assert.equal(stats.topProducts[1].name, 'Y');
});

test('empty day returns zeros', () => {
  const stats = dayStats([], startOfDay(new Date(day + 'T00:00:00')));
  assert.equal(stats.count, 0);
  assert.equal(stats.avgKES, 0);
  assert.deepEqual(stats.byMethod, { cash: 0, mpesa: 0, card: 0 });
});

test('salesInWindow filters by time and netSaleKES subtracts refunds', () => {
  const from = startOfDay(new Date('2026-09-18T00:00:00'));
  const to = startOfDay(new Date('2026-09-19T00:00:00'));
  assert.equal(salesInWindow(sales, from, to).length, 4);
  assert.equal(netSaleKES(sales[2]), 200);
});
