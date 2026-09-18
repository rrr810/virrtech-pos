// VirrTech Duka POS — toast notifications (polite live region).

import { el, esc, ICONS } from './dom.js';

let region = null;

export function initToasts() {
  region = document.getElementById('toast-region');
}

const TYPE_ICON = { success: ICONS.check, error: ICONS.alert, info: ICONS.info };

export function toast(message, { type = 'info', duration = 3200 } = {}) {
  if (!region) return;
  const item = el(
    `<div class="toast toast-${type}" role="status">
       <span class="toast-icon" aria-hidden="true">${TYPE_ICON[type] ?? ICONS.info}</span>
       <span>${esc(message)}</span>
     </div>`,
  );
  region.appendChild(item);
  const dismiss = () => {
    item.classList.add('toast-hide');
    setTimeout(() => item.remove(), 220);
  };
  const timer = setTimeout(dismiss, duration);
  item.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}
