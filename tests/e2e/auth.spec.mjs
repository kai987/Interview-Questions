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


test('invalid credentials show actionable Japanese feedback above recovery actions', async ({ page, app }) => {
  app.setSession(null);
  await app.open();
  await page.locator('#authButton').click();
  await page.locator('#authEmail').fill('fixture@example.test');
  await page.locator('#authPassword').fill('fixture-password');
  await page.evaluate(() => {
    window.__qa.authError = { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' };
  });
  await page.locator('#passwordLoginButton').click();
  const notice = page.locator('#authMessage');
  await expect(notice).toHaveAttribute('data-type', 'error');
  await expect(notice).toContainText('ログインできませんでした');
  await expect(notice).toContainText('ブラウザーに保存された古いパスワード');
  await expect(notice).toContainText('Magic Linkを送信');
  await expect(notice).toContainText('パスワードを忘れた方');
  await expect(notice).not.toContainText('Invalid login credentials');
  await expect(page.locator('#authPassword')).toHaveValue('fixture-password');
  await expect(page.locator('#passwordLoginButton')).toBeEnabled();
  await expect(page.locator('#magicLinkButton')).toBeEnabled();
  await expect(page.locator('#forgotPasswordButton')).toBeEnabled();
  expect(await page.evaluate(() => {
    const notice = document.getElementById('authMessage');
    const button = document.getElementById('magicLinkButton');
    const dialog = document.getElementById('authDialog');
    return notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING && dialog.scrollWidth <= dialog.clientWidth + 1;
  })).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(notice).toBeVisible();
  await page.locator('#authPassword').fill('another-fixture-password');
  await expect(notice).toBeEmpty();
  expect(await page.evaluate(() => window.__qa.authCalls.length)).toBe(1);
});

test('network exceptions and email rate limits recover buttons and never register a new user', async ({ page, app }) => {
  app.setSession(null);
  await app.open();
  await page.locator('#authButton').click();
  await page.locator('#authEmail').fill('fixture@example.test');
  await page.locator('#authPassword').fill('fixture-password');
  await page.evaluate(() => { window.__qa.authThrow = true; });
  await page.locator('#passwordLoginButton').click();
  await expect(page.locator('#authMessage')).toContainText('接続できませんでした');
  await expect(page.locator('#passwordLoginButton')).toBeEnabled();
  await page.evaluate(() => {
    window.__qa.authThrow = false;
    window.__qa.authError = { code: 'over_email_send_rate_limit', status: 429, message: 'raw provider error' };
  });
  await page.locator('#magicLinkButton').click();
  await expect(page.locator('#authMessage')).toContainText('メールの送信回数が上限に達しました');
  await expect(page.locator('#magicLinkButton')).toBeEnabled();
  await page.evaluate(() => { window.__qa.authError = null; window.__qa.authDelay = 300; });
  await page.locator('#magicLinkButton').click();
  await expect(page.locator('#forgotPasswordButton')).toBeDisabled();
  await expect(page.locator('#authMessage')).toContainText('ログインリンクが届きます');
  await expect(page.locator('#authMessage')).toContainText('迷惑メールフォルダ');
  await expect(page.locator('#forgotPasswordButton')).toBeEnabled();
  expect(await page.evaluate(() => window.__qa.authCalls.at(-1))).toEqual({
    method: 'signInWithOtp', email: 'fixture@example.test',
    options: { shouldCreateUser: false, emailRedirectTo: page.url() }
  });
});
