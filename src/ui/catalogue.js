// VirrTech Duka POS — Catalogue: product list, create/edit, stock
// adjustments and the append-only stock movement history.

import { el, esc, fmtDateTime } from './dom.js';
import { formatKES } from '../core/money.js';
import { searchProducts } from '../core/catalog.js';
import { movementReasonLabel } from '../core/inventory.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { openProductForm } from './catalogue-form.js';

export function mountCatalogue(root, { store }) {
  let query = '';
  const searchInput = root.querySelector('#cat-search');
  const list = root.querySelector('#cat-list');
  const countLabel = root.querySelector('#cat-count');
  const movList = root.querySelector('#mov-list');

  function renderList() {
    const results = searchProducts(store.state.products, query);
    countLabel.textContent = query.trim() ? `${results.length} of ${store.state.products.length}` : `${store.state.products.length}`;
    if (results.length === 0) {
      list.replaceChildren(el(`<div class="empty-state"><p>No products found.</p><p class="muted small">Add your first product with <strong>New product</strong>.</p></div>`));
      return;
    }
    list.replaceChildren(
      ...results.map((p) =>
        el(
          `<article class="product-card" data-id="${p.id}">
             <div class="pc-main">
               <h3 class="pc-name">${esc(p.name)}</h3>
               <div class="pc-chips">
                 <span class="chip chip-muted">${esc(p.sku)}</span>
                 <span class="chip chip-muted">${esc(p.category)}</span>
                 ${p.barcode ? `<span class="chip chip-mono">${esc(p.barcode)}</span>` : '<span class="chip chip-warn">No barcode</span>'}
               </div>
             </div>
             <div class="pc-side">
               <span class="pc-price">${formatKES(p.priceKES)}</span>
               <span class="chip ${p.stock === 0 ? 'chip-danger' : 'chip-ok'}">${p.stock === 0 ? 'Out of stock' : `Stock: ${p.stock}`}</span>
             </div>
             <div class="pc-actions">
               <button type="button" class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button>
               <button type="button" class="btn btn-ghost btn-sm" data-adjust="${p.id}">Adjust stock</button>
             </div>
           </article>`,
        ),
      ),
    );
  }

  function renderMovements() {
    const movements = store.state.movements.slice(0, 40);
    if (movements.length === 0) {
      movList.replaceChildren(el(`<p class="muted small">No stock movements recorded yet.</p>`));
      return;
    }
    movList.replaceChildren(
      ...movements.map((m) =>
        el(
          `<li class="mov-row">
             <span class="mov-delta ${m.delta >= 0 ? 'mov-plus' : 'mov-minus'}">${m.delta >= 0 ? '+' : ''}${m.delta}</span>
             <span class="mov-info">
               <span class="mov-name">${esc(m.name)}</span>
               <span class="mov-meta">${movementReasonLabel(m.reason)}${m.note ? ` · ${esc(m.note)}` : ''} · ${fmtDateTime(m.createdAt)}</span>
             </span>
             <span class="mov-sku mono">${esc(m.sku)}</span>
           </li>`,
        ),
      ),
    );
  }

  function render() {
    renderList();
    renderMovements();
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderList();
  });

  root.addEventListener('click', (e) => {
    const newBtn = e.target.closest('[data-new-product]');
    if (newBtn) {
      openProductForm({ store, onSaved: render });
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const product = store.state.products.find((p) => p.id === edit.dataset.edit);
      openProductForm({ store, product, onSaved: render });
      return;
    }
    const adjust = e.target.closest('[data-adjust]');
    if (adjust) openAdjustModal(store.state.products.find((p) => p.id === adjust.dataset.adjust), () => render());
  });

  function openAdjustModal(product, done) {
    if (!product) return;
    const content = el(
      `<form data-adjust-form novalidate>
        <p class="form-hint">${esc(product.name)} — current stock: <strong>${product.stock}</strong></p>
        <div class="field">
          <label for="adj-delta">Change (use negative to reduce, e.g. -2)</label>
          <input id="adj-delta" inputmode="numeric" required placeholder="e.g. 10 or -3">
          <p class="field-error" data-adj-error role="alert" hidden></p>
        </div>
        <div class="field">
          <label for="adj-note">Reason note <span class="muted small">(optional)</span></label>
          <input id="adj-note" maxlength="120" placeholder="e.g. Received delivery, damaged count…">
        </div>
        <div class="row spread" style="margin-top:8px">
          <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
          <button type="submit" class="btn btn-primary">Record adjustment</button>
        </div>
      </form>`,
    );
    const errorEl = content.querySelector('[data-adj-error]');
    content.querySelector('[data-cancel]').addEventListener('click', () => close());
    content.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = content.querySelector('#adj-delta').value.trim();
      const delta = Number(raw);
      if (!/^-?\d+$/.test(raw) || delta === 0) {
        errorEl.textContent = 'Enter a non-zero whole number (negative to reduce stock).';
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      store.adjustStock(product.id, delta, content.querySelector('#adj-note').value.trim()).then((res) => {
        if (!res.ok) {
          errorEl.textContent = res.error;
          errorEl.hidden = false;
          return;
        }
        toast('Stock updated', { type: 'success' });
        close();
        done?.();
      });
    });
    const { close } = openModal({ title: 'Adjust stock', content });
    content.querySelector('#adj-delta').focus();
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { render, destroy: unsubscribe };
}
