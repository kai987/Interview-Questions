import { test, expect } from './fixture.mjs';

const privateTables = ['interview_private_content', 'interview_user_state'];
const owner = 'e2e-synthetic-user';
const privateReads = app => app.tableReads.filter(read => privateTables.includes(read.table));

function requestedIds(read) {
  expect(read.filters).toContainEqual({ field: 'user_id', value: owner });
  const filter = read.filters.find(filter => filter.field === 'question_id' && filter.operator === 'in');
  expect(filter, 'Each private read must be bounded to explicit current question IDs').toBeTruthy();
  expect(filter.values.length).toBeGreaterThan(0);
  expect(filter.values.length).toBeLessThanOrEqual(200);
  return filter.values;
}

function addSecondLibrary(app) {
  app.addSet({ id: 2, slug: 'second-fixture', company: '第二企業', position: '面接練習' },
    [{ id: 101, category: '基本質問', question: '第二企業への志望理由', sort_order: 1 }],
    [{ question_id: 101, answer: '第二企業の回答例' }]);
}

function addLargeLibrary(app, count = 201) {
  const ids = Array.from({ length: count }, (_, index) => 2001 + index);
  app.addSet({ id: 3, slug: 'large-fixture', company: '大きな題庫', position: '面接練習' },
    ids.map((id, index) => ({ id, category: '基本質問', question: `大きな題庫の質問 ${id}`, sort_order: index })),
    ids.map(question_id => ({ question_id, answer: `対象題庫の回答 ${question_id}` })));
  for (const question_id of ids) app.setRemoteState({ question_id, own_answer: `対象題庫の自分の回答 ${question_id}` });
  return ids;
}

