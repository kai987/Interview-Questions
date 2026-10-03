import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeSessionStore } from '../practice-session-store.js';

function setup(options = {}) {
  const rows = new Map();
  const storage = {
    getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: key => rows.delete(key)
  };
  const create = overrides => createPracticeSessionStore({
    storage, ownerId: 'account-a', setId: 1, questionIds: [1, 2, 3], now: () => 1234,
    ...options, ...overrides
  });
  return { rows, storage, create, store: create() };
}

test('restores question order, current step and ratings, scoped to account and company', () => {
  const { create, store } = setup();
  assert.equal(store.save({ ids: [3, 1, 2], index: 1, ratings: { 3: 'okay', 1: 'confident' } }), true);
  assert.deepEqual(create().load(), { ids: [3, 1, 2], index: 1, ratings: { 3: 'okay', 1: 'confident' }, updatedAt: 1234 });
  assert.equal(create({ ownerId: 'account-b' }).load(), null);
  assert.equal(create({ setId: 2 }).load(), null);
  store.clear();
  assert.equal(create().load(), null);
});

test('removes deleted questions and moves to the next surviving question', () => {
  const { create, store } = setup();
  store.save({ ids: [3, 1, 2], index: 1, ratings: { 3: 'okay' } });
  assert.deepEqual(create({ questionIds: [2, 3] }).load(), { ids: [3, 2], index: 1, ratings: { 3: 'okay' }, updatedAt: 1234 });
  assert.equal(create({ questionIds: [3] }).load(), null);
});

test('rejects corrupt, foreign-scope and invalid snapshots', () => {
  const { rows, store } = setup();
  const snapshot = { ids: [1, 2], index: 0, ratings: {} };
  store.save(snapshot);
  const key = [...rows.keys()][0];
  const original = JSON.parse(rows.get(key));
  for (const patch of [{ version: 2 }, { ownerId: 'someone-else' }, { setId: 2 },
    { ids: [1, 1] }, { index: 2 }, { ratings: { 3: 'okay' } }, { ratings: { 1: 'wrong' } }]) {
    rows.set(key, JSON.stringify({ ...original, ...patch }));
    assert.equal(store.load(), null);
  }
  rows.set(key, '{broken');
  assert.equal(store.load(), null);
  assert.equal(store.save({ ...snapshot, ids: [1, 99] }), false);
});

test('unavailable local storage does not crash practice or claim it was saved', () => {
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const { store } = setup({ storage: unavailable });
  assert.equal(store.load(), null);
  assert.equal(store.save({ ids: [1], index: 0, ratings: {} }), false);
  assert.equal(store.clear(), false);
});
