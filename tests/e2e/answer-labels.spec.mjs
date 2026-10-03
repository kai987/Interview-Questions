import { createHash } from 'node:crypto';
import { test, expect } from './fixture.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('answer versions show verified recorded durations rather than fixed target times', async ({ page, app }) => {
  const question = app.getQuestion(1).question;
  const answers = { short: '結論を簡潔に説明します。', standard: '具体例を一つ加えて説明します。', full: app.getPrivateContent(1).answer };
  const durations = { short: 8.4, standard: 42.6, full: 60.5 };
  app.setPrivateContent(1, {
    answer_variants: answers,
    audio_variants: Object.fromEntries(Object.entries(answers).map(([variant, text]) => [variant,
      { audio_text_hash: sha256(`${question}\n${text}`), duration_seconds: durations[variant] }]))
  });
  await app.open();
  await page.locator('#q-1 > summary').click();
  for (const [variant, name, duration] of [['short', '結論', '00:08'], ['standard', '標準', '00:42'], ['full', '深掘り', '01:00']]) {
    const button = page.locator(`#q-1 [data-answer-length="${variant}"]`);
    await expect(button.locator('.answer-length-label')).toHaveText(name);
    await expect(button.locator('.answer-length-duration')).toHaveText(duration);
    await button.click();
    await expect(page.locator('#q-1 .audio-source-note')).toHaveText(`00:00 / ${duration}`);
  }
  await expect(page.locator('#q-1 .answer-duration-note')).toContainText('質問を含む録音時間');
  expect(app.audioRequests).toBe(0);
  await page.evaluate(() => {
    window.INTERVIEW_DATA.find(item => item.id === 1).answerVariants.short = '録音後に変更された回答です。';
    window.dispatchEvent(new Event('interview-answer-changed'));
  });
  await expect(page.locator('#q-1 [data-answer-length="short"] .answer-length-duration')).toHaveText('--:--');
  await expect(page.locator('#q-1 [data-answer-length="standard"] .answer-length-duration')).toHaveText('00:42');
  expect(app.audioRequests).toBe(0);
});
