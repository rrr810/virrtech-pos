/* VirrTech Duka POS — service worker (offline app shell).
 * Cache-first for static assets, network-first for the page itself.
 * All paths are relative to this file so the app also works when served from
 * a subpath (e.g. GitHub Pages at /virrtech-pos/).
 * Bump VERSION on every release to re-precache. */

const VERSION = 'vtduka-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './vendor/barcode-decoder.mjs',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/maskable-512.png',
  './src/core/barcodes.js',
  './src/core/cart.js',
  './src/core/catalog.js',
  './src/core/checkout.js',
  './src/core/demo.js',
  './src/core/inventory.js',
  './src/core/money.js',
  './src/core/receipt.js',
  './src/core/refunds.js',
  './src/core/sales.js',
  './src/main.js',
  './src/scanner/engine.js',
  './src/state/db.js',
  './src/state/store.js',
  './src/ui/catalogue-form.js',
  './src/ui/catalogue.js',
  './src/ui/checkout.js',
  './src/ui/dashboard.js',
  './src/ui/dom.js',
  './src/ui/modal.js',
  './src/ui/receipt-view.js',
  './src/ui/register.js',
  './src/ui/sales.js',
  './src/ui/scanner.js',
  './src/ui/settings.js',
  './src/ui/toast.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const INDEX = new URL('index.html', self.location).href;

  // Navigations: network first so a fresh deploy wins, cache as offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(INDEX, copy));
          return res;
        })
        .catch(async () => (await caches.match(INDEX)) || (await caches.match(new URL('./', self.location).href))),
    );
    return;
  }

  // Static assets: cache first, then network (and fill the cache).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
