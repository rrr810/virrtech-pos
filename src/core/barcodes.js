// VirrTech Duka POS — barcode normalization, classification and checksum validation.
// Supported retail formats: EAN-13, EAN-8, UPC-A and Code 128.

const DIGITS = /^[0-9]+$/;
export const MIN_BARCODE_LEN = 4;
export const MAX_BARCODE_LEN = 48;

/** Strip whitespace that some scanners inject into raw values. */
export function cleanRaw(raw) {
  return String(raw ?? '').replace(/\s+/g, '');
}

function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(first12[i]);
  return (10 - (sum % 10)) % 10;
}

function ean8CheckDigit(first7) {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (i % 2 === 0 ? 3 : 1) * Number(first7[i]);
  return (10 - (sum % 10)) % 10;
}

function upcACheckDigit(first11) {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += (i % 2 === 0 ? 3 : 1) * Number(first11[i]);
  return (10 - (sum % 10)) % 10;
}

/**
 * Build a full EAN-13 (with valid check digit) from its first 12 digits.
 * Used by the demo seeder to mint realistic Kenyan (GS1 629) barcodes.
 */
export function ean13WithCheck(first12) {
  if (!/^[0-9]{12}$/.test(first12)) throw new TypeError('EAN-13 base must be exactly 12 digits');
  return first12 + ean13CheckDigit(first12);
}

/**
 * Classify and validate a barcode string.
 * Returns { ok: true, code, format } or { ok: false, code, error }.
 */
export function classify(code) {
  const c = cleanRaw(code).toUpperCase();
  if (c.length === 13 && DIGITS.test(c)) {
    if (Number(c[12]) === ean13CheckDigit(c.slice(0, 12))) return { ok: true, code: c, format: 'ean_13' };
    return { ok: false, code: c, error: 'EAN-13 check digit is invalid.' };
  }
  if (c.length === 8 && DIGITS.test(c)) {
    if (Number(c[7]) === ean8CheckDigit(c.slice(0, 7))) return { ok: true, code: c, format: 'ean_8' };
    return { ok: false, code: c, error: 'EAN-8 check digit is invalid.' };
  }
  if (c.length === 12 && DIGITS.test(c)) {
    if (Number(c[11]) === upcACheckDigit(c.slice(0, 11))) return { ok: true, code: c, format: 'upc_a' };
    return { ok: false, code: c, error: 'UPC-A check digit is invalid.' };
  }
  if (c.length >= MIN_BARCODE_LEN && c.length <= MAX_BARCODE_LEN && /^[\dA-Z-]+$/.test(c)) {
    return { ok: true, code: c, format: 'code_128' };
  }
  return { ok: false, code: c, error: 'Not a supported barcode format (EAN-13, EAN-8, UPC-A or Code 128).' };
}

/** A 12-digit UPC-A is the same product as the EAN-13 with a leading zero. */
export function ean13FromUpc(upc12) {
  return '0' + upc12;
}

/**
 * Candidate barcode strings to try when looking a scanned code up,
 * so UPC-A and leading-zero EAN-13 representations resolve to one product.
 */
export function lookupCandidates(code) {
  const c = cleanRaw(code).toUpperCase();
  const set = [c];
  if (c.length === 12 && DIGITS.test(c)) set.push(ean13FromUpc(c));
  if (c.length === 13 && DIGITS.test(c) && c.startsWith('0')) set.push(c.slice(1));
  return [...new Set(set)];
}
