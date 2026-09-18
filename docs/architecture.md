# Architecture & data model — VirrTech Duka POS

## Layering

```
┌────────────────────────────────────────────────────────────┐
│  UI  (src/ui, src/scanner, index.html, styles.css)         │
│  semantic HTML, event delegation, a11y, theming            │
├────────────────────────────────────────────────────────────┤
│  Store  (src/state/store.js)                               │
│  app state, actions, pub/sub, atomic persistence           │
├────────────────────────────────────────────────────────────┤
│  Core  (src/core/*.js) — PURE functions, no DOM/storage    │
│  money · barcodes · catalog · cart · checkout · refunds    │
│  inventory · receipt · sales · demo                        │
├────────────────────────────────────────────────────────────┤
│  Storage  (src/state/db.js) — thin IndexedDB wrapper       │
│  (the ONLY file that touches indexedDB)                    │
└────────────────────────────────────────────────────────────┘
```

Rules that keep the layers honest:

- **Core is pure**: same input → same output, no side effects. This is what
  makes it unit-testable with `node:test` today and directly reusable as
  server-side rules (Node service) later.
- **UI never mutates state directly** — it calls store actions and re-renders
  from the store snapshot.
- **The store persists atomically**: a completed sale writes sale + product
  stock + movements + cart in one IndexedDB transaction (one future Postgres
  transaction).

## Money

- Unit: **integer Kenyan Shilling (KES)** — KES has no practical sub-unit.
- `formatKES(1250)` → `KSh 1,250` (locale `en-KE`).
- `assertMoney` guards every boundary; parsing rejects fractions.

## Barcode model

`classify(code)` → `{ ok, code, format }` for `ean_13 | ean_8 | upc_a | code_128`,
with real check-digit validation for the three GS1 numeric formats.
`lookupCandidates(code)` bridges UPC-A ↔ leading-zero EAN-13 so one product
resolves from either representation. Product barcodes are unique when set;
the scanner, search box and registration form all funnel through the same
classifier, so a product can only exist under a *valid* barcode shape.

## Checkout state machine

```
        beginCheckout(method)
  cart ───────────────────────────► PENDING  (row persisted FIRST,
                                      │        idempotencyKey = uuid)
        settleCash / settleElectronic │
                                      ▼
                                   SETTLED (payment.details filled)
                                      │  completeActiveSale()
                                      ▼
                               COMPLETED + stock movements + stock−
        cancel / decline / close dialog
        ───────────────────────────► FAILED (audited, stock untouched,
                                        cart preserved)
```

**Duplicate-checkout protection (three layers):**

1. The `PENDING` sale row is written *before* any payment simulation, and
   `store.activeSaleId` rejects a second `beginCheckout` while one is open.
2. Every attempt carries a unique `idempotencyKey`; completing the *same*
   attempt twice is impossible because `completeActiveSale` only acts on the
   active pending sale and then clears `activeSaleId`.
3. The UI disables the confirm button while an action is in flight.

Failed/declined attempts stay in history as `FAILED` rows (audit trail)
without touching stock or clearing the cart.

## Refunds (safe returns)

- Refund quantities are validated per line against
  `purchased − alreadyRefunded` — over-refunds are structurally impossible.
- Prices come from the **sale lines** (what was paid), never current stock
  prices.
- `applyRefund` returns the updated sale (`partially_refunded` / `refunded`)
  plus positive `return` stock movements.

## Data model (IndexedDB object stores → future PostgreSQL tables)

| Store / table | Key | Fields | Notes |
|---|---|---|---|
| `products` | `id` (uuid) | `sku` (unique), `barcode` (unique when set, indexed), `name`, `category`, `priceKES` int, `stock` int, `createdAt`, `updatedAt` | no hard deletes — history integrity |
| `sales` | `id` (uuid) | `idempotencyKey` (unique), `number` (`S-00001`), `createdAt`, `status` (pending/completed/refunded/partially_refunded/failed), `lines[]` (product snapshot + integer amounts), `subtotalKES`, `totalKES`, `refundTotalKES`, `payment{method,status,details}`, `failureReason` | one row per payment attempt |
| `movements` | `id` (uuid) | `productId`, `name`, `sku`, `delta` (signed int), `reason` (initial/sale/return/adjustment), `note`, `refId` (→ sales.id), `createdAt` | append-only audit log |
| `refunds` | `id` (uuid) | `saleId` (indexed), `saleNumber`, `createdAt`, `method`, `reason`, `note`, `ref` (simulated ref for non-cash), `lines[]`, `totalKES` | |
| `meta` | `key` | `value` (json) | `shop`, `theme`, `sale-counter`, `demo-seeded` |
| `cart` | `id` = `'cart'` | `items[]` | persisted for offline recovery |

Postgres sketch: `products(id uuid pk, sku text unique, barcode text unique,
name text, category text, price_kes bigint check (price_kes >= 0), stock int
check (stock >= 0), created_at timestamptz, updated_at timestamptz)`;
`sales(..., idempotency_key uuid unique, status text, lines jsonb,
total_kes bigint, ...)`; `stock_movements(... delta int check (delta <> 0),
reason text, ref_id uuid references sales(id))`; `refunds(... ref_id
uuid references sales(id) on delete restrict)`. The sale counter becomes a
Postgres sequence; the idempotency key becomes a unique constraint the API
enforces.

## PWA / offline

- `sw.js` precaches the full app shell on install (versioned cache name);
  navigations are network-first with cache fallback; assets are cache-first.
- Because all business data lives in IndexedDB, **offline is a default, not a
  feature**: sales, receipts and inventory all work with zero connectivity;
  the header pill shows online/offline state.
- Camera scanning needs HTTPS (or localhost) — guaranteed by any real host.

## Intentional non-goals (this prototype)

- No real payment processing, no eTIMS/EPR integration, no multi-shop or
  multi-cashier auth, no tax/discount engines, no cloud sync, no product
  deletion (edit + adjust instead), no image storage.
