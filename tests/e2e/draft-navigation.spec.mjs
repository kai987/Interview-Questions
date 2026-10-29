import { test, expect } from './fixture.mjs';

const oldAnswer = '以前にクラウドへ保存した回答';
const newAnswer = '保存障害の間に入力した、失ってはいけない最新の回答';

function addSecondLibrary(app) {
  app.addSet({ id: 2, slug: 'second-fixture', company: '第二企業', position: '面接練習' },
    [{ id: 101, category: '基本質問', question: '第二企業への志望理由', sort_order: 1 }],
    [{ question_id: 101, answer: '第二企業の回答例' }]);
}

async function prepareDraft(page, app, { volatile = true, blockStorageAccess = false } = {}) {
  addSecondLibrary(app);
  app.setRemoteState({ question_id: 1, own_answer: oldAnswer });
  await app.open();
  await page.locator('#q-1 > summary').click();
  const input = page.locator('[data-own-answer-id="1"]');
  await expect(input).toHaveValue(oldAnswer);
  await page.evaluate(({ blockOutbox, blockStorageAccess }) => {
    const set = Storage.prototype.setItem;
    window.__qa.failDraftStorage = true;
    Storage.prototype.setItem = function (key, value) {
      const ownAnswerCache = key.startsWith('interview-own-answers');
      const outbox = blockOutbox && key.startsWith('interview-pending-state:');
      if (window.__qa.failDraftStorage && (ownAnswerCache || outbox)) {
        throw new DOMException('Synthetic draft quota failure', 'QuotaExceededError');
      }
      return set.call(this, key, value);
    };
    if (blockStorageAccess) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Synthetic storage access denied', 'SecurityError'); }
      });
    }
    window.__qa.sameDocument = 'draft-document';
  }, { blockOutbox: volatile, blockStorageAccess });
  app.setSaveFailure(true);
  await input.fill(newAnswer);
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', volatile ? 'local-error' : 'error');
  return input;
}

for (const recovery of ['cloud', 'storage']) {
  test(`volatile answers block company switching until ${recovery} saving recovers`, async ({ page, app }) => {
    const input = await prepareDraft(page, app, { blockStorageAccess: recovery === 'cloud' });
    const initialUrl = page.url();
    await page.locator('#interviewSetSelect').selectOption('2');
    const notice = page.locator('#unsavedDraftNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'alert');
    await expect(notice).toContainText('未保存');
    await expect(page.locator('#interviewSetSelect')).toHaveValue('1');
    await expect(page.locator('.qa-card')).toHaveCount(12);
    await expect(input).toHaveValue(newAnswer);
    expect(page.url()).toBe(initialUrl);
    expect(await page.evaluate(() => window.__qa.sameDocument)).toBe('draft-document');

    if (recovery === 'cloud') app.setSaveFailure(false);
    else await page.evaluate(() => { window.__qa.failDraftStorage = false; });
    await notice.getByRole('button', { name: '同期を再試行', exact: true }).click();
    await expect(notice).not.toBeVisible();
    await page.locator('#interviewSetSelect').selectOption('2');
    await expect(page.locator('#q-101 .training-workbench')).toBeAttached();
    await expect(page.locator('.qa-card')).toHaveCount(1);
    await page.locator('#interviewSetSelect').selectOption('1');
    await expect(input).toHaveValue(newAnswer);
  });
}

test('a durable offline outbox allows company switching and restores the unsynced answer', async ({ page, app }) => {
  const input = await prepareDraft(page, app, { volatile: false });
  const persisted = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('interview-pending-state:'))
    .map(key => JSON.parse(localStorage.getItem(key))));
  expect(persisted.some(entry => entry.row?.own_answer === newAnswer)).toBe(true);
  await page.locator('#interviewSetSelect').selectOption('2');
  await expect(page.locator('#q-101 .training-workbench')).toBeAttached();
  await expect(page.locator('#unsavedDraftNotice')).not.toBeVisible();
  await page.locator('#interviewSetSelect').selectOption('1');
  await expect(input).toHaveValue(newAnswer);
  await expect(page.locator('.sync-banner')).toHaveAttribute('data-state', 'error');
});

test('desktop navigation warns before discarding an answer held only in memory', async ({ page, app }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Native beforeunload dialogs are not reliable on mobile.');
  const input = await prepareDraft(page, app);
  const initialUrl = page.url();
  const dialogPromise = page.waitForEvent('dialog', { timeout: 5000 });
  const navigation = page.goto('/?navigation-probe=1').catch(() => {});
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await navigation;
  expect(page.url()).toBe(initialUrl);
  await expect(input).toHaveValue(newAnswer);
});
