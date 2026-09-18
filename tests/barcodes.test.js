import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, cleanRaw, ean13WithCheck, ean13FromUpc, lookupCandidates } from '../src/core/barcodes.js';

test('ean13WithCheck produces valid check digits', () => {
  assert.equal(ean13WithCheck('629104150021'), '6291041500213');
  assert.equal(ean13WithCheck('590123412345'), '5901234123457');
  assert.throws(() => ean13WithCheck('123'), TypeError);
});

test('classify accepts valid EAN-13, EAN-8, UPC-A and Code 128', () => {
  assert.deepEqual(classify('5901234123457'), { ok: true, code: '5901234123457', format: 'ean_13' });
  assert.deepEqual(classify('96385074'), { ok: true, code: '96385074', format: 'ean_8' });
  assert.deepEqual(classify('036000291452'), { ok: true, code: '036000291452', format: 'upc_a' });
  assert.deepEqual(classify('ABC-123'), { ok: true, code: 'ABC-123', format: 'code_128' });
  assert.deepEqual(classify('VIRRTECH'), { ok: true, code: 'VIRRTECH', format: 'code_128' });
});

test('classify normalizes whitespace and case from raw scanner output', () => {
  assert.deepEqual(classify(' ab c-12 '), { ok: true, code: 'ABC-12', format: 'code_128' });
  assert.equal(cleanRaw(' 12 34 56 '), '123456');
});

test('classify rejects bad check digits and unsupported shapes', () => {
  assert.equal(classify('5901234123458').ok, false);
  assert.match(classify('5901234123458').error, /EAN-13 check digit/);
  assert.equal(classify('96385075').ok, false);
  assert.equal(classify('036000291453').ok, false);
  assert.equal(classify('12').ok, false); // too short
  assert.equal(classify('x'.repeat(60)).ok, false); // too long
  assert.equal(classify('').ok, false);
  assert.equal(classify('AB!12').ok, false); // bad characters
});

test('UPC-A <-> EAN-13 cross-lookup candidates', () => {
  assert.deepEqual(lookupCandidates('036000291452'), ['036000291452', '0036000291452']);
  assert.deepEqual(lookupCandidates('0036000291452'), ['0036000291452', '036000291452']);
  assert.equal(ean13FromUpc('036000291452'), '0036000291452');
  assert.deepEqual(lookupCandidates('6291041500213'), ['6291041500213']);
});
