(() => {
  const questionSections = document.getElementById('questionSections');
  if (!questionSections) return;

  const dataById = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));

  function enhanceGuestLocks() {
    if (window.InterviewPrivateStore?.isAuthenticated?.()) return;
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = Number(card.id.replace(/^q-/, ''));
      const item = dataById.get(id);
      if (!item || item.answer) return;
      const answer = card.querySelector('.qa-answer');
      if (!answer || answer.querySelector('.private-answer-locked')) return;
      answer.innerHTML = `
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
      favorite: favorites.map(Number).includes(id),
      practiced: practiced.map(Number).includes(id),
      mastery: mastery[id] || null,
      own_answer: ownAnswers[id] || ''
    };
  }

  function syncStateSoon(id, options = {}) {
    if (!window.InterviewPrivateStore?.isAuthenticated?.()) return;
    setTimeout(() => {
      const state = currentLocalState(id);
      window.InterviewPrivateStore.saveState(id, state, options);
    }, 0);
  }

  questionSections.addEventListener('click', event => {
    if (event.target.closest('[data-open-login]')) {
      event.preventDefault();
      window.InterviewPrivateStore?.openLogin?.();
      return;
    }
    const favorite = event.target.closest('[data-favorite-id]');
    if (favorite) return syncStateSoon(Number(favorite.dataset.favoriteId));
    const practiced = event.target.closest('[data-practiced-id]');
    if (practiced) return syncStateSoon(Number(practiced.dataset.practicedId));
    const mastery = event.target.closest('[data-mastery-id]');
    if (mastery) return syncStateSoon(Number(mastery.dataset.masteryId));
  }, true);

  questionSections.addEventListener('input', event => {
    const textarea = event.target.closest('[data-own-answer-id]');
    if (!textarea) return;
    syncStateSoon(Number(textarea.dataset.ownAnswerId), { debounce: true });
  }, true);

  const observer = new MutationObserver(() => requestAnimationFrame(enhanceGuestLocks));
  observer.observe(questionSections, { childList: true, subtree: true });
  enhanceGuestLocks();
})();
