// VirrTech Duka POS — Register (the till screen).
// Product search (name / SKU / barcode), big-tile product grid, cart with
// quantity controls, camera scanning and checkout entry point.

import { el, esc, ICONS } from './dom.js';
import { formatKES } from '../core/money.js';
import { searchProducts } from '../core/catalog.js';
import { cartTotals } from '../core/cart.js';
import { toast } from './toast.js';
import { openScanner } from './scanner.js';
import { openCheckout } from './checkout.js';
import { openReceiptModal } from './receipt-view.js';
import { openProductForm } from './catalogue-form.js';

export function mountRegister(root, { store, onNav }) {
  let query = '';
  let scanner = null;
  let lastScanned = null; // { code, at } to avoid adding the same code twice in a row
  const searchInput = root.querySelector('#reg-search');
  const hint = root.querySelector('#reg-hint');
  const grid = root.querySelector('#reg-results');
  const cartLines = root.querySelector('#cart-lines');
  const cartCount = root.querySelector('#cart-count');
  const cartTotal = root.querySelector('#cart-total');
  const checkoutBtn = root.querySelector('#checkout-btn');
  const clearBtn = root.querySelector('#clear-cart');
  const scanBtn = root.querySelector('#reg-scan');
  const cartToggle = root.querySelector('#cart-toggle');

  // ------------------------------------------------------------- product grid

  function renderGrid() {
    const results = searchProducts(store.state.products, query);
    const q = query.trim();
    const exact = q ? store.findByBarcode(q) : null;
    hint.textContent = q
      ? exact
        ? `Barcode ${exact.barcode} → ${exact.name} — press Enter or tap the tile to add.`
        : `${results.length} product${results.length === 1 ? '' : 's'} match “${q}”`
      : `${store.state.products.length} products in catalogue`;

    if (results.length === 0) {
      grid.replaceChildren(
        el(`<div class="empty-state" role="status">
              <p>No products match “${esc(q)}”.</p>
              <p class="muted small">Unknown barcode? Tap <strong>Scan</strong> and register it when prompted.</p>
            </div>`),
      );
      return;
    }
    grid.replaceChildren(
      ...results.map((p) => {
        const out = p.stock === 0;
        const isExact = exact && exact.id === p.id;
        return el(
          `<button type="button" class="tile${out ? ' tile-out' : ''}${isExact ? ' tile-exact' : ''}" data-add="${p.id}" ${out ? 'disabled' : ''}>
             <span class="tile-name">${esc(p.name)}</span>
             <span class="tile-sku">${esc(p.sku)}</span>
             <span class="tile-row">
               <span class="tile-price">${formatKES(p.priceKES)}</span>
               <span class="chip ${out ? 'chip-danger' : 'chip-muted'}">${out ? 'Out of stock' : `${p.stock} left`}</span>
             </span>
             <span class="tile-add">${ICONS.plus}<span>${out ? 'Unavailable' : 'Add'}</span></span>
           </button>`,
        );
      }),
    );
  }

  function addProduct(target, { silent = false } = {}) {
    const res = store.addToCart(target, 1);
    if (!res.ok) {
      toast(res.error, { type: 'error' });
      return null;
    }
    const product = store.resolveProduct(target);
    if (!silent) toast(`${product.name} added to cart`, { type: 'success', duration: 1600 });
    renderCart();
    return product;
  }

  // ------------------------------------------------------------- cart panel

  function renderCart() {
    const { items } = store.state.cart;
    if (cartCount) {
      cartCount.textContent = items.length > 0 ? `${cartTotals(store.state.cart).count} item${cartTotals(store.state.cart).count === 1 ? '' : 's'}` : 'empty';
    }
    if (items.length === 0) {
      cartLines.replaceChildren(el(`<p class="muted cart-empty">Cart is empty.<br>Scan or tap products to start a sale.</p>`));
    } else {
      cartLines.replaceChildren(
        ...items.map((i) =>
          el(
            `<div class="cart-line">
               <div class="cart-line-info">
                 <span class="cl-name">${esc(i.name)}</span>
                 <span class="cl-unit">${formatKES(i.unitPriceKES)} each</span>
               </div>
               <div class="qty-control">
                 <button type="button" class="qty-btn" data-dec="${i.productId}" aria-label="Decrease ${esc(i.name)}">${ICONS.minus}</button>
                 <span class="qty-val" aria-live="polite">${i.qty}</span>
                 <button type="button" class="qty-btn" data-inc="${i.productId}" aria-label="Increase ${esc(i.name)}">${ICONS.plus}</button>
               </div>
               <span class="cl-total">${formatKES(i.unitPriceKES * i.qty)}</span>
               <button type="button" class="icon-btn cl-remove" data-del="${i.productId}" aria-label="Remove ${esc(i.name)} from cart">${ICONS.trash}</button>
             </div>`,
          ),
        ),
      );
    }
    const t = cartTotals(store.state.cart);
    cartTotal.textContent = formatKES(t.subtotalKES);
    checkoutBtn.disabled = t.count === 0 || Boolean(store.state.activeSaleId);
    checkoutBtn.textContent = t.count > 0 ? `Checkout · ${formatKES(t.subtotalKES)}` : 'Checkout';
    clearBtn.disabled = t.count === 0;
    const toggleText = root.querySelector('#cart-toggle-text');
    if (toggleText) toggleText.textContent = t.count > 0 ? `Cart · ${formatKES(t.subtotalKES)}` : 'Cart is empty';
  }

  function render() {
    renderGrid();
    renderCart();
  }

  // ------------------------------------------------------------- scanning

  function openScannerPanel() {
    if (scanner) return;
    scanner = openScanner({
      onDetected: (code) => {
        const now = Date.now();
        if (lastScanned && lastScanned.code === code && now - lastScanned.at < 2500) return true; // duplicate frame
        lastScanned = { code, at: now };
        const product = store.findByBarcode(code);
        if (!product) return false;
        const res = store.addToCart(product.id, 1);
        if (!res.ok) {
          toast(res.error, { type: 'error' });
          return true; // recognised, but could not add (stock)
        }
        toast(`${product.name} added`, { type: 'success', duration: 1400 });
        renderCart();
        renderGrid();
        return true;
      },
      onUnknown: (code) => {
        // Registration form on top of the scanner; the camera keeps running.
        openProductForm({
          store,
          prefill: { barcode: code },
          onSaved: () => {
            toast('Barcode registered — it will be recognised on the next scan.', { type: 'success' });
          },
        });
      },
      onClose: () => {
        scanner = null;
      },
    });
  }

  // ------------------------------------------------------------- wiring

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderGrid();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    const exact = store.findByBarcode(q);
    const first = searchProducts(store.state.products, q)[0];
    if (exact) {
      addProduct(exact.id);
      return;
    }
    if (first) addProduct(first.id);
  });

  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-add]');
    if (!tile || tile.disabled) return;
    addProduct(tile.dataset.add);
  });

  root.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    if (inc) {
      const line = store.state.cart.items.find((i) => i.productId === inc.dataset.inc);
      if (line) {
        const res = store.setCartQty(line.productId, line.qty + 1);
        if (!res.ok) toast(res.error, { type: 'error' });
      }
      return;
    }
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const line = store.state.cart.items.find((i) => i.productId === dec.dataset.dec);
      if (line) store.setCartQty(line.productId, line.qty - 1);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      store.removeCartItem(del.dataset.del);
      return;
    }
    if (e.target.closest('#reg-scan')) {
      openScannerPanel();
      return;
    }
    if (e.target.closest('#clear-cart')) {
      store.clearCart();
      toast('Cart cleared', { type: 'info' });
      return;
    }
    if (e.target.closest('#checkout-btn')) {
      const t = cartTotals(store.state.cart);
      if (t.count === 0 || store.state.activeSaleId) return;
      openCheckout({
        store,
        onSettled: ({ sale, action }) => {
          if (action === 'print' && sale) {
            openReceiptModal({ sale, shop: store.state.shop });
          }
        },
      });
      return;
    }
    if (e.target.closest('#cart-toggle')) {
      const panel = root.querySelector('#reg-cart');
      const collapsed = panel.classList.toggle('cart-collapsed');
      root.querySelector('#cart-toggle').setAttribute('aria-expanded', String(!collapsed));
    }
  });

  // Phone-sized screens start with the cart collapsed so the product grid
  // owns the screen; the toggle bar keeps the running total one tap away.
  if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 959px)').matches) {
    root.querySelector('#reg-cart').classList.add('cart-collapsed');
    root.querySelector('#cart-toggle').setAttribute('aria-expanded', 'false');
  }

  const unsubscribe = store.subscribe(render);
  render();

  return {
    render,
    focusSearch: () => searchInput.focus(),
    destroy() {
      unsubscribe();
      scanner?.close();
    },
  };
}
