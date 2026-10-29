import { test, expect } from './fixture.mjs';

function addSecondLibrary(app) {
  app.addSet({ id: 2, slug: 'second-fixture', company: '第二企業', position: '面接練習' },
    [{ id: 101, category: '基本質問', question: '第二企業への志望理由', sort_order: 1 }],
    [{ question_id: 101, answer: '第二企業の回答例' }]);
}

async function failStorageOnStartup(page, failure) {
  await page.addInitScript(mode => {
    if (mode === 'getter') {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Synthetic storage access denied', 'SecurityError'); }
      });
      return;
    }
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    // Keep a stale preference to prove that an explicit URL selection wins
    // after a preference cannot be read or updated.
    if (mode.startsWith('active-set')) set.call(localStorage, 'interview-active-set-id', '1');
    Storage.prototype.getItem = function (key) {
      if (mode === 'reads' || (mode === 'active-set-read' && key === 'interview-active-set-id')) {
        throw new DOMException('Synthetic storage read failure', 'SecurityError');
      }
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (mode === 'writes' || (mode === 'active-set-write' && key === 'interview-active-set-id')) {
        throw new DOMException('Synthetic storage write failure', 'QuotaExceededError');
      }
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (mode === 'writes') throw new DOMException('Synthetic storage remove failure', 'SecurityError');
      return remove.call(this, key);
    };
  }, failure);
}

for (const session of ['guest', 'authenticated']) {
  for (const failure of ['getter', 'reads', 'writes', 'active-set-read', 'active-set-write']) {
    test(`${session} startup and company switching survive ${failure} storage failure`, async ({ page, app }) => {
      if (session === 'guest') app.setSession(null);
      addSecondLibrary(app);
      await failStorageOnStartup(page, failure);
      await app.open();
      await expect(page.locator('#libraryLoadNotice')).not.toBeVisible();
      if (session === 'guest') {
        await expect(page.locator('#q-1 .private-answer-locked')).toBeAttached();
      } else {
        await expect(page.locator('#q-1 .answer-text')).toContainText('実務での経験');
      }

      const theme = await page.locator('html').getAttribute('data-theme');
      await page.locator('#themeButton').click();
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme);
      await page.locator('#searchInput').fill('練習用の質問 12');
      await expect(page.locator('.qa-card:visible')).toHaveCount(1);
      await expect(page.locator('.qa-card:visible')).toHaveAttribute('id', 'q-12');
      await page.locator('#searchInput').fill('');

      await page.locator('#interviewSetSelect').selectOption('2');
      await expect(page).toHaveURL(/\?set=2(?:&|#|$)/);
      await expect(page).toHaveTitle('第二企業｜面接練習｜Interview Questions');
      await expect(page.locator('#q-101 .training-workbench')).toBeAttached();
      await expect(page.locator('.qa-card')).toHaveCount(1);
      await page.reload();
      await expect(page.locator('#q-101 .training-workbench')).toBeAttached();
      await expect(page.locator('#interviewSetSelect')).toHaveValue('2');
      if (session === 'authenticated') {
        await expect(page.locator('#q-101 .answer-text')).toHaveText('第二企業の回答例');
      }
    });
  }
}
