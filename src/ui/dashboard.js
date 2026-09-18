// VirrTech Duka POS — Daily sales dashboard (pure presentation over core
// reporting functions).

import { el, esc, fmtToday, PAYMENT_LABEL } from './dom.js';
import { formatKES } from '../core/money.js';
import { dayStats, startOfDay } from '../core/sales.js';

export function mountDashboard(root, { store }) {
  const grid = root.querySelector('#dash-stats');
  const payRows = root.querySelector('#dash-payments');
  const topList = root.querySelector('#dash-top');
  const hourBars = root.querySelector('#dash-hours');
  const weekTable = root.querySelector('#dash-week');

  function render() {
    const today = startOfDay(new Date());
    const stats = dayStats(store.state.sales, today);

    grid.replaceChildren(
      stat('Gross today', formatKES(stats.totalKES)),
      stat('Transactions', String(stats.count)),
      stat('Items sold', String(stats.itemsSold)),
      stat('Avg basket', formatKES(stats.avgKES)),
    );

    const methodMax = Math.max(1, ...Object.values(stats.byMethod));
    payRows.replaceChildren(
      ...['cash', 'mpesa', 'card'].map((m) => {
        const v = stats.byMethod[m];
        const pct = stats.totalKES > 0 ? Math.round((v / stats.totalKES) * 100) : 0;
        return el(
          `<div class="pay-row">
             <span class="pay-label">${PAYMENT_LABEL[m]}${m !== 'cash' ? ' <span class="muted small">(sim)</span>' : ''}</span>
             <span class="pay-bar-wrap"><span class="pay-bar pay-bar-${m}" style="width:${(v / methodMax) * 100}%"></span></span>
             <span class="pay-value">${formatKES(v)} <span class="muted small">(${pct}%)</span></span>
           </div>`,
        );
      }),
    );

    topList.replaceChildren(
      ...(stats.topProducts.length
        ? stats.topProducts.map((p, i) =>
            el(
              `<li><span class="top-rank">${i + 1}</span><span class="top-name">${esc(p.name)}</span><span class="top-nums mono">${p.qty} sold · ${formatKES(p.revenueKES)}</span></li>`,
            ),
          )
        : [el('<li class="muted small">No sales today yet.</li>'),]),
    );

    const hourMax = Math.max(1, ...stats.byHour);
    hourBars.replaceChildren(
      ...stats.byHour.map((v, h) =>
        el(
          `<span class="hour-bar-wrap" title="${h}:00 — ${formatKES(v)}">
             <span class="hour-bar" style="height:${(v / hourMax) * 100}%"></span>
             <span class="hour-label">${h % 3 === 0 ? h : ''}</span>
           </span>`,
        ),
      ),
    );

    const rows = [];
    for (let i = 6; i >= 0; i--) {
      const day = startOfDay(new Date());
      day.setDate(day.getDate() - i);
      const s = dayStats(store.state.sales, day);
      rows.push(
        `<tr>
           <td>${i === 0 ? 'Today' : new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short' }).format(day)}</td>
           <td class="mono">${s.count}</td>
           <td class="mono">${formatKES(s.totalKES)}</td>
           <td class="mono">${s.refundedKES > 0 ? `−${formatKES(s.refundedKES)}` : '—'}</td>
         </tr>`,
      );
    }
    weekTable.innerHTML = `<tbody>${rows.join('')}</tbody>`;
    root.querySelector('#dash-date').textContent = fmtToday();
  }

  function stat(label, value) {
    return el(`<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`);
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { render, destroy: unsubscribe };
}
