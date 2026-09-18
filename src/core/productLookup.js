// VirrTech Duka POS — auto-fill for unknown barcodes (pure logic, no DOM).
//
// When the scanner meets a barcode the local catalogue has never seen, the
// register pre-fills the registration form from the public Open Facts
// databases (food → beauty → products). This module is deliberately
// defensive: EVERY failure mode (offline, 404, status:0, bad JSON, a hanging
// request, even a non-cooperative fetch that ignores AbortSignal) resolves
// to null, so the manual registration flow is never blocked or broken.
//
// Hard rules: only the barcode itself is sent (never camera frames), and
// prices are NEVER fetched — the shelf price belongs to the shop.

const ENDPOINTS = [
  { origin: 'https://world.openfoodfacts.org', label: 'Open Food Facts' },
  { origin: 'https://world.openbeautyfacts.org', label: 'Open Beauty Facts' },
  { origin: 'https://world.openproductsfacts.org', label: 'Open Products Facts' },
];

const FIELDS =
  'code,product_name,product_name_en,generic_name,generic_name_en,brands,categories_tags,quantity';

const MAX_NAME = 120;
const MAX_CATEGORY = 40;

const clean = (value) => String(value ?? '').trim();

/** First candidate that survives trimming and is at least 2 chars long. */
function firstUsable(candidates) {
  for (const c of candidates) {
    const v = clean(c);
    if (v.length >= 2) return v;
  }
  return '';
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function titleize(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** AUTO-<last 6 barcode digits>, bumped -2/-3/… while colliding with existingSkus. */
function nextSku(barcode, existingSkus = []) {
  const code = String(barcode ?? '').trim();
  const digits = code.replace(/\D/g, '');
  const tail = (digits || code).slice(-6);
  const base = `AUTO-${tail}`;
  const taken = new Set(existingSkus.map((s) => String(s ?? '').trim().toUpperCase()));
  let sku = base;
  let bump = 2;
  while (taken.has(sku.toUpperCase())) {
    sku = `${base}-${bump}`;
    bump += 1;
  }
  return sku;
}

/**
 * Turn an Open Facts product record into a registration-form draft:
 * `{ name, sku, category }`, or null when there is no usable name
 * (missing, null, or shorter than 2 characters).
 *
 * - name: "Brand product_name (quantity)", never duplicating a brand or
 *   quantity that the base name already carries, ≤ 120 chars (truncated
 *   with …). Falls back through product_name → product_name_en →
 *   generic_name → generic_name_en.
 * - sku: AUTO-<last 6 barcode digits>, bumped on collision.
 * - category: first "en:" categories_tag, dashes → spaces, titleized,
 *   ≤ 40 chars ('' when the record has none — the shop picks).
 */
export function draftFromProduct(product, { barcode, existingSkus = [] } = {}) {
  const base = firstUsable([
    product?.product_name,
    product?.product_name_en,
    product?.generic_name,
    product?.generic_name_en,
  ]);
  if (!base) return null;

  const brand = clean(String(product?.brands ?? '').split(',')[0]);
  const quantity = clean(product?.quantity);

  let name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : base;
  if (quantity && !name.toLowerCase().includes(quantity.toLowerCase())) {
    name = `${name} (${quantity})`;
  }
  name = truncate(name, MAX_NAME);

  const tags = Array.isArray(product?.categories_tags) ? product.categories_tags : [];
  const enTag = tags.map(clean).find((t) => t.startsWith('en:'));
  const category = enTag ? truncate(titleize(enTag.slice(3).replace(/-/g, ' ')), MAX_CATEGORY) : '';

  return { name, sku: nextSku(barcode, existingSkus), category };
}

/**
 * Fetch one endpoint's product JSON. Resolves to the parsed body or null —
 * never rejects, never hangs beyond `timeoutMs`, even if `doFetch` ignores
 * the AbortSignal (a sentinel settles the Promise.race on its own timer).
 */
async function fetchProductJson(doFetch, url, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(() => doFetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } }))
    .catch(() => null) // offline, DNS failure, aborted, or a throwing fetch impl
    .then((res) => {
      clearTimeout(timer);
      return res;
    });
  const res = await Promise.race([attempt, timeout]);
  if (!res || typeof res !== 'object' || !(res.ok === true || res.status === 200)) return null;
  if (typeof res.json !== 'function') return null;
  try {
    const json = await res.json();
    return json && typeof json === 'object' ? json : null; // bad JSON / non-object body
  } catch {
    return null;
  }
}

/**
 * Look up an unknown barcode in the public Open Facts databases, in order:
 * Open Food Facts → Open Beauty Facts → Open Products Facts.
 *
 * Resolves to `{ name, sku, category, sourceLabel }` (a registration-form
 * draft plus the database it came from) or null. Never rejects. Prices are
 * never fetched. Whitespace and garbage codes never touch the network.
 *
 * @param {string} barcode raw scanned text (trimmed here before any URL use)
 * @param {object} opts
 * @param {(url: string, init?: object) => Promise<object>} [opts.fetchImpl]
 *   injectable fetch (tests fake it; defaults to the global fetch)
 * @param {number} [opts.timeoutMs=4000] per-endpoint timeout
 * @param {string[]} [opts.existingSkus] SKUs already in the shop's catalogue
 */
export async function lookupBarcode(barcode, { fetchImpl, timeoutMs = 4000, existingSkus = [] } = {}) {
  const code = String(barcode ?? '').trim();
  // Barcodes are alphanumeric; anything else (whitespace, spaces mid-code,
  // punctuation) is garbage and must never hit the network.
  if (!/^[0-9A-Za-z]{6,48}$/.test(code)) return null;
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (url, init) => fetch(url, init);

  for (const { origin, label } of ENDPOINTS) {
    const url = `${origin}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
    const json = await fetchProductJson(doFetch, url, timeoutMs);
    if (!json || json.status !== 1) continue; // offline / 404 / status:0 / bad JSON
    const product = json.product;
    if (!product || typeof product !== 'object') continue;
    const draft = draftFromProduct(product, { barcode: code, existingSkus });
    if (!draft) continue; // unusable name — try the next database
    return { ...draft, sourceLabel: label };
  }
  return null;
}
