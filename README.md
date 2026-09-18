# VirrTech Duka POS

A polished, **mobile-first Point of Sale prototype** for small Kenyan shops (dukas).
Installable PWA, fully offline, integer-shilling money, camera barcode scanning,
and **simulated** cash / M-Pesa / card checkouts.

> **Prototype disclaimer** — VirrTech Duka POS v0.1.0 is a development
> prototype. It stores data only in your browser (IndexedDB), all payments are
> on-screen simulations, and it is **NOT KRA eTIMS certified**. Do not use it to
> take real payments or file tax. No payment-provider APIs or credentials are
> used anywhere.

---

## Features

| Area | What it does |
|---|---|
| Catalogue | Products with name, SKU, barcode, category, price (KSh) and stock; create/edit; search by name, SKU or barcode |
| Barcode scanning | Rear camera, in-browser decode (native `BarcodeDetector`, bundled ZXing fallback); EAN-13, EAN-8, UPC-A, Code 128; manual entry fallback; unknown barcodes open a registration form and are remembered |
| Register | Big touch tiles, live search, cart with +/− quantity controls, stock validation |
| Checkout | Cash with quick amounts and exact change; **simulated** M-Pesa (fake STK push); **simulated** card terminal; duplicate-checkout protection via idempotency keys |
| Receipts | 80 mm thermal-style layout, printable at exactly 80 mm; carries the "simulated / not eTIMS certified" notice |
| Returns | Line-level refunds capped at what was sold, at the original price; stock restored with auditable `return` movements |
| Sales history | Filterable list (today / 7 days / all), full detail, reprint, refund |
| Dashboard | Daily gross, transactions, items, average basket, payment mix, best sellers, by-hour chart, 7-day table |
| Inventory | Append-only stock movement history (opening, sale, return, adjustment); stock can never go negative |
| Offline | Service worker + IndexedDB: the whole duka runs with no connection; online/offline indicator |
| PWA | Installable (manifest + icons incl. maskable), works standalone |
| Themes | Light / dark / system, persisted |
| Demo data | Realistic Kenyan shop seed (GS1 629 barcodes); one-tap reset in Settings |

**Kenyan context:** currency is the Kenyan Shilling displayed as `KSh`,
locale `en-KE`, demo location Eldoret, Kenya. M-Pesa appears as a
clearly-labelled simulation.

## Quick start

Requirements: **Node.js ≥ 20** (for the dev server and tests). The app itself
runs in any modern browser.

```bash
npm install          # dev deps only (ZXing + esbuild, used to regenerate the vendored decoder)
npm test             # 74 automated tests (node:test + happy-dom, zero test frameworks)
npm start            # http://localhost:8080  (PORT=3000 to override)
```

Open http://localhost:8080 in a phone or desktop browser. Demo data loads on
first run; reset it anytime from **Settings → Demo data**.

### Install as an app (PWA)

- **Android/Chrome:** address bar → *Install app* (or the "Install app" button
  in the top bar / Settings).
- **iOS/Safari:** Share → *Add to Home Screen*.
- The install prompt needs a secure context (HTTPS or localhost) — which any
  real deployment provides.

## Camera barcode scanning

- Taps **Scan** → requests the **rear** camera → shows a scanning frame.
- Frames are processed **entirely on the device**; nothing is uploaded.
- Uses the native browser `BarcodeDetector` where supported; otherwise falls
  back to the **locally bundled** ZXing decoder (`vendor/barcode-decoder.mjs`,
  Apache-2.0, committed to the repo — **no CDN**).
- Recognised products are added straight to the cart (vibrate + flash feedback,
  duplicates within 2.5 s are ignored).
- Unknown barcodes open the product-registration form; once registered, the
  barcode is remembered in the catalogue.
- If the camera is denied, missing or the browser is unsupported, a clear
  message appears and **manual barcode entry is always available**.
- Closing the scanner stops **all** camera tracks.

