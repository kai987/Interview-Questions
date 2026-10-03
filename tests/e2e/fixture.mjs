import { createHash } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

const answer = '実務での経験と学習した技術について説明します。\n具体例を整理して、結論から分かりやすく伝えます。';
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Deterministic silent audio; no private recordings or live account are used.
export function makeAudioFixture(seconds = 20) {
  const audio = Buffer.alloc(44 + 24000 * 2 * seconds);
  audio.write('RIFF');
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(24000, 24);
  audio.writeUInt32LE(48000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  return audio;
}
const audio = makeAudioFixture();

const questions = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  set_id: 1,
  is_active: true,
  question: `練習用の質問 ${index + 1} について説明してください。`,
  category: index === 1 ? '技術質問' : '基本質問',
  sort_order: index + 1
}));

const tables = {
  interview_sets: [{ id: 1, slug: 'e2e-fixture', company: 'テスト企業', position: '面接練習', is_public: true, is_archived: false }],
  interview_questions: questions,
  interview_private_content: questions.map(question => ({
    question_id: question.id,
    user_id: 'e2e-synthetic-user',
    answer,
    answer_variants: { short: '結論を簡潔に説明します。' },
    duration_seconds: 21,
    audio_text_hash: `legacy:${sha256(`${question.question}\n${answer}`)}:${sha256(audio)}`
  })),
  interview_user_state: []
};

const sdk = `
export function createClient() {
  return {
    auth: {
      getSession: async () => fetch('/__e2e__/session').then(response => response.json()),
      onAuthStateChange(callback) {
        window.__qa.authListeners.push(callback);
        return { data: { subscription: { unsubscribe() {
          window.__qa.authListeners = window.__qa.authListeners.filter(listener => listener !== callback);
        } } } };
      },
      signOut: async () => ({ error: null })
    },
    from(table) {
      const filters = [];
      const orders = [];
      return {
        select() { return this; },
        order(field, options = {}) { orders.push({ field, ascending: options.ascending !== false }); return this; },
        eq(field, value) { filters.push({ field, value }); return this; },
        upsert: async (rows, options = {}) => {
          window.__qa.writes.push({ rows, options });
          if (window.__qa.saveError) return { error: { message: 'Synthetic save failure' } };
          return fetch('/__e2e__/state', { method: 'POST', body: JSON.stringify({ rows, options }) }).then(response => response.json());
        },
        then(resolve, reject) {
          const query = new URLSearchParams({ filters: JSON.stringify(filters), orders: JSON.stringify(orders) });
          return fetch('/__e2e__/table/' + table + '?' + query).then(response => response.json()).then(resolve, reject);
        }
      };
    }
  };
}`;

