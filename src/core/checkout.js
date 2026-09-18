// VirrTech Duka POS — checkout state machine (pure logic).
//
// A sale moves:  pending -> completed | failed
// Stock is only decremented when a sale is completed, and the idempotency
// key guarantees the same payment attempt can never produce two sales.

import { assertMoney } from './money.js';

export const PAYMENT_METHODS = ['cash', 'mpesa', 'card'];

export function buildSaleLines(cartItems, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  for (const item of cartItems) {
    const p = byId.get(item.productId);
    if (!p) return { ok: false, error: `A product in the cart no longer exists: ${item.name}` };
    if (item.qty > p.stock) {
      return { ok: false, error: `Insufficient stock for ${p.name} (available: ${p.stock}).` };
    }
    lines.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? null,
      unitPriceKES: p.priceKES,
      qty: item.qty,
      lineTotalKES: p.priceKES * item.qty,
    });
  }
  const subtotalKES = lines.reduce((s, l) => s + l.lineTotalKES, 0);
  return { ok: true, lines, subtotalKES };
}

/**
 * Create the pending sale that will represent this payment attempt.
 * `idempotencyKey` ties exactly one payment attempt to exactly one sale row,
 * so a retried or duplicated action cannot double-charge.
 */
export function createPendingSale({ cartItems, products, number, id, idempotencyKey, createdAt, method }) {
  if (!PAYMENT_METHODS.includes(method)) throw new Error(`Unknown payment method: ${method}`);
  if (!idempotencyKey) throw new Error('idempotencyKey is required');
  const built = buildSaleLines(cartItems, products);
  if (!built.ok) return built;
  return {
    ok: true,
    sale: {
      id,
      idempotencyKey,
      number,
      createdAt,
      status: 'pending',
      failureReason: null,
      lines: built.lines,
      subtotalKES: built.subtotalKES,
      totalKES: built.subtotalKES,
      refundTotalKES: 0,
      payment: { method, status: 'requested', details: {} },
      refunds: [],
    },
  };
}

export function applyCashPayment(sale, { tenderedKES }) {
  assertMoney(tenderedKES, 'tenderedKES');
  if (sale.status !== 'pending') return { ok: false, error: 'This checkout is no longer pending.' };
  if (tenderedKES < sale.totalKES) {
    return { ok: false, error: 'Cash tendered is less than the total.' };
  }
  return {
    ok: true,
    sale: {
      ...sale,
      payment: { ...sale.payment, status: 'settled', details: { tenderedKES, changeKES: tenderedKES - sale.totalKES } },
    },
  };
}

/** Simulated M-Pesa / card settlement. `ref` is a locally generated reference. */
export function applyElectronicPayment(sale, { phone = null, ref = null }) {
  if (sale.status !== 'pending') return { ok: false, error: 'This checkout is no longer pending.' };
  if (sale.payment.method === 'mpesa' && !phone) return { ok: false, error: 'Customer phone number is missing.' };
  if (!ref) return { ok: false, error: 'Payment reference is missing.' };
  const details = { ref };
  if (sale.payment.method === 'mpesa') details.phone = phone;
  return { ok: true, sale: { ...sale, payment: { ...sale.payment, status: 'settled', details } } };
}

/** Finalize a settled sale: mark completed and emit stock-movement records. */
export function completeSale(sale) {
  if (sale.status !== 'pending') return { ok: false, error: 'Only a pending sale can be completed.' };
  if (sale.payment.status !== 'settled') return { ok: false, error: 'Payment has not been settled yet.' };
  const movements = sale.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    sku: l.sku,
    delta: -l.qty,
    reason: 'sale',
    note: `Sale ${sale.number}`,
    refId: sale.id,
  }));
  return { ok: true, sale: { ...sale, status: 'completed' }, movements };
}

export function failSale(sale, reason = '') {
  return { ok: true, sale: { ...sale, status: 'failed', failureReason: reason || null } };
}
