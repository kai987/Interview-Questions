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
  await expect(page.locator('#q-1 .audio-feedback')).toBeVisible();
  expect(await page.evaluate(() => window.__qa.spokenText)).toBeUndefined();
  await page.locator('#q-1 .audio-browser-button').click();
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

test('cancelled and timed-out downloads can retry without speaking automatically', async ({ page, app }) => {
  registerVariants(app);
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.clock.install();
  await page.evaluate(() => {
    const original = window.fetch;
    window.__qa.hangAudio = true;
    window.__qa.hungAudioRequests = 0;
    window.__qa.abortedAudioRequests = 0;
    speechSynthesis.speak = utterance => { window.__qa.spokenText = utterance.text; };
    window.fetch = function (url, options) {
      if (String(url).includes('/local-audio/') && window.__qa.hangAudio) {
        window.__qa.hungAudioRequests += 1;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
          window.__qa.abortedAudioRequests += 1;
          reject(new DOMException('Cancelled', 'AbortError'));
        }, { once: true }));
      }
      return original.call(this, url, options);
    };
  });
  const button = page.locator('#q-1 [data-speech-id]');
  await button.click();
  await expect(button).toHaveText('読込中…');
  await expect.poll(() => page.evaluate(() => window.__qa.hungAudioRequests)).toBe(1);
  await button.click();
  await expect(button).toHaveText('音声で練習');
  await expect.poll(() => page.evaluate(() => window.__qa.abortedAudioRequests)).toBe(1);
  await expect(page.locator('#q-1 .audio-feedback')).toBeHidden();
  await button.click();
  await expect.poll(() => page.evaluate(() => window.__qa.hungAudioRequests)).toBe(2);
  await page.clock.fastForward(15001);
  await expect(page.locator('#q-1 .audio-feedback')).toContainText('時間切れ');
  await expect(page.locator('#q-1 .audio-source-note')).toHaveText('00:00 / 00:20');
  expect(await page.evaluate(() => window.__qa.spokenText)).toBeUndefined();
  await page.evaluate(() => { window.__qa.hangAudio = false; });
  await page.locator('#q-1 .audio-retry-button').click();
  await expect(button).toHaveText('停止');
  await expect(page.locator('#q-1 .audio-feedback')).toBeHidden();
  expect(app.audioRequests).toBe(1);
});

test('immutable audio path is used only for its matching owner, set, question and hashes', async ({ page, app, context }) => {
  const recordings = registerVariants(app);
  app.rejectLocalAudio();
  const recording = recordings.full;
  recording.object_path = `e2e-synthetic-user/e2e-fixture/q1-${recording.audio_text_hash}-${recording.audio_sha256}.mp3`;
  app.setPrivateContent(1, { audio_variants: recordings });
  app.setAudioFile(recording.object_path.split('/').at(-1), makeAudioFixture(20));
  await context.addInitScript(() => {
    localStorage.setItem('sb-flpmblfscgcbrprwwckz-auth-token', JSON.stringify({
      access_token: 'synthetic-e2e-token', user: { id: 'e2e-synthetic-user' }
    }));
  });
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 [data-speech-id]').click();
  await expect(page.locator('#q-1 [data-speech-id]')).toHaveText('停止');
  expect(app.audioPaths.at(-1)).toBe(`/storage/v1/object/authenticated/interview-audio/${recording.object_path}`);
  const successfulRequests = app.audioRequests;
  for (const invalid of [recording.object_path.replace('e2e-synthetic-user/', 'another-owner/'),
    recording.object_path.replace('/e2e-fixture/', '/another-set/'), recording.object_path.replace('/q1-', '/q2-'),
    recording.object_path.replace(recording.audio_text_hash, '0'.repeat(64)),
    recording.object_path.replace(recording.audio_sha256, '0'.repeat(64)), '../outside.mp3']) {
    await page.evaluate(value => {
      window.InterviewAudioPlayer.clearCache();
      window.INTERVIEW_DATA.find(item => item.id === 1).audioVariants.full.object_path = value;
      window.dispatchEvent(new Event('interview-answer-changed'));
    }, invalid);
    await page.locator('#q-1 [data-speech-id]').click();
    await expect(page.locator('#q-1 .audio-feedback')).toContainText('録音を確認できません');
  }
  // Each invalid entry may try verified local audio, but none requests another remote path.
  expect(app.audioPaths.filter(path => path.includes('/storage/'))).toHaveLength(1);
  expect(app.audioRequests).toBe(successfulRequests + 6);
});

test('authentication failure is visible and browser speech requires an explicit choice', async ({ page, app, context }) => {
  registerVariants(app);
  app.rejectLocalAudio();
  app.allowWarning('Failed to load resource');
  await context.addInitScript(() => {
    localStorage.setItem('sb-flpmblfscgcbrprwwckz-auth-token', JSON.stringify({
      access_token: 'synthetic-expired-token', user: { id: 'e2e-synthetic-user' }
    }));
    speechSynthesis.speak = utterance => { window.__chosenSpeech = utterance.text; };
  });
  await page.route('**/storage/v1/object/authenticated/**', route => route.fulfill({ status: 401, json: { error: 'Expired token' } }));
  await app.open();
  await page.locator('#q-1 > summary').click();
  await page.locator('#q-1 [data-speech-id]').click();
  await expect(page.locator('#q-1 .audio-feedback')).toContainText('ログイン状態');
  expect(await page.evaluate(() => window.__chosenSpeech)).toBeUndefined();
  await page.locator('#q-1 .audio-browser-button').click();
  await expect(page.locator('#q-1 [data-speech-id]')).toHaveText('停止');
  expect(await page.evaluate(() => window.__chosenSpeech)).toContain(app.getPrivateContent(1).answer);
  await expect(page.locator('#q-1 .audio-seek')).toBeDisabled();
});

test('a playback rejection during resume shows a recoverable error', async ({ page, app }) => {
  registerVariants(app);
  await app.open();
  await page.locator('#q-1 > summary').click();
  const button = page.locator('#q-1 [data-speech-id]');
  await button.click();
  await expect(button).toHaveText('停止');
  await button.click();
  await expect(button).toHaveText('再開');
  await page.evaluate(() => {
    speechSynthesis.speak = utterance => { window.__qa.spokenText = utterance.text; };
    window.__qa.audio[0].play = () => Promise.reject(new DOMException('Playback unavailable', 'NotAllowedError'));
  });
  await button.click();
  await expect(page.locator('#q-1 .audio-feedback')).toContainText('録音を再生できません');
  expect(await page.evaluate(() => window.__qa.spokenText)).toBeUndefined();
  await page.locator('#q-1 .audio-retry-button').click();
  await expect(button).toHaveText('停止');
});
