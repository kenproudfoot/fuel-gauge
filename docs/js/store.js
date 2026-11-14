// All storage access goes through this module (IndexedDB on the device).
// Nothing else in the app touches IndexedDB, so an optional sync target can be
// added here later without changing the rest of the app.

const DB_NAME = 'fuel-gauge';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'id' }).createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('foods')) db.createObjectStore('foods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'day' });
      if (!db.objectStoreNames.contains('pngs')) db.createObjectStore('pngs', { keyPath: 'day' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is blocked by another open copy of the app.'));
  });
  return dbPromise;
}

/** Run one request-producing function inside a transaction. */
async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
  });
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (plain http on a LAN).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function kvGet(key) {
  return run('kv', 'readonly', (s) => s.get(key));
}

async function kvSet(key, value) {
  return run('kv', 'readwrite', (s) => s.put(value, key));
}

export const store = {
  /** Open the database and ask the browser not to evict our data. */
  async init() {
    await open();
    let persisted = null;
    try {
      if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
      if (!persisted && navigator.storage?.persist) persisted = await navigator.storage.persist();
    } catch {
      persisted = null;
    }
    return { persisted };
  },

  // --- settings ---
  getSettings: () => kvGet('settings'),
  saveSettings: (settings) => kvSet('settings', settings),

  // --- foods ---
  /** All non-deleted foods, sorted by name. */
  async listFoods() {
    const all = await run('foods', 'readonly', (s) => s.getAll());
    return all
      .filter((f) => !f.deleted)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  },

  /** One food by id, even if it has been soft-deleted. Undefined when missing. */
  getFood: (id) => (id ? run('foods', 'readonly', (s) => s.get(id)) : Promise.resolve(undefined)),

  /** Insert or update a food. Assigns id and timestamps. */
  async putFood(food) {
    const now = Date.now();
    const record = { ...food, id: food.id || newId(), createdAt: food.createdAt || now, updatedAt: now };
    await run('foods', 'readwrite', (s) => s.put(record));
    return record;
  },

  /** Soft delete: the food is hidden but never removed. */
  async deleteFood(food) {
    return store.putFood({ ...food, deleted: true, deletedAt: Date.now() });
  },

  // --- entries ---
  /** Every entry of a food day, including soft-deleted ones, newest first. */
  async listEntriesForDay(day) {
    const all = await run('entries', 'readonly', (s) => s.index('day').getAll(day));
    return all.sort((a, b) => b.ts - a.ts);
  },

  async putEntry(entry) {
    const record = { ...entry, id: entry.id || newId() };
    await run('entries', 'readwrite', (s) => s.put(record));
    return record;
  },

  /** Soft delete: the entry stays stored and is excluded from totals. */
  async deleteEntry(entry) {
    return store.putEntry({ ...entry, deleted: true, deletedAt: Date.now() });
  },

  /** Bring a soft-deleted entry back. */
  async restoreEntry(entry) {
    return store.putEntry({ ...entry, deleted: false, deletedAt: null });
  },
};
