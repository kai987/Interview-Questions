import { test, expect } from './fixture.mjs';

const versions = {
  short: '結論専用語と共通検索語。A+B と & を説明します。',
  standard: '標準専用語と共通検索語について説明します。',
  full: '深掘り専用語と共通検索語の具体例です。ＡＩ＋<script> は文字列です。'
};

function seedAnswers(app) {
  app.setPrivateContent(1, {
    answer: versions.standard,
    answer_variants: versions,
    outline: '提綱専用語 → 具体例専用語',
    tags: ['タグ専用語']
  });
}

test('all answer versions, outline keywords and tags share filtering and suggestion matches', async ({ page, app }) => {
  seedAnswers(app);
  await app.open();
  const card = page.locator('#q-1');
  const input = page.locator('#searchInput');
  await expect(card.locator('.answer-text')).toHaveText(versions.full);
  await expect(card.locator('[data-answer-length="full"]')).toHaveAttribute('aria-pressed', 'true');
  for (const [query, version] of [
    ['結論専用語', 'short'], ['標準専用語', 'standard'], ['深掘り専用語', 'full'],
    ['提綱専用語', null], ['タグ専用語', null]
  ]) {
    const selected = await card.locator('[data-answer-length][aria-pressed="true"]').getAttribute('data-answer-length');
    await input.fill(query);
    await expect(page.locator('.qa-card')).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(page.locator('#searchSuggestions [data-suggestion-id="1"]')).toBeVisible();
    await expect(card.locator(`[data-answer-length="${selected}"]`)).toHaveAttribute('aria-pressed', 'true');
    if (version) {
      await card.locator(`[data-answer-length="${version}"]`).click();
      await expect(card.locator('.answer-text')).toHaveText(versions[version]);
      await expect(card.locator('.answer-text mark')).toHaveText(query);
    } else if (query === '提綱専用語') {
      await page.locator('[data-toggle-group="answer"][data-toggle-value="outline"]').click();
      await expect(card.locator('.answer-outline mark')).toHaveText(query);
    } else await expect(card.locator('.tag mark')).toHaveText(query);
  }
});

test('selected prose and its highlights survive version switches and search rerenders', async ({ page, app }) => {
  seedAnswers(app);
  await app.open();
  const card = page.locator('#q-1');
  const input = page.locator('#searchInput');
  await input.fill('共通検索語');
  for (const version of ['short', 'standard', 'full', 'short']) {
    await card.locator(`[data-answer-length="${version}"]`).click();
    await expect(card.locator('.answer-text')).toHaveText(versions[version]);
    await expect(card.locator('.answer-text mark')).toHaveText('共通検索語');
  }
  await input.fill('共通検索語 ');
  await expect(card.locator('[data-answer-length="short"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.answer-text')).toHaveText(versions.short);
  await expect(card.locator('.answer-text mark')).toHaveText('共通検索語');
  await input.fill('');
  await expect(page.locator('.qa-card')).toHaveCount(12);
  await expect(card.locator('.answer-text')).toHaveText(versions.short);
  await input.fill('共通検索語');
  await expect(card.locator('.answer-text mark')).toHaveText('共通検索語');
  await expect(card.locator('[data-answer-length="short"]')).toHaveAttribute('aria-pressed', 'true');
});

test('outline search highlights survive keyword mode and rerender without changing display mode', async ({ page, app }) => {
  seedAnswers(app);
  await app.open();
  await page.locator('[data-toggle-group="answer"][data-toggle-value="outline"]').click();
  await page.locator('#searchInput').fill('提綱専用語');
  await expect(page.locator('#q-1 .answer-outline')).toBeVisible();
  await expect(page.locator('#q-1 .answer-outline mark')).toHaveText('提綱専用語');
  await expect(page.locator('#q-1 .answer-text')).toBeHidden();
  await page.locator('#searchInput').fill('提綱専用語 ');
  await expect(page.locator('#q-1 .answer-outline mark')).toHaveText('提綱専用語');
  await expect(page.locator('body')).toHaveClass(/answer-view-outline/);
});

test('compatibility text and literal HTML or regex characters match and highlight safely', async ({ page, app }) => {
  seedAnswers(app);
  await app.open();
  await page.locator('#searchInput').fill('ai+<script>');
  await expect(page.locator('.qa-card')).toHaveCount(1);
  await expect(page.locator('#q-1 .answer-text mark')).toHaveText('ＡＩ＋<script>');
  await expect(page.locator('#q-1 .answer-text script')).toHaveCount(0);
  await page.locator('#q-1 [data-answer-length="short"]').click();
  await page.locator('#searchInput').fill('A+B');
  await expect(page.locator('#q-1 .answer-text mark')).toHaveText('A+B');
  await page.locator('#searchInput').fill('&');
  await expect(page.locator('#q-1 .answer-text mark')).toHaveText('&');
});

test('guests cannot find private variants, keywords or tags through search', async ({ page, app }) => {
  seedAnswers(app);
  app.setSession(null);
  const privateRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/__e2e__/table/interview_private_content') privateRequests.push(request.url());
  });
  await app.open();
  for (const query of ['結論専用語', '標準専用語', '深掘り専用語', '提綱専用語', 'タグ専用語']) {
    await page.locator('#searchInput').fill(query);
    await expect(page.locator('.qa-card')).toHaveCount(0);
    await expect(page.locator('#searchSuggestions [data-suggestion-id]')).toHaveCount(0);
  }
  await page.locator('#searchInput').fill(app.getQuestion(1).question);
  await expect(page.locator('.qa-card')).toHaveCount(1);
  await expect(page.locator('#q-1 .private-answer-locked')).toBeVisible();
  expect(privateRequests).toEqual([]);
});

test('legacy unversioned answers remain searchable and highlighted', async ({ page, app }) => {
  app.setPrivateContent(1, { answer: '従来形式の回答専用語です。', answer_variants: {} });
  await app.open();
  await page.locator('#searchInput').fill('回答専用語');
  await expect(page.locator('.qa-card')).toHaveCount(1);
  await expect(page.locator('#q-1 .answer-text mark')).toHaveText('回答専用語');
  await expect(page.locator('#q-1 .answer-length-control')).toHaveCount(0);
});
