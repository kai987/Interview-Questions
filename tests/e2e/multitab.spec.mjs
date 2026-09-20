import { test, expect } from './fixture.mjs';

test('two tabs retain edits to different questions and different fields of one question', async ({ page, context, app }) => {
  await app.open();
  expect(await page.evaluate(() => typeof navigator.locks?.request)).toBe('function');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.sync-banner')).toBeAttached();
  await expect(other.locator('.qa-card')).toHaveCount(12);

  app.setSaveFailure(true);
  await page.locator('#q-1 [data-favorite-id]').click();
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
  await other.locator('#q-1 [data-practiced-id]').click();
  await expect(other.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
  await page.locator('#q-8 [data-favorite-id]').click();
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');

  // Concurrent retries use the real browser Web Locks implementation.
  app.setSaveFailure(false);
  await Promise.all([
    page.evaluate(() => window.InterviewPrivateStore.retry()),
    other.evaluate(() => window.InterviewPrivateStore.retry())
  ]);
  for (const tab of [page, other]) {
    await tab.reload();
    await expect(tab.locator('.sync-banner')).toBeAttached();
    await expect(tab.locator('#q-1 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tab.locator('#q-1 [data-practiced-id]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tab.locator('#q-8 [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
    expect(await tab.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(false);
  }
  await other.close();
});

test('one tab dismisses its error after another tab successfully syncs the pending edit', async ({ page, context, app }) => {
  await page.clock.install();
  await app.open();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.sync-banner')).toBeAttached();
  app.setSaveFailure(true);
  await page.locator('#q-1 [data-favorite-id]').click();
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
  await expect(other.locator('.sync-banner')).toBeVisible();
  app.setSaveFailure(false);
  await other.locator('.sync-banner').getByRole('button').click();
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'synced');
  await page.clock.fastForward(2600);
  await expect(page.locator('.sync-banner')).toBeHidden();
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(false);
  await other.close();
});
