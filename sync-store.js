// Per-account durable outbox. A question's writes are serialized so a slow
// response cannot acknowledge or overwrite a newer edit from this page.
export function createStateSync({ storage, ownerId, send, notify = () => {}, delay = 500 }) {
  const key = `interview-pending-state:${ownerId}`;
  let pending = {};
  try { pending = JSON.parse(storage.getItem(key) || '{}') || {}; } catch {}
  if (Array.isArray(pending) || typeof pending !== 'object') pending = {};
  const running = new Map();
  const timers = new Map();
  const statuses = new Map();
  let stopped = false;
  const notDurable = new Set();
  function persist() {
    storage.setItem(key, JSON.stringify(pending));
  }
  function status(id, value) {
    statuses.set(Number(id), value);
    notify(Number(id), value);
  }
  async function flush(id) {
    id = Number(id);
    clearTimeout(timers.get(id));
    if (stopped || !pending[id]) return;
    if (running.has(id)) return running.get(id);
    const work = (async () => {
      // Always resume on a new microtask before running has been registered.
      await Promise.resolve();
      while (!stopped && pending[id]) {
        const snapshot = pending[id];
        status(id, 'syncing');
        try {
          await send(id, snapshot);
          if (stopped) return;
          if (pending[id] === snapshot) {
            delete pending[id];
            try { persist(); } catch {
              pending[id] = snapshot;
              notDurable.add(id);
              status(id, 'local-error');
              return;
            }
            status(id, 'synced');
          }
        } catch {
          if (!stopped) status(id, notDurable.has(id) ? 'local-error' : 'error');
          return;
        }
      }
    })();
    running.set(id, work);
    try { await work; } finally { running.delete(id); }
  }
  function save(id, row, { debounce = false } = {}) {
    id = Number(id);
    if (stopped || !Number.isSafeInteger(id) || id <= 0) return;
    pending[id] = { ...row };
    let durable = true;
    try { persist(); notDurable.clear(); } catch { durable = false; notDurable.add(id); }
    status(id, durable ? 'local' : 'local-error');
    clearTimeout(timers.get(id));
    if (debounce) timers.set(id, setTimeout(() => void flush(id), delay));
    else void flush(id);
  }
  return {
    save, flush,
    retry: () => Promise.all(Object.keys(pending).map(flush)),
    pendingRows: () => Object.entries(pending).map(([id, row]) => ({ ...row, question_id: Number(id) })),
    getStatus: id => statuses.get(Number(id)) || (pending[id] ? 'local' : 'synced'),
    hasPending: () => Object.keys(pending).length > 0,
    stop() { stopped = true; timers.forEach(clearTimeout); },
    discard() { this.stop(); storage.removeItem(key); pending = {}; }
  };
}
