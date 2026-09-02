(() => {
  const data = window.INTERVIEW_DATA || [];
  const searchInput = document.getElementById('searchInput');
  const suggestions = document.getElementById('searchSuggestions');
  const categoryNav = document.getElementById('categoryNav');
  const questionSections = document.getElementById('questionSections');
  const resultSummary = document.getElementById('resultSummary');
  const emptyState = document.getElementById('emptyState');
  const clearSearchButton = document.getElementById('clearSearchButton');
  const questionCount = document.getElementById('questionCount');
  const themeButton = document.getElementById('themeButton');
  const expandAllButton = document.getElementById('expandAllButton');
  const toast = document.getElementById('toast');

  let activeCategory = 'all';
  let currentQuery = '';
  let activeSuggestion = -1;
  let speakingId = null;
  let toastTimer = null;
  let allExpanded = false;

  const normalize = (text) => (text || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  const categories = [...new Set(data.map(item => item.category))];

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const safe = escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return safe.replace(new RegExp(`(${escapedQuery})`, 'ig'), '<mark>$1</mark>'); }
    catch { return safe; }
  }

  function matches(item, query) {
    if (!query) return true;
    const haystack = normalize([item.question, item.questionZh, item.answer, ...(item.tags || [])].join(' '));
    return haystack.includes(normalize(query));
  }

  function filteredItems() {
    return data.filter(item => (activeCategory === 'all' || item.category === activeCategory) && matches(item, currentQuery));
  }

  function renderNav() {
    const buttons = [
      `<button class="category-link ${activeCategory === 'all' ? 'is-active' : ''}" data-category="all"><span>すべて</span><span>${data.length}</span></button>`,
      ...categories.map(category => {
        const count = data.filter(item => item.category === category).length;
        return `<button class="category-link ${activeCategory === category ? 'is-active' : ''}" data-category="${escapeHtml(category)}"><span>${escapeHtml(category)}</span><span>${count}</span></button>`;
      })
    ];
    categoryNav.innerHTML = buttons.join('');
  }

  function renderQuestions() {
    const items = filteredItems();
    const grouped = categories.map(category => [category, items.filter(item => item.category === category)]).filter(([, categoryItems]) => categoryItems.length);
    questionSections.innerHTML = grouped.map(([category, categoryItems]) => `
      <section class="category-section" id="section-${slugify(category)}">
        <div class="category-heading"><h3>${escapeHtml(category)}</h3><span>${categoryItems.length} questions</span></div>
        <div class="qa-list">${categoryItems.map(item => renderCard(item)).join('')}</div>
      </section>
    `).join('');
    emptyState.hidden = items.length !== 0;
    questionCount.textContent = data.length;
    resultSummary.textContent = currentQuery || activeCategory !== 'all' ? `${items.length}件の質問が一致しました` : 'すべての質問を表示しています';
    renderNav();
  }

  function renderCard(item) {
    const query = currentQuery.trim();
    return `
      <details class="qa-card" id="q-${item.id}" ${query ? 'open' : ''}>
        <summary>
          <span class="qa-index">${String(item.id).padStart(2, '0')}</span>
          <span class="qa-question"><strong>${highlight(item.question, query)}</strong><small>${highlight(item.questionZh || '', query)}</small></span>
          <span class="qa-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
        </summary>
        <div class="qa-answer">
          <div class="qa-toolbar"><button class="speech-button" type="button" data-speech-id="${item.id}" aria-label="この問答を読み上げる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg><span>音声で練習</span></button></div>
          <p class="answer-label">回答例</p>
          <div class="answer-text">${highlight(item.answer, query)}</div>
          ${(item.tags || []).length ? `<div class="tags">${item.tags.map(tag => `<span class="tag">${highlight(tag, query)}</span>`).join('')}</div>` : ''}
        </div>
      </details>`;
  }

  function slugify(text) { return encodeURIComponent(text).replace(/%/g, '').toLowerCase(); }

  function renderSuggestions() {
    const query = currentQuery.trim();
    if (!query) { suggestions.hidden = true; suggestions.innerHTML = ''; activeSuggestion = -1; return; }
    const candidates = data.filter(item => matches(item, query)).slice(0, 8);
    if (!candidates.length) { suggestions.hidden = false; suggestions.innerHTML = `<div class="suggestion" aria-disabled="true"><span class="suggestion__question">一致する質問がありません</span></div>`; return; }
    suggestions.hidden = false;
    suggestions.innerHTML = candidates.map((item, index) => `<button class="suggestion" type="button" role="option" data-suggestion-id="${item.id}" aria-selected="${index === activeSuggestion}"><span class="suggestion__meta"><span>Q${String(item.id).padStart(2, '0')}</span><span>${escapeHtml(item.category)}</span></span><span class="suggestion__question">${highlight(item.question, query)}</span></button>`).join('');
  }

  function selectSuggestion(id) {
    const item = data.find(entry => entry.id === Number(id));
    if (!item) return;
    activeCategory = 'all'; searchInput.value = ''; currentQuery = ''; suggestions.hidden = true; renderQuestions();
    requestAnimationFrame(() => {
      const card = document.getElementById(`q-${item.id}`);
      if (card) { card.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    });
  }

  function getJapaneseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find(v => v.lang === 'ja-JP') || voices.find(v => v.lang.startsWith('ja')) || null;
  }

  function stopSpeech() {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); speakingId = null;
    document.querySelectorAll('.speech-button').forEach(btn => { btn.classList.remove('is-speaking'); const span = btn.querySelector('span'); if (span) span.textContent = '音声で練習'; });
  }

  function speak(item, button) {
    if (!('speechSynthesis' in window)) { showToast('このブラウザは音声読み上げに対応していません'); return; }
    if (speakingId === item.id) { stopSpeech(); return; }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(`質問。${item.question}。回答例。${item.answer}`);
    utterance.lang = 'ja-JP'; utterance.rate = 0.92; utterance.pitch = 1;
    const voice = getJapaneseVoice(); if (voice) utterance.voice = voice;
    speakingId = item.id; button.classList.add('is-speaking'); button.querySelector('span').textContent = '停止';
    utterance.onend = stopSpeech; utterance.onerror = stopSpeech; window.speechSynthesis.speak(utterance);
  }

  function showToast(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('is-visible'); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200); }
  function applyTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem('interview-theme', theme); }
  function initTheme() { const saved = localStorage.getItem('interview-theme'); if (saved === 'light' || saved === 'dark') return applyTheme(saved); applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }

  function updateExpandAllButton() {
    const icon = expandAllButton.querySelector('svg');
    if (icon) {
      icon.style.transition = 'transform .2s ease';
      icon.style.transform = allExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    }
    expandAllButton.setAttribute('aria-pressed', String(allExpanded));
    expandAllButton.setAttribute('aria-label', allExpanded ? 'すべて閉じる' : 'すべて開く');
    expandAllButton.setAttribute('title', allExpanded ? 'すべて閉じる' : 'すべて開く');
  }

  searchInput.addEventListener('input', event => { currentQuery = event.target.value; activeCategory = 'all'; activeSuggestion = -1; renderQuestions(); renderSuggestions(); });
  searchInput.addEventListener('keydown', event => {
    const buttons = [...suggestions.querySelectorAll('[data-suggestion-id]')];
    if (!buttons.length) { if (event.key === 'Escape') suggestions.hidden = true; return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); activeSuggestion = (activeSuggestion + 1) % buttons.length; renderSuggestions(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); activeSuggestion = activeSuggestion <= 0 ? buttons.length - 1 : activeSuggestion - 1; renderSuggestions(); }
    else if (event.key === 'Enter' && activeSuggestion >= 0) { event.preventDefault(); selectSuggestion(buttons[activeSuggestion].dataset.suggestionId); }
    else if (event.key === 'Escape') suggestions.hidden = true;
  });
  suggestions.addEventListener('click', event => { const button = event.target.closest('[data-suggestion-id]'); if (button) selectSuggestion(button.dataset.suggestionId); });
  categoryNav.addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (!button) return; activeCategory = button.dataset.category; currentQuery = ''; searchInput.value = ''; renderQuestions(); window.scrollTo({ top: document.getElementById('questions').offsetTop - 86, behavior: 'smooth' }); });
  questionSections.addEventListener('click', event => { const button = event.target.closest('[data-speech-id]'); if (!button) return; event.preventDefault(); event.stopPropagation(); const item = data.find(entry => entry.id === Number(button.dataset.speechId)); if (item) speak(item, button); });
  clearSearchButton.addEventListener('click', () => { searchInput.value = ''; currentQuery = ''; activeCategory = 'all'; renderQuestions(); searchInput.focus(); });
  themeButton.addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(next); showToast(next === 'dark' ? '夜間モードに切り替えました' : '昼間モードに切り替えました'); });
  expandAllButton.addEventListener('click', () => {
    allExpanded = !allExpanded;
    document.querySelectorAll('.qa-card').forEach(card => { card.open = allExpanded; });
    updateExpandAllButton();
    showToast(allExpanded ? 'すべての回答を開きました' : 'すべての回答を閉じました');
  });
  document.addEventListener('click', event => { if (!event.target.closest('.search')) suggestions.hidden = true; });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.focus(); searchInput.select(); } });
  window.addEventListener('beforeunload', stopSpeech);
  initTheme();
  updateExpandAllButton();
  renderQuestions();
})();
