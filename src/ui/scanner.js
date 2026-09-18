// VirrTech Duka POS — barcode scanner overlay.
// Full-screen frame with live camera, status line and manual-entry fallback.
// Closing the overlay always stops every camera track (see engine.close()).

import { el, esc, ICONS } from './dom.js';
import { modalIsOpen } from './modal.js';
import { startScanner } from '../scanner/engine.js';

export function openScanner({ onDetected, onUnknown, onClose }) {
  let scanner = null;
  let closed = false;

  const overlay = el(
    `<div class="scanner-overlay" role="dialog" aria-modal="true" aria-label="Barcode scanner">
       <video class="scanner-video" autoplay playsinline muted></video>
       <div class="scan-frame" aria-hidden="true"><span class="scan-line"></span></div>
       <div class="scanner-status" role="status" aria-live="polite">Looking for a barcode…</div>
       <div class="scanner-bottom">
         <form class="manual-entry" data-manual-form>
           <label class="sr-only" data-manual-label>Manual barcode entry</label>
           <input data-manual-input inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false"
                  placeholder="Or type a barcode and press Enter" aria-label="Manual barcode entry">
           <button type="submit" class="btn btn-primary">Add</button>
         </form>
         <button type="button" class="scanner-close btn btn-ghost" data-scanner-close>${ICONS.close}<span>Close scanner</span></button>
       </div>
     </div>`,
  );
  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector('.scanner-status');
  const flash = (ok) => {
    const frame = overlay.querySelector('.scan-frame');
    frame.classList.remove('frame-ok', 'frame-bad');
    void frame.offsetWidth; // restart animation
    frame.classList.add(ok ? 'frame-ok' : 'frame-bad');
  };
  const setStatus = (msg) => {
    statusEl.textContent = msg;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    scanner?.close(); // stops ALL camera tracks
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    // If a modal (e.g. the register-product form) is stacked on top,
    // let its Escape handling run first; the scanner stays open.
    if (e.key === 'Escape' && !modalIsOpen()) close();
  };
  document.addEventListener('keydown', onKey);

  const handleCode = (code, { silent = false } = {}) => {
    if (closed) return;
    const trimmed = String(code ?? '').trim();
    if (!trimmed) return;
    const found = onDetected(trimmed);
    if (found) {
      if (!silent) {
        setStatus(`Found: ${trimmed}`);
        flash(true);
        if (navigator.vibrate) navigator.vibrate(60);
      }
    } else {
      flash(false);
      setStatus(`Unknown barcode: ${trimmed} — register it below.`);
      onUnknown(trimmed);
    }
  };

  // Start the camera engine; manual entry stays available on any failure.
  startScanner({
    video: overlay.querySelector('.scanner-video'),
    onResult: (code) => handleCode(code),
    onStatus: setStatus,
    onCameraError: (msg) => {
      setStatus(msg);
      overlay.querySelector('.scan-frame').classList.add('frame-off');
    },
  }).then((handle) => {
    scanner = handle;
    if (closed) handle.close();
  });

  overlay.querySelector('[data-scanner-close]').addEventListener('click', close);
  overlay.querySelector('[data-manual-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = overlay.querySelector('[data-manual-input]');
    handleCode(input.value, { silent: true });
    input.value = '';
    input.focus();
  });
  overlay.querySelector('[data-manual-input]').focus();

  return { close };
}
