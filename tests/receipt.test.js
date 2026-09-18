import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, wrapText, RECEIPT_WIDTH } from '../src/core/receipt.js';

const shop = { name: 'VirrTech Duka', location: 'Eldoret, Kenya', phone: '0700 000 000' };
const sale = {
  id: 's1',
  number: 'S-00007',
  createdAt: new Date('2026-09-18T09:30:00').getTime(),
  status: 'completed',
  lines: [
    { productId: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, unitPriceKES: 135, qty: 2, lineTotalKES: 270 },
    { productId: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, unitPriceKES: 55, qty: 1, lineTotalKES: 55 },
  ],
  subtotalKES: 325,
  totalKES: 325,
  refundTotalKES: 0,
  payment: { method: 'cash', status: 'settled', details: { tenderedKES: 500, changeKES: 175 } },
  refunds: [],
};

test('receipt lines are all within the 80mm width', () => {
  const { lines } = buildReceipt({ shop, sale });
  assert.ok(lines.length > 10);
  for (const line of lines) assert.ok(line.length <= RECEIPT_WIDTH, `line too wide: "${line}" (${line.length})`);
});

test('cash receipt shows tendered amount and change', () => {
  const { text } = buildReceipt({ shop, sale });
  assert.ok(text.includes('S-00007'));
  assert.ok(text.includes('TOTAL'));
  assert.ok(text.includes('500'));
  assert.ok(text.includes('175'));
  assert.ok(text.includes('Change'));
});

test('mpesa receipt shows the simulated reference, card receipt too', () => {
  const mpesa = {
    ...sale,
    payment: { method: 'mpesa', status: 'settled', details: { ref: 'S8XK2Q9LM4', phone: '0712345678' } },
  };
  const mpesaText = buildReceipt({ shop, sale: mpesa }).text;
  assert.ok(mpesaText.includes('M-Pesa (simulated)'));
  assert.ok(mpesaText.includes('S8XK2Q9LM4'));
  assert.ok(mpesaText.includes('0712345678'));

  const card = { ...sale, payment: { method: 'card', status: 'settled', details: { ref: 'T77889900' } } };
  assert.ok(buildReceipt({ shop, sale: card }).text.includes('Card terminal (simulated)'));
});

test('receipt carries the prototype / eTIMS disclaimer', () => {
  const { text } = buildReceipt({ shop, sale });
  assert.ok(text.includes('DEMO PROTOTYPE'));
  assert.ok(text.includes('NOT KRA eTIMS certified'));
});

test('long product names wrap to the line width', () => {
  const longSale = {
    ...sale,
    lines: [{ ...sale.lines[0], name: 'Extra Premium Fortified Whole Grain Wheat Flour Large Family Pack (2kg)', qty: 1, lineTotalKES: 295 }],
  };
  const { lines } = buildReceipt({ shop, sale: longSale });
  for (const line of lines) assert.ok(line.length <= RECEIPT_WIDTH);
  assert.ok(lines.some((l) => l.includes('Fortified')));
});

test('wrapText hard-breaks words longer than the width', () => {
  const words = wrapText('a'.repeat(RECEIPT_WIDTH + 10), RECEIPT_WIDTH);
  assert.equal(words.length, 2);
  assert.equal(words[0].length, RECEIPT_WIDTH);
  assert.equal(words[1].length, 10);
  assert.deepEqual(wrapText('hello world', RECEIPT_WIDTH), ['hello world']);
});
