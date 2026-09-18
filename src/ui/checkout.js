// VirrTech Duka POS — checkout dialog.
// Flow: method choice -> per-method payment panel -> success/failure.
//
// Payment is SIMULATED: no provider APIs, no credentials, no real money.
// M-Pesa shows a fake STK-push prompt; the card step mimics a terminal.
// The store layer guarantees a single in-flight checkout (idempotency key +
// active-sale guard) so double-taps can never double-charge.

import { openModal } from './modal.js';
import { toast } from './toast.js';
import { el, esc, ICONS, PAYMENT_LABEL } from './dom.js';
import { formatKES, parseKESInput } from '../core/money.js';

const KE_MOBILE = /^0[17]\d{8}$/;

export function normalizeKEPhone(raw) {
  let s = String(raw ?? '').replace(/[\s()\-]/g, '');
  if (/^\+?254[17]\d{8}$/.test(s)) s = '0' + s.replace(/^\+?254/, '');
  return s;
}

export function validateKEPhone(raw) {
  const s = normalizeKEPhone(raw);
  if (!KE_MOBILE.test(s)) return { ok: false, error: 'Enter a Kenyan mobile number, e.g. 0712 345 678.' };
  return { ok: true, phone: s };
}

function genRef(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(9))
    : Array.from({ length: 9 }, () => Math.floor(Math.random() * 256));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return `${prefix}${s}`;
}

const METHOD_ICONS = { cash: ICONS.cash, mpesa: ICONS.phone, card: ICONS.card };

