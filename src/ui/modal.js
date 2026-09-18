// VirrTech Duka POS — accessible modal dialogs.
// Role=dialog, aria-modal, focus trap, Escape to close, overlay click to close.

import { el, esc, ICONS } from './dom.js';

let activeOverlay = null;
let activeCleanup = null;
let lastFocused = null;

export function closeAnyModal() {
  if (activeCleanup) activeCleanup();
}

/** True while a generic modal is open (used to stack Escape handling). */
export function modalIsOpen() {
  return activeOverlay !== null;
}

function trapTab(e, root) {
  const focusables = [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (x) => x.offsetParent !== null || x === document.activeElement,
  );
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Open a modal. `content` is an HTMLElement or an HTML string.
 * Returns { root, close }.
 */
export function openModal({ title, content, wide = false, onClose, ariaLabel }) {
  closeAnyModal();
  lastFocused = document.activeElement;

  const overlay = el(
    `<div class="modal-overlay">
       <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(ariaLabel ?? title)}">
         <header class="modal-head">
           <h2>${esc(title)}</h2>
           <button type="button" class="icon-btn" data-close-modal aria-label="Close dialog">${ICONS.close}</button>
         </header>
         <div class="modal-body"></div>
       </div>
     </div>`,
  );
  const body = overlay.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else body.appendChild(content);
  document.body.appendChild(overlay);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (activeOverlay === overlay) {
      activeOverlay = null;
      activeCleanup = null;
    }
    onClose?.();
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      trapTab(e, overlay);
    }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('[data-close-modal]').addEventListener('click', close);

  activeOverlay = overlay;
  activeCleanup = close;
  const firstFocus = overlay.querySelector('input, select, textarea') ?? overlay.querySelector('button:not([data-close-modal])');
  (firstFocus ?? overlay.querySelector('[data-close-modal]')).focus();
  return { root: overlay, close };
}

/** Confirmatory action (used for destructive operations). */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const { root, close } = openModal({
      title,
      content: `<div class="confirm-body">
                  <p>${esc(message)}</p>
                  <div class="row spread" style="margin-top:16px">
                    <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
                  </div>
                </div>`,
      onClose: () => finish(false),
    });
    root.querySelector('[data-ok]').addEventListener('click', () => finish(true));
    root.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    root.querySelector('[data-ok]').focus();
  });
}
