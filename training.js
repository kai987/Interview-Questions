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
  let timerInterval = null;
  let randomIds = null;
  let observerQueued = false;
  let toastTimer = null;

  function loadObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function saveObject(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadIdSet(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []);
    } catch {
      return new Set();
    }
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
          <div class="mastery-control" role="group" aria-label="この質問の掌握度">
            <span class="training-label">掌握度</span>
            <button type="button" class="mastery-button ${level === 'learning' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="learning">まだ</button>
            <button type="button" class="mastery-button ${level === 'okay' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="okay">普通</button>
            <button type="button" class="mastery-button ${level === 'confident' ? 'is-active' : ''}" data-mastery-id="${id}" data-mastery-level="confident">自信あり</button>
          </div>
        </div>
        <details class="own-answer-editor" ${text ? 'open' : ''}>
          <summary>
            <span>自分の回答</span>
            <span class="own-answer-status">${text ? '保存済み' : '未入力'}</span>
          </summary>
          <div class="own-answer-editor__body">
            <textarea data-own-answer-id="${id}" rows="6" placeholder="自分の言葉で回答を書いてください。例文を丸暗記せず、結論 → 具体例 → この会社でどう活かすか、の順で整理すると話しやすくなります。">${escapeHtml(text)}</textarea>
            <div class="own-answer-editor__footer">
              <span data-own-answer-count="${id}">${text.length} 文字</span>
              <span>入力内容はこのブラウザに自動保存されます</span>
            </div>
          </div>
        </details>
      </div>`;
  }

  function syncCardMastery(card, id) {
    const level = mastery[id] || '';
    card.dataset.mastery = level;
    card.classList.toggle('mastery-learning', level === 'learning');
    card.classList.toggle('mastery-okay', level === 'okay');
    card.classList.toggle('mastery-confident', level === 'confident');
    card.querySelectorAll('[data-mastery-id]').forEach(button => {
      const active = button.dataset.masteryLevel === level;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
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
      display.textContent = id === activeTimerId ? formatSeconds(activeTimerRemaining) : formatSeconds(selectedTimerSeconds);
    });
  }

  function resetTimerCard(id) {
    const card = document.getElementById(`q-${id}`);
    card?.classList.remove('timer-running', 'timer-finished');
    const button = card?.querySelector(`[data-timer-id="${id}"]`);
    if (button) button.innerHTML = '<span aria-hidden="true">▶</span><span>回答開始</span>';
    const display = card?.querySelector(`[data-timer-display="${id}"]`);
    if (display) display.textContent = formatSeconds(selectedTimerSeconds);
  }

  function stopActiveTimer(reset = true) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    const previousId = activeTimerId;
    activeTimerId = null;
    activeTimerRemaining = 0;
    if (reset && previousId !== null) resetTimerCard(previousId);
  }

  function finishTimer(id) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    activeTimerId = null;
    activeTimerRemaining = 0;
    const card = document.getElementById(`q-${id}`);
    card?.classList.remove('timer-running');
    card?.classList.add('timer-finished');
    const button = card?.querySelector(`[data-timer-id="${id}"]`);
    if (button) button.innerHTML = '<span aria-hidden="true">↻</span><span>もう一度</span>';
    const display = card?.querySelector(`[data-timer-display="${id}"]`);
    if (display) display.textContent = '00:00';
    showToast('回答時間が終了しました');
  }

  function startTimer(id) {
    if (activeTimerId === id) {
      stopActiveTimer(true);
      return;
    }
    if (activeTimerId !== null) stopActiveTimer(true);
    const card = document.getElementById(`q-${id}`);
    if (!card) return;
    card.classList.remove('timer-finished');
    card.classList.add('timer-running');
    activeTimerId = id;
    activeTimerRemaining = selectedTimerSeconds;
    const button = card.querySelector(`[data-timer-id="${id}"]`);
    if (button) button.innerHTML = '<span aria-hidden="true">■</span><span>停止</span>';
    updateTimerDisplays();
    timerInterval = setInterval(() => {
      activeTimerRemaining -= 1;
      const display = document.querySelector(`[data-timer-display="${id}"]`);
      if (display) display.textContent = formatSeconds(activeTimerRemaining);
      if (activeTimerRemaining <= 0) finishTimer(id);
    }, 1000);
  }

  function setMastery(id, level) {
    if (!['learning', 'okay', 'confident'].includes(level)) return;
    if (mastery[id] === level) delete mastery[id];
    else mastery[id] = level;
    saveObject(MASTERY_KEY, mastery);
    const card = document.getElementById(`q-${id}`);
    if (card) syncCardMastery(card, id);
  }

  function saveOwnAnswer(id, value) {
    if (value.trim()) ownAnswers[id] = value;
    else delete ownAnswers[id];
    saveObject(OWN_ANSWERS_KEY, ownAnswers);
    const editor = document.querySelector(`[data-own-answer-id="${id}"]`)?.closest('.own-answer-editor');
    const status = editor?.querySelector('.own-answer-status');
    const count = editor?.querySelector(`[data-own-answer-count="${id}"]`);
    if (status) status.textContent = value.trim() ? '保存済み' : '未入力';
    if (count) count.textContent = `${value.length} 文字`;
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
    const ids = data.map(item => Number(item.id));
    if (source === 'favorites') {
      const favorites = loadIdSet('interview-favorites');
      return ids.filter(id => favorites.has(id));
    }
    if (source === 'remaining') {
      const practiced = loadIdSet('interview-practiced');
      return ids.filter(id => !practiced.has(id));
    }
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

  function applyRandomFilter() {
    if (!(randomIds instanceof Set)) return;
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = itemIdFromCard(card);
      card.hidden = !randomIds.has(id);
    });
    document.querySelectorAll('.category-section').forEach(section => {
      const visible = [...section.querySelectorAll('.qa-card')].some(card => !card.hidden);
      section.hidden = !visible;
    });
    if (resultSummary) resultSummary.textContent = `ランダム練習：${randomIds.size}問を表示しています`;
  }

  function clearRandomPractice({ rerender = true } = {}) {
    randomIds = null;
    updateRandomUI();
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
      showToast(source === 'favorites' ? '重点問題がまだありません' : '対象になる未練習問題がありません');
      return;
    }
    randomIds = new Set(shuffledSample(candidates, 10));
    if (searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (practiceModeButton?.getAttribute('aria-pressed') !== 'true') practiceModeButton?.click();
    updateRandomUI();
    requestAnimationFrame(() => {
      enhanceCards();
      document.getElementById('questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    showToast(`${randomIds.size}問のランダム練習を開始しました`);
  }

  timerSecondsButtons.forEach(button => {
    button.addEventListener('click', () => setTimerSeconds(button.dataset.timerSeconds));
  });

  randomPracticeButton?.addEventListener('click', startRandomPractice);
  randomResetButton?.addEventListener('click', () => {
    clearRandomPractice();
    showToast('ランダム練習を終了しました');
  });

  searchInput?.addEventListener('input', () => {
    if (randomIds instanceof Set && searchInput.value.trim()) clearRandomPractice({ rerender: false });
  }, { capture: true });

  categoryNav?.addEventListener('click', () => {
    if (randomIds instanceof Set) clearRandomPractice({ rerender: false });
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

  const observer = new MutationObserver(queueEnhance);
  observer.observe(questionSections, { childList: true, subtree: true });

  setTimerSeconds(selectedTimerSeconds);
  updateRandomUI();
  enhanceCards();
  window.addEventListener('beforeunload', () => stopActiveTimer(false));
})();
