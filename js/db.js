// IndexedDB storage. The database keeps its original name ("oscar") so existing documents carry over.
let dbp = null;
export function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('oscar', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', {keyPath: 'id'});
      d.createObjectStore('sessions', {keyPath: 'id'});
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function os(name, mode) { const d = await idb(); return d.transaction(name, mode || 'readonly').objectStore(name); }
// Values are structured-cloned by IndexedDB itself, so no JSON round trip is needed.
export const DB = {
  get: async (s, k) => rq((await os(s)).get(k)),
  all: async s => rq((await os(s)).getAll()),
  put: async (s, v, k) => { const st = await os(s, 'readwrite'); return rq(k === undefined ? st.put(v) : st.put(v, k)); },
  del: async (s, k) => rq((await os(s, 'readwrite')).delete(k))
};

// Ask the browser not to clear Zephyr's storage on its own (Safari otherwise may after a week without a visit).
export async function persistStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) { return null; }
}
