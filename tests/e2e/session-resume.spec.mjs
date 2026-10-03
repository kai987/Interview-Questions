import { test, expect } from './fixture.mjs';

const sessionPanel = page => page.locator('.practice-session:not(.practice-resume)');
const currentCard = page => page.locator('.qa-card:visible');

test('refresh offers the same interview order and step without restarting audio or timer', async ({ page, app }) => {
  await app.open();
  await page.locator('#randomPracticeButton').click();
  await expect(currentCard(page)).toHaveCount(1);
  await currentCard(page).locator('[data-mastery-level="okay"]').click();
  await sessionPanel(page).locator('[data-session-action="next"]').click();
  const id = await currentCard(page).getAttribute('id');
  await currentCard(page).locator('[data-mastery-level="confident"]').click();
  await currentCard(page).locator('[data-timer-id]').click();
  await expect(currentCard(page).locator('[data-timer-id]')).toContainText('停止');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('interview-practice-session:e2e-synthetic-user:1')));
  expect(saved.index).toBe(1);
  expect(saved.ids).toHaveLength(10);
  await page.reload();
  const resume = page.locator('.practice-resume');
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('10問中 2問目');
  await expect(sessionPanel(page)).toBeHidden();
  await resume.getByRole('button', { name: '前回の続きから' }).click();
  await expect(currentCard(page)).toHaveAttribute('id', id);
  await expect(sessionPanel(page)).toContainText('2 / 10問');
  await expect(sessionPanel(page).locator('[data-session-action="next"]')).toBeEnabled();
  await expect(currentCard(page).locator('[data-timer-id]')).toContainText('回答開始');
  expect(await page.evaluate(() => window.__qa.audio.length)).toBe(0);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('interview-practice-session:e2e-synthetic-user:1')));
  expect(restored.ids).toEqual(saved.ids);
  expect(restored.ratings).toEqual(saved.ratings);
});

test('search suspends an interview and explicit exit removes its saved progress', async ({ page, app }) => {
  await app.open();
  await page.locator('#randomPracticeButton').click();
  await sessionPanel(page).locator('[data-session-action="skip"]').click();
  const id = await currentCard(page).getAttribute('id');
  await page.locator('#searchInput').fill('質問 1 ');
  await expect(sessionPanel(page)).toBeHidden();
  await expect(page.locator('.practice-resume')).toBeVisible();
  await page.locator('.practice-resume [data-resume-action="resume"]').click();
  await expect(currentCard(page)).toHaveAttribute('id', id);
  await sessionPanel(page).locator('[data-session-action="exit"]').click();
  await page.reload();
  await expect(page.locator('.practice-resume')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('interview-practice-session:e2e-synthetic-user:1'))).toBeNull();
});

test('a completed interview is not offered again after refresh', async ({ page, app }) => {
  await app.open();
  await page.locator('#randomPracticeButton').click();
  for (let i = 0; i < 10; i += 1) await sessionPanel(page).locator('[data-session-action="skip"]').click();
  await expect(sessionPanel(page)).toContainText('練習お疲れさまでした');
  expect(await page.evaluate(() => localStorage.getItem('interview-practice-session:e2e-synthetic-user:1'))).toBeNull();
  await page.reload();
  await expect(page.locator('.practice-resume')).toBeHidden();
});

test('resume waits for private study state to load and keeps its saved progress on failure', async ({ page, app }) => {
  await app.open();
  await page.locator('#randomPracticeButton').click();
  await sessionPanel(page).locator('[data-session-action="skip"]').click();
  const saved = await page.evaluate(() => localStorage.getItem('interview-practice-session:e2e-synthetic-user:1'));
  app.failNext('interview_private_content');
  app.allowWarning('Could not load private interview content:');
  await page.reload();
  await expect(page.locator('.practice-resume [data-resume-action="resume"]')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('interview-practice-session:e2e-synthetic-user:1'))).toBe(saved);
  await page.locator('#retryLibraryLoad').click();
  await expect(page.locator('.practice-resume [data-resume-action="resume"]')).toBeEnabled();
  await page.locator('.practice-resume [data-resume-action="resume"]').click();
  await expect(sessionPanel(page)).toContainText('2 / 10問');
});
