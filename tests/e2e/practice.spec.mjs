import { test, expect } from './fixture.mjs';

for (const state of ['favorite', 'practiced']) {
  test(`${state} toggles preserve expanded cards and scroll position`, async ({ page, app }) => {
    await app.open();
    await page.locator('#q-1 > summary').click();
    await page.locator('#q-8 > summary').click();
    const card = page.locator('#q-8');
    const original = await card.elementHandle();
    const originalAudio = await card.locator('.audio-seek').elementHandle();
    const button = card.locator(`[data-${state}-id]`);
    await button.scrollIntoViewIfNeeded();
    // Wait for smooth scrolling/scroll-driven navigation to settle before measuring.
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(100);
    for (const pressed of ['true', 'false']) {
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', pressed);
      await expect(card).toHaveAttribute('open', '');
      await expect(page.locator('#q-1')).toHaveAttribute('open', '');
      expect(await card.evaluate((node, first) => node === first, original)).toBe(true);
      expect(await card.locator('.audio-seek').evaluate((node, first) => node === first, originalAudio)).toBe(true);
      if (state === 'practiced') {
        await expect(page.locator('#practicedCount')).toHaveText(pressed === 'true' ? '1' : '0');
        await expect(button).toContainText(pressed === 'true' ? '練習済み' : '未練習');
      }
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
    }
    await original.dispose();
    await originalAudio.dispose();
  });
}

test('idle timers do not mutate repeatedly and completion stays at zero', async ({ page, app }) => {
  await page.clock.install();
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__qa.timerMutations = 0;
    window.__qa.timerObserver = new MutationObserver(records => {
      window.__qa.timerMutations += records.length;
    });
    document.querySelectorAll('[data-timer-display]').forEach(display => {
      window.__qa.timerObserver.observe(display, { childList: true, characterData: true, subtree: true });
    });
  });
  await page.clock.runFor(250);
  expect(await page.evaluate(() => window.__qa.timerMutations)).toBe(0);
  await page.locator('[data-timer-seconds="30"]').click();
  await page.locator('[data-timer-id="1"]').click();
  await expect(page.locator('[data-timer-display="1"]')).toHaveText('00:30');
  await page.clock.runFor(31000);
  await expect(page.locator('[data-timer-display="1"]')).toHaveText('00:00');
  await expect(page.locator('[data-timer-id="1"]')).toContainText('もう一度');
  await page.locator('#q-1 [data-favorite-id]').click();
  await page.clock.runFor(1000);
  await expect(page.locator('[data-timer-display="1"]')).toHaveText('00:00');
  await page.locator('#searchInput').fill('質問 2 ');
  await expect(page.locator('#q-1')).toHaveCount(0);
  await page.locator('#searchInput').fill('');
  await expect(page.locator('[data-timer-display="1"]')).toHaveText('00:00');
  await page.locator('#searchInput').press('Escape');
  await page.locator('#q-1 > summary').click();
  await page.locator('[data-timer-id="1"]').click();
  await expect(page.locator('[data-timer-display="1"]')).toHaveText('00:30');
});

test('sync success disappears after 2.5 seconds while errors remain retryable', async ({ page, app }) => {
  await page.clock.install();
  await app.open();
  const banner = page.locator('.sync-banner');
  const favorite = page.locator('#q-1 [data-favorite-id]');
  await expect(banner).toBeHidden();
  await favorite.click();
  await expect(banner).toHaveAttribute('data-state', 'synced');
  await expect(banner).toBeVisible();
  const y = await page.evaluate(() => scrollY);
  await page.clock.fastForward(2400);
  await expect(banner).toBeVisible();
  await page.clock.fastForward(150);
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(y);
  await page.locator('#q-1 > summary').click();
  await expect(banner).toBeHidden();
  app.allowWarning('Could not save interview state:');
  await page.evaluate(() => { window.__qa.saveError = true; });
  await favorite.click();
  await expect(banner).toHaveAttribute('data-state', 'error');
  await page.clock.fastForward(4000);
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button')).toBeVisible();
  await page.evaluate(() => { window.__qa.saveError = false; });
  await banner.getByRole('button').click();
  await expect(banner).toHaveAttribute('data-state', 'synced');
  await page.clock.fastForward(2600);
  await expect(banner).toBeHidden();
});
