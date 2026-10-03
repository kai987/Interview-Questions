import { test, expect } from './fixture.mjs';

test('signing in from another tab unlocks the existing guest page', async ({ page, app }) => {
  app.setSession(null);
  await page.goto('/');
  await expect(page.locator('#q-1 .private-answer-locked')).toBeAttached();
  await app.emitAuth(page, 'SIGNED_IN', 'e2e-synthetic-user');
  await expect(page.locator('#q-1 .answer-text')).toContainText('実務での経験');
  expect(await page.evaluate(() => window.InterviewPrivateStore.isReady())).toBe(true);
  await page.locator('#q-1 [data-favorite-id]').click();
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'synced');
});

test('repeated same-account auth events leave the current practice page mounted', async ({ page, app }) => {
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('[data-timer-id="1"]').click();
  await page.evaluate(() => { window.__qa.sameDocument = 'retained'; });
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
    await app.emitAuth(page, event, 'e2e-synthetic-user');
  }
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__qa.sameDocument)).toBe('retained');
  await expect(page.locator('#q-1')).toHaveAttribute('open', '');
  await expect(page.locator('[data-timer-id="1"]')).toContainText('停止');
});

test('changing account replaces private content and keeps the old owner pending draft isolated', async ({ page, app }) => {
  app.setPrivateContent(1, { user_id: 'second-user', answer: '第二ユーザー専用の回答例' });
  await app.open();
  app.setSaveFailure(true);
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 .own-answer-editor > summary').click();
  await page.locator('[data-own-answer-id="1"]').fill('最初のユーザーの未同期草稿');
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
  await app.emitAuth(page, 'SIGNED_IN', 'second-user');
  await expect(page.locator('#q-1 .answer-text')).toHaveText('第二ユーザー専用の回答例');
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('');
  expect(await page.evaluate(() => window.InterviewPrivateStore.getOwnerId())).toBe('second-user');
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('interview-pending-state:e2e-synthetic-user:')))).toBe(true);
  await app.emitAuth(page, 'SIGNED_IN', 'e2e-synthetic-user');
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('最初のユーザーの未同期草稿');
});
