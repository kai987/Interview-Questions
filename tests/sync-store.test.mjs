import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateSync } from '../sync-store.js';

function memory() {
  const values = new Map();
  return { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
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
  assert.ok(storage.getItem('interview-pending-state:a').includes('private A'));
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
