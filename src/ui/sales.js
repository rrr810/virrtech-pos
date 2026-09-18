// VirrTech Duka POS — Sales history: filterable list, sale detail,
// receipt reprint and safe returns/refunds.

import { el, esc, ICONS, fmtDateTime, fmtTime, PAYMENT_SIM_LABEL, STATUS_LABEL } from './dom.js';
import { formatKES } from '../core/money.js';
import { startOfDay } from '../core/sales.js';
import { remainingQty, refundableLineCount } from '../core/refunds.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { openReceiptModal } from './receipt-view.js';
import { REFUND_REASONS } from '../state/store.js';

const FILTERS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'all', label: 'All' },
];

export function mountSales(root, { store }) {
  let filter = 'today';
  const chips = root.querySelector('#sales-filters');
  const list = root.querySelector('#sales-list');
  const summary = root.querySelector('#sales-summary');

  function visibleSales() {
    const now = new Date();
    const today = startOfDay(now);
    if (filter === 'today') return store.state.sales.filter((s) => new Date(s.createdAt) >= today);
    if (filter === '7d') {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 6);
      return store.state.sales.filter((s) => new Date(s.createdAt) >= from);
    }
    return store.state.sales;
  }

  function render() {
    const sales = visibleSales();
    const completed = sales.filter((s) => s.status === 'completed' || s.status === 'partially_refunded' || s.status === 'refunded');
    const gross = completed.reduce((s, x) => s + x.totalKES, 0);
    const refunded = completed.reduce((s, x) => s + (x.refundTotalKES ?? 0), 0);
    summary.innerHTML = `
      <span><strong>${formatKES(gross)}</strong> gross</span>
      <span><strong>${completed.length}</strong> sale${completed.length === 1 ? '' : 's'}</span>
      ${refunded > 0 ? `<span><strong>${formatKES(refunded)}</strong> refunded</span>` : ''}`;

    if (sales.length === 0) {
      list.replaceChildren(el(`<div class="empty-state"><p>No sales in this period yet.</p><p class="muted small">Completed and cancelled attempts both appear here.</p></div>`));
      return;
    }
    list.replaceChildren(
      ...sales.map((s) =>
        el(
          `<button type="button" class="sale-card" data-sale="${s.id}">
             <span class="sc-top">
               <span class="sc-number mono">${esc(s.number)}</span>
               <span class="chip chip-status chip-${s.status}">${STATUS_LABEL[s.status]}</span>
             </span>
             <span class="sc-mid">
               <span class="sc-total">${formatKES(s.totalKES)}</span>
               <span class="sc-method">${PAYMENT_SIM_LABEL[s.payment.method] ?? s.payment.method}</span>
             </span>
             <span class="sc-bottom">
               <span>${fmtDateTime(s.createdAt)}</span>
               <span>${s.lines.reduce((n, l) => n + l.qty, 0)} item${s.lines.reduce((n, l) => n + l.qty, 0) === 1 ? '' : 's'}${s.refundTotalKES > 0 ? ` · ${formatKES(s.refundTotalKES)} refunded` : ''}</span>
             </span>
           </button>`,
        ),
      ),
    );
  }

  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    for (const c of chips.querySelectorAll('[data-filter]')) c.classList.toggle('chip-active', c === chip);
    render();
  });

  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-sale]');
    if (card) openSaleDetail(store.saleById(card.dataset.sale));
  });

  function openSaleDetail(sale) {
    if (!sale) return;
    const refundable = refundableLineCount(sale) > 0;
    const content = el(
      `<div class="sale-detail">
         <div class="sd-head">
           <div>
             <span class="sd-number mono">${esc(sale.number)}</span>
             <span class="chip chip-status chip-${sale.status}">${STATUS_LABEL[sale.status]}</span>
           </div>
           <span class="sd-date">${fmtDateTime(sale.createdAt)}</span>
         </div>
         <ul class="sd-lines">
           ${sale.lines
             .map(
               (l) =>
                 `<li>
                    <span class="sd-line-name">${esc(l.name)}</span>
                    <span class="sd-line-num mono">${l.qty} × ${formatKES(l.unitPriceKES)}</span>
                    <span class="sd-line-total">${formatKES(l.lineTotalKES)}</span>
                   </li>`,
             )
             .join('')}
         </ul>
         <div class="sd-totals">
           <div><span>Total</span><strong>${formatKES(sale.totalKES)}</strong></div>
           ${sale.refundTotalKES > 0 ? `<div class="refund-tint"><span>Refunded so far</span><strong>−${formatKES(sale.refundTotalKES)}</strong></div>` : ''}
           <div><span>Net</span><strong>${formatKES(sale.totalKES - (sale.refundTotalKES ?? 0))}</strong></div>
         </div>
         <div class="sd-payment">
           <span>${PAYMENT_SIM_LABEL[sale.payment.method]}</span>
           ${sale.payment.method === 'cash' ? `<span class="muted small">Received ${formatKES(sale.payment.details.tenderedKES)} · change ${formatKES(sale.payment.details.changeKES)}</span>` : ''}
           ${sale.payment.details.phone ? `<span class="muted small">M-Pesa ${esc(sale.payment.details.phone)} · ref ${esc(sale.payment.details.ref)}</span>` : ''}
           ${sale.payment.method === 'card' ? `<span class="muted small">Terminal ref ${esc(sale.payment.details.ref)}</span>` : ''}
           ${sale.status === 'failed' && sale.failureReason ? `<span class="muted small">${esc(sale.failureReason)}</span>` : ''}
         </div>
         ${sale.refunds.length > 0 ? `
           <div class="sd-refunds">
             <h4>Refunds</h4>
             ${sale.refunds
               .map(
                 (r) =>
                   `<p class="muted small">${fmtDateTime(r.createdAt)} — ${formatKES(r.totalKES)} via ${PAYMENT_SIM_LABEL[r.method]}: ${esc(r.reason)}${r.lines.map((l) => ` (${l.qty}× ${esc(l.name)})`).join('')}</p>`,
               )
               .join('')}
           </div>` : ''}
         <div class="row spread" style="margin-top:16px">
           <button type="button" class="btn btn-ghost" data-print>${ICONS.print}<span>Receipt</span></button>
           ${refundable ? '<button type="button" class="btn btn-danger" data-refund>' + ICONS.refresh + '<span>Return / refund</span></button>' : ''}
         </div>
       </div>`,
    );

    const { close } = openModal({ title: `Sale ${sale.number}`, content, wide: true });
    content.querySelector('[data-print]')?.addEventListener('click', () => openReceiptModal({ sale, shop: store.state.shop }));
    content.querySelector('[data-refund]')?.addEventListener('click', () => {
      close();
      openRefundModal(sale, () => {
        // re-open detail after the refund so the cashier sees the new status
        openSaleDetail(store.saleById(sale.id));
      });
    });
  }

  function openRefundModal(sale, done) {
    const linesWithRemaining = sale.lines.filter((l) => remainingQty(sale, l.productId) > 0);
    const content = el(
      `<form data-refund-form novalidate>
        <ul class="refund-lines">
          ${linesWithRemaining
            .map(
              (l) =>
                `<li>
                   <div class="rl-info">
                     <span class="rl-name">${esc(l.name)}</span>
                     <span class="muted small">${remainingQty(sale, l.productId)} left to refund · ${formatKES(l.unitPriceKES)} each</span>
                   </div>
                   <div class="qty-control">
                     <button type="button" class="qty-btn" data-rdec="${l.productId}" aria-label="Decrease refund quantity for ${esc(l.name)}">${ICONS.minus}</button>
                     <span class="qty-val" data-rqty="${l.productId}">0</span>
                     <button type="button" class="qty-btn" data-rinc="${l.productId}" aria-label="Increase refund quantity for ${esc(l.name)}">${ICONS.plus}</button>
                   </div>
                 </li>`,
            )
            .join('')}
        </ul>
        <div class="field-grid">
          <div class="field">
            <label for="rf-reason">Reason</label>
            <select id="rf-reason" required>${REFUND_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="rf-method">Refund method</label>
            <select id="rf-method">
              <option value="cash">Cash</option>
              <option value="mpesa">M-Pesa (simulated)</option>
              <option value="card">Card (simulated)</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="rf-note">Note <span class="muted small">(optional)</span></label>
          <input id="rf-note" maxlength="140">
        </div>
        <p class="refund-total" data-rf-total aria-live="polite">Select quantities to continue</p>
        <button type="submit" class="btn btn-danger btn-lg" data-rf-btn disabled>Process refund</button>
      </form>`,
    );

    const totals = new Map(linesWithRemaining.map((l) => [l.productId, { line: l, qty: 0 }]));
    const totalEl = content.querySelector('[data-rf-total]');
    const btn = content.querySelector('[data-rf-btn]');

    const refresh = () => {
      let sum = 0;
      let any = false;
      for (const { line, qty } of totals.values()) {
        content.querySelector(`[data-rqty="${line.productId}"]`).textContent = qty;
        if (qty > 0) any = true;
        sum += line.unitPriceKES * qty;
      }
      totalEl.textContent = any ? `Refund total: ${formatKES(sum)} (stock will be restored)` : 'Select quantities to continue';
      btn.disabled = !any;
      btn.textContent = any ? `Process refund · ${formatKES(sum)}` : 'Process refund';
    };

    content.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-rinc]');
      const dec = e.target.closest('[data-rdec]');
      const id = inc?.dataset.rinc ?? dec?.dataset.rdec;
      if (!id) return;
      const entry = totals.get(id);
      if (!entry) return;
      const max = remainingQty(sale, id);
      entry.qty = Math.max(0, Math.min(max, entry.qty + (inc ? 1 : -1)));
      refresh();
    });

    content.querySelector('[data-refund-form]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = [...totals.values()].filter((t) => t.qty > 0).map((t) => ({ productId: t.line.productId, qty: t.qty }));
      const method = content.querySelector('#rf-method').value;
      const reason = content.querySelector('#rf-reason').value;
      const note = content.querySelector('#rf-note').value.trim();
      btn.disabled = true;
      btn.textContent = 'Processing…';
      let ref = null;
      if (method !== 'cash') {
        ref = genRef(method === 'mpesa' ? 'S' : 'T');
      }
      const res = await store.createRefund(sale.id, items, { method, reason, note, ref });
      if (!res.ok) {
        toast(res.error, { type: 'error' });
        btn.disabled = false;
        return;
      }
      toast(`Refund of ${formatKES(res.refund.totalKES)} recorded — stock restored`, { type: 'success' });
      close();
      done?.();
    });

    const { close } = openModal({ title: `Refund — sale ${sale.number}`, content, wide: true });
    refresh();
  }

  function genRef(prefix) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(9)) : Array.from({ length: 9 }, () => Math.floor(Math.random() * 256));
    let s = '';
    for (const b of bytes) s += chars[b % chars.length];
    return `${prefix}${s}`;
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { render, destroy: unsubscribe };
}
