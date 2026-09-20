import { test, expect } from './fixture.mjs';

test('a failed library request shows an error and can be retried', async ({ page, app }) => {
  app.failNext('interview_sets');
  app.allowWarning('Could not load interview library:');
  await page.goto('/');
  const notice = page.locator('#libraryLoadNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(page.locator('#activeSetTitle')).not.toHaveText('題庫がありません');
  await expect(page.locator('#retryLibraryLoad')).toBeEnabled();
  await page.locator('#retryLibraryLoad').click();
  await expect(page.locator('#q-1 .answer-text')).toContainText('実務での経験と学習した技術');
  await expect(page.locator('.qa-card')).toHaveCount(12);
  await expect(notice).toBeHidden();
});

test('a failed private-content request retains questions and retry restores answers', async ({ page, app }, testInfo) => {
  app.failNext('interview_private_content');
  app.allowWarning('Could not load private interview content:');
  app.allowWarning('Could not load interview library:');
  await page.goto('/');
  await expect(page.locator('#libraryLoadNotice')).toBeVisible();
  await expect(page.locator('.qa-card')).toHaveCount(12);
  await expect(page.locator('#q-1 > summary')).toContainText('練習用の質問 1');
  await expect(page.locator('#q-1 [data-favorite-id]')).toBeDisabled();
  const screenshot = testInfo.outputPath('private-load-error.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('private-load-error', { path: screenshot, contentType: 'image/png' });
  await page.locator('#retryLibraryLoad').click();
  await expect(page.locator('#libraryLoadNotice')).toBeHidden();
  await expect(page.locator('#q-1 [data-favorite-id]')).toBeEnabled();
  await expect(page.locator('#q-1 .answer-text')).toContainText('実務での経験と学習した技術');
});
