import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateSync } from '../sync-store.js';

function memory() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
}
test('failed edits survive a reload and successful retry removes the outbox', async () => {
  const storage = memory();
  const first = createStateSync({ storage, ownerId: 'a', send: async () => { throw Error('offline'); } });
  first.save(1, { own_answer: 'draft' });
  await first.flush(1);
  assert.equal(first.getStatus(1), 'error');
  first.stop();
  const sent = [];
  const second = createStateSync({ storage, ownerId: 'a', send: async (_, row) => sent.push(row) });
  assert.equal(second.pendingRows()[0].own_answer, 'draft');
  await second.retry();
  assert.deepEqual(sent, [{ own_answer: 'draft' }]);
  assert.equal(second.hasPending(), false);
  assert.equal(second.getStatus(1), 'synced');
});
test('a slow save cannot acknowledge a newer edit; writes are serialized', async () => {
  let release;
  const sent = [];
  const store = createStateSync({ storage: memory(), ownerId: 'a', send: async (_, row) => {
    sent.push(row.own_answer);
    if (sent.length === 1) await new Promise(resolve => { release = resolve; });
  } });
  store.save(1, { own_answer: 'first' });
  await Promise.resolve();
  store.save(1, { own_answer: 'latest' });
  assert.deepEqual(sent, ['first']);
  release();
  await store.flush(1);
  assert.deepEqual(sent, ['first', 'latest']);
  assert.equal(store.hasPending(), false);
});
test('pending records are account scoped and stopping never sends more records', async () => {
  const storage = memory();
  const first = createStateSync({ storage, ownerId: 'a', send: async () => assert.fail('stopped') });
  first.save(1, { own_answer: 'private A' }, { debounce: true });
  first.stop();
  const second = createStateSync({ storage, ownerId: 'b', send: async () => assert.fail('different account') });
  assert.deepEqual(second.pendingRows(), []);
  await second.retry();
  const restored = createStateSync({ storage, ownerId: 'a', send: async () => assert.fail('not flushed') });
  assert.equal(restored.pendingRows()[0].own_answer, 'private A');
});
test('failure of durable storage is visible, not falsely reported as local saved', async () => {
  const states = [];
  const store = createStateSync({ storage: { getItem: () => null, setItem: () => { throw Error('quota'); } }, ownerId: 'a', notify: (_, s) => states.push(s), send: async () => { throw Error('offline'); } });
  store.save(1, { own_answer: 'draft' });
  assert.equal(states[0], 'local-error');
  await store.flush(1);
  assert.equal(store.hasPending(), true);
  assert.equal(store.getStatus(1), 'local-error');
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function lockManager() {
  const queues = new Map();
  return { request(name, callback) {
    const work = (queues.get(name) || Promise.resolve()).then(callback);
    queues.set(name, work.catch(() => {}));
    return work;
  } };
}

test('deferred saves are durable without starting a request or debounce timer', async () => {
  const storage = memory();
  let sends = 0;
  const store = createStateSync({ storage, ownerId: 'a', delay: 1, send: async () => { sends += 1; } });
  store.save(1, { favorite: true }, { defer: true, debounce: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sends, 0);
  assert.equal(store.hasPending(), true);
  await store.retry();
  assert.equal(sends, 1);
});

test('different tabs retain pending changes to different questions across reload', async () => {
  const storage = memory();
  const options = { storage, ownerId: 'a', send: async () => { throw Error('offline'); } };
  const first = createStateSync(options);
  const second = createStateSync(options);
  first.save(1, { own_answer: 'tab A draft' }, { defer: true });
  second.save(2, { favorite: true }, { defer: true });
  first.stop();
  second.stop();
  const reloaded = createStateSync(options);
  assert.deepEqual(reloaded.pendingRows().sort((a, b) => a.question_id - b.question_id), [
    { question_id: 1, own_answer: 'tab A draft' }, { question_id: 2, favorite: true }
  ]);
});

test('same-question patches from different tabs merge without stale unrelated fields', async () => {
  const storage = memory();
  const sent = [];
  const options = { storage, ownerId: 'a', send: async (_, row) => sent.push(row) };
  const first = createStateSync(options);
  const second = createStateSync(options);
  first.save(1, { own_answer: 'new answer' }, { defer: true });
  second.save(1, { favorite: true }, { defer: true });
  first.save(1, { own_answer: 'latest answer' }, { defer: true });
  assert.deepEqual(second.pendingRows(), [{ question_id: 1, own_answer: 'latest answer', favorite: true }]);
  await second.retry();
  assert.deepEqual(sent, [{ own_answer: 'latest answer', favorite: true }]);
  assert.equal(first.hasPending(), false);
});

test('Web Locks serialize same-question requests across tabs and keep newer edits', async () => {
  const storage = memory();
  const locks = lockManager();
  const started = deferred();
  const release = deferred();
  let active = 0;
  let peak = 0;
  const sent = [];
  const options = { storage, locks, ownerId: 'a', send: async (_, row) => {
    peak = Math.max(peak, ++active);
    sent.push(row.own_answer);
    if (sent.length === 1) { started.resolve(); await release.promise; }
    active -= 1;
  } };
  const first = createStateSync(options);
  const second = createStateSync(options);
  first.save(1, { own_answer: 'first' });
  await started.promise;
  second.save(1, { own_answer: 'latest' });
  await Promise.resolve();
  assert.deepEqual(sent, ['first']);
  assert.equal(second.pendingRows()[0].own_answer, 'latest');
  release.resolve();
  await Promise.all([first.flush(1), second.flush(1)]);
  assert.equal(peak, 1);
  assert.deepEqual(sent, ['first', 'latest']);
  assert.equal(second.hasPending(), false);
});

test('a new edit created during old-record cleanup is never deleted by the old acknowledgement', async () => {
  const storage = memory();
  const sent = [];
  const nextStarted = deferred();
  const releaseNext = deferred();
  const first = createStateSync({ storage, ownerId: 'a', send: async (_, row) => {
    sent.push(row.own_answer);
    if (sent.length === 2) { nextStarted.resolve(); await releaseNext.promise; }
  } });
  const second = createStateSync({ storage, ownerId: 'a', send: async () => assert.fail('deferred') });
  const remove = storage.removeItem;
  let injected = false;
  storage.removeItem = key => {
    if (!injected && key.startsWith('interview-pending-state:a:v2:1:')) {
      injected = true;
      second.save(1, { own_answer: 'created during acknowledgement' }, { defer: true });
    }
    remove(key);
  };
  first.save(1, { own_answer: 'old request' });
  await nextStarted.promise;
  assert.equal(second.pendingRows()[0].own_answer, 'created during acknowledgement');
  first.stop();
  releaseNext.resolve();
  await first.flush(1);
  assert.equal(second.hasPending(), true);
});

test('stopping a tab waiting for the question lock leaves its draft queued', async () => {
  const storage = memory();
  const locks = lockManager();
  const held = deferred();
  const blocker = locks.request('interview-pending-state:a:v2:1', () => held.promise);
  const store = createStateSync({ storage, ownerId: 'a', locks, send: async () => assert.fail('stopped before lock acquired') });
  store.save(1, { favorite: true });
  const flush = store.flush(1);
  store.stop();
  held.resolve();
  await Promise.all([blocker, flush]);
  assert.equal(store.hasPending(), true);
});

test('legacy outbox migrates durably and merges with newer field patches', async () => {
  const storage = memory();
  const current = createStateSync({ storage, ownerId: 'a', send: async () => {} });
  current.save(1, { own_answer: 'new' }, { defer: true });
  storage.setItem('interview-pending-state:a', JSON.stringify({ 1: { own_answer: 'legacy', favorite: true }, 2: { practiced: true } }));
  const sent = [];
  const restored = createStateSync({ storage, ownerId: 'a', send: async (id, row) => sent.push({ id, ...row }) });
  assert.equal(storage.getItem('interview-pending-state:a'), null);
  assert.deepEqual(restored.pendingRows().find(row => row.question_id === 1), { question_id: 1, own_answer: 'new', favorite: true });
  await restored.retry();
  assert.deepEqual(sent.sort((a, b) => a.id - b.id), [{ id: 1, own_answer: 'new', favorite: true }, { id: 2, practiced: true }]);
});

test('partial legacy migration retains the old bundle until all records persist', async () => {
  const storage = memory();
  storage.setItem('interview-pending-state:a', JSON.stringify({ 1: { favorite: true }, 2: { own_answer: 'legacy draft' } }));
  const set = storage.setItem;
  let blocked = true;
  storage.setItem = (key, value) => {
    if (blocked && key.includes(':v2:2:')) throw Error('quota');
    set(key, value);
  };
  const sent = [];
  const store = createStateSync({ storage, ownerId: 'a', send: async (id, row) => sent.push({ id, ...row }) });
  assert.ok(storage.getItem('interview-pending-state:a'));
  assert.equal(store.pendingRows().length, 2);
  assert.equal(store.getStatus(2), 'local-error');
  await store.retry();
  assert.equal(sent.length, 0);
  blocked = false;
  await store.retry();
  assert.equal(storage.getItem('interview-pending-state:a'), null);
  assert.equal(store.hasPending(), false);
  assert.deepEqual(sent.sort((a, b) => a.id - b.id), [{ id: 1, favorite: true }, { id: 2, own_answer: 'legacy draft' }]);
});

test('failure to remove an acknowledged record remains a visible local error', async () => {
  const storage = memory();
  const store = createStateSync({ storage, ownerId: 'a', send: async () => {} });
  store.save(1, { favorite: true }, { defer: true });
  storage.removeItem = () => { throw Error('storage blocked'); };
  await store.retry();
  assert.equal(store.hasPending(), true);
  assert.equal(store.getStatus(1), 'local-error');
});

test('an in-flight acknowledgement after stop does not remove a newer draft', async () => {
  const storage = memory();
  const started = deferred();
  const release = deferred();
  const store = createStateSync({ storage, ownerId: 'a', send: async () => { started.resolve(); await release.promise; } });
  store.save(1, { own_answer: 'sending' });
  await started.promise;
  store.save(1, { own_answer: 'keep after stop' }, { defer: true });
  store.stop();
  release.resolve();
  await store.flush(1);
  const restored = createStateSync({ storage, ownerId: 'a', send: async () => {} });
  assert.equal(restored.pendingRows()[0].own_answer, 'keep after stop');
});

test('temporary storage read failures do not forget already queued records', () => {
  const storage = memory();
  const store = createStateSync({ storage, ownerId: 'a', send: async () => {} });
  store.save(1, { own_answer: 'keep cached draft' }, { defer: true });
  storage.getItem = () => { throw Error('storage temporarily unavailable'); };
  assert.equal(store.pendingRows()[0].own_answer, 'keep cached draft');
});

test('a local migration snapshot cannot override a user edit made after the pending read', async () => {
  const storage = memory();
  const sent = [];
  const options = { storage, ownerId: 'a', send: async (_, row) => sent.push(row) };
  const migrationTab = createStateSync(options);
  const editingTab = createStateSync(options);
  const pendingBeforeMigration = migrationTab.pendingRows();
  assert.deepEqual(pendingBeforeMigration, []);
  editingTab.save(1, { own_answer: 'new user edit' }, { defer: true });
  migrationTab.save(1, { own_answer: 'older local snapshot', favorite: true }, { migration: true, defer: true });
  assert.deepEqual(migrationTab.pendingRows(), [{ question_id: 1, own_answer: 'new user edit', favorite: true }]);
  const reloaded = createStateSync(options);
  assert.deepEqual(reloaded.pendingRows(), [{ question_id: 1, own_answer: 'new user edit', favorite: true }]);
  await reloaded.retry();
  assert.deepEqual(sent, [{ own_answer: 'new user edit', favorite: true }]);
});

test('legacy and regular user edits outrank explicit migration values', async () => {
  const storage = memory();
  storage.setItem('interview-pending-state:a', JSON.stringify({ 1: { own_answer: 'legacy', favorite: false } }));
  const sent = [];
  const store = createStateSync({ storage, ownerId: 'a', send: async (_, row) => sent.push(row) });
  store.save(1, { own_answer: 'first imported snapshot' }, { migration: true, defer: true });
  store.save(1, { own_answer: 'newer imported snapshot', favorite: true }, { migration: true, defer: true });
  assert.deepEqual(store.pendingRows(), [{ question_id: 1, own_answer: 'legacy', favorite: false }]);
  store.save(1, { favorite: false }, { defer: true });
  store.save(1, { favorite: true }, { migration: true, defer: true });
  assert.equal(store.pendingRows()[0].favorite, false);
  await store.retry();
  assert.deepEqual(sent, [{ own_answer: 'legacy', favorite: false }]);
});

test('send metadata separates migration imports from current and legacy user changes', async () => {
  const storage = memory();
  storage.setItem('interview-pending-state:a', JSON.stringify({ 1: { own_answer: 'queued legacy edit', practiced: true } }));
  const sent = [];
  const store = createStateSync({ storage, ownerId: 'a', send: async (id, row, metadata) => sent.push({ id, row, metadata }) });
  store.save(1, { own_answer: 'old local import', favorite: true }, { migration: true, defer: true });
  store.save(1, { own_answer: 'new user edit' }, { defer: true });
  await store.retry();
  assert.deepEqual(sent, [{
    id: 1,
    row: { own_answer: 'new user edit', practiced: true, favorite: true },
    metadata: {
      migration: { own_answer: 'old local import', favorite: true },
      changes: { own_answer: 'new user edit', practiced: true }
    }
  }]);
});

test('migration-only sends have no regular changes and normal saves have no migration metadata', async () => {
  const sent = [];
  const store = createStateSync({ storage: memory(), ownerId: 'a', send: async (id, row, metadata) => sent.push({ id, row, metadata }) });
  store.save(1, { favorite: true }, { migration: true, defer: true });
  store.save(2, { own_answer: 'typed answer' }, { defer: true });
  await store.retry();
  assert.deepEqual(sent.sort((a, b) => a.id - b.id), [
    { id: 1, row: { favorite: true }, metadata: { migration: { favorite: true }, changes: {} } },
    { id: 2, row: { own_answer: 'typed answer' }, metadata: { migration: {}, changes: { own_answer: 'typed answer' } } }
  ]);
});

test('a full migration patch does not compact away a genuine legacy edit', async () => {
  const storage = memory();
  storage.setItem('interview-pending-state:a', JSON.stringify({ 1: { own_answer: 'unsent legacy user edit' } }));
  const sent = [];
  const store = createStateSync({ storage, ownerId: 'a', send: async (_, row, metadata) => { assert.deepEqual(row, { ...metadata.migration, ...metadata.changes }); sent.push(metadata); } });
  store.save(1, { own_answer: 'local import snapshot' }, { migration: true, defer: true });
  assert.deepEqual(store.pendingRows(), [{ question_id: 1, own_answer: 'unsent legacy user edit' }]);
  await store.retry();
  assert.deepEqual(sent, [{ migration: { own_answer: 'local import snapshot' }, changes: { own_answer: 'unsent legacy user edit' } }]);
});
