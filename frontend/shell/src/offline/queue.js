/**
 * Cola local de operaciones y copia de las últimas lecturas, en IndexedDB (RF-10, CU-22).
 * Cada usuario tiene su propia base: en un equipo compartido nadie ve ni envía lo de otro.
 * Reenviar es seguro: cada operación conserva su Idempotency-Key desde que se creó (RNF-04).
 */
const QUEUE = 'queue';
const CACHE = 'cache';
const RETRY_MS = 30000;

export const PENDING = 'PENDING';
export const CONFLICT = 'CONFLICT';
export const DONE = 'DONE';

function openDatabase(userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`salon-offline-${userId}`, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(QUEUE, { keyPath: 'id' });
      request.result.createObjectStore(CACHE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(database, store, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function errorMessage(response) {
  const body = await response.json().catch(() => ({}));
  const detail = typeof body.detail === 'object' ? body.detail?.message : body.detail;
  return detail ?? body.message ?? `El servicio respondió ${response.status}.`;
}

export async function createOfflineStore({
  userId,
  getToken,
  onSessionLost = () => {},
  fetchImpl = (...args) => fetch(...args),
  newId = () => crypto.randomUUID(),
  now = () => Date.now(),
}) {
  const database = await openDatabase(userId);
  const listeners = new Set();
  let syncing = null;

  const notify = () => listeners.forEach((listener) => listener());

  const list = async () => {
    const items = await transaction(database, QUEUE, 'readonly', (store) => store.getAll());
    return items.sort((a, b) => a.createdAt - b.createdAt);
  };

  const put = (item) => transaction(database, QUEUE, 'readwrite', (store) => store.put(item));
  const remove = (id) => transaction(database, QUEUE, 'readwrite', (store) => store.delete(id));

  /** Envía una operación. Devuelve falso si conviene detenerse y volver a intentar más tarde. */
  async function send(item) {
    let response;
    try {
      response = await fetchImpl(item.url, {
        method: item.method,
        headers: {
          ...(item.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'Idempotency-Key': item.idempotencyKey,
          Authorization: `Bearer ${await getToken()}`,
        },
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
      });
    } catch {
      return false;
    }
    if (response.status === 401) {
      onSessionLost();
      return false;
    }
    // Un error del servidor puede ser pasajero: se conserva el orden y se reintenta después
    if (response.status >= 500) return false;
    if (response.ok || (item.method === 'DELETE' && response.status === 404)) {
      if (item.keepResult) {
        await put({ ...item, status: DONE, result: await response.json().catch(() => ({})) });
      } else {
        await remove(item.id);
      }
      return true;
    }
    // Rechazo definitivo, como un turno que ya ocupó otra persona: decide el usuario, nunca se pierde en silencio
    await put({ ...item, status: CONFLICT, error: await errorMessage(response) });
    return true;
  }

  async function runSync() {
    for (const item of await list()) {
      if (item.status !== PENDING) continue;
      const proceed = await send(item);
      notify();
      if (!proceed) return false;
    }
    return true;
  }

  const store = {
    isOnline: () => navigator.onLine,

    /** Guarda una operación para enviarla cuando vuelva la conexión. */
    async enqueue({ kind, label, url, method, body, idempotencyKey, keepResult = false }) {
      const item = {
        id: newId(), kind, label, url, method, body, keepResult,
        idempotencyKey: idempotencyKey ?? newId(),
        status: PENDING,
        createdAt: now(),
      };
      await put(item);
      notify();
      return item;
    },

    list,

    async discard(id) {
      await remove(id);
      notify();
    },

    /** Vacía la cola en orden; varias llamadas simultáneas comparten el mismo envío. */
    sync() {
      syncing ??= runSync().finally(() => {
        syncing = null;
      });
      return syncing;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    cachePut: (key, value) => transaction(database, CACHE, 'readwrite', (cache) => cache.put(value, key)),
    cacheGet: (key) => transaction(database, CACHE, 'readonly', (cache) => cache.get(key)),

    /** Arranca el envío automático: al recuperar la conexión, al abrir la plataforma y cada cierto tiempo. */
    start() {
      const trigger = () => {
        if (navigator.onLine) void store.sync();
      };
      window.addEventListener('online', trigger);
      const offlineChanged = () => notify();
      window.addEventListener('offline', offlineChanged);
      const timer = setInterval(trigger, RETRY_MS);
      trigger();
      return () => {
        window.removeEventListener('online', trigger);
        window.removeEventListener('offline', offlineChanged);
        clearInterval(timer);
      };
    },
  };
  return store;
}
