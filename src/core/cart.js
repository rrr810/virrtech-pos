// VirrTech Duka POS — shopping cart operations (pure, no DOM, no storage).

export function emptyCart() {
  return { items: [] };
}

/**
 * Add qty of a product to the cart. Enforces available stock
 * (current cart quantity + requested quantity <= product.stock).
 */
export function addToCart(cart, product, qty = 1) {
  if (!product || typeof product.id !== 'string') return { ok: false, error: 'Unknown product.' };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: 'Quantity must be at least 1.' };
  const items = [...cart.items];
  const idx = items.findIndex((i) => i.productId === product.id);
  const current = idx >= 0 ? items[idx].qty : 0;
  if (current + qty > product.stock) {
    return { ok: false, error: `Only ${product.stock} in stock for ${product.name}.` };
  }
  const line = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? null,
    unitPriceKES: product.priceKES,
    qty: current + qty,
  };
  if (idx >= 0) items[idx] = line;
  else items.push(line);
  return { ok: true, cart: { items } };
}

/** Set an absolute quantity for a line. qty 0 removes the line. */
export function setCartQty(cart, productId, qty, maxStock) {
  if (!Number.isInteger(qty) || qty < 0) return { ok: false, error: 'Quantity must be zero or a positive whole number.' };
  if (qty > maxStock) return { ok: false, error: `Only ${maxStock} in stock.` };
  const items =
    qty === 0
      ? cart.items.filter((i) => i.productId !== productId)
      : cart.items.map((i) => (i.productId === productId ? { ...i, qty } : i));
  return { ok: true, cart: { items } };
}

export function removeCartItem(cart, productId) {
  return { ok: true, cart: { items: cart.items.filter((i) => i.productId !== productId) } };
}

export function clearCart(cart) {
  return { ok: true, cart: emptyCart() };
}

export function cartTotals(cart) {
  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  const subtotalKES = cart.items.reduce((s, i) => s + i.unitPriceKES * i.qty, 0);
  return { count, subtotalKES };
}
