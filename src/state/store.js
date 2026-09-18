// VirrTech Duka POS — application store.
//
// Orchestration layer: loads state from IndexedDB, applies the pure
// business rules from src/core, persists results atomically, and notifies
// the UI. No DOM access here, which keeps it portable and testable.

import { openDB, idbGet, idbGetAll, idbBulk, idbClear, STORE_NAMES } from './db.js';
import { validateProduct } from '../core/catalog.js';
import * as cartCore from '../core/cart.js';
import * as checkoutCore from '../core/checkout.js';
import * as refundsCore from '../core/refunds.js';
import * as inventoryCore from '../core/inventory.js';
import { demoProducts, defaultShop } from '../core/demo.js';
import { lookupCandidates } from '../core/barcodes.js';
import { formatSaleNumber } from '../core/sales.js';

export const THEMES = ['system', 'light', 'dark'];
export const REFUND_REASONS = ['Customer return', 'Our error', 'Damaged in store', 'Expired product', 'Other'];

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class AppStore {
  #db = null;
  #listeners = new Set();

  state = {
    ready: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    products: [],
    sales: [],
    movements: [],
    cart: cartCore.emptyCart(),
    shop: defaultShop(),
    theme: 'system',
    saleCounter: 0,
    activeSaleId: null,
    lastSaleId: null,
    demoSeeded: false,
  };

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit() {
    for (const fn of [...this.#listeners]) fn(this.state);
  }

  // ---------------------------------------------------------------- setup

  async init() {
    this.#db = await openDB();
    const [seeded, products] = await Promise.all([
      idbGet(this.#db, 'meta', 'demo-seeded'),
      idbGetAll(this.#db, 'products'),
    ]);
    if (!seeded && products.length === 0) {
      await this.#seedDemo();
      this.state.demoSeeded = true;
    }
    await this.#load();
    this.state.ready = true;
    this.#emit();
  }

  async #seedDemo() {
    const now = Date.now();
    const products = demoProducts().map((p) => ({ id: p.id, createdAt: now, updatedAt: now, ...p }));
    const movements = products
      .filter((p) => p.stock > 0)
      .map((p) => ({
        id: uid(),
        productId: p.id,
        name: p.name,
        sku: p.sku,
        delta: p.stock,
        reason: 'initial',
        note: 'Demo opening stock',
        refId: null,
        createdAt: now,
      }));
    await idbBulk(this.#db, [
      ...products.map((p) => ['products', p]),
      ...movements.map((m) => ['movements', m]),
      ['meta', { key: 'demo-seeded', value: now }],
      ['cart', { id: 'cart', items: [] }],
    ]);
  }

  async #load() {
    const [products, sales, movements, metaShop, metaTheme, metaCounter, cartDoc, metaSeeded] = await Promise.all([
      idbGetAll(this.#db, 'products'),
      idbGetAll(this.#db, 'sales'),
      idbGetAll(this.#db, 'movements'),
      idbGet(this.#db, 'meta', 'shop'),
      idbGet(this.#db, 'meta', 'theme'),
      idbGet(this.#db, 'meta', 'sale-counter'),
      idbGet(this.#db, 'cart', 'cart'),
      idbGet(this.#db, 'meta', 'demo-seeded'),
    ]);
    products.sort((a, b) => a.name.localeCompare(b.name));
    sales.sort((a, b) => b.createdAt - a.createdAt);
    movements.sort((a, b) => b.createdAt - a.createdAt);
    this.state = {
      ...this.state,
      products,
      sales,
      movements,
      cart: cartDoc && Array.isArray(cartDoc.items) && cartDoc.items.length > 0 ? { items: cartDoc.items } : cartCore.emptyCart(),
      shop: metaShop?.value ?? defaultShop(),
      theme: THEMES.includes(metaTheme?.value) ? metaTheme.value : 'system',
      saleCounter: metaCounter?.value ?? 0,
      demoSeeded: Boolean(metaSeeded),
    };
  }

  // ---------------------------------------------------------------- products

  async upsertProduct(input, id = null) {
    const { ok, errors, value } = validateProduct(input, this.state.products, id);
    if (!ok) return { ok, errors };
    const now = Date.now();
    const existing = id ? this.state.products.find((p) => p.id === id) : null;
    const product = existing ? { ...existing, ...value, updatedAt: now } : { id: uid(), createdAt: now, updatedAt: now, ...value };
    const movements = [];
    if (!existing) {
      if (product.stock > 0) movements.push(this.#mv(product, product.stock, 'initial', 'Opening stock'));
    } else if (existing.stock !== product.stock) {
      movements.push(this.#mv(product, product.stock - existing.stock, 'adjustment', 'Stock edited in catalogue'));
    }
    await idbBulk(this.#db, [['products', product], ...movements.map((m) => ['movements', m])]);
    this.#applyProduct(product, movements);
    return { ok: true, id: product.id };
  }

  async adjustStock(id, delta, note = '') {
    const product = this.state.products.find((p) => p.id === id);
    if (!product) return { ok: false, error: 'Product not found.' };
    const res = inventoryCore.adjustStock(product, { delta, reason: 'adjustment', note });
    if (!res.ok) return res;
    const movement = { ...res.movement, id: uid(), createdAt: Date.now() };
    const next = { ...res.product, updatedAt: Date.now() };
    await idbBulk(this.#db, [['products', next], ['movements', movement]]);
    this.#applyProduct(next, [movement]);
    return { ok: true };
  }

  #mv(product, delta, reason, note, refId = null) {
    return {
      id: uid(),
      productId: product.id,
      name: product.name,
      sku: product.sku,
      delta,
      reason,
      note,
      refId,
      createdAt: Date.now(),
    };
  }

  #applyProduct(product, movements = []) {
    const idx = this.state.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) this.state.products[idx] = product;
    else this.state.products.push(product);
    this.state.products.sort((a, b) => a.name.localeCompare(b.name));
    for (const m of [...movements].reverse()) this.state.movements.unshift(m);
    this.#emit();
  }

  #replaceSale(sale) {
    const idx = this.state.sales.findIndex((s) => s.id === sale.id);
    if (idx >= 0) this.state.sales[idx] = sale;
    else this.state.sales.unshift(sale);
  }

  // ---------------------------------------------------------------- cart

  resolveProduct(target) {
    return (
      this.state.products.find((p) => p.id === target) ??
      this.findByBarcode(target) ??
      null
    );
  }

  findByBarcode(raw) {
    for (const code of lookupCandidates(raw)) {
      const hit = this.state.products.find((p) => p.barcode && p.barcode.toUpperCase() === code.toUpperCase());
      if (hit) return hit;
    }
    return null;
  }

  async addToCart(target, qty = 1) {
    const product = this.resolveProduct(target);
    if (!product) return { ok: false, error: 'Product not found.' };
    const res = cartCore.addToCart(this.state.cart, product, qty);
    if (!res.ok) return res;
    await this.#persistCart(res.cart);
    this.state.cart = res.cart;
    this.#emit();
    return { ok: true, cart: res.cart };
  }

  async setCartQty(productId, qty) {
    const product = this.state.products.find((p) => p.id === productId);
    const res = cartCore.setCartQty(this.state.cart, productId, qty, product ? product.stock : 0);
    if (!res.ok) return res;
    await this.#persistCart(res.cart);
    this.state.cart = res.cart;
    this.#emit();
    return { ok: true };
  }

  async removeCartItem(productId) {
    const res = cartCore.removeCartItem(this.state.cart, productId);
    await this.#persistCart(res.cart);
    this.state.cart = res.cart;
    this.#emit();
    return res;
  }

  async clearCart() {
    const res = cartCore.clearCart(this.state.cart);
    await this.#persistCart(res.cart);
    this.state.cart = res.cart;
    this.#emit();
    return res;
  }

  async #persistCart(cart) {
    await idbBulk(this.#db, [['cart', { id: 'cart', items: cart.items }]]);
  }

  // ---------------------------------------------------------------- checkout
  //
  // Duplicate-checkout protection has three layers:
  //   1. a `pending` sale row is written BEFORE the payment simulation runs;
  //   2. `activeSaleId` rejects any second checkout start while one is open;
  //   3. each attempt carries a unique idempotencyKey, so even a retried
  //      action can never produce a second completed sale.

  async beginCheckout(method) {
    if (this.state.activeSaleId) return { ok: false, error: 'A checkout is already in progress.' };
    if (this.state.cart.items.length === 0) return { ok: false, error: 'The cart is empty.' };
    const id = uid();
    const res = checkoutCore.createPendingSale({
      cartItems: this.state.cart.items,
      products: this.state.products,
      number: formatSaleNumber(this.state.saleCounter + 1),
      id,
      idempotencyKey: uid(),
      createdAt: Date.now(),
      method,
    });
    if (!res.ok) return res;
    await idbBulk(this.#db, [
      ['sales', res.sale],
      ['meta', { key: 'sale-counter', value: this.state.saleCounter + 1 }],
    ]);
    this.state.sales.unshift(res.sale);
    this.state.saleCounter += 1;
    this.state.activeSaleId = id;
    this.#emit();
    return { ok: true, sale: res.sale };
  }

  #findActive() {
    return this.state.sales.find((s) => s.id === this.state.activeSaleId) ?? null;
  }

  async settleCash(tenderedKES) {
    const sale = this.#findActive();
    if (!sale) return { ok: false, error: 'No checkout in progress.' };
    const res = checkoutCore.applyCashPayment(sale, { tenderedKES });
    if (!res.ok) return res;
    await idbBulk(this.#db, [['sales', res.sale]]);
    this.#replaceSale(res.sale);
    this.#emit();
    return { ok: true, sale: res.sale };
  }

  async settleElectronic({ phone = null, ref = null, approved }) {
    if (!approved) return this.cancelActiveSale('Payment declined');
    const sale = this.#findActive();
    if (!sale) return { ok: false, error: 'No checkout in progress.' };
    const res = checkoutCore.applyElectronicPayment(sale, { phone, ref });
    if (!res.ok) return res;
    await idbBulk(this.#db, [['sales', res.sale]]);
    this.#replaceSale(res.sale);
    this.#emit();
    return { ok: true, sale: res.sale };
  }

  async completeActiveSale() {
    const sale = this.#findActive();
    if (!sale) return { ok: false, error: 'No checkout in progress.' };
    const res = checkoutCore.completeSale(sale);
    if (!res.ok) return res;
    const now = Date.now();
    const productOps = [];
    for (const line of sale.lines) {
      const product = this.state.products.find((p) => p.id === line.productId);
      if (product) productOps.push(['products', { ...product, stock: product.stock - line.qty, updatedAt: now }]);
    }
    const movementOps = res.movements.map((m) => ['movements', { ...m, id: uid(), createdAt: now }]);
    await idbBulk(this.#db, [
      ['sales', res.sale],
      ...productOps,
      ...movementOps,
      ['cart', { id: 'cart', items: [] }],
    ]);
    this.#replaceSale(res.sale);
    for (const line of sale.lines) {
      const p = this.state.products.find((x) => x.id === line.productId);
      if (p) p.stock -= line.qty;
    }
    for (const op of movementOps) this.state.movements.unshift(op[1]);
    this.state.cart = cartCore.emptyCart();
    this.state.activeSaleId = null;
    this.state.lastSaleId = res.sale.id;
    this.#emit();
    return { ok: true, sale: res.sale };
  }

  async cancelActiveSale(reason = 'Checkout closed') {
    const sale = this.#findActive();
    if (!sale) return { ok: false, error: 'No checkout in progress.' };
    const res = checkoutCore.failSale(sale, reason);
    await idbBulk(this.#db, [['sales', res.sale]]);
    this.#replaceSale(res.sale);
    this.state.activeSaleId = null;
    this.#emit();
    return { ok: true, sale: res.sale };
  }

  // ---------------------------------------------------------------- refunds

  async createRefund(saleId, items, { method, reason, note = '', ref = null }) {
    const sale = this.state.sales.find((s) => s.id === saleId);
    if (!sale) return { ok: false, error: 'Sale not found.' };
    const built = refundsCore.buildRefund({ sale, items, id: uid(), createdAt: Date.now(), method, reason, note, ref });
    if (!built.ok) return built;
    const applied = refundsCore.applyRefund(sale, built.refund);
    const now = Date.now();
    const productOps = [];
    for (const line of built.refund.lines) {
      const product = this.state.products.find((p) => p.id === line.productId);
      if (product) productOps.push(['products', { ...product, stock: product.stock + line.qty, updatedAt: now }]);
    }
    const movementOps = applied.movements.map((m) => ['movements', { ...m, id: uid(), createdAt: now }]);
    await idbBulk(this.#db, [
      ['sales', applied.sale],
      ['refunds', built.refund],
      ...productOps,
      ...movementOps,
    ]);
    this.#replaceSale(applied.sale);
    for (const line of built.refund.lines) {
      const p = this.state.products.find((x) => x.id === line.productId);
      if (p) p.stock += line.qty;
    }
    for (const op of movementOps) this.state.movements.unshift(op[1]);
    this.#emit();
    return { ok: true, refund: built.refund, sale: applied.sale };
  }

  // ---------------------------------------------------------------- settings

  async setShop(shop) {
    const name = String(shop?.name ?? '').trim();
    if (name.length < 2 || name.length > 60) return { ok: false, error: 'Shop name must be 2–60 characters.' };
    const location = String(shop?.location ?? '').trim();
    if (location.length > 80) return { ok: false, error: 'Location must be 80 characters or fewer.' };
    const phone = String(shop?.phone ?? '').trim();
    if (phone !== '' && !/^[+\d][\d\s()-]{5,19}$/.test(phone)) return { ok: false, error: 'Phone number looks invalid.' };
    const value = { name, location, phone };
    await idbBulk(this.#db, [['meta', { key: 'shop', value }]]);
    this.state.shop = value;
    this.#emit();
    return { ok: true };
  }

  async setTheme(theme) {
    if (!THEMES.includes(theme)) return { ok: false, error: 'Unknown theme.' };
    await idbBulk(this.#db, [['meta', { key: 'theme', value: theme }]]);
    this.state.theme = theme;
    this.#emit();
    return { ok: true };
  }

  async resetDemo() {
    for (const store of STORE_NAMES) await idbClear(this.#db, store);
    await this.#seedDemo();
    await this.#load();
    this.state.activeSaleId = null;
    this.state.lastSaleId = null;
    this.#emit();
    return { ok: true };
  }

  // ---------------------------------------------------------------- misc

  setOnline(online) {
    this.state.online = Boolean(online);
    this.#emit();
  }

  saleById(id) {
    return this.state.sales.find((s) => s.id === id) ?? null;
  }
}
