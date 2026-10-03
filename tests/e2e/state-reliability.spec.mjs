import { test, expect } from './fixture.mjs';

for (const failure of ['ui-cache', 'all-storage']) {
  test(`the latest typed answer survives ${failure} write failures`, async ({ page, app }) => {
    app.setRemoteState({ question_id: 1, own_answer: '以前の回答' });
    await app.open();
    await page.locator('#q-1 > summary').click();
    const input = page.locator('[data-own-answer-id="1"]');
    await expect(input).toHaveValue('以前の回答');
    await page.evaluate(mode => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (mode === 'all-storage' || key === 'interview-own-answers') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }, failure);
    app.setSaveFailure(true);
    await input.fill('今入力した最新の回答');
    await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', failure === 'all-storage' ? 'local-error' : 'error');
    await expect(input).toHaveValue('今入力した最新の回答');
    app.setSaveFailure(false);
    await page.evaluate(() => window.InterviewPrivateStore.retry());
    await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'synced');
    const writes = await page.evaluate(() => window.__qa.writes.filter(write => Object.hasOwn(write.rows, 'own_answer')));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(write => write.rows.own_answer === '今入力した最新の回答')).toBe(true);
    await page.reload();
    await expect(input).toHaveValue('今入力した最新の回答');
  });
}

test('opening and editing company A retains legacy company B drafts until B is opened', async ({ page, app }) => {
  app.addSet({ id: 2, slug: 'second-fixture', company: '第二企業', position: '面接練習' },
    [{ id: 101, category: '基本質問', question: '第二企業への志望理由', sort_order: 1 }],
    [{ question_id: 101, answer: '第二企業の回答例' }]);
  await page.addInitScript(() => {
    if (localStorage.getItem('e2e-cross-set-seeded')) return;
    localStorage.setItem('interview-own-answers', JSON.stringify({ 1: 'Aの旧草稿', 101: 'Bの未移行草稿' }));
    localStorage.setItem('interview-favorites', '[101]');
    localStorage.setItem('e2e-cross-set-seeded', 'true');
  });
  await app.open();
  await expect(page.locator('#favoriteCount')).toHaveText('0');
  await page.locator('#q-1 > summary').click();
  await page.locator('[data-own-answer-id="1"]').fill('Aの更新した草稿');
  await page.locator('#q-1 [data-favorite-id]').click();
  await page.evaluate(() => window.InterviewPrivateStore.retry());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('interview-own-answers'))[101])).toBe('Bの未移行草稿');
  await page.locator('#interviewSetSelect').selectOption('2');
  await expect(page.locator('.qa-card')).toHaveCount(1);
  await expect(page.locator('[data-own-answer-id="101"]')).toHaveValue('Bの未移行草稿');
  await expect(page.locator('#q-101 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.InterviewPrivateStore.retry());
  await page.reload();
  await expect(page.locator('[data-own-answer-id="101"]')).toHaveValue('Bの未移行草稿');
});

for (const source of ['favorites', 'remaining']) {
  test(`random ${source} selection uses the current state after UI cache writes fail`, async ({ page, app }) => {
    if (source === 'remaining') {
      for (let id = 2; id <= 12; id += 1) app.setRemoteState({ question_id: id, practiced: true });
    }
    await app.open();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (['interview-favorites', 'interview-practiced'].includes(key)) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    const field = source === 'favorites' ? 'favorite' : 'practiced';
    await page.locator(`#q-1 [data-${field}-id]`).click();
    await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'synced');
    await page.locator('#randomSource').selectOption(source);
    await page.locator('#randomPracticeButton').click();
    if (source === 'favorites') {
      await expect(page.locator('.qa-card:visible')).toHaveCount(1);
      await expect(page.locator('.qa-card:visible')).toHaveAttribute('id', 'q-1');
      await expect(page.locator('.practice-session:not(.practice-resume)')).toContainText('1 / 1問');
    } else {
      await expect(page.locator('#toast')).toContainText('対象になる未練習問題がありません');
      await expect(page.locator('.practice-session:not(.practice-resume)')).toBeHidden();
    }
  });
}
