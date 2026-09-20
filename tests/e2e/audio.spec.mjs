import { test, expect } from './fixture.mjs';

test('audio controls keep duration, pause position, seeking and section colors', async ({ page, app }, testInfo) => {
  await app.open();
  await page.locator('#q-1 > summary').click();
  const button = page.locator('#q-1 [data-speech-id]');
  const progress = page.locator('#q-1 .audio-source-note');
  const slider = page.locator('#q-1 .audio-seek');
  await expect(slider).toBeVisible();
  await expect(progress).toHaveText('00:00 / 00:21');
  expect(app.audioRequests).toBe(0);
  await slider.fill('6');
  await expect(progress).toHaveText('00:06 / 00:21');
  await button.click();
  await expect(button).toHaveText('停止');
  await expect.poll(() => page.evaluate(() => window.__qa.audio[0].currentTime)).toBeGreaterThan(6.1);
  await button.click();
  await expect(button).toHaveText('再開');
  const pausedAt = await page.evaluate(() => window.__qa.audio[0].currentTime);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__qa.audio[0].currentTime)).toBe(pausedAt);
  expect(await page.evaluate(() => window.__qa.audio[0].paused)).toBe(true);
  await expect(progress).toHaveText(`00:${String(Math.floor(pausedAt)).padStart(2, '0')} / 00:20`);

  // Exercise the native range hit area over the independently painted visuals.
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.__qa.audio[0].currentTime);
  expect(dragged).toBeGreaterThan(10);
  expect(dragged).toBeLessThan(14);
  expect(await page.evaluate(() => window.__qa.audio[0].paused)).toBe(true);
  await slider.focus();
  await slider.press('Home');
  await slider.press('ArrowRight');
  expect(await page.evaluate(() => window.__qa.audio[0].currentTime)).toBeCloseTo(0.1, 2);

  await slider.fill('8');
  await slider.blur();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const colors = await slider.evaluate(input => {
      const control = input.closest('.audio-seek-control');
      const track = control.querySelector('.audio-seek-track');
      return {
        label: getComputedStyle(input.closest('.qa-card').querySelector('.answer-label')).color,
        control: getComputedStyle(control).color,
        background: getComputedStyle(control).backgroundColor,
        fill: getComputedStyle(track).backgroundImage,
        thumb: getComputedStyle(track, '::after').backgroundColor,
        progress: control.style.getPropertyValue('--audio-progress')
      };
    });
    expect(colors.control).toBe(colors.label);
    expect(colors.thumb).toBe(colors.label);
    expect(colors.fill).toContain(`${colors.label} 0px, ${colors.label} 40%`);
    expect(colors.background).toBe('rgba(0, 0, 0, 0)');
    expect(colors.progress).toBe('40%');
    const screenshot = testInfo.outputPath(`audio-${theme}.png`);
    await page.locator('#q-1 .qa-toolbar').screenshot({ path: screenshot });
    await testInfo.attach(`audio-${theme}`, { path: screenshot, contentType: 'image/png' });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await button.click();
  await expect(button).toHaveText('停止');
  await expect.poll(() => page.evaluate(() => window.__qa.audio[0].currentTime)).toBeGreaterThan(8.2);
  expect(await page.evaluate(() => window.__qa.audio.length)).toBe(1);
  await slider.fill('12');
  await expect.poll(() => page.evaluate(() => window.__qa.audio[0].currentTime)).toBeGreaterThan(12.1);
  await button.click();
  await expect(button).toHaveText('再開');

  // Different question sections must keep their own answer-label color.
  await page.locator('#q-2 > summary').click();
  const secondColor = await page.locator('#q-2 .audio-seek-control').evaluate(control => ({
    control: getComputedStyle(control).color,
    label: getComputedStyle(control.closest('.qa-card').querySelector('.answer-label')).color
  }));
  expect(secondColor.control).toBe(secondColor.label);
  expect(secondColor.label).not.toBe(await page.locator('#q-1 .answer-label').evaluate(label => getComputedStyle(label).color));
});
