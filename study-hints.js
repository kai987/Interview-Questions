(() => {
  const dataById = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
  const studyTools = document.querySelector('.study-tools');
  const questionSections = document.getElementById('questionSections');
  if (!studyTools || !questionSections) return;

  let chineseHintsEnabled = localStorage.getItem('interview-chinese-hints') === 'true';
  let answerView = localStorage.getItem('interview-answer-view') === 'outline' ? 'outline' : 'full';

  function createButton(label, value, group) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'memory-toggle-button';
    button.dataset.toggleValue = value;
    button.dataset.toggleGroup = group;
    button.textContent = label;
    return button;
  }

  function createSegmentedControl(labelText, groupName, options) {
    const field = document.createElement('div');
    field.className = 'control-field';
    const label = document.createElement('span');
    label.className = 'control-field__label memory-toggle-label';
    label.textContent = labelText;
    const segment = document.createElement('div');
    segment.className = `memory-toggle-group ${groupName}-control`;
    segment.setAttribute('role', 'group');
    segment.setAttribute('aria-label', labelText);
    options.forEach(([labelTextValue, value]) => segment.append(createButton(labelTextValue, value, groupName)));
    field.append(label, segment);
    return field;
  }

  function injectControls() {
    if (document.querySelector('.study-memory-controls')) return;
    const controls = document.createElement('div');
    controls.className = 'study-memory-controls';
    controls.append(
      createSegmentedControl('練習時 中文提示', 'chinese', [['OFF','off'],['ON','on']]),
      createSegmentedControl('回答表示', 'answer', [['全文','full'],['キーワード','outline']])
    );
    studyTools.appendChild(controls);

    controls.addEventListener('click', event => {
      const button = event.target.closest('.memory-toggle-button');
      if (!button) return;
      if (button.dataset.toggleGroup === 'chinese') {
        chineseHintsEnabled = button.dataset.toggleValue === 'on';
        localStorage.setItem('interview-chinese-hints', String(chineseHintsEnabled));
      } else if (button.dataset.toggleGroup === 'answer') {
        answerView = button.dataset.toggleValue === 'outline' ? 'outline' : 'full';
        localStorage.setItem('interview-answer-view', answerView);
      }
      applyState();
    });
  }

  function buildOutline(id) {
    const item = dataById.get(id);
    const text = item?.outline || '';
    if (!text) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'answer-outline';
    const title = document.createElement('div');
    title.className = 'answer-outline__title';
    title.textContent = 'キーワード提綱';
    wrapper.appendChild(title);
    const flow = document.createElement('div');
    flow.className = 'answer-outline__flow';
    const parts = text.split('→').map(part => part.trim()).filter(Boolean);
    parts.forEach((part, index) => {
      const chip = document.createElement('span');
      chip.className = 'answer-outline__chip';
      chip.textContent = part;
      flow.appendChild(chip);
      if (index < parts.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'answer-outline__arrow';
        arrow.textContent = '→';
        flow.appendChild(arrow);
      }
    });
    wrapper.appendChild(flow);
    return wrapper;
  }

  function enhanceCards() {
    document.querySelectorAll('.qa-card').forEach(card => {
      const id = Number(card.id.replace(/^q-/, ''));
      if (!Number.isFinite(id)) return;
      const answerText = card.querySelector('.answer-text');
      const existing = card.querySelector('.answer-outline');
      if (existing) existing.remove();
      if (!answerText) return;
      const outline = buildOutline(id);
      if (outline) answerText.before(outline);
    });
  }

  function applyState() {
    document.body.classList.toggle('chinese-hints-on', chineseHintsEnabled);
    document.body.classList.toggle('chinese-hints-off', !chineseHintsEnabled);
    document.body.classList.toggle('answer-view-outline', answerView === 'outline');
    document.body.classList.toggle('answer-view-full', answerView === 'full');
    document.querySelectorAll('[data-toggle-group="chinese"]').forEach(button => {
      const active = (button.dataset.toggleValue === 'on') === chineseHintsEnabled;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-toggle-group="answer"]').forEach(button => {
      const active = button.dataset.toggleValue === answerView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  injectControls();
  enhanceCards();
  applyState();

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceCards();
      applyState();
    });
  });
  observer.observe(questionSections, { childList: true, subtree: true });
})();
