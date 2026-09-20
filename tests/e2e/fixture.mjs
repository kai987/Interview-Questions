import { createHash } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

const answer = '実務での経験と学習した技術について説明します。\n具体例を整理して、結論から分かりやすく伝えます。';
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Deterministic silent audio; no private recordings or live account are used.
const audio = Buffer.alloc(44 + 24000 * 2 * 20);
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

const questions = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  question: `練習用の質問 ${index + 1} について説明してください。`,
  category: index === 1 ? '技術質問' : '基本質問',
  sort_order: index + 1
}));

const tables = {
  interview_sets: [{ id: 1, slug: 'e2e-fixture', company: 'テスト企業', position: '面接練習', is_public: true }],
  interview_questions: questions,
  interview_private_content: questions.map(question => ({
    question_id: question.id,
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
      getSession: async () => ({ data: { session: { user: { id: 'e2e-synthetic-user' } } }, error: null }),
      onAuthStateChange() {},
      signOut: async () => ({ error: null })
    },
    from(table) {
      return {
        select() { return this; }, order() { return this; }, eq() { return this; },
        upsert: async (rows, options = {}) => {
          window.__qa.writes.push({ rows, options });
          if (window.__qa.saveError) return { error: { message: 'Synthetic save failure' } };
          return fetch('/__e2e__/state', { method: 'POST', body: JSON.stringify({ rows, options }) }).then(response => response.json());
        },
        then(resolve, reject) {
          return fetch('/__e2e__/table/' + table).then(response => response.json()).then(resolve, reject);
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
    let saveFailure = false;
    let audioRequests = 0;
    function watch(tab) {
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('console', message => {
        if (!['error', 'warning'].includes(message.type())) return;
        if ([...allowedWarnings].some(prefix => message.text().startsWith(prefix))) return;
        errors.push(message.text());
      });
    }
    watch(page);
    context.on('page', watch);
    await context.addInitScript(() => {
      window.__qa = { writes: [], saveError: false, audio: [] };
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
      if (url.origin !== baseURL) {
        unexpectedRequests.push(url.origin + url.pathname);
        return route.abort();
      }
      if (url.pathname.startsWith('/__e2e__/table/')) {
        const table = url.pathname.split('/').at(-1);
        const remaining = failures.get(table) || 0;
        if (remaining) failures.set(table, remaining - 1);
        return route.fulfill({
          json: remaining
            ? { data: null, error: { message: `Synthetic ${table} failure` } }
            : { data: table === 'interview_user_state' ? [...remoteState.values()] : tables[table] || [], error: null }
        });
      }
      if (url.pathname === '/__e2e__/state') {
        const { rows: data, options } = route.request().postDataJSON();
        const rows = Array.isArray(data) ? data : [data];
        if (saveFailure || rows.some(row => failedQuestionIds.has(row.question_id))) {
          return route.fulfill({ json: { error: { message: 'Synthetic save failure' } } });
        }
        for (const row of rows) {
          if (options.ignoreDuplicates && remoteState.has(row.question_id)) continue;
          remoteState.set(row.question_id, { ...remoteState.get(row.question_id), ...row });
        }
        return route.fulfill({ json: { error: null } });
      }
      if (url.pathname.includes('/local-audio/')) {
        audioRequests += 1;
        return route.fulfill({ contentType: 'audio/wav', body: audio });
      }
      return route.continue();
    });
    await use({
      async open() {
        await page.goto('/');
        await expect(page.locator('#q-1 .training-workbench')).toBeAttached();
        await expect(page.locator('.sync-banner')).toBeAttached();
        await expect(page).toHaveTitle('テスト企業｜面接練習｜Interview Questions');
        await expect(page.locator('.qa-card')).toHaveCount(12);
      },
      failNext(table, count = 1) { failures.set(table, count); },
      setSaveFailure(value) { saveFailure = value; },
      failQuestionSave(id, value = true) { value ? failedQuestionIds.add(id) : failedQuestionIds.delete(id); },
      setRemoteState(row) { remoteState.set(row.question_id, structuredClone(row)); },
      allowWarning(prefix) { allowedWarnings.add(prefix); },
      get audioRequests() { return audioRequests; }
    });
    expect(unexpectedRequests, 'All tests must stay isolated from live services').toEqual([]);
    expect(errors, 'No unaccounted browser errors or warnings').toEqual([]);
  }
});

export { expect };