test('private reads follow the selected library and retain another library pending answer', async ({ page, app }) => {
  addSecondLibrary(app);
  app.setRemoteState({ question_id: 1, own_answer: '第一企業の保存済み回答' });
  app.setRemoteState({ question_id: 101, own_answer: '第二企業の保存済み回答' });
  app.setPrivateContent(1, { user_id: 'different-owner', answer: '別アカウントの回答' });
  await app.open();
  expect(privateReads(app)).toHaveLength(2);
  for (const read of privateReads(app)) {
    expect(requestedIds(read)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(read.questionIds.every(id => id >= 1 && id <= 12)).toBe(true);
  }
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('第一企業の保存済み回答');

  await page.locator('#interviewSetSelect').selectOption('2');
  const secondInput = page.locator('[data-own-answer-id="101"]');
  await expect(secondInput).toHaveValue('第二企業の保存済み回答');
  await expect(page.locator('#q-101 .answer-text')).toHaveText('第二企業の回答例');
  for (const read of privateReads(app).slice(2)) {
    expect(requestedIds(read)).toEqual([101]);
    expect(read.questionIds).toEqual([101]);
  }
  app.setSaveFailure(true);
  await page.locator('#q-101 > summary').click();
  await secondInput.fill('第二企業の未同期の新しい回答');
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
  await page.locator('#interviewSetSelect').selectOption('1');
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('第一企業の保存済み回答');
  await page.locator('#interviewSetSelect').selectOption('2');
  await expect(secondInput).toHaveValue('第二企業の未同期の新しい回答');
  expect(await page.evaluate(() => window.InterviewPrivateStore.hasPending())).toBe(true);
});

for (const scenario of ['guest', 'empty-library']) {
  test(`${scenario} does not make private-content or study-state requests`, async ({ page, app }) => {
    if (scenario === 'guest') app.setSession(null);
    else app.addSet({ id: 2, slug: 'empty-fixture', company: '空の題庫', position: '面接練習' }, []);
    await page.goto(scenario === 'guest' ? '/' : '/?set=2');
    await expect(page.locator('.sync-banner')).toBeAttached();
    if (scenario === 'guest') await expect(page.locator('#q-1 .private-answer-locked')).toBeAttached();
    else {
      await expect(page.locator('#interviewSetSelect')).toHaveValue('2');
      await expect(page.locator('.qa-card')).toHaveCount(0);
    }
    expect(privateReads(app)).toEqual([]);
  });
}

test('bounded batches load all current rows beyond the account-wide 1000-row default limit', async ({ page, app }) => {
  const outsideIds = Array.from({ length: 1100 }, (_, index) => 101 + index);
  app.addSet({ id: 2, slug: 'outside-fixture', company: '他の企業', position: '面接練習' },
    outsideIds.map(id => ({ id, category: '基本質問', question: `他社の質問 ${id}`, sort_order: id })),
    outsideIds.map(question_id => ({ question_id, answer: `他社の回答 ${question_id}` })));
  for (const question_id of outsideIds) app.setRemoteState({ question_id, own_answer: `他社の自分の回答 ${question_id}` });
  const ids = addLargeLibrary(app);
  await page.goto('/?set=3');
  await expect(page.locator('#q-2001 .training-workbench')).toBeAttached();
  await expect(page.locator('.qa-card')).toHaveCount(ids.length);
  await expect(page.locator('#q-2201 .answer-text')).toHaveText('対象題庫の回答 2201');
  await expect(page.locator('[data-own-answer-id="2201"]')).toHaveValue('対象題庫の自分の回答 2201');
  for (const table of privateTables) {
    const reads = privateReads(app).filter(read => read.table === table);
    expect(reads).toHaveLength(2);
    expect(reads.flatMap(requestedIds)).toEqual(ids);
    expect(reads.flatMap(read => read.questionIds)).toEqual(ids);
  }
});

for (const failedTable of privateTables) {
  test(`a later ${failedTable} batch failure exposes no partial private snapshot and retry restores it`, async ({ page, app }) => {
    addLargeLibrary(app);
    app.failOnRead(failedTable, 2);
    app.allowWarning('Could not load private interview content:');
    await page.addInitScript(() => {
      if (localStorage.getItem('e2e-other-draft-seeded')) return;
      localStorage.setItem('interview-own-answers', JSON.stringify({ 101: '別の題庫の旧草稿' }));
      localStorage.setItem('e2e-other-draft-seeded', 'true');
    });
    await page.goto('/?set=3');
    await expect(page.locator('#libraryLoadNotice')).toBeVisible();
    await expect(page.locator('.qa-card')).toHaveCount(201);
    await expect(page.locator('#q-2001 .private-answer-locked')).toBeAttached();
    await expect(page.locator('#q-2201 .private-answer-locked')).toBeAttached();
    expect(await page.evaluate(() => window.InterviewPrivateStore.isReady())).toBe(false);
    expect(await page.evaluate(() => window.INTERVIEW_DATA.every(item => item.answer === ''))).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('interview-own-answers'))[101])).toBe('別の題庫の旧草稿');
    const failed = privateReads(app).filter(read => read.failed);
    expect(failed).toHaveLength(1);
    expect(failed[0].table).toBe(failedTable);
    expect(failed[0].ordinal).toBe(2);
    await page.locator('#retryLibraryLoad').click();
    await expect(page.locator('#libraryLoadNotice')).not.toBeVisible();
    await expect(page.locator('#q-2001 .answer-text')).toHaveText('対象題庫の回答 2001');
    await expect(page.locator('#q-2201 .answer-text')).toHaveText('対象題庫の回答 2201');
    await expect(page.locator('[data-own-answer-id="2201"]')).toHaveValue('対象題庫の自分の回答 2201');
    expect(await page.evaluate(() => window.InterviewPrivateStore.isReady())).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('interview-own-answers'))[101])).toBe('別の題庫の旧草稿');
  });
}

test('private rows outside the requested question IDs never enter the current state cache', async ({ page, app }) => {
  await page.route('**/__e2e__/table/interview_user_state?*', route => route.fulfill({
    json: {
      data: [
        { question_id: 1, own_answer: '現在の回答' },
        { question_id: 101, own_answer: '要求外の回答' }
      ],
      error: null
    }
  }));
  await app.open();
  await expect(page.locator('[data-own-answer-id="1"]')).toHaveValue('現在の回答');
  expect(await page.evaluate(() => window.InterviewPrivateStore.getState(101).own_answer)).toBeUndefined();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('interview-own-answers'))[101])).toBeUndefined();
});
