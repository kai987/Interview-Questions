import { test, expect } from './fixture.mjs';

test('a guest can request password recovery and retry a sending error', async ({ page, app }) => {
  app.setSession(null);
  await app.open();
  await page.locator('#authButton').click();
  await page.locator('#forgotPasswordButton').click();
  await expect(page.locator('#authMessage')).toContainText('正しいメールアドレス');
  expect(await page.evaluate(() => window.__qa.authCalls)).toEqual([]);
  await page.locator('#authEmail').fill('fixture@example.test');
  await page.evaluate(() => { window.__qa.authError = 'Synthetic SMTP failure'; });
  await page.locator('#forgotPasswordButton').click();
  await expect(page.locator('#authMessage')).toContainText('Synthetic SMTP failure');
  await expect(page.locator('#forgotPasswordButton')).toBeEnabled();
  await page.evaluate(() => { window.__qa.authError = null; });
  await page.locator('#forgotPasswordButton').click();
  await expect(page.locator('#authMessage')).toContainText('再設定メールが届きます');
  expect(await page.evaluate(() => window.__qa.authCalls.at(-1))).toEqual({
    method: 'resetPasswordForEmail', email: 'fixture@example.test',
    options: { redirectTo: page.url() }
  });
});

test('cold-start recovery shows the reset form and keeps it usable after a server error', async ({ page, app }) => {
  app.setInitialAuthEvent('PASSWORD_RECOVERY');
  await app.open();
  await expect(page.locator('#authDialog')).toBeVisible();
  await expect(page.locator('#authDialogTitle')).toHaveText('パスワードの再設定');
  await expect(page.locator('#passwordLoginButton')).toBeHidden();
  await page.locator('#newAuthPassword').fill('fixture-password');
  await page.locator('#confirmAuthPassword').fill('different-password');
  await page.locator('#updatePasswordButton').click();
  await expect(page.locator('#authMessage')).toContainText('一致しません');
  expect(await page.evaluate(() => window.__qa.authCalls)).toEqual([]);
  await page.locator('#confirmAuthPassword').fill('fixture-password');
  await page.evaluate(() => { window.__qa.authError = 'Synthetic update failure'; });
  await page.locator('#updatePasswordButton').click();
  await expect(page.locator('#authMessage')).toContainText('Synthetic update failure');
  await expect(page.locator('#updatePasswordButton')).toBeEnabled();
  await page.evaluate(() => { window.__qa.authError = null; });
  await page.locator('#updatePasswordButton').click();
  await expect(page.locator('#authDialog')).not.toBeVisible();
  await expect(page.locator('#authButton')).toHaveText('ログイン中');
});

test('a recovery event from a guest page opens the reset form without reloading it', async ({ page, app }) => {
  app.setSession(null);
  await app.open();
  await page.evaluate(() => { window.__qa.sameDocument = 'retained'; });
  await app.emitAuth(page, 'PASSWORD_RECOVERY', 'e2e-synthetic-user');
  await expect(page.locator('#authDialogTitle')).toHaveText('パスワードの再設定');
  await expect(page.locator('#updatePasswordButton')).toBeVisible();
  expect(await page.evaluate(() => window.__qa.sameDocument)).toBe('retained');
});

test('ordinary signed-in sessions never offer the recovery password editor', async ({ page, app }) => {
  await app.open();
  await page.locator('#authButton').click();
  await expect(page.locator('#passwordRecoveryFields')).toBeHidden();
  await expect(page.locator('#updatePasswordButton')).toBeHidden();
  await expect(page.locator('#forgotPasswordButton')).toBeHidden();
});
