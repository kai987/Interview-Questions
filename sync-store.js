// Immutable, account-scoped outbox entries keep one tab from overwriting another
// tab's drafts. Web Locks serialize sends for the same account and question.
export function createStateSync({ storage, ownerId, send, notify = () => {}, delay = 500, locks = globalThis.navigator?.locks }) {
  const legacyKey = `interview-pending-state:${ownerId}`;
  const prefix = `${legacyKey}:v2:`;
  const records = new Map();
  const running = new Map();
  const timers = new Map();
  const statuses = new Map();
  let stopped = false;
  let lastTimestamp = 0;
  let sequence = 0;
  const writer = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const validId = id => Number.isSafeInteger(id) && id > 0;
  const validRow = row => row && typeof row === 'object' && !Array.isArray(row);
  const isMigration = entry => /^m\d+-/.test(entry.revision);
  const priority = entry => isMigration(entry) ? 0 : entry.revision === 'legacy' ? 1 : 2;
  const compareEntries = (a, b) => priority(a) - priority(b) || a.revision.localeCompare(b.revision);

  function readRecords() {
    try {
      const found = new Map();
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const raw = storage.getItem(key);
        let entry;
        try { entry = JSON.parse(raw); } catch { continue; }
        if (!entry || !validId(entry.id) || !validRow(entry.row) || typeof entry.revision !== 'string' || key !== `${prefix}${entry.id}:${entry.revision}`) continue;
        found.set(key, { ...entry, key, durable: true });
      }
      // A successful scan may remove acknowledged records from another tab,
      // but a draft that failed to persist must remain available in memory.
      for (const [key, entry] of records) {
        if (entry.durable && !found.has(key)) records.delete(key);
      }
      for (const [key, entry] of found) records.set(key, entry);
    } catch { /* Keep the last known records if browser storage is unavailable. */ }
    return [...records.values()];
  }
  function newestByQuestion() {
    const latest = new Map();
    for (const entry of readRecords().sort(compareEntries)) {
      const previous = latest.get(entry.id);
      latest.set(entry.id, { ...entry, row: { ...previous?.row, ...entry.row }, durable: entry.durable && previous?.durable !== false });
    }
    return latest;
  }
  function status(id, value) {
    statuses.set(id, value);
    notify(id, value);
  }
  function persist(entry) {
    storage.setItem(entry.key, JSON.stringify({ id: entry.id, revision: entry.revision, row: entry.row }));
    entry.durable = true;
    records.set(entry.key, entry);
  }
  function migrateLegacy() {
    let legacy;
    try { legacy = JSON.parse(storage.getItem(legacyKey) || 'null'); } catch { return true; }
    if (!validRow(legacy)) return true;
    readRecords();
    let complete = true;
    for (const [value, row] of Object.entries(legacy)) {
      const id = Number(value);
      if (!validId(id) || !validRow(row)) continue;
      // Deterministic, lower-priority migration entries cannot outrank a new
      // edit even if two tabs migrate the same old outbox simultaneously.
      const key = `${prefix}${id}:legacy`;
      if (records.get(key)?.durable) continue;
      const entry = { key, id, revision: 'legacy', row: { ...row }, durable: false };
      records.set(key, entry);
      try { persist(entry); } catch { complete = false; }
    }
    if (complete) {
      try { storage.removeItem(legacyKey); } catch { complete = false; }
    }
    return complete;
  }
  migrateLegacy();

  async function drain(id) {
    if (stopped) return;
    // Never acknowledge legacy entries while the old bundle can restore them.
    if (!migrateLegacy()) { status(id, 'local-error'); return; }
    while (!stopped) {
      const covered = readRecords().filter(entry => entry.id === id);
      if (!covered.length) { status(id, 'synced'); return; }
      status(id, 'syncing');
      try {
        const ordered = covered.sort(compareEntries);
        const row = Object.assign({}, ...ordered.map(entry => entry.row));
        const metadata = { migration: {}, changes: {} };
        for (const entry of ordered) {
          // Legacy outbox records are genuine edits. Only explicit local-state
          // imports use the lower-priority migration channel at the server.
          const target = isMigration(entry) ? metadata.migration : metadata.changes;
          Object.assign(target, entry.row);
        }
        await send(id, row, metadata);
      } catch {
        if (!stopped) status(id, covered.some(entry => !entry.durable) ? 'local-error' : 'error');
        return;
      }
      if (stopped) return;
      try {
        // Delete only keys captured before sending. A new revision created by
        // either tab during this request has a different key and survives.
        for (const entry of covered) {
          storage.removeItem(entry.key);
          records.delete(entry.key);
        }
      } catch {
        if (!stopped) status(id, 'local-error');
        return;
      }
    }
  }
  async function flush(id) {
    id = Number(id);
    clearTimeout(timers.get(id));
    if (stopped || !validId(id)) return;
    if (running.has(id)) return running.get(id);
    const work = (async () => {
      // Register running before a synchronous send can finish.
      await Promise.resolve();
      if (stopped) return;
      try {
        if (locks?.request) await locks.request(`${prefix}${id}`, () => drain(id));
        else await drain(id);
      } catch {
        if (!stopped) status(id, 'error');
      }
    })();
    running.set(id, work);
    try { await work; } finally { running.delete(id); }
  }
  function save(id, row, { debounce = false, defer = false, migration = false } = {}) {
    id = Number(id);
    if (stopped || !validId(id) || !validRow(row)) return;
    const previous = readRecords().filter(entry => entry.id === id);
    const latestTime = previous.reduce((value, entry) => Math.max(value, Number(entry.revision.match(/^[mr](\d+)-/)?.[1]) || 0), 0);
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1, latestTime + 1);
    // Importing an old local snapshot must never outrank a user edit made
    // while that snapshot was being read. The comparator gives both legacy
    // and regular user edits priority over these explicit migration entries.
    const revision = `${migration ? 'm' : 'r'}${String(lastTimestamp).padStart(16, '0')}-${writer}-${++sequence}`;
    const entry = { key: `${prefix}${id}:${revision}`, id, revision, row: { ...row }, durable: false };
    records.set(entry.key, entry);
    try {
      persist(entry);
      // Compact only patches whose fields this edit replaces entirely. Keep
      // other fields as separate revisions so stale snapshots cannot win.
      for (const old of previous) {
        // Use the same priority as pending rows and send metadata: an import
        // cannot compact away genuine legacy or regular user edits.
        if (compareEntries(old, entry) > 0 || !Object.keys(old.row).every(field => Object.hasOwn(entry.row, field))) continue;
        try { storage.removeItem(old.key); records.delete(old.key); } catch {}
      }
    } catch { /* The latest draft remains in memory and is visibly unsaved. */ }
    status(id, entry.durable ? 'local' : 'local-error');
    clearTimeout(timers.get(id));
    if (defer) return;
    if (debounce) timers.set(id, setTimeout(() => void flush(id), delay));
    else void flush(id);
  }
  return {
    save, flush,
    retry: () => Promise.all([...newestByQuestion().keys()].map(flush)),
    pendingRows: () => [...newestByQuestion().values()].map(entry => ({ ...entry.row, question_id: entry.id })),
    getStatus(id) {
      id = Number(id);
      const entry = newestByQuestion().get(id);
      if (!entry) return 'synced';
      if (!entry.durable) return 'local-error';
      const current = statuses.get(id);
      return current && current !== 'synced' ? current : 'local';
    },
    hasPending: () => newestByQuestion().size > 0,
    stop() { stopped = true; timers.forEach(clearTimeout); },
    discard() {
      this.stop();
      for (const entry of readRecords()) storage.removeItem(entry.key);
      storage.removeItem(legacyKey);
      records.clear();
    }
  };
}
