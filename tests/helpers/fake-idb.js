// Minimal in-memory IndexedDB implementation for Node integration tests.
// Implements exactly the surface src/state/db.js uses: open/upgrade,
// transactions with atomic commit + unique-index enforcement, and the
// get/getAll/put/delete/clear request API with async result delivery.

class IDBRequest {
  constructor() {
    this.result = undefined;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class FakeObjectStore {
  constructor(fakeDb, name) {
    this._fakeDb = fakeDb;
    this._name = name;
    this._keyPath = fakeDb._keyPaths.get(name);
    this._indexes = new Map();
    this._tx = null;
  }

  createIndex(name, keyPath, opts = {}) {
    this._indexes.set(name, { keyPath, unique: Boolean(opts.unique) });
    return this._indexes.get(name);
  }

  #data() {
    return this._fakeDb._stores.get(this._name);
  }

  get(key) {
    const req = new IDBRequest();
    queueMicrotask(() => {
      req.result = this.#data().get(key);
      req.onsuccess?.({ type: 'success' });
    });
    return req;
  }

  getAll() {
    const req = new IDBRequest();
    queueMicrotask(() => {
      req.result = [...this.#data().values()];
      req.onsuccess?.({ type: 'success' });
    });
    return req;
  }

  put(value) {
    const key = value[this._keyPath];
    const req = new IDBRequest();
    if (this._tx) this._tx._enqueue({ store: this._name, type: 'put', key, value, req });
    else {
      this.#data().set(key, value);
      queueMicrotask(() => {
        req.result = key;
        req.onsuccess?.({ type: 'success' });
      });
    }
    return req;
  }

  delete(key) {
    const req = new IDBRequest();
    if (this._tx) this._tx._enqueue({ store: this._name, type: 'delete', key, req });
    else {
      this.#data().delete(key);
      queueMicrotask(() => req.onsuccess?.({ type: 'success' }));
    }
    return req;
  }

  clear() {
    const req = new IDBRequest();
    if (this._tx) this._tx._enqueue({ store: this._name, type: 'clear', req });
    else {
      this.#data().clear();
      queueMicrotask(() => req.onsuccess?.({ type: 'success' }));
    }
    return req;
  }
}

class FakeTx {
  constructor(fakeDb, storeNames) {
    this._fakeDb = fakeDb;
    this._storeNames = storeNames;
    this.error = null;
    this._mutations = [];
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    // Commit as a microtask: the caller performs all synchronous put() calls
    // before the current turn ends, then registers oncomplete.
    queueMicrotask(() => this.#commit());
  }

  objectStore(name) {
    const store = this._fakeDb._objectStores.get(name);
    if (!store) throw new Error(`No object store: ${name}`);
    store._tx = this;
    return store;
  }

  _enqueue(mutation) {
    this._mutations.push(mutation);
  }

  #commit() {
    if (this._done) return;
    this._done = true;
    for (const m of this._mutations) {
      const data = this._fakeDb._stores.get(m.store);
      if (m.type === 'put') data.set(m.key, m.value);
      else if (m.type === 'delete') data.delete(m.key);
      else data.clear();
      if (m.req) {
        m.req.result = m.key;
        m.req.onsuccess?.({ type: 'success' });
      }
    }
    // Unique index enforcement (mirrors IDB ConstraintError).
    for (const store of this._fakeDb._objectStores.values()) {
      for (const idx of store._indexes.values()) {
        if (!idx.unique) continue;
        const seen = new Set();
        for (const value of this._fakeDb._stores.get(store._name).values()) {
          const v = value[idx.keyPath];
          if (v === null || v === undefined) continue;
          if (seen.has(v)) {
            this.error = Object.assign(new Error('Unique constraint failed: ' + idx.keyPath), { name: 'ConstraintError' });
            this.onabort?.({ type: 'abort' });
            return;
          }
          seen.add(v);
        }
      }
    }
    this.oncomplete?.({ type: 'complete' });
  }
}

export class FakeIndexedDB {
  constructor() {
    this._databases = new Map();
  }

  #createDb(name) {
    const db = {
      name,
      version: 0,
      _keyPaths: new Map(),
      _stores: new Map(),
      _objectStores: new Map(),
      onversionchange: null,
      createObjectStore(storeName, opts = {}) {
        db._keyPaths.set(storeName, opts.keyPath);
        db._stores.set(storeName, new Map());
        const store = new FakeObjectStore(db, storeName);
        db._objectStores.set(storeName, store);
        return store;
      },
      transaction(storeNames) {
        const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
        return new FakeTx(db, names);
      },
      close() {},
    };
    return db;
  }

  open(name) {
    const req = new IDBRequest();
    queueMicrotask(() => {
      let db = this._databases.get(name);
      if (!db) {
        db = this.#createDb(name);
        this._databases.set(name, db);
      }
      req.result = db;
      req.onupgradeneeded?.({ type: 'upgradeneeded' });
      req.onsuccess?.({ type: 'success' });
    });
    return req;
  }
}
