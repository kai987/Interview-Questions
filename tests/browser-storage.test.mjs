import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createPracticeSessionStore } from '../practice-session-store.js';

const source = readFileSync(new URL('../browser-storage.js', import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const failures = {};
  return {
    values, failures,
    get length() { if (failures.length) throw failures.length; return values.size; },
    key(index) { if (failures.key) throw failures.key; return [...values.keys()][index] ?? null; },
    getItem(key) { if (failures.get) throw failures.get; return values.get(String(key)) ?? null; },
    setItem(key, value) { if (failures.set) throw failures.set; values.set(String(key), String(value)); },
    removeItem(key) { if (failures.remove) throw failures.remove; values.delete(String(key)); }
  };
}

function load(getStorage) {
  // A plain fake global preserves throwing accessor behavior; Node's
  // contextified global proxy can turn a host getter exception into undefined.
  const environment = {};
  Object.defineProperty(environment, 'localStorage', { get: getStorage, configurable: true });
  const context = vm.createContext({ globalThis: environment });
  vm.runInContext(source, context);
  return environment.InterviewStorage;
}

test('initialization is lazy and preferences survive a blocked storage getter', () => {
  const blocked = new Error('Storage getter blocked');
  let calls = 0;
  const { preferences, durable } = load(() => { calls += 1; throw blocked; });
  assert.equal(calls, 0);
  assert.equal(preferences.getItem('interview-theme'), null);
  assert.equal(preferences.setItem('interview-theme', 'dark'), false);
  assert.equal(preferences.getItem('interview-theme'), 'dark');
  assert.equal(preferences.removeItem('interview-theme'), false);
  assert.equal(preferences.getItem('interview-theme'), null);
  for (const operation of [
    () => durable.length, () => durable.key(0), () => durable.getItem('draft'),
    () => durable.setItem('draft', 'value'), () => durable.removeItem('draft')
  ]) assert.throws(operation, error => error === blocked);
});

test('a failed preference write wins over stale storage until a successful write', () => {
  const storage = fakeStorage({ 'interview-theme': 'light' });
  const { preferences } = load(() => storage);
  assert.equal(preferences.getItem('interview-theme'), 'light');
  storage.failures.set = new Error('Quota exceeded');
  assert.equal(preferences.setItem('interview-theme', 'dark'), false);
  assert.equal(storage.values.get('interview-theme'), 'light');
  assert.equal(preferences.getItem('interview-theme'), 'dark');
  storage.values.set('interview-theme', 'external-before-retry');
  assert.equal(preferences.getItem('interview-theme'), 'dark');
  delete storage.failures.set;
  assert.equal(preferences.setItem('interview-theme', 'light'), true);
  storage.values.set('interview-theme', 'external-after-retry');
  assert.equal(preferences.getItem('interview-theme'), 'external-after-retry');
});

test('failed removal hides stale stored preferences and successful removal clears its shadow', () => {
  const storage = fakeStorage({ 'interview-answer-view': 'outline' });
  const { preferences } = load(() => storage);
  storage.failures.remove = new Error('Removal blocked');
  assert.equal(preferences.removeItem('interview-answer-view'), false);
  assert.equal(storage.values.get('interview-answer-view'), 'outline');
  assert.equal(preferences.getItem('interview-answer-view'), null);
  delete storage.failures.remove;
  assert.equal(preferences.removeItem('interview-answer-view'), true);
  storage.values.set('interview-answer-view', 'full');
  assert.equal(preferences.getItem('interview-answer-view'), 'full');
});

test('temporary read failures preserve the last successfully read or written preference', () => {
  const storage = fakeStorage({ 'interview-reading-size': 'large' });
  const { preferences } = load(() => storage);
  assert.equal(preferences.getItem('interview-reading-size'), 'large');
  storage.failures.get = new Error('Reads blocked');
  assert.equal(preferences.getItem('interview-reading-size'), 'large');
  assert.equal(preferences.setItem('interview-reading-size', 'small'), true);
  assert.equal(preferences.getItem('interview-reading-size'), 'small');
  assert.equal(preferences.removeItem('interview-reading-size'), true);
  assert.equal(preferences.getItem('interview-reading-size'), null);
});

test('credentials and private answers never fall back to preference memory', () => {
  const tokenKey = 'sb-example-auth-token';
  const storage = fakeStorage({ [tokenKey]: 'old-synthetic-token' });
  let blocked = false;
  const { preferences } = load(() => {
    if (blocked) throw new Error('Storage blocked');
    return storage;
  });
  assert.equal(preferences.getItem(tokenKey), 'old-synthetic-token');
  blocked = true;
  assert.equal(preferences.getItem(tokenKey), null);
  assert.equal(preferences.setItem(tokenKey, 'new-synthetic-token'), false);
  assert.equal(preferences.getItem(tokenKey), null);
  assert.equal(preferences.setItem('interview-own-answers', '{"1":"synthetic answer"}'), false);
  assert.equal(preferences.getItem('interview-own-answers'), null);
  blocked = false;
  assert.equal(preferences.getItem(tokenKey), 'old-synthetic-token');
});

test('durable operations use real storage and propagate method failures unchanged', () => {
  const first = fakeStorage();
  let active = first;
  const { durable } = load(() => active);
  durable.setItem('draft', 'first');
  assert.equal(durable.length, 1);
  assert.equal(durable.key(0), 'draft');
  assert.equal(durable.getItem('draft'), 'first');
  const second = fakeStorage({ draft: 'second' });
  active = second;
  assert.equal(durable.getItem('draft'), 'second');
  for (const [failure, operation] of [
    ['length', () => durable.length], ['key', () => durable.key(0)],
    ['get', () => durable.getItem('draft')], ['set', () => durable.setItem('draft', 'third')],
    ['remove', () => durable.removeItem('draft')]
  ]) {
    const error = new Error('Synthetic ' + failure + ' failure');
    second.failures[failure] = error;
    assert.throws(operation, thrown => thrown === error);
    delete second.failures[failure];
  }
  durable.removeItem('draft');
  assert.equal(durable.length, 0);
});

test('practice progress never reports memory-only fallback as a durable save', () => {
  const { durable } = load(() => { throw new Error('Storage getter blocked'); });
  const store = createPracticeSessionStore({ storage: durable, ownerId: 'synthetic-owner', setId: 1, questionIds: [1] });
  assert.equal(store.load(), null);
  assert.equal(store.save({ ids: [1], index: 0, ratings: {} }), false);
  assert.equal(store.clear(), false);
});
