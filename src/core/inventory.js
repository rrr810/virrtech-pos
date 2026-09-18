// VirrTech Duka POS — inventory / stock movement rules (pure logic).

export const MOVEMENT_REASONS = ['initial', 'sale', 'return', 'adjustment'];

export function movementReasonLabel(reason) {
  switch (reason) {
    case 'sale': return 'Sale';
    case 'return': return 'Customer return';
    case 'adjustment': return 'Stock adjustment';
    case 'initial': return 'Opening stock';
    default: return reason;
  }
}

/**
 * Apply a manual stock adjustment to a product.
 * Stock can never go below zero; the movement record is returned for audit.
 */
export function adjustStock(product, { delta, reason = 'adjustment', note = '', refId = null }) {
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, error: 'Change must be a non-zero whole number.' };
  }
  if (!MOVEMENT_REASONS.includes(reason)) return { ok: false, error: 'Unknown movement reason.' };
  const stock = product.stock + delta;
  if (stock < 0) return { ok: false, error: `Stock cannot go below zero (current stock: ${product.stock}).` };
  return {
    ok: true,
    product: { ...product, stock },
    movement: {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      delta,
      reason,
      note,
      refId,
    },
  };
}
