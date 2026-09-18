// VirrTech Duka POS — application bootstrap.
// Wires the store to the shell: navigation, theme, connectivity,
// PWA install prompt and view mounting.

import { AppStore } from './state/store.js';
import { initToasts, toast } from './ui/toast.js';
import { mountRegister } from './ui/register.js';
import { mountCatalogue } from './ui/catalogue.js';
import { mountSales } from './ui/sales.js';
import { mountDashboard } from './ui/dashboard.js';
import { mountSettings } from './ui/settings.js';

const VIEWS = ['register', 'catalogue', 'sales', 'dashboard', 'settings'];

const store = new AppStore();
let mounted = new Map();
let current = null;
let deferredInstall = null;

function viewFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return VIEWS.includes(h) ? h : 'register';
}

function applyTheme(theme) {
  const resolved =
    theme === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0E111C' : '#F7F5F0';
}

function setOnline(online) {
  const pill = document.getElementById('net-status');
  if (!pill) return;
  pill.dataset.state = online ? 'online' : 'offline';
  pill.querySelector('span').textContent = online ? 'Online' : 'Offline';
  pill.title = online ? 'Connected. All data is still stored locally.' : 'Working offline — sales continue and save on this device.';
}

function setActiveView(name, { updateHash = true } = {}) {
  if (!VIEWS.includes(name)) name = 'register';
  current = name;
  for (const id of VIEWS) {
    document.getElementById(`view-${id}`).hidden = id !== name;
  }
  for (const tab of document.querySelectorAll('[data-nav]')) {
    const on = tab.dataset.nav === name;
    tab.setAttribute('aria-current', on ? 'page' : 'false');
    tab.classList.toggle('tab-active', on);
  }
  document.body.dataset.activeView = name;
  if (updateHash && location.hash !== `#/${name}`) {
    history.replaceState(null, '', `#/${name}`);
  }
  if (!mounted.has(name)) {
    const api = { store, onInstall: promptInstall };
    let view;
    switch (name) {
      case 'register': view = mountRegister(document.getElementById('view-register'), api); break;
      case 'catalogue': view = mountCatalogue(document.getElementById('view-catalogue'), api); break;
      case 'sales': view = mountSales(document.getElementById('view-sales'), api); break;
      case 'dashboard': view = mountDashboard(document.getElementById('view-dashboard'), api); break;
      case 'settings': view = mountSettings(document.getElementById('view-settings'), api); break;
    }
    mounted.set(name, view);
  }
  const view = mounted.get(name);
  view.render();
  if (name === 'register') setTimeout(() => view.focusSearch?.(), 60);
}

function promptInstall() {
  if (!deferredInstall) {
    toast('Install prompt is not available right now — use your browser menu: Add to Home Screen / Install app.', { type: 'info', duration: 4200 });
    return;
  }
  deferredInstall.prompt();
  deferredInstall.userChoice.then((choice) => {
    if (choice?.accepted) {
      toast('VirrTech Duka POS installed', { type: 'success' });
      deferredInstall = null;
      const btn = document.getElementById('install-btn');
      if (btn) btn.hidden = true;
    }
  });
}

function wireShell() {
  document.getElementById('nav').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-nav]');
    if (tab) setActiveView(tab.dataset.nav);
  });

  document.addEventListener('online', () => {
    store.setOnline(true);
    setOnline(true);
    toast('Back online', { type: 'success' });
  });
  document.addEventListener('offline', () => {
    store.setOnline(false);
    setOnline(false);
    toast('You are offline — the duka keeps working', { type: 'info' });
  });

  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.addEventListener('click', () => {
    const resolved = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.setTheme(resolved);
    applyTheme(resolved);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.state.theme === 'system') applyTheme('system');
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.getElementById('install-btn');
    if (btn) btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('install-btn');
    if (btn) btn.hidden = true;
  });

  document.getElementById('install-btn').addEventListener('click', promptInstall);

  // Deep links: #/register, #/catalogue, #/sales, #/dashboard, #/settings
  window.addEventListener('hashchange', () => {
    const name = viewFromHash();
    if (name !== current) setActiveView(name, { updateHash: false });
  });
}

function boot() {
  initToasts();
  wireShell();
  applyTheme(store.state.theme);
  setOnline(store.state.online);
  document.getElementById('splash').hidden = true;
  if (store.state.demoSeeded) {
    toast('Demo data loaded — reset it anytime from Settings.', { type: 'info', duration: 4200 });
  }
}

store
  .init()
  .then(() => {
    boot();
    setActiveView(viewFromHash());
  })
  .catch((err) => {
    document.getElementById('splash').innerHTML = `
      <div class="splash-error" role="alert">
        <p><strong>VirrTech Duka POS could not start.</strong></p>
        <p>${err?.message ?? 'Unknown error'}</p>
        <p class="muted small">This app needs a modern browser with IndexedDB support (Chrome, Edge, Firefox, Safari). Try reloading.</p>
      </div>`;
  });

// Surface unexpected async failures instead of failing silently.
window.addEventListener('unhandledrejection', (e) => {
  toast(e.reason?.message ?? 'Something went wrong', { type: 'error' });
});

// Service worker: register only in supported, secure contexts.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline caching unavailable; app still works online */
    });
  });
}
