import test from 'node:test';
import assert from 'node:assert/strict';
import { queueLocalStateMigration } from '../state-migration.js';
import { createStateSync } from '../sync-store.js';

function memory() {
  const data = new Map();
  return {
    get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)
  };
}
const local = overrides => ({ favorite: new Set(), practiced: new Set(), mastery: {}, ownAnswers: {}, ...overrides });

test('partial cloud state still queues the other local answers before sending', async () => {
  const storage = memory();
  let attempts = 0;
  const sync = createStateSync({ storage, ownerId: 'a', send: async () => { attempts++; throw Error('offline'); } });
  queueLocalStateMigration({ questionIds: new Set([1, 2]), remoteRows: [{ question_id: 1, own_answer: 'cloud answer' }],
    local: local({ ownAnswers: { 1: 'stale local answer', 2: 'unmigrated draft', 3: 'another set' } }), sync });
  assert.equal(attempts, 0);
  assert.deepEqual(sync.pendingRows().map(row => row.question_id), [2]);
  await sync.retry();
  assert.equal(sync.getStatus(2), 'error');
  sync.stop();

  const sent = [];
  const reloaded = createStateSync({ storage, ownerId: 'a', send: async (id, row) => sent.push({ id, ...row }) });
  assert.equal(reloaded.pendingRows()[0].own_answer, 'unmigrated draft');
  await reloaded.retry();
  assert.equal(sent[0].own_answer, 'unmigrated draft');
  assert.equal(reloaded.hasPending(), false);
});

test('migration never replaces a newer pending edit with a stale UI cache', () => {
  const sync = createStateSync({ storage: memory(), ownerId: 'a', send: async () => assert.fail('must defer') });
  sync.save(1, { own_answer: 'new draft' }, { defer: true });
  queueLocalStateMigration({ questionIds: new Set([1]), remoteRows: [], local: local({ ownAnswers: { 1: 'old draft' } }), sync });
  assert.equal(sync.pendingRows()[0].own_answer, 'new draft');
  sync.stop();
});

test('empty state is not uploaded and legacy answer length is bounded', () => {
  const sync = createStateSync({ storage: memory(), ownerId: 'a', send: async () => assert.fail('must defer') });
  queueLocalStateMigration({ questionIds: new Set([1, 2]), remoteRows: [], local: local({ ownAnswers: { 2: 'a'.repeat(21000) } }), sync });
  assert.deepEqual(sync.pendingRows().map(row => row.question_id), [2]);
  assert.equal(sync.pendingRows()[0].own_answer.length, 20000);
  sync.stop();
});

test('a pending favorite patch does not discard a legacy answer or review date', () => {
  const sync = createStateSync({ storage: memory(), ownerId: 'a', send: async () => assert.fail('must defer') });
  sync.save(1, { favorite: false }, { defer: true });
  queueLocalStateMigration({ questionIds: new Set([1]), remoteRows: [], local: local({
    favorite: new Set([1]), ownAnswers: { 1: 'legacy draft' }, reviewHistory: { 1: '2026-09-20T01:00:00Z' }
  }), sync });
  const row = sync.pendingRows()[0];
  assert.equal(row.favorite, false);
  assert.equal(row.own_answer, 'legacy draft');
  assert.equal(row.last_practiced_at, '2026-09-20T01:00:00Z');
  sync.stop();
});
