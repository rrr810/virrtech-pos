// VirrTech Duka POS — product create/edit form (also used to register
// unknown barcodes from the scanner).

import { openModal } from './modal.js';
import { toast } from './toast.js';
import { el, esc, ICONS } from './dom.js';
import { CATEGORIES } from '../core/catalog.js';

export function openProductForm({ store, product = null, prefill = {}, onSaved }) {
  const editing = Boolean(product);
  const p = product ?? {};
  const bar = (prefill.barcode ?? p.barcode ?? '') || '';

  const content = el(
    `<form data-product-form novalidate>
      <div class="field">
        <label for="pf-name">Product name</label>
        <input id="pf-name" data-field="name" value="${esc(p.name ?? '')}" maxlength="120" required
               placeholder="e.g. Mandi Rice (1kg)">
        <p class="field-error" data-error="name" role="alert" hidden></p>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="pf-sku">SKU</label>
          <input id="pf-sku" data-field="sku" value="${esc(p.sku ?? '')}" maxlength="40" required placeholder="e.g. STP-009">
          <p class="field-error" data-error="sku" role="alert" hidden></p>
        </div>
        <div class="field">
          <label for="pf-category">Category</label>
          <input id="pf-category" data-field="category" value="${esc(p.category ?? '')}" list="pf-categories" maxlength="40" required>
          <datalist id="pf-categories">
            ${CATEGORIES.map((c) => `<option value="${esc(c)}"></option>`).join('')}
          </datalist>
          <p class="field-error" data-error="category" role="alert" hidden></p>
        </div>
      </div>
      <div class="field">
        <label for="pf-barcode">Barcode <span class="muted small">(EAN-13, EAN-8, UPC-A or Code 128 — optional)</span></label>
        <input id="pf-barcode" data-field="barcode" value="${esc(bar)}" maxlength="48"
               placeholder="Scan into the Register or type it here" inputmode="text" autocomplete="off">
        <p class="field-error" data-error="barcode" role="alert" hidden></p>
        <p class="form-hint small">${ICONS.info}<span>Check digits are validated for EAN/UPC. The first barcode for a product is its scanner identity.</span></p>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="pf-price">Price (KSh)</label>
          <input id="pf-price" data-field="priceKES" value="${p.priceKES ?? ''}" inputmode="numeric" required placeholder="e.g. 165">
          <p class="field-error" data-error="priceKES" role="alert" hidden></p>
        </div>
        <div class="field">
          <label for="pf-stock">Stock on hand</label>
          <input id="pf-stock" data-field="stock" value="${p.stock ?? ''}" inputmode="numeric" required placeholder="e.g. 20">
          <p class="field-error" data-error="stock" role="alert" hidden></p>
        </div>
      </div>
      <div class="row spread" style="margin-top:8px">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add product'}</button>
      </div>
    </form>`,
  );

  const showErrors = (errors) => {
    for (const key of ['name', 'sku', 'barcode', 'category', 'priceKES', 'stock']) {
      const node = content.querySelector(`[data-error="${key}"]`);
      const input = content.querySelector(`[data-field="${key}"]`);
      if (errors[key]) {
        node.textContent = errors[key];
        node.hidden = false;
        input.classList.add('input-error');
      } else {
        node.hidden = true;
        input.classList.remove('input-error');
      }
    }
  };

  content.querySelector('[data-cancel]').addEventListener('click', () => close());
  content.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (key) => content.querySelector(`[data-field="${key}"]`).value;
    const res = store.upsertProduct(
      {
        name: input('name'),
        sku: input('sku'),
        barcode: input('barcode'),
        category: input('category'),
        priceKES: input('priceKES'),
        stock: input('stock'),
      },
      product?.id ?? null,
    );
    if (!res.ok) {
      showErrors(res.errors ?? {});
      return;
    }
    toast(editing ? 'Product updated' : 'Product added', { type: 'success' });
    close();
    onSaved?.(res.id);
  });

  const { close } = openModal({
    title: editing ? `Edit ${p.name}` : bar ? 'Register new product' : 'New product',
    content,
    wide: true,
  });

  content.querySelector('#pf-name').focus();
  return { close };
}
