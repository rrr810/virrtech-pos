import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMoney, assertMoney, formatKES, plainKES, parseKESInput } from '../src/core/money.js';

test('isMoney accepts only non-negative integers', () => {
  assert.equal(isMoney(0), true);
  assert.equal(isMoney(1234), true);
  assert.equal(isMoney(12.5), false);
  assert.equal(isMoney(-1), false);
  assert.equal(isMoney('12'), false);
  assert.equal(isMoney(null), false);
});

test('assertMoney throws a descriptive TypeError on bad values', () => {
  assert.throws(() => assertMoney(10.5), TypeError);
  assert.throws(() => assertMoney(-5, 'price'), /price must be a whole number/);
  assert.equal(assertMoney(100), 100);
});

test('formatKES uses the KSh symbol and en-KE grouping', () => {
  assert.equal(formatKES(0), 'KSh 0');
  assert.equal(formatKES(1250), 'KSh 1,250');
  assert.equal(formatKES(1234567), 'KSh 1,234,567');
});

test('plainKES drops the currency label', () => {
  assert.equal(plainKES(1250), '1,250');
});

test('parseKESInput handles cashier-style input', () => {
  assert.deepEqual(parseKESInput('1250'), { ok: true, value: 1250 });
  assert.deepEqual(parseKESInput('1,250'), { ok: true, value: 1250 });
  assert.deepEqual(parseKESInput('  ksh 500  '), { ok: true, value: 500 });
  assert.equal(parseKESInput('').ok, false);
  assert.equal(parseKESInput('abc').ok, false);
  assert.equal(parseKESInput('12.50').ok, false);
  assert.equal(parseKESInput('-100').ok, false);
  assert.equal(parseKESInput('99999999999999').ok, false);
});
