// VirrTech Duka POS — receipt preview + 80 mm print.
// The same plain-text layout is rendered on screen and into #print-root,
// which the print stylesheet shows at exactly 80 mm width.

import { openModal } from './modal.js';
import { el, esc, ICONS } from './dom.js';
import { buildReceipt } from '../core/receipt.js';

export function openReceiptModal({ sale, shop, title = `Receipt ${sale.number}` }) {
  const { lines } = buildReceipt({ shop, sale });
  const text = lines.join('\n');

  const content = el(
    `<div class="receipt-panel">
       <pre class="receipt" tabindex="0" aria-label="Receipt preview">${esc(text)}</pre>
       <div class="row spread receipt-actions">
         <button type="button" class="btn btn-primary" data-receipt-print>${ICONS.print}<span>Print 80&nbsp;mm receipt</span></button>
         <button type="button" class="btn btn-ghost" data-receipt-close>Close</button>
       </div>
     </div>`,
  );

  const print = () => {
    const root = document.getElementById('print-root');
    if (!root) return;
    root.innerHTML = `<div class="print-receipt"><pre>${esc(text)}</pre></div>`;
    window.print();
  };

  const { close } = openModal({
    title,
    content,
    onClose: () => {
      const root = document.getElementById('print-root');
      if (root) root.replaceChildren();
    },
  });

  content.querySelector('[data-receipt-print]').addEventListener('click', print);
  content.querySelector('[data-receipt-close]').addEventListener('click', close);
  return { close, print };
}