export const test = base.extend({
  app: async ({ page, context, baseURL }, use) => {
    const errors = [];
    const unexpectedRequests = [];
    const allowedWarnings = new Set();
    const failures = new Map();
    const remoteState = new Map();
    const failedQuestionIds = new Set();
    const rowKey = (userId, questionId) => `${userId}:${questionId}`;
    const privateContent = new Map(tables.interview_private_content.map(row => [rowKey(row.user_id, row.question_id), structuredClone(row)]));
    const sets = structuredClone(tables.interview_sets);
    const questionRows = structuredClone(questions);
    let sessionUserId = 'e2e-synthetic-user';
    const audioFiles = new Map();
    const audioPaths = [];
    let rejectLocalAudio = false;
    let saveFailure = false;
    let audioRequests = 0;
    function watch(tab) {
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('console', message => {
        if (!['error', 'warning'].includes(message.type())) return;
        if ([...allowedWarnings].some(prefix => message.text().startsWith(prefix))) return;
        const url = message.location().url;
        errors.push(url ? `${message.text()} (${url})` : message.text());
      });
    }
    watch(page);
    context.on('page', watch);
    await context.addInitScript(() => {
      window.__qa = { writes: [], saveError: false, audio: [], authListeners: [] };
      const OriginalAudio = window.Audio;
      window.Audio = function (...args) {
        const element = new OriginalAudio(...args);
        element.volume = 0;
        if (args.length) window.__qa.audio.push(element);
        return element;
      };
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/supabase-js@')) {
        return route.fulfill({ contentType: 'application/javascript', body: sdk });
      }
      if (url.hostname === 'flpmblfscgcbrprwwckz.supabase.co'
        && url.pathname.startsWith('/storage/v1/object/authenticated/interview-audio/e2e-synthetic-user/e2e-fixture/')) {
        audioRequests += 1;
        audioPaths.push(url.pathname);
        return route.fulfill({ contentType: 'audio/wav', body: audioFiles.get(url.pathname.split('/').at(-1)) || audio });
      }
      if (url.origin !== baseURL) {
        unexpectedRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      if (route.request().resourceType() === 'document') {
        // The fixture server is HTTP. WebKit upgrades even loopback subresources
        // under this production-only directive; keep the rest of the CSP intact.
        const response = await route.fetch();
        const body = (await response.text()).replace('; upgrade-insecure-requests', '');
        return route.fulfill({ response, body });
      }
      if (url.pathname === '/__e2e__/session') {
        return route.fulfill({ json: { data: { session: sessionUserId ? { user: { id: sessionUserId } } : null }, error: null } });
      }
      if (url.pathname.startsWith('/__e2e__/table/')) {
        const table = url.pathname.split('/').at(-1);
        const remaining = failures.get(table) || 0;
        if (remaining) failures.set(table, remaining - 1);
        let rows = table === 'interview_user_state' ? [...remoteState.values()].filter(row => row.user_id === sessionUserId)
          : table === 'interview_private_content' ? [...privateContent.values()].filter(row => row.user_id === sessionUserId)
          : table === 'interview_sets' ? sets : table === 'interview_questions' ? questionRows : [];
        for (const { field, value } of JSON.parse(url.searchParams.get('filters') || '[]')) {
          rows = rows.filter(row => row[field] === value);
        }
        const orders = JSON.parse(url.searchParams.get('orders') || '[]');
        rows = [...rows].sort((left, right) => {
          for (const { field, ascending } of orders) {
            if (left[field] === right[field]) continue;
            return (left[field] < right[field] ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        return route.fulfill({
          json: remaining
            ? { data: null, error: { message: `Synthetic ${table} failure` } }
            : { data: rows, error: null }
        });
      }
      if (url.pathname === '/__e2e__/state') {
        const { rows: data, options } = route.request().postDataJSON();
        const rows = Array.isArray(data) ? data : [data];
        if (saveFailure || rows.some(row => failedQuestionIds.has(row.question_id))) {
          return route.fulfill({ json: { error: { message: 'Synthetic save failure' } } });
        }
        for (const row of rows) {
          const key = rowKey(row.user_id || sessionUserId, row.question_id);
          if (options.ignoreDuplicates && remoteState.has(key)) continue;
          remoteState.set(key, { ...remoteState.get(key), user_id: sessionUserId, ...row });
        }
        return route.fulfill({ json: { error: null } });
      }
      if (url.pathname.includes('/local-audio/')) {
        audioRequests += 1;
        audioPaths.push(url.pathname);
        return route.fulfill({ contentType: 'audio/wav', body: rejectLocalAudio ? Buffer.from('invalid local file')
          : audioFiles.get(url.pathname.split('/').at(-1)) || audio });
      }
      return route.continue();
    });
    await use({
      async open({ questionCount = 12, firstQuestionId = 1, title = 'テスト企業｜面接練習｜Interview Questions' } = {}) {
        await page.goto('/');
        await expect(page.locator(`#q-${firstQuestionId} .training-workbench`)).toBeAttached();
        await expect(page.locator('.sync-banner')).toBeAttached();
        await expect(page).toHaveTitle(title);
        await expect(page.locator('.qa-card')).toHaveCount(questionCount);
      },
      setSession(userId) { sessionUserId = userId; },
      async emitAuth(tab, event, userId) {
        sessionUserId = userId;
        await tab.evaluate(async ({ event, userId }) => {
          const session = userId ? { user: { id: userId } } : null;
          await Promise.all(window.__qa.authListeners.map(callback => callback(event, session)));
        }, { event, userId });
      },
      addSet(set, rows, privateRows = []) {
        sets.push({ is_public: true, is_archived: false, ...structuredClone(set) });
        questionRows.push(...rows.map(row => ({ is_active: true, set_id: set.id, ...structuredClone(row) })));
        for (const row of privateRows) {
          const value = { user_id: sessionUserId, ...structuredClone(row) };
          privateContent.set(rowKey(value.user_id, value.question_id), value);
        }
      },
      failNext(table, count = 1) { failures.set(table, count); },
      setSaveFailure(value) { saveFailure = value; },
      failQuestionSave(id, value = true) { value ? failedQuestionIds.add(id) : failedQuestionIds.delete(id); },
      setRemoteState(row) { const value = { user_id: sessionUserId, ...structuredClone(row) }; remoteState.set(rowKey(value.user_id, value.question_id), value); },
      getPrivateContent(id) { return structuredClone(privateContent.get(rowKey(sessionUserId, id))); },
      setPrivateContent(id, patch) { const key = rowKey(patch.user_id || sessionUserId, id); privateContent.set(key, { question_id: id, user_id: sessionUserId, ...privateContent.get(key), ...structuredClone(patch) }); },
      getQuestion(id) { return structuredClone(questionRows.find(question => question.id === id)); },
      setAudioFile(filename, bytes) { audioFiles.set(filename, bytes); },
      rejectLocalAudio(value = true) { rejectLocalAudio = value; },
      get audioPaths() { return [...audioPaths]; },
      allowWarning(prefix) { allowedWarnings.add(prefix); },
      get audioRequests() { return audioRequests; }
    });
    expect(unexpectedRequests, 'All tests must stay isolated from live services').toEqual([]);
    expect(errors, 'No unaccounted browser errors or warnings').toEqual([]);
  }
});

export { expect };