export function openCheckout({ store, onSettled }) {
  const state = { step: 'method', method: null, processing: false };
  let modal = null;

  const body = el(`<div data-checkout-body></div>`);
  const render = () => {
    body.replaceChildren(renderStep());
  };

  function renderStep() {
    switch (state.step) {
      case 'method': return stepMethod();
      case 'cash': return stepCash();
      case 'mpesa': return stepMpesa();
      case 'card': return stepCard();
      case 'success': return stepSuccess();
      case 'failed': return stepFailed();
      default: return stepMethod();
    }
  }

  function stepMethod() {
    const methods = ['cash', 'mpesa', 'card'].map((m) => {
      const sub = m === 'cash' ? 'Tendered cash & change' : 'Simulated — no real money moves';
      return `<button type="button" class="method-card" data-method="${m}">
                <span class="method-icon">${METHOD_ICONS[m]}</span>
                <span class="method-name">${PAYMENT_LABEL[m]}</span>
                <span class="method-sub">${sub}</span>
              </button>`;
    }).join('');
    return el(`
      <div class="checkout-summary">
        <span>Total due</span><strong>${formatKES(store.state.cart.items.reduce((s, i) => s + i.unitPriceKES * i.qty, 0))}</strong>
      </div>
      <p class="form-hint">Choose how the customer is paying.</p>
      <div class="method-grid">${methods}</div>
      <div class="row spread" style="margin-top:16px">
        <button type="button" class="btn btn-ghost" data-back>Back to cart</button>
      </div>
    `);
  }

  function paymentShell(inner, backLabel = 'Back') {
    return el(`
      <div class="checkout-summary">
        <span>${esc(PAYMENT_LABEL[state.method])}</span><strong>${formatKES(totalKES())}</strong>
      </div>
      ${inner}
      <div class="row spread" style="margin-top:16px">
        <button type="button" class="btn btn-ghost" data-back>${backLabel}</button>
        <span></span>
      </div>
    `);
  }

  function totalKES() {
    return store.state.cart.items.reduce((s, i) => s + i.unitPriceKES * i.qty, 0);
  }

  function stepCash() {
    const wrap = paymentShell(`
      <div class="field">
        <label for="cash-tendered">Cash received (KSh)</label>
        <input id="cash-tendered" data-tendered inputmode="numeric" autocomplete="off" placeholder="0"
               style="font-size:28px;font-weight:700">
        <p class="field-error" data-tendered-error role="alert" hidden></p>
        <div class="quick-amounts" data-quick>
          <button type="button" data-quick-amount="exact">Exact</button>
          <button type="button" data-quick-amount="100">100</button>
          <button type="button" data-quick-amount="200">200</button>
          <button type="button" data-quick-amount="500">500</button>
          <button type="button" data-quick-amount="1000">1,000</button>
          <button type="button" data-quick-amount="2000">2,000</button>
        </div>
        <p class="change-line" data-change aria-live="polite"></p>
      </div>
      <button type="button" class="btn btn-teal btn-lg" data-complete-cash disabled>Complete sale</button>
    `);

    const input = wrap.querySelector('[data-tendered]');
    const errorEl = wrap.querySelector('[data-tendered-error]');
    const changeEl = wrap.querySelector('[data-change]');
    const completeBtn = wrap.querySelector('[data-complete-cash]');

    const refresh = () => {
      const parsed = parseKESInput(input.value);
      if (input.value.trim() === '') {
        errorEl.hidden = true;
        changeEl.textContent = '';
        completeBtn.disabled = true;
        return;
      }
      if (!parsed.ok) {
        errorEl.textContent = parsed.error;
        errorEl.hidden = false;
        changeEl.textContent = '';
        completeBtn.disabled = true;
        return;
      }
      errorEl.hidden = true;
      const diff = parsed.value - totalKES();
      if (diff < 0) {
        changeEl.textContent = `Short by ${formatKES(-diff)}`;
        changeEl.className = 'change-line change-short';
        completeBtn.disabled = true;
      } else {
        changeEl.textContent = diff === 0 ? 'Exact amount — no change' : `Change due: ${formatKES(diff)}`;
        changeEl.className = 'change-line change-ok';
        completeBtn.disabled = state.processing;
      }
    };
    input.addEventListener('input', refresh);
    wrap.querySelector('[data-quick]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick-amount]');
      if (!btn) return;
      const v = btn.dataset.quickAmount;
      input.value = v === 'exact' ? String(totalKES()) : v.replace(',', '');
      refresh();
      input.focus();
    });
    completeBtn.addEventListener('click', () => {
      const parsed = parseKESInput(input.value);
      if (!parsed.ok || state.processing) return;
      state.processing = true;
      completeBtn.disabled = true;
      completeBtn.textContent = 'Completing…';
      store.settleCash(parsed.value)
        .then((res) => {
          if (!res.ok) {
            toast(res.error, { type: 'error' });
            state.processing = false;
            render();
            return;
          }
          return store.completeActiveSale().then((done) => {
            if (!done.ok) {
              toast(done.error, { type: 'error' });
              state.processing = false;
              render();
              return;
            }
            state.sale = done.sale;
            state.step = 'success';
            render();
          });
        })
        .catch((err) => {
          state.processing = false;
          toast(err?.message ?? 'Checkout failed', { type: 'error' });
          render();
        });
    });
    refresh();
    setTimeout(() => input.focus(), 30);
    return wrap;
  }

  function stepMpesa() {
    const wrap = paymentShell(`
      <div class="field">
        <label for="mpesa-phone">Customer M-Pesa number</label>
        <input id="mpesa-phone" data-mpesa-phone inputmode="tel" autocomplete="off" placeholder="07XX XXX XXX"
               style="font-size:22px;font-weight:600">
        <p class="field-error" data-mpesa-error role="alert" hidden></p>
      </div>
      <p class="form-hint">${ICONS.info}<span>Simulated M-Pesa: a STK push prompt is faked on-screen. No Safaricom API call is made and no credentials are used.</span></p>
      <button type="button" class="btn btn-teal btn-lg" data-mpesa-send disabled>Send payment request</button>
      <div data-mpesa-prompt hidden>
        <div class="sim-card" role="status" aria-live="polite">
          <p class="sim-title">M-Pesa prompt (simulated)</p>
          <p class="sim-body" data-mpesa-status>Waiting for the customer to enter their M-Pesa PIN on their phone…</p>
        </div>
        <div class="row spread" data-mpesa-buttons>
          <button type="button" class="btn btn-primary" data-mpesa-approve>${ICONS.check}<span>Customer approved</span></button>
          <button type="button" class="btn btn-ghost" data-mpesa-decline>Customer declined</button>
        </div>
      </div>
    `);

    const input = wrap.querySelector('[data-mpesa-phone]');
    const errorEl = wrap.querySelector('[data-mpesa-error]');
    const sendBtn = wrap.querySelector('[data-mpesa-send]');
    const prompt = wrap.querySelector('[data-mpesa-prompt]');

    input.addEventListener('input', () => {
      const res = validateKEPhone(input.value);
      sendBtn.disabled = state.processing || input.value.trim() === '' || !res.ok;
      errorEl.hidden = input.value.trim() === '' || res.ok;
      errorEl.textContent = res.ok ? '' : res.error;
    });
    sendBtn.addEventListener('click', () => {
      const res = validateKEPhone(input.value);
      if (!res.ok || state.processing) return;
      state.processing = true;
      sendBtn.disabled = true;
      input.disabled = true;
      wrap.querySelector('[data-mpesa-status]').textContent =
        `STK push sent (simulated) to ${res.phone}. Waiting for the customer to enter their M-Pesa PIN…`;
      prompt.hidden = false;
    });
    wrap.querySelector('[data-mpesa-approve]').addEventListener('click', () => settle({ phone: normalizeKEPhone(input.value), ref: genRef('S') }));
    wrap.querySelector('[data-mpesa-decline]').addEventListener('click', () => failAttempt('M-Pesa payment declined by customer'));
    setTimeout(() => input.focus(), 30);
    return wrap;
  }

  function stepCard() {
    const wrap = paymentShell(`
      <p class="form-hint">${ICONS.info}<span>Simulated card terminal: a real payment device would be presented to the customer here. No card data is collected or stored.</span></p>
      <div class="sim-card" role="status" aria-live="polite">
        <p class="sim-title">Card terminal (simulated)</p>
        <p class="sim-body">Waiting for the customer to insert or tap their card…</p>
      </div>
      <div class="row spread">
        <button type="button" class="btn btn-primary" data-card-approve>${ICONS.check}<span>Card approved</span></button>
        <button type="button" class="btn btn-ghost" data-card-decline>Card declined</button>
      </div>
    `);
    wrap.querySelector('[data-card-approve]').addEventListener('click', () => settle({ ref: genRef('T') }));
    wrap.querySelector('[data-card-decline]').addEventListener('click', () => failAttempt('Card payment declined by terminal'));
    return wrap;
  }

  async function settle(details) {
    if (state.processing) return;
    state.processing = true;
    const res = await store.settleElectronic({ ...details, approved: true });
    if (!res.ok) {
      toast(res.error, { type: 'error' });
      state.processing = false;
      render();
      return;
    }
    const done = await store.completeActiveSale();
    if (!done.ok) {
      toast(done.error, { type: 'error' });
      state.processing = false;
      render();
      return;
    }
    state.sale = done.sale;
    state.step = 'success';
    render();
  }

  function failAttempt(reason) {
    if (state.processing) return;
    state.processing = true;
    store.cancelActiveSale(reason).then(() => {
      state.sale = null;
      state.failReason = reason;
      state.step = 'failed';
      state.processing = false;
      render();
    });
  }

  function stepSuccess() {
    const sale = state.sale;
    const change = sale?.payment?.details?.changeKES;
    return el(`
      <div class="result-panel">
        <span class="result-icon result-ok">${ICONS.check}</span>
        <h3>Sale ${esc(sale.number)} completed</h3>
        <p class="result-total">${formatKES(sale.totalKES)}</p>
        <p class="result-sub">${esc(PAYMENT_SIM_LABEL(sale.payment.method))}${change ? ` · Change ${formatKES(change)}` : ''}</p>
        <div class="row spread">
          <button type="button" class="btn btn-primary" data-print>${ICONS.print}<span>Print receipt</span></button>
          <button type="button" class="btn btn-ghost" data-done>New sale</button>
        </div>
      </div>
    `);
  }

  function stepFailed() {
    return el(`
      <div class="result-panel">
        <span class="result-icon result-bad">${ICONS.alert}</span>
        <h3>Payment not completed</h3>
        <p class="result-sub">${esc(state.failReason ?? 'The payment was not settled.')} The cart is still intact.</p>
        <div class="row spread">
          <button type="button" class="btn btn-primary" data-retry>Try another payment</button>
          <button type="button" class="btn btn-ghost" data-close-sale>Close</button>
        </div>
      </div>
    `);
  }

  function PAYMENT_SIM_LABEL(method) {
    return method === 'cash' ? 'Paid with cash' : method === 'mpesa' ? 'Paid via M-Pesa (simulated)' : 'Paid by card (simulated)';
  }

  // Delegated navigation.
  body.addEventListener('click', (e) => {
    const methodBtn = e.target.closest('[data-method]');
    if (methodBtn && !state.processing) {
      const method = methodBtn.dataset.method;
      store.beginCheckout(method).then((res) => {
        if (!res.ok) {
          toast(res.error, { type: 'error' });
          return;
        }
        state.method = method;
        state.step = method;
        render();
      });
      return;
    }
    if (e.target.closest('[data-back]')) {
      if (store.state.activeSaleId) {
        store.cancelActiveSale('Payment cancelled').then(() => {
          state.step = 'method';
          render();
        });
      } else {
        state.step = 'method';
        render();
      }
      return;
    }
    if (e.target.closest('[data-print]')) {
      onSettled({ sale: state.sale, action: 'print' });
      return;
    }
    if (e.target.closest('[data-done]')) {
      onSettled({ sale: state.sale, action: 'close' });
      return;
    }
    if (e.target.closest('[data-retry]')) {
      state.step = 'method';
      state.processing = false;
      render();
      return;
    }
    if (e.target.closest('[data-close-sale]')) {
      onSettled({ sale: state.sale, action: 'close' });
    }
  });

  // If the user dismisses the dialog mid-flow, the pending attempt is cancelled.
  modal = openModal({
    title: 'Checkout',
    content: body,
    wide: true,
    onClose: () => {
      const active = store.state.activeSaleId;
      if (active) {
        store.cancelActiveSale('Checkout dialog closed').then(() => toast('Checkout cancelled', { type: 'info' }));
      }
    },
  });

  render();
  return { root: modal.root, close: modal.close };
}
