import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Synthetic content only: no Supabase connection, credentials or personal answers.
const source = readFileSync(new URL('../../answer-variants.js', import.meta.url), 'utf8');
const fixture = {
  id: 1,
  question: '自己紹介をお願いします。',
  answer: '標準の本文。\n\n以上です。',
  answerVariants: {
    short: '短い回答です。',
    standard: '標準の本文。\n\n以上です。',
    full: 'はじめまして、テストです。\n\n職歴です。\n\n具体例です。\n\nよろしくお願いいたします。'
  }
};

async function mount(page, item = fixture) {
  await page.setContent('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Answer variants regression fixture</title></head><body><section id="questionSections"></section></body></html>');
  await page.evaluate((data) => {
    window.INTERVIEW_DATA = [data];
    document.getElementById('questionSections').innerHTML = '<details class="qa-card" id="q-1" open><summary>Question</summary><div class="qa-toolbar"></div><div class="answer-text"></div></details>';
    document.querySelector('.answer-text').textContent = data.answer;
  }, item);
  await page.addScriptTag({ content: source });
}

async function expectSelected(page, key, content) {
  await expect(page.locator('.answer-text')).toHaveText(content);
  await expect(page.locator(`[data-answer-length="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.InterviewAnswers.text(window.INTERVIEW_DATA[0]))).toBe(content);
}

async function rerender(page) {
  await page.evaluate(() => {
    // app.js recreates cards using item.answer, which is the standard version.
    document.getElementById('questionSections').innerHTML = '<details class="qa-card" id="q-1" open><summary>Re-render</summary><div class="qa-toolbar"></div><div class="answer-text"></div></details>';
    document.querySelector('.answer-text').textContent = window.INTERVIEW_DATA[0].answer;
  });
}

test('initial default full renders the full answer, not the standard fallback', async ({ page }) => {
  await mount(page);
  await expectSelected(page, 'full', fixture.answerVariants.full);
  await expect(page.locator('.answer-length-control')).toHaveCount(1);
});

test('three version controls keep the visible answer and reading text in sync', async ({ page }) => {
  await mount(page);
  for (const key of ['short', 'standard', 'full']) {
    await page.locator(`[data-answer-length="${key}"]`).click();
    await expectSelected(page, key, fixture.answerVariants[key]);
    await expect(page.locator('[data-answer-length][aria-pressed="true"]')).toHaveCount(1);
  }
});

test('card re-render preserves default full and a later selected short answer', async ({ page }) => {
  await mount(page);
  await rerender(page);
  await expectSelected(page, 'full', fixture.answerVariants.full);
  await page.locator('[data-answer-length="short"]').click();
  await rerender(page);
  await expectSelected(page, 'short', fixture.answerVariants.short);
  await expect(page.locator('.answer-length-control')).toHaveCount(1);
});

test('missing full falls back to answer without losing matching highlight markup', async ({ page }) => {
  const item = { ...fixture, answer: '標準の本文。', answerVariants: { short: '短い回答です。' } };
  await mount(page, item);
  await expectSelected(page, 'full', item.answer);
  await page.evaluate(() => {
    document.querySelector('.answer-text').innerHTML = '<mark>標準</mark>の本文。';
    document.querySelector('.answer-length-control').remove();
    window.dispatchEvent(new Event('interview-audio-ready'));
  });
  await expect(page.locator('.answer-text mark')).toHaveText('標準');
  await expectSelected(page, 'full', item.answer);
});

test('locked or unversioned answers do not create controls or expose content', async ({ page }) => {
  await mount(page, { id: 1, question: 'Locked question', answer: '' });
  await expect(page.locator('.answer-length-control')).toHaveCount(0);
  await expect(page.locator('.answer-text')).toHaveText('');
});
