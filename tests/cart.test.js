import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCart, addToCart, setCartQty, removeCartItem, clearCart, cartTotals } from '../src/core/cart.js';

const milk = { id: 'm', name: 'Milk (1L)', sku: 'DRY-001', barcode: null, priceKES: 135, stock: 3 };
const bread = { id: 'b', name: 'White Bread (Loaf)', sku: 'FRH-001', barcode: null, priceKES: 55, stock: 2 };

test('addToCart accumulates quantities for the same product', () => {
  let res = addToCart(emptyCart(), milk, 1);
  assert.equal(res.ok, true);
  res = addToCart(res.cart, milk, 1);
  assert.equal(res.ok, true);
  assert.equal(res.cart.items[0].qty, 2);
  assert.equal(res.cart.items.length, 1);
});

test('addToCart enforces available stock', () => {
  let res = addToCart(emptyCart(), milk, 3);
  assert.equal(res.ok, true);
  res = addToCart(res.cart, milk, 1);
  assert.equal(res.ok, false);
  assert.match(res.error, /Only 3 in stock/);
});

test('addToCart rejects bad quantities', () => {
  assert.equal(addToCart(emptyCart(), milk, 0).ok, false);
  assert.equal(addToCart(emptyCart(), milk, 1.5).ok, false);
  assert.equal(addToCart(emptyCart(), undefined, 1).ok, false);
});

test('setCartQty clamps to stock and removes at zero', () => {
  let cart = addToCart(emptyCart(), milk, 2).cart;
  let res = setCartQty(cart, 'm', 4, milk.stock);
  assert.equal(res.ok, false);
  res = setCartQty(cart, 'm', 1, milk.stock);
  assert.equal(res.ok, true);
  assert.equal(res.cart.items[0].qty, 1);
  res = setCartQty(res.cart, 'm', 0, milk.stock);
  assert.equal(res.ok, true);
  assert.equal(res.cart.items.length, 0);
});

test('removeCartItem and clearCart work', () => {
  let cart = addToCart(emptyCart(), milk, 1).cart;
  cart = addToCart(cart, bread, 2).cart;
  assert.equal(cart.items.length, 2);
  cart = removeCartItem(cart, 'b').cart;
  assert.deepEqual(cart.items.map((i) => i.productId), ['m']);
  cart = clearCart(cart).cart;
  assert.equal(cart.items.length, 0);
});

test('cartTotals sums quantities and integer shilling subtotals', () => {
  let cart = addToCart(emptyCart(), milk, 2).cart;
  cart = addToCart(cart, bread, 1).cart;
  const t = cartTotals(cart);
  assert.equal(t.count, 3);
  assert.equal(t.subtotalKES, 2 * 135 + 55);
  assert.ok(Number.isInteger(t.subtotalKES));
});