Barcode formats: EAN-13, EAN-8, UPC-A (with check-digit validation and
UPC↔leading-zero-EAN cross-lookup) and Code 128 (any length).

## Running and testing

```bash
npm test                    # core business logic + static wiring checks
node --check src/main.js    # (all JS is plain ESM, syntax-checked in CI-friendly way)
npm run build:vendor        # regenerate vendor/barcode-decoder.mjs from @zxing (dev only)
npm run icons               # regenerate the procedural PNG/SVG icons (dev only)
```

Automated tests cover: money handling, barcode classification/checksums,
product validation and search, cart stock rules, the checkout state machine
(including idempotency and change), refunds (caps, statuses, stock restore),
stock adjustments, receipt layout (42-char width, wrapping, disclaimer),
daily reporting, and static wiring (every referenced asset, import and
manifest entry exists; no CDN; no secret patterns; no `.env`).

Manual E2E checklist (browser): search → scan → register unknown barcode →
cart → cash checkout with change → print → refund part of the sale → verify
stock + movements + dashboard → toggle dark mode → reload offline → reset demo.

## Deployment

The app is 100% static — deploy to **any** static host that serves correct
MIME types over **HTTPS** (required for camera + PWA):

- **GitHub Pages / Netlify / Cloudflare Pages / any web server**: point the
  doc root at this repo folder; no build step.
- `sw.js` must be served from the site root (it is). Bump `VERSION` in
  `sw.js` when releasing to force re-precache.
- Suggested headers: `X-Content-Type-Options: nosniff` (the included
  `server.mjs` already sends it), `Referrer-Policy: no-referrer`, and the CSP
  meta tag is embedded in `index.html`.

### Production path (later)

The code is structured so the IndexedDB layer can be swapped for a secure API
without touching business logic or UI:

- `src/core/*` — pure business rules (no DOM, no storage) — keep as-is.
- `src/state/db.js` — the **only** IndexedDB module; replace with a REST/WS
  client. Each object store maps 1:1 to a PostgreSQL table (see
  [docs/architecture.md](docs/architecture.md)).
- `src/state/store.js` — orchestration; the server would then own idempotency
  enforcement (the `idempotencyKey` field is already persisted on every sale).

## Security & privacy posture

- No secrets of any kind exist in this app: no `.env`, no API keys, no
  provider credentials — there are no provider integrations to secure yet.
- Money is stored as **integer KES minor units** (no float money anywhere).
- All inputs are validated (form-level, business-rule-level, storage-level).
- The scanner never transmits frames; manual entry and all data stay local.
- Print output and receipts carry the prototype / non-eTIMS disclaimer.

## Project layout

```
index.html              app shell (semantic, accessible)
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline app shell)
server.mjs              zero-dependency static dev server
vendor/barcode-decoder.mjs  bundled ZXing (committed, Apache-2.0)
icons/                  generated PWA icons + SVG favicon
src/
  main.js               bootstrap: nav, theme, connectivity, install
  core/                 pure business logic (money, barcodes, catalog,
                        cart, checkout, refunds, inventory, receipt, sales, demo)
  state/                db.js (IndexedDB) + store.js (app state & actions)
  scanner/              camera engine (native detector + ZXing fallback)
  ui/                   views: register, catalogue, sales, dashboard,
                        settings + modals, toasts, checkout, scanner, receipt
tests/                  node:test suites — core rules, store integration
                        (full checkout/refund/reset flows over an in-memory
                        IndexedDB shim), static wiring, DOM id checks, and a
                        happy-dom boot test that drives the real UI
tests/helpers/fake-idb.js  tiny in-memory IndexedDB for the integration tests
docs/architecture.md    architecture, data model, API/Postgres mapping
```

## License note

`vendor/barcode-decoder.mjs` is a minified bundle of
[@zxing/browser](https://github.com/zxing-js/browser) +
[@zxing/library](https://zxing.github.io/zxing-js/) — Apache License 2.0.
Everything else in this repository is © VirrTech (prototype, all rights
reserved).
