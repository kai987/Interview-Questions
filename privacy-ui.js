(() => {
  const questionSections = document.getElementById('questionSections');
  if (!questionSections) return;

  const dataById = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));

  function enhanceGuestLocks() {
    const authenticated = window.InterviewPrivateStore?.isAuthenticated?.();
    const unavailable = authenticated && !window.InterviewPrivateStore?.isReady?.();
    if (authenticated && !unavailable) return;
    if (unavailable) {
      document.querySelectorAll('[data-favorite-id], [data-practiced-id], [data-mastery-id], [data-own-answer-id], #randomPracticeButton').forEach(control => {
        control.disabled = true;
        control.setAttribute('title', '学習状態を再読み込みしてから操作してください');
      });
    }
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = Number(card.id.replace(/^q-/, ''));
      const item = dataById.get(id);
      if (!item || item.answer) return;
      const answer = card.querySelector('.qa-answer');
      if (!answer || answer.querySelector('.private-answer-locked')) return;
      answer.innerHTML = unavailable ? `
        <div class="private-answer-locked">
          <strong>個人向け回答を読み込めませんでした</strong>
          <p>接続を確認してから再読み込みしてください。</p>
          <button type="button" data-retry-library>再読み込み</button>
        </div>` : `
        <div class="private-answer-locked">
          <strong>個人向け回答例はログイン後に表示されます</strong>
          <p>公開ページには質問だけを残し、あなたの経歴・学校・在留資格・希望給与などを含む回答はSupabaseで保護しています。</p>
          <button type="button" data-open-login>ログインして回答を表示</button>
        </div>`;
    });
  }

  function currentLocalState(id) {
    let favorites = [];
    let practiced = [];
    let mastery = {};
    let ownAnswers = {};
    try { favorites = JSON.parse(localStorage.getItem('interview-favorites') || '[]'); } catch {}
    try { practiced = JSON.parse(localStorage.getItem('interview-practiced') || '[]'); } catch {}
    try { mastery = JSON.parse(localStorage.getItem('interview-mastery') || '{}') || {}; } catch {}
    try { ownAnswers = JSON.parse(localStorage.getItem('interview-own-answers') || '{}') || {}; } catch {}
    return {
      favorite: Array.isArray(favorites) && favorites.map(Number).includes(id),
      practiced: Array.isArray(practiced) && practiced.map(Number).includes(id),
      mastery: mastery[id] || null,
      own_answer: ownAnswers[id] || ''
    };
  }

  function syncStateSoon(id, field, options = {}) {
    if (!window.InterviewPrivateStore?.isReady?.()) return;
    const state = currentLocalState(id);
    window.InterviewPrivateStore.saveState(id, { [field]: state[field] }, options);
  }

  questionSections.addEventListener('click', event => {
    if (event.target.closest('[data-retry-library]')) {
      event.preventDefault();
      document.getElementById('retryLibraryLoad')?.click();
      return;
    }
    if (event.target.closest('[data-open-login]')) {
      event.preventDefault();
      window.InterviewPrivateStore?.openLogin?.();
      return;
    }
    const favorite = event.target.closest('[data-favorite-id]');
    if (favorite) return syncStateSoon(Number(favorite.dataset.favoriteId), 'favorite');
    const practiced = event.target.closest('[data-practiced-id]');
    if (practiced) return syncStateSoon(Number(practiced.dataset.practicedId), 'practiced');
    const mastery = event.target.closest('[data-mastery-id]');
    if (mastery) return syncStateSoon(Number(mastery.dataset.masteryId), 'mastery');
  });

  questionSections.addEventListener('input', event => {
    const textarea = event.target.closest('[data-own-answer-id]');
    if (!textarea) return;
    syncStateSoon(Number(textarea.dataset.ownAnswerId), 'own_answer', { debounce: true });
  });

  const syncBanner = document.createElement('div');
  syncBanner.className = 'sync-banner';
  syncBanner.hidden = true;
  syncBanner.innerHTML = '<span role="status" aria-live="polite"></span><button type="button" class="training-action" hidden>同期を再試行</button>';
  document.querySelector('.study-tools-wrap')?.append(syncBanner);
  syncBanner.querySelector('button').addEventListener('click', () => window.InterviewPrivateStore?.retry());
  const labels = {
    local: '端末保存済み・同期待ち', syncing: 'クラウドに同期中…', synced: 'クラウドに保存済み',
    error: '同期できませんでした。変更は端末に保存されています。',
    'local-error': '端末への保存に失敗しました。入力をコピーして保管してください。'
  };
  const states = new Map();
  let successTimer = null;
  function updateSyncUI() {
    if (!window.InterviewPrivateStore?.isAuthenticated?.()) {
      clearTimeout(successTimer);
      successTimer = null;
      states.clear();
      syncBanner.hidden = true;
      return;
    }
    document.querySelectorAll('[data-own-answer-id]').forEach(input => {
      const id = Number(input.dataset.ownAnswerId);
      const state = window.InterviewPrivateStore.getSyncStatus(id);
      if (state !== 'synced' || states.has(id)) states.set(id, state);
      const status = input.closest('.own-answer-editor')?.querySelector('.own-answer-status');
      const text = input.value || state !== 'synced' ? labels[state] : '未入力';
      if (status && status.textContent !== text) status.textContent = text;
    });
    const values = [...states.values()];
    const state = ['local-error', 'error', 'syncing', 'local'].find(value => values.includes(value)) || 'synced';
    syncBanner.hidden = !states.size;
    syncBanner.dataset.state = state;
    const text = syncBanner.querySelector('span');
    if (text.textContent !== labels[state]) text.textContent = labels[state];
    syncBanner.querySelector('button').hidden = !['local-error', 'error', 'local'].includes(state);
    if (state !== 'synced' || !states.size) {
      clearTimeout(successTimer);
      successTimer = null;
    } else if (successTimer === null) {
      successTimer = setTimeout(() => {
        successTimer = null;
        // Forget acknowledged saves so unrelated DOM updates cannot reopen the notice.
        for (const [id, status] of states) {
          if (status === 'synced') states.delete(id);
        }
        updateSyncUI();
      }, 2500);
    }
  }
  window.addEventListener('interview-sync', event => {
    states.set(event.detail.id, event.detail.status);
    updateSyncUI();
  });
  window.addEventListener('storage', event => {
    if (event.key?.startsWith('interview-pending-state:')) updateSyncUI();
  });

  const observer = new MutationObserver(() => requestAnimationFrame(() => { enhanceGuestLocks(); updateSyncUI(); }));
  observer.observe(questionSections, { childList: true, subtree: true });
  enhanceGuestLocks();
  updateSyncUI();
})();
