import { createHash } from 'node:crypto';
import { test, expect, makeAudioFixture } from './fixture.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('native audio controls retain preview, pause, keyboard seeking and section colors', async ({ page, app }, testInfo) => {
  const question = app.getQuestion(1).question;
  const full = app.getPrivateContent(1).answer;
  const variants = { short: '結論を短く説明します。', standard: '標準の長さで具体例を説明します。', full };
  const recordings = {};
  for (const [key, duration] of [['short', 8], ['standard', 14], ['full', 20]]) {
    const bytes = makeAudioFixture(duration);
    const hash = sha256(`${question}\n${variants[key]}`);
    recordings[key] = { audio_text_hash: hash, audio_sha256: sha256(bytes), duration_seconds: duration };
    app.setAudioFile(`q1-${hash}.mp3`, bytes);
  }
  app.setPrivateContent(1, { answer_variants: variants, audio_variants: recordings });
  await app.open();
  await page.screenshot({ path: testInfo.outputPath('first-viewport.png') });
  await page.locator('#q-1 > summary').click();
  const card = page.locator('#q-1');
  await expect(card.locator('.answer-length-label')).toHaveText(['結論', '標準', '深掘り']);
  await expect(card.locator('.answer-length-duration')).toHaveText(['00:08', '00:14', '00:20']);
  const slider = card.locator('.audio-seek');
  const button = card.locator('[data-speech-id]');
  await card.locator('[data-answer-length="standard"]').click();
  await expect(card.locator('.audio-source-note')).toHaveText('00:00 / 00:14');
  expect(app.audioRequests).toBe(0);
  await button.click();
  await expect(button).toHaveText('停止');
  await expect.poll(() => page.evaluate(() => window.__qa.audio.at(-1).currentTime)).toBeGreaterThan(0.1);
  await button.click();
  await expect(button).toHaveText('再開');
  await slider.focus();
  await slider.press('Home');
  await slider.press('ArrowRight');
  expect(await slider.inputValue()).toBe('0.1');
  expect(await page.evaluate(() => window.__qa.audio.at(-1).currentTime)).toBeCloseTo(0.1, 1);
  expect(await page.evaluate(() => window.__qa.audio.at(-1).paused)).toBe(true);
  await slider.fill('7');
  await expect(card.locator('.audio-source-note')).toHaveText('00:07 / 00:14');
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__qa.audio.at(-1).currentTime)).toBeGreaterThan(7.1);
  await button.click();
  await slider.fill('7');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const colors = await card.locator('.audio-seek-control').evaluate(control => ({
      label: getComputedStyle(control.closest('.qa-card').querySelector('.answer-label')).color,
      track: getComputedStyle(control).color,
      thumb: getComputedStyle(control.querySelector('.audio-seek-track'), '::after').backgroundColor,
      background: getComputedStyle(control).backgroundColor,
      progress: control.style.getPropertyValue('--audio-progress')
    }));
    expect(colors.track).toBe(colors.label);
    expect(colors.thumb).toBe(colors.label);
    expect(colors.background).toBe('rgba(0, 0, 0, 0)');
    expect(colors.progress).toBe('50%');
    await card.locator('.qa-answer').screenshot({ path: testInfo.outputPath(`answer-${theme}.png`) });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('segmented settings and nested details keep state, focus and a single divider', async ({ page, app }, testInfo) => {
  await app.open();
  const group = page.locator('.reading-size-control');
  await group.locator('[data-reading-size="large"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-reading-size', 'large');
  await expect.poll(() => group.evaluate(node => {
    const active = node.querySelector('.is-active').getBoundingClientRect();
    const thumb = node.querySelector('.ios-segment-thumb').getBoundingClientRect();
    // offsetLeft is measured inside the track's 1px border.
    return Math.max(Math.abs(active.x - thumb.x), Math.abs(active.width - thumb.width));
  })).toBeLessThan(1.5);
  await group.locator('[data-reading-size="medium"]').click();

  await page.locator('#q-1 > summary').click();
  const card = page.locator('#q-1');
  const initial = await card.elementHandle();
  const favorite = card.locator('[data-favorite-id]');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  expect(await card.evaluate((node, previous) => node === previous, initial)).toBe(true);
  await expect(card).toHaveAttribute('open', '');
  await card.locator('.own-answer-editor > summary').click();
  const separators = await card.locator('.own-answer-editor').evaluate(editor => ({
    summary: getComputedStyle(editor.querySelector('summary')).borderBottomWidth,
    body: getComputedStyle(editor.querySelector('.own-answer-editor__body')).borderTopWidth
  }));
  expect(separators).toEqual({ summary: '0px', body: '1px' });
  await card.locator('.own-answer-editor > summary').click();
  await page.clock.install();
  await page.locator('[data-timer-seconds="30"]').click();
  await card.locator('[data-timer-id]').click();
  await page.clock.runFor(31000);
  await expect(card.locator('[data-timer-display]')).toHaveText('00:00');
  await expect(card.locator('[data-timer-id]')).toContainText('もう一度');
  await page.locator('#expandAllButton').click();
  await expect(page.locator('#expandAllButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#expandAllButton').click();
  await expect(page.locator('#expandAllButton')).toHaveAttribute('aria-pressed', 'false');
  await group.screenshot({ path: testInfo.outputPath('segmented-controls.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await initial.dispose();
});
