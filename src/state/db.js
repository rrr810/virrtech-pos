// VirrTech Duka POS — thin IndexedDB wrapper.
//
// This is the ONLY module in the app that touches indexedDB. The store
// layer above it works with plain objects, so swapping this file for a
// secure REST/PostgreSQL-backed implementation later requires no changes
// to business logic or UI.
//
// Object stores (each maps 1:1 to a future PostgreSQL table):
//   products        — product catalogue
//   sales           — checkout records (one row per payment attempt)
//   movements       — append-only stock movement history
//   refunds         — refund records, linked to sales
//   meta            — key/value settings (shop info, theme, counters)
//   cart            — persisted cart (offline recovery)

const DB_NAME = 'virrtech-duka-pos';
const DB_VERSION = 1;

export const STORE_NAMES = ['products', 'sales', 'movements', 'refunds', 'meta', 'cart'];

export function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const products = db.createObjectStore('products', { keyPath: 'id' });
      products.createIndex('sku', 'sku', { unique: true });
      products.createIndex('barcode', 'barcode', { unique: false });

      const sales = db.createObjectStore('sales', { keyPath: 'id' });
      sales.createIndex('createdAt', 'createdAt');
      sales.createIndex('status', 'status');

      const movements = db.createObjectStore('movements', { keyPath: 'id' });
      movements.createIndex('createdAt', 'createdAt');
      movements.createIndex('productId', 'productId');

      const refunds = db.createObjectStore('refunds', { keyPath: 'id' });
      refunds.createIndex('saleId', 'saleId');

      db.createObjectStore('meta', { keyPath: 'key' });
      db.createObjectStore('cart', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

const p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const idbGet = (db, store, key) => p(db.transaction(store, 'readonly').objectStore(store).get(key));
export const idbGetAll = (db, store) => p(db.transaction(store, 'readonly').objectStore(store).getAll());
export const idbPut = (db, store, value) => p(db.transaction(store, 'readwrite').objectStore(store).put(value));
export const idbDelete = (db, store, key) => p(db.transaction(store, 'readwrite').objectStore(store).delete(key));
export const idbClear = (db, store) => p(db.transaction(store, 'readwrite').objectStore(store).clear());

/**
 * Atomic multi-store write.
 * ops: [ [storeName, value], [storeName, { __delete: key }], ... ]
 * All writes commit together or not at all (e.g. sale + movements + stock).
 */
export function idbBulk(db, ops) {
  const stores = [...new Set(ops.map(([s]) => s))];
  const tx = db.transaction(stores, 'readwrite');
  for (const [store, op] of ops) {
    const os = tx.objectStore(store);
    if (op && typeof op === 'object' && '__delete' in op) os.delete(op.__delete);
    else os.put(op);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Database transaction aborted'));
  });
}
