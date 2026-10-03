(() => {
  const data = window.INTERVIEW_DATA || [];
  const questionSections = document.getElementById('questionSections');
  const resultSummary = document.getElementById('resultSummary');
  const searchInput = document.getElementById('searchInput');
  const categoryNav = document.getElementById('categoryNav');
  const practiceModeButton = document.getElementById('practiceModeButton');
  const randomSource = document.getElementById('randomSource');
  const randomPracticeButton = document.getElementById('randomPracticeButton');
  const randomResetButton = document.getElementById('randomResetButton');
  const randomSessionLabel = document.getElementById('randomSessionLabel');
  const timerSecondsButtons = [...document.querySelectorAll('[data-timer-seconds]')];
  const toast = document.getElementById('toast');

  if (!questionSections || !data.length) return;

  const MASTERY_KEY = 'interview-mastery';
  const OWN_ANSWERS_KEY = 'interview-own-answers';
  const TIMER_SECONDS_KEY = 'interview-timer-seconds';

  let mastery = loadObject(MASTERY_KEY);
  let ownAnswers = loadObject(OWN_ANSWERS_KEY);
  let selectedTimerSeconds = Number(localStorage.getItem(TIMER_SECONDS_KEY)) || 60;
  if (![30, 60, 90].includes(selectedTimerSeconds)) selectedTimerSeconds = 60;

  let activeTimerId = null;
  let activeTimerRemaining = 0;
  let activeTimerEndsAt = 0;
  let timerInterval = null;
  const finishedTimerIds = new Set();
  let randomIds = null;
  let sessionIds = [];
  let sessionIndex = 0;
  let sessionRatings = {};
  let sessionDone = false;
  const history = loadObject('interview-review-history');
  const sessionStore = window.InterviewPracticeSessions.create({
    storage: localStorage,
    ownerId: window.InterviewPrivateStore?.getOwnerId?.(),
    setId: window.InterviewLibrary?.activeSet?.id,
    questionIds: data.filter(item => item.category !== '逆質問').map(item => Number(item.id))
  });
  let savedSession = sessionStore.load();
  let sessionSaveFailed = false;
  const sessionPanel = document.createElement('section');
  sessionPanel.className = 'practice-session';
  sessionPanel.hidden = true;
  sessionPanel.setAttribute('aria-label', '模擬面接の進行');
  questionSections.before(sessionPanel);
  const resumePanel = document.createElement('section');
  resumePanel.className = 'practice-session practice-resume';
  resumePanel.setAttribute('aria-label', '中断した模擬面接');
  sessionPanel.before(resumePanel);
  let observerQueued = false;
  let toastTimer = null;

  function loadObject(key) {
    let result = {};
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) result = value;
    } catch {}
    const field = { 'interview-mastery': 'mastery', 'interview-own-answers': 'own_answer', 'interview-review-history': 'last_practiced_at' }[key];
    if (field) {
      for (const item of data) {
        const state = window.InterviewPrivateStore?.getState?.(item.id);
        if (!state) continue;
        if (state[field]) result[item.id] = state[field];
        else delete result[item.id];
      }
    }
    return result;
  }

  function saveObject(key, value) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      const next = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
      for (const { id } of data) {
        if (Object.hasOwn(value, id)) next[id] = value[id];
        else delete next[id];
      }
      localStorage.setItem(key, JSON.stringify(next));
      return true;
    } catch { return false; }
  }

  function loadIdSet(key) {
    let result = new Set();
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      result = new Set(Array.isArray(value) ? value.map(Number).filter(id => data.some(item => Number(item.id) === id)) : []);
    } catch {}
    const field = key === 'interview-favorites' ? 'favorite' : 'practiced';
    for (const item of data) {
      const state = window.InterviewPrivateStore?.getState?.(item.id);
      if (state) state[field] ? result.add(Number(item.id)) : result.delete(Number(item.id));
    }
    return result;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'
    }[char]));
  }

  function formatSeconds(total) {
    const safe = Math.max(0, Number(total) || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function showToast(message) {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function itemIdFromCard(card) {
    return Number(card?.id?.replace(/^q-/, ''));
  }

  function renderWorkbench(id) {
    const level = mastery[id] || '';
    const text = ownAnswers[id] || '';
    return `
      <div class="training-workbench" data-training-id="${id}">
        <div class="training-workbench__top">
          <div class="answer-timer" aria-label="回答タイマー">
            <button class="answer-timer__button" type="button" data-timer-id="${id}">
              <span aria-hidden="true">▶</span><span>回答開始</span>
            </button>
            <span class="answer-timer__display" data-timer-display="${id}">${formatSeconds(selectedTimerSeconds)}</span>
          </div>
          <div class="mastery-control" role="group" aria-label="この質問の習熟度">
            <span class="training-label">習熟度</span>
            <button type="button" class="mastery-button ${level === 'learning' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="learning">まだ</button>
            <button type="button" class="mastery-button ${level === 'okay' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="okay">普通</button>
            <button type="button" class="mastery-button ${level === 'confident' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="confident">自信あり</button>
          </div>
        </div>
        <details class="own-answer-editor" ${text ? 'open' : ''}>
          <summary>
            <span>自分の回答</span>
            <span class="own-answer-status">${text ? '端末保存済み' : '未入力'}</span>
          </summary>
          <div class="own-answer-editor__body">
            <textarea data-own-answer-id="${id}" rows="6" maxlength="20000" aria-label="自分の回答" placeholder="自分の言葉で回答を書いてください。例文を丸暗記せず、結論 → 具体例 → この会社でどう活かすか、の順で整理すると話しやすくなります。">${escapeHtml(text)}</textarea>
            <div class="own-answer-editor__footer">
              <span data-own-answer-count="${id}">${text.length} 文字</span>
              <span>入力は端末に保存し、ログイン中はクラウドへ同期します</span>
            </div>
          </div>
        </details>
      </div>`;
  }

  function syncCardMastery(card, id) {
    const level = mastery[id] || '';
    if (card.dataset.mastery !== level) card.dataset.mastery = level;
    card.classList.toggle('mastery-learning', level === 'learning');
    card.classList.toggle('mastery-okay', level === 'okay');
    card.classList.toggle('mastery-confident', level === 'confident');
    card.querySelectorAll('[data-mastery-id]').forEach(button => {
      const active = button.dataset.masteryLevel === level;
      button.classList.toggle('is-active', active);
      if (button.getAttribute('aria-pressed') !== String(active)) button.setAttribute('aria-pressed', String(active));
    });
  }

  function enhanceCards() {
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = itemIdFromCard(card);
      if (!Number.isFinite(id)) return;
      if (!card.querySelector('.training-workbench')) {
        const reveal = card.querySelector('.practice-reveal');
        if (reveal) reveal.insertAdjacentHTML('afterend', renderWorkbench(id));
      }
      syncCardMastery(card, id);
      syncTimerCard(card, id);
    });
    updateTimerDisplays();
    applyRandomFilter();
  }

  function queueEnhance() {
    if (observerQueued) return;
    observerQueued = true;
    requestAnimationFrame(() => {
      observerQueued = false;
      enhanceCards();
    });
  }

  function setTimerSeconds(seconds) {
    const next = Number(seconds);
    if (![30, 60, 90].includes(next)) return;
    selectedTimerSeconds = next;
    localStorage.setItem(TIMER_SECONDS_KEY, String(next));
    timerSecondsButtons.forEach(button => {
      const active = Number(button.dataset.timerSeconds) === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (activeTimerId === null) updateTimerDisplays();
  }

  function updateTimerDisplays() {
    document.querySelectorAll('[data-timer-display]').forEach(display => {
      const id = Number(display.dataset.timerDisplay);
      const seconds = id === activeTimerId ? activeTimerRemaining : finishedTimerIds.has(id) ? 0 : selectedTimerSeconds;
      const text = formatSeconds(seconds);
      if (display.textContent !== text) display.textContent = text;
    });
  }

  function syncTimerCard(card, id) {
    const running = id === activeTimerId;
    const finished = finishedTimerIds.has(id);
    card.classList.toggle('timer-running', running);
    card.classList.toggle('timer-finished', finished);
    const button = card.querySelector(`[data-timer-id="${id}"]`);
    if (!button) return;
    const icon = running ? '■' : finished ? '↻' : '▶';
    const label = running ? '停止' : finished ? 'もう一度' : '回答開始';
    const [iconElement, labelElement] = button.querySelectorAll('span');
    if (iconElement && iconElement.textContent !== icon) iconElement.textContent = icon;
    if (labelElement && labelElement.textContent !== label) labelElement.textContent = label;
  }

  function resetTimerCard(id) {
    finishedTimerIds.delete(id);
    const card = document.getElementById(`q-${id}`);
    if (card) syncTimerCard(card, id);
    updateTimerDisplays();
  }

  function stopActiveTimer(reset = true) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    const previousId = activeTimerId;
    activeTimerId = null;
    activeTimerRemaining = 0;
    activeTimerEndsAt = 0;
    if (reset && previousId !== null) resetTimerCard(previousId);
  }

  function finishTimer(id) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    activeTimerId = null;
    activeTimerRemaining = 0;
    activeTimerEndsAt = 0;
    finishedTimerIds.add(id);
    const card = document.getElementById(`q-${id}`);
    if (card) syncTimerCard(card, id);
    updateTimerDisplays();
    showToast('回答時間が終了しました');
  }

  function tickTimer() {
    if (activeTimerId === null) return;
    // Use elapsed time so background-tab throttling does not extend the answer limit.
    activeTimerRemaining = Math.max(0, Math.ceil((activeTimerEndsAt - Date.now()) / 1000));
    if (activeTimerRemaining === 0) finishTimer(activeTimerId);
    else updateTimerDisplays();
  }

  function startTimer(id) {
    if (activeTimerId === id) {
      stopActiveTimer(true);
      return;
    }
    if (activeTimerId !== null) stopActiveTimer(true);
    const card = document.getElementById(`q-${id}`);
    if (!card) return;
    finishedTimerIds.delete(id);
    activeTimerId = id;
    activeTimerRemaining = selectedTimerSeconds;
    activeTimerEndsAt = Date.now() + selectedTimerSeconds * 1000;
    syncTimerCard(card, id);
    updateTimerDisplays();
    timerInterval = setInterval(tickTimer, 1000);
  }

  function setMastery(id, level) {
    if (!['learning', 'okay', 'confident'].includes(level)) return;
    if (mastery[id] === level) delete mastery[id];
    else mastery[id] = level;
    if (randomIds && !sessionDone) {
      mastery[id] = level;
      sessionRatings[id] = level;
      history[id] = new Date().toISOString();
      saveObject('interview-review-history', history);
      window.dispatchEvent(new CustomEvent('interview-session-rated', { detail: { id } }));
      window.InterviewPrivateStore?.saveState(id, { mastery: level, practiced: true, last_practiced_at: history[id] });
      renderSessionPanel();
    } else {
      window.InterviewPrivateStore?.saveState(id, { mastery: mastery[id] || null });
    }
    saveObject(MASTERY_KEY, mastery);
    const card = document.getElementById(`q-${id}`);
    if (card) syncCardMastery(card, id);
  }

  function saveOwnAnswer(id, value) {
    if (value.trim()) ownAnswers[id] = value;
    else delete ownAnswers[id];
    const cached = saveObject(OWN_ANSWERS_KEY, ownAnswers);
    const editor = document.querySelector(`[data-own-answer-id="${id}"]`)?.closest('.own-answer-editor');
    const status = editor?.querySelector('.own-answer-status');
    const count = editor?.querySelector(`[data-own-answer-count="${id}"]`);
    if (status) status.textContent = cached ? (value.trim() ? '端末保存済み' : '未入力') : '端末への保存に失敗しました。入力をコピーして保管してください。';
    if (count) count.textContent = `${value.length} 文字`;
    // The current input is authoritative even if writing the UI cache failed.
    window.InterviewPrivateStore?.saveState(id, { own_answer: value.trim() ? value : '' }, { debounce: true });
  }

  function shuffledSample(values, count) {
    const copy = [...values];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(count, copy.length));
  }

  function randomCandidates(source) {
    const ids = data.filter(item => item.category !== '逆質問').map(item => Number(item.id));
    if (source === 'favorites') {
      const favorites = loadIdSet('interview-favorites');
      return ids.filter(id => favorites.has(id));
    }
    if (source === 'remaining') {
      const practiced = loadIdSet('interview-practiced');
      return ids.filter(id => !practiced.has(id));
    }
    if (source === 'review') return ids.filter(id => {
      const last = Date.parse(history[id] || '');
      const days = mastery[id] === 'confident' ? 7 : mastery[id] === 'okay' ? 3 : 1;
      return !Number.isFinite(last) || Date.now() - last >= days * 86400000;
    });
    return ids;
  }

  function updateRandomUI() {
    const active = randomIds instanceof Set;
    if (randomResetButton) randomResetButton.hidden = !active;
    if (randomPracticeButton) randomPracticeButton.textContent = active ? '10問を出し直す' : '10問出題';
    if (randomSessionLabel) {
      randomSessionLabel.hidden = !active;
      randomSessionLabel.textContent = active ? `ランダム練習中：${randomIds.size}問` : '';
    }
  }

  function renderResumePanel() {
    resumePanel.hidden = !savedSession || Boolean(randomIds);
    if (resumePanel.hidden) return;
    const ready = Boolean(window.InterviewPrivateStore?.isReady?.());
    resumePanel.innerHTML = `<h3>中断した模擬面接があります</h3>
      <p>${savedSession.ids.length}問中 ${savedSession.index + 1}問目から再開できます。${ready ? 'タイマーと音声は停止した状態で再開します。' : '学習状態を再読み込みしてから再開してください。'}</p>
      <button type="button" class="training-action training-action--primary" data-resume-action="resume" ${ready ? '' : 'disabled'}>前回の続きから</button>
      <button type="button" class="training-action" data-resume-action="discard">この練習を終了</button>`;
  }

  function clearSavedSession() {
    savedSession = null;
    if (!sessionStore.clear()) showToast('練習の進行記録を端末から削除できませんでした');
    renderResumePanel();
  }

  function persistSession() {
    if (!randomIds || sessionDone) return;
    savedSession = { ids: [...sessionIds], index: sessionIndex, ratings: { ...sessionRatings } };
    const saved = sessionStore.save(savedSession);
    if (!saved && !sessionSaveFailed) showToast('練習の進行を端末に保存できません。ページを閉じると再開できません。');
    sessionSaveFailed = !saved;
  }

  resumePanel.addEventListener('click', event => {
    const action = event.target.closest('[data-resume-action]')?.dataset.resumeAction;
    if (action === 'resume' && savedSession) beginSession(savedSession.ids, savedSession);
    if (action === 'discard') clearSavedSession();
  });

  function renderSessionPanel() {
    sessionPanel.hidden = !randomIds;
    if (!randomIds) return;
    if (sessionDone) {
      const counts = Object.values(sessionRatings);
      const review = sessionIds.filter(id => sessionRatings[id] !== 'confident');
      sessionPanel.innerHTML = `<h3 tabindex="-1">練習お疲れさまでした</h3>
        <p>${sessionIds.length}問中 ${counts.length}問を自己評価しました。自信あり ${counts.filter(v => v === 'confident').length}問・復習候補 ${review.length}問</p>
        <p>評価しなかった質問も、復習候補に含めています。</p>
        <ul>${review.map(id => `<li>${escapeHtml(data.find(item => Number(item.id) === id)?.question || '')}</li>`).join('')}</ul>
        <button type="button" class="training-action training-action--primary" data-session-action="review" ${review.length ? '' : 'disabled'}>復習候補をもう一度</button>
        <button type="button" class="training-action" data-session-action="exit">質問一覧へ戻る</button>`;
    } else {
      const id = sessionIds[sessionIndex];
      const rated = Boolean(sessionRatings[id]);
      sessionPanel.innerHTML = `<div class="practice-session__heading"><h3 tabindex="-1">模擬面接 · ${sessionIndex + 1} / ${sessionIds.length}問</h3><button type="button" class="training-action" data-session-action="exit">練習を終了</button></div>
        <progress value="${sessionIndex}" max="${sessionIds.length}" aria-label="完了した質問数"></progress>
        <p role="status">${rated ? '自己評価を記録しました。次へ進めます。' : '回答開始 → 自分の言葉で話す → 回答例を見る → 習熟度を選ぶ'}</p>
        <button type="button" class="training-action training-action--primary" data-session-action="next" ${rated ? '' : 'disabled'}>${sessionIndex + 1 === sessionIds.length ? '結果を見る' : '次の質問へ'}</button>
        <button type="button" class="training-action" data-session-action="skip">${sessionIndex + 1 === sessionIds.length ? '評価せず結果を見る' : '後で復習する'}</button>`;
    }
  }

  function applyRandomFilter() {
    if (!(randomIds instanceof Set)) return;
    document.querySelectorAll('.qa-card').forEach(card => {
      card.hidden = sessionDone || itemIdFromCard(card) !== sessionIds[sessionIndex];
    });
    document.querySelectorAll('.category-section').forEach(section => {
      section.hidden = ![...section.querySelectorAll('.qa-card')].some(card => !card.hidden);
      const count = section.querySelector('.category-heading > span');
      if (count && !section.hidden && count.textContent !== '今回の質問') count.textContent = '今回の質問';
    });
    const summary = sessionDone ? '模擬面接の振り返り' : `模擬面接：${sessionIndex + 1} / ${sessionIds.length}問`;
    if (resultSummary && resultSummary.textContent !== summary) resultSummary.textContent = summary;
    window.dispatchEvent(new Event('interview-session-step'));
  }

  function beginSession(ids, restored = null) {
    if (!window.InterviewPrivateStore?.isReady?.()) return;
    stopActiveTimer();
    window.InterviewAudioPlayer?.stop();
    sessionIds = ids;
    sessionIndex = restored?.index ?? 0;
    sessionRatings = { ...(restored?.ratings || {}) };
    sessionDone = false;
    randomIds = new Set(ids);
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new Event('interview-session-start'));
    if (practiceModeButton?.getAttribute('aria-pressed') !== 'true') practiceModeButton?.click();
    updateRandomUI();
    persistSession();
    renderResumePanel();
    renderSessionPanel();
    enhanceCards();
    sessionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sessionPanel.querySelector('h3')?.focus({ preventScroll: true });
  }

  sessionPanel.addEventListener('click', event => {
    const action = event.target.closest('[data-session-action]')?.dataset.sessionAction;
    if (!action) return;
    if (action === 'exit') { clearRandomPractice(); return; }
    if (action === 'review') { beginSession(sessionIds.filter(id => sessionRatings[id] !== 'confident')); return; }
    if (action === 'next' && !sessionRatings[sessionIds[sessionIndex]]) return;
    stopActiveTimer();
    window.InterviewAudioPlayer?.stop();
    sessionIndex += 1;
    sessionDone = sessionIndex >= sessionIds.length;
    if (sessionDone) clearSavedSession();
    else persistSession();
    renderSessionPanel();
    applyRandomFilter();
    sessionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sessionPanel.querySelector('h3')?.focus({ preventScroll: true });
  });

  function clearRandomPractice({ rerender = true, discard = true } = {}) {
    if (!discard) persistSession();
    randomIds = null;
    if (discard) clearSavedSession();
    stopActiveTimer();
    window.InterviewAudioPlayer?.stop();
    sessionPanel.hidden = true;
    updateRandomUI();
    renderResumePanel();
    document.querySelectorAll('.qa-card, .category-section').forEach(element => { element.hidden = false; });
    if (rerender && searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function startRandomPractice() {
    const source = randomSource?.value || 'all';
    const candidates = randomCandidates(source);
    if (!candidates.length) {
      showToast(source === 'favorites' ? '重点問題がまだありません' : source === 'review' ? '今日の復習は完了しています' : '対象になる未練習問題がありません');
      return;
    }
    beginSession(shuffledSample(candidates, 10));
  }

  document.getElementById('normalModeButton')?.addEventListener('click', () => { if (randomIds) clearRandomPractice({ discard: false }); });

  timerSecondsButtons.forEach(button => {
    button.addEventListener('click', () => setTimerSeconds(button.dataset.timerSeconds));
  });

  randomPracticeButton?.addEventListener('click', startRandomPractice);
  randomResetButton?.addEventListener('click', () => {
    clearRandomPractice();
    showToast('ランダム練習を終了しました');
  });

  searchInput?.addEventListener('input', () => {
    if (randomIds instanceof Set && searchInput.value.trim()) clearRandomPractice({ rerender: false, discard: false });
  }, { capture: true });

  categoryNav?.addEventListener('click', () => {
    if (randomIds instanceof Set) clearRandomPractice({ rerender: false, discard: false });
  }, { capture: true });

  questionSections.addEventListener('click', event => {
    const timerButton = event.target.closest('[data-timer-id]');
    if (timerButton) {
      event.preventDefault();
      event.stopPropagation();
      startTimer(Number(timerButton.dataset.timerId));
      return;
    }
    const masteryButton = event.target.closest('[data-mastery-id]');
    if (masteryButton) {
      event.preventDefault();
      event.stopPropagation();
      setMastery(Number(masteryButton.dataset.masteryId), masteryButton.dataset.masteryLevel);
    }
  });

  questionSections.addEventListener('input', event => {
    const textarea = event.target.closest('[data-own-answer-id]');
    if (!textarea) return;
    saveOwnAnswer(Number(textarea.dataset.ownAnswerId), textarea.value);
  });

  const observer = new MutationObserver(records => {
    // Timer ticks, audio progress, and editor text do not introduce new cards.
    const cardsAdded = records.some(record => [...record.addedNodes].some(node =>
      node.nodeType === 1 && (node.matches('.qa-card') || node.querySelector('.qa-card'))));
    if (cardsAdded) queueEnhance();
  });
  observer.observe(questionSections, { childList: true, subtree: true });

  setTimerSeconds(selectedTimerSeconds);
  updateRandomUI();
  renderResumePanel();
  enhanceCards();
  window.addEventListener('interview-session-rated', persistSession);
  document.addEventListener('visibilitychange', tickTimer);
  window.addEventListener('beforeunload', () => stopActiveTimer(false));
})();
