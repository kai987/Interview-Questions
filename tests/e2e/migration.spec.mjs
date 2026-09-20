import { test, expect } from './fixture.mjs';

async function seedLegacyDraft(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('e2e-legacy-seeded')) return;
    localStorage.setItem('interview-own-answers', JSON.stringify({ 1: '旧端末に保存した回答草稿' }));
    localStorage.setItem('e2e-legacy-seeded', 'true');
  });
}

test('a failed legacy migration survives another saved question and a reload', async ({ page, app }) => {
  await seedLegacyDraft(page);
  app.failQuestionSave(1);
  await app.open();
  const draft = page.locator('[data-own-answer-id="1"]');
  const banner = page.locator('.sync-banner');
  await expect(draft).toHaveValue('旧端末に保存した回答草稿');
  await expect(banner).toHaveAttribute('data-state', 'error');
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(true);

  await page.locator('#q-2 [data-favorite-id]').click();
  await expect.poll(() => page.evaluate(() => window.InterviewPrivateStore.getSyncStatus(2))).toBe('synced');
  await page.reload();
  await expect(draft).toHaveValue('旧端末に保存した回答草稿');
  await expect(page.locator('#q-2 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
  await expect(banner).toHaveAttribute('data-state', 'error');

  app.failQuestionSave(1, false);
  await banner.getByRole('button').click();
  await expect(banner).toHaveAttribute('data-state', 'synced');
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(false);
  await page.reload();
  await expect(draft).toHaveValue('旧端末に保存した回答草稿');
  await expect(page.locator('#q-2 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
});

test('a queued legacy draft cannot overwrite a newer cloud answer but explicit edits still save', async ({ page, app }) => {
  await seedLegacyDraft(page);
  app.failQuestionSave(1);
  await app.open();
  const banner = page.locator('.sync-banner');
  await expect(banner).toHaveAttribute('data-state', 'error');
  // Represents another device saving after this tab's initial cloud read.
  app.setRemoteState({ question_id: 1, own_answer: '別の端末から保存した新しい回答', favorite: false });
  await page.locator('#q-1 [data-favorite-id]').click();
  await expect(banner).toHaveAttribute('data-state', 'error');

  app.failQuestionSave(1, false);
  await banner.getByRole('button').click();
  await expect(banner).toHaveAttribute('data-state', 'synced');
  await page.reload();
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('別の端末から保存した新しい回答');
  await expect(page.locator('#q-1 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(false);
});
