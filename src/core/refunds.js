// VirrTech Duka POS — returns and refunds (pure logic).
//
// Refunds are always validated against what was actually sold, so a cashier
// can never refund more than the customer bought, and stock is restored
// line by line as auditable 'return' movements.

import { PAYMENT_METHODS } from './checkout.js';

export function remainingQty(sale, productId) {
  const line = sale.lines.find((l) => l.productId === productId);
  if (!line) return 0;
  const refunded = sale.refunds.reduce(
    (sum, r) => sum + r.lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.qty, 0),
    0,
  );
  return line.qty - refunded;
}

export function refundableLineCount(sale) {
  return sale.lines.reduce((s, l) => s + (remainingQty(sale, l.productId) > 0 ? 1 : 0), 0);
}

/**
 * Build a refund from the original sale. Prices are taken from the sale
 * lines (what the customer paid), never from current catalogue prices.
 */
export function buildRefund({ sale, items, id, createdAt, method, reason, note = '', ref = null }) {
  if (!['completed', 'partially_refunded'].includes(sale.status)) {
    return { ok: false, error: 'This sale cannot be refunded.' };
  }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'Select at least one item to refund.' };
  if (!PAYMENT_METHODS.includes(method)) return { ok: false, error: 'Choose a refund method.' };
  if (typeof reason !== 'string' || reason.trim().length < 3) {
    return { ok: false, error: 'A short refund reason is required.' };
  }
  const lines = [];
  for (const item of items) {
    const line = sale.lines.find((l) => l.productId === item.productId);
    if (!line) return { ok: false, error: 'Unknown product in refund.' };
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      return { ok: false, error: `Quantity must be at least 1 for ${line.name}.` };
    }
    const remaining = remainingQty(sale, item.productId);
    if (item.qty > remaining) {
      return { ok: false, error: `Only ${remaining} of ${line.name} left to refund.` };
    }
    lines.push({
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unitPriceKES: line.unitPriceKES,
      qty: item.qty,
      lineTotalKES: line.unitPriceKES * item.qty,
    });
  }
  const totalKES = lines.reduce((s, l) => s + l.lineTotalKES, 0);
  return {
    ok: true,
    refund: {
      id,
      saleId: sale.id,
      saleNumber: sale.number,
      createdAt,
      method,
      reason: reason.trim(),
      note: String(note).trim(),
      ref,
      lines,
      totalKES,
    },
  };
}

/** Apply a built refund to a sale and emit stock-restoration movements. */
export function applyRefund(sale, refund) {
  const refundTotalKES = sale.refunds.reduce((s, r) => s + r.totalKES, 0) + refund.totalKES;
  const takenFrom = new Map();
  for (const l of refund.lines) takenFrom.set(l.productId, (takenFrom.get(l.productId) ?? 0) + l.qty);
  const fully = sale.lines.every((l) => remainingQty(sale, l.productId) - (takenFrom.get(l.productId) ?? 0) <= 0);
  const status = fully ? 'refunded' : 'partially_refunded';
  const movements = refund.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku,
    delta: l.qty,
    reason: 'return',
    note: `Return on ${sale.number}: ${refund.reason}`,
    refId: sale.id,
  }));
  return {
    ok: true,
    sale: { ...sale, status, refundTotalKES, refunds: [...sale.refunds, refund] },
    movements,
  };
}
