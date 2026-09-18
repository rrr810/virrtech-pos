// VirrTech Duka POS — product validation and catalogue search (pure logic).

import { parseKESInput } from './money.js';
import { classify } from './barcodes.js';

export const CATEGORIES = [
  'Staples',
  'Drinks',
  'Dairy',
  'Fresh Produce',
  'Snacks',
  'Household',
  'Personal Care',
];

const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/**
 * Validate a product form input.
 * `existing` is the list of all products (for uniqueness checks),
 * `selfId` excludes the record being edited.
 */
export function validateProduct(input, existing = [], selfId = null) {
  const errors = {};

  const name = String(input?.name ?? '').trim();
  if (name.length < 2) errors.name = 'Name must be at least 2 characters.';
  else if (name.length > 120) errors.name = 'Name must be 120 characters or fewer.';

  const sku = String(input?.sku ?? '').trim().toUpperCase();
  if (!SKU_RE.test(sku)) errors.sku = 'SKU must be 2–40 letters, digits or dashes (no spaces).';
  else if (existing.some((p) => p.id !== selfId && p.sku.toUpperCase() === sku)) errors.sku = 'This SKU is already in use.';

  let barcode = null;
  const rawBarcode = String(input?.barcode ?? '').trim();
  if (rawBarcode !== '') {
    const res = classify(rawBarcode);
    if (!res.ok) errors.barcode = res.error;
    else {
      barcode = res.code;
      if (existing.some((p) => p.id !== selfId && p.barcode && p.barcode.toUpperCase() === barcode)) {
        errors.barcode = 'This barcode is already registered to another product.';
      }
    }
  }

  const category = String(input?.category ?? '').trim();
  if (category.length < 1) errors.category = 'Category is required.';
  else if (category.length > 40) errors.category = 'Category must be 40 characters or fewer.';

  let priceKES = input?.priceKES;
  if (typeof priceKES === 'string') {
    const parsed = parseKESInput(priceKES);
    if (!parsed.ok) errors.priceKES = parsed.error;
    else priceKES = parsed.value;
  }
  if (!errors.priceKES && (!Number.isInteger(priceKES) || priceKES < 0)) {
    errors.priceKES = 'Price must be a whole number of shillings (0 allowed).';
  }

  let stock = input?.stock;
  if (typeof stock === 'string') stock = stock === '' ? NaN : Number(stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
    errors.stock = 'Stock must be a whole number between 0 and 1,000,000.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, sku, barcode, category, priceKES, stock } };
}

/**
 * Search products by name, SKU or barcode (barcode exact/prefix first,
 * then SKU, then name). Returns at most 60 matches.
 */
export function searchProducts(products, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...products];
  const code = q.replace(/\s+/g, '');
  const scored = [];
  for (const p of products) {
    const name = p.name.toLowerCase();
    const sku = p.sku.toLowerCase();
    const barcode = (p.barcode ?? '').toLowerCase();
    let score = 0;
    if (barcode && barcode === code) score = 100;
    else if (barcode && barcode.startsWith(code)) score = 90;
    else if (sku === q) score = 85;
    else if (sku.startsWith(q)) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (name.includes(q)) score = 60;
    if (score > 0) scored.push({ score, p });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, 60).map((s) => s.p);
}
