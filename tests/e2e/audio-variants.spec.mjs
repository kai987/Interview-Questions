import { createHash } from 'node:crypto';
import { test, expect, makeAudioFixture } from './fixture.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

function registerVariants(app) {
  const question = app.getQuestion(1).question;
  const full = app.getPrivateContent(1).answer;
  const short = '結論と具体例を短く説明します。';
  const recordings = {};
  for (const [variant, text, duration] of [['short', short, 8], ['full', full, 20]]) {
    const bytes = makeAudioFixture(duration);
    const hash = sha256(`${question}\n${text}`);
    recordings[variant] = { audio_text_hash: hash, audio_sha256: sha256(bytes), duration_seconds: duration };
    app.setAudioFile(`q1-${hash}.mp3`, bytes);
  }
  app.setPrivateContent(1, {
    answer_variants: { short, standard: full },
    // No standard entry: identical standard/full prose must reuse full audio.
    audio_variants: recordings
  });
  return recordings;
}

test('each answer length has measured duration before playback and identical prose reuses audio', async ({ page, app }) => {
  const recordings = registerVariants(app);
  await app.open();
  await page.locator('#q-1 > summary').click();
  const note = page.locator('#q-1 .audio-source-note');
  const button = page.locator('#q-1 [data-speech-id]');
  for (const [variant, duration] of [['short', '08'], ['standard', '20'], ['full', '20']]) {
    await page.locator(`#q-1 [data-answer-length="${variant}"]`).click();
    await expect(note).toHaveText(`00:00 / 00:${duration}`);
    expect(app.audioRequests).toBe(0);
  }
  await button.click();
  await expect(button).toHaveText('停止');
  expect(app.audioPaths).toEqual([`/local-audio/e2e-fixture/q1-${recordings.full.audio_text_hash}.mp3`]);
  await page.locator('#q-1 [data-answer-length="standard"]').click();
  await expect(note).toHaveText('00:00 / 00:20');
  await button.click();
  await expect(button).toHaveText('停止');
  expect(app.audioRequests).toBe(1);
  await page.locator('#q-1 [data-answer-length="short"]').click();
  await expect(note).toHaveText('00:00 / 00:08');
  await button.click();
  await expect(button).toHaveText('停止');
  expect(app.audioPaths.at(-1)).toBe(`/local-audio/e2e-fixture/q1-${recordings.short.audio_text_hash}.mp3`);
  await button.click();
  await expect(button).toHaveText('再開');
  await page.locator('#q-1 .audio-seek').fill('3');
  await expect(note).toHaveText('00:03 / 00:08');
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__qa.audio.at(-1).currentTime)).toBeGreaterThan(3.1);
});

test('changed recording metadata invalidates caches and changed prose rejects stale audio and duration', async ({ page, app }) => {
  const recordings = registerVariants(app);
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 [data-answer-length="short"]').click();
  const note = page.locator('#q-1 .audio-source-note');
  const button = page.locator('#q-1 [data-speech-id]');
  await expect(note).toHaveText('00:00 / 00:08');
  await button.click();
  await expect(button).toHaveText('停止');
  const replacement = makeAudioFixture(9);
  const metadata = { ...recordings.short, audio_sha256: sha256(replacement), duration_seconds: 9 };
  app.setAudioFile(`q1-${metadata.audio_text_hash}.mp3`, replacement);
  await page.evaluate(value => {
    window.INTERVIEW_DATA.find(item => item.id === 1).audioVariants.short = value;
    window.dispatchEvent(new Event('interview-answer-changed'));
  }, metadata);
  await expect(note).toHaveText('00:00 / 00:09');
  expect(await page.evaluate(() => window.__qa.audio[0].getAttribute('src'))).toBe(null);
  expect(app.audioRequests).toBe(1);
  await button.click();
  await expect(button).toHaveText('停止');
  expect(app.audioRequests).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__qa.audio.at(-1).duration)).toBe(9);

  await page.evaluate(() => {
    window.INTERVIEW_DATA.find(item => item.id === 1).answerVariants.short = '内容を更新した短い回答です。';
    speechSynthesis.speak = utterance => { window.__qa.spokenText = utterance.text; };
  });
  await page.locator('#q-1 [data-answer-length="short"]').click();
  await expect(note).toHaveText('00:00 / --:--');
  await expect(page.locator('#q-1 .audio-seek')).toBeDisabled();
  await button.click();
  await expect(button).toHaveText('停止');
  expect(await page.evaluate(() => window.__qa.spokenText)).toContain('内容を更新した短い回答です。');
  expect(app.audioRequests).toBe(2);
});

test('a distinct standard answer uses its own recorded audio and measured duration', async ({ page, app }) => {
  const recordings = registerVariants(app);
  const row = app.getPrivateContent(1);
  const standard = '標準の長さで経験と具体例を順番に説明します。';
  const bytes = makeAudioFixture(14);
  const hash = sha256(`${app.getQuestion(1).question}\n${standard}`);
  recordings.standard = { audio_text_hash: hash, audio_sha256: sha256(bytes), duration_seconds: 14 };
  app.setPrivateContent(1, { answer_variants: { ...row.answer_variants, standard }, audio_variants: recordings });
  app.setAudioFile(`q1-${hash}.mp3`, bytes);
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 [data-answer-length="standard"]').click();
  await expect(page.locator('#q-1 .audio-source-note')).toHaveText('00:00 / 00:14');
  expect(app.audioRequests).toBe(0);
  await page.locator('#q-1 [data-speech-id]').click();
  await expect(page.locator('#q-1 [data-speech-id]')).toHaveText('停止');
  expect(app.audioPaths).toEqual([`/local-audio/e2e-fixture/q1-${hash}.mp3`]);
  await expect.poll(() => page.evaluate(() => window.__qa.audio[0].duration)).toBe(14);
});

test('legacy audio without a stored duration is measured only after Play', async ({ page, app }) => {
  app.setPrivateContent(1, { duration_seconds: null });
  await app.open();
  await page.locator('#q-1 > summary').click();
  const note = page.locator('#q-1 .audio-source-note');
  await expect(note).toHaveText('00:00 / --:--');
  expect(app.audioRequests).toBe(0);
  await page.locator('#q-1 [data-speech-id]').click();
  await expect(note).toHaveText(/00:0\d \/ 00:20/);
  expect(app.audioPaths).toEqual(['/local-audio/e2e-fixture/q1.mp3']);
});

test('variant playback can fall back to the authenticated versioned storage object', async ({ page, app, context }) => {
  const recordings = registerVariants(app);
  app.rejectLocalAudio();
  await context.addInitScript(() => {
    localStorage.setItem('sb-flpmblfscgcbrprwwckz-auth-token', JSON.stringify({
      access_token: 'synthetic-e2e-token', user: { id: 'e2e-synthetic-user' }
    }));
  });
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 [data-answer-length="short"]').click();
  await expect(page.locator('#q-1 .audio-source-note')).toHaveText('00:00 / 00:08');
  expect(app.audioRequests).toBe(0);
  await page.locator('#q-1 [data-speech-id]').click();
  await expect(page.locator('#q-1 [data-speech-id]')).toHaveText('停止');
  expect(app.audioPaths.at(-1)).toBe(`/storage/v1/object/authenticated/interview-audio/e2e-synthetic-user/e2e-fixture/q1-${recordings.short.audio_text_hash}.mp3`);
  await expect.poll(() => page.evaluate(() => window.__qa.audio[0].duration)).toBe(8);
});
