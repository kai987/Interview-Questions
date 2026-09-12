(() => {
  const root = document.getElementById('questionSections');
  if (!root) return;
  const byId = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
  const selection = new Map();
  const labels = { short: '30秒・結論', standard: '60秒・標準', full: '深掘り・全文' };
  function selected(item) { return selection.get(Number(item.id)) || 'full'; }
  function text(item) { return item.answerVariants?.[selected(item)] || item.answer || ''; }
  window.InterviewAnswers = { text, selected };
  function enhance() {
    root.querySelectorAll('.qa-card').forEach(card => {
      const item = byId.get(Number(card.id.slice(2)));
      if (!item?.answerVariants?.short || card.querySelector('.answer-length-control')) return;
      const toolbar = card.querySelector('.qa-toolbar');
      if (!toolbar) return;
      const controls = document.createElement('div');
      controls.className = 'answer-length-control';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', '回答例の長さ');
      for (const [value, label] of Object.entries(labels)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'training-action';
        button.textContent = label; button.dataset.answerLength = value;
        button.setAttribute('aria-pressed', String(selected(item) === value));
        controls.append(button);
      }
      const note = document.createElement('p'); note.className = 'answer-duration-note';
      note.textContent = '時間は目安です。声に出して、自分の話す速さで調整してください。';
      toolbar.after(controls, note);
      const answer = card.querySelector('.answer-text');
      if (selected(item) !== 'full' && answer) answer.textContent = text(item);
    });
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-answer-length]');
    if (!button) return;
    const card = button.closest('.qa-card');
    const item = byId.get(Number(card.id.slice(2)));
    selection.set(Number(item.id), button.dataset.answerLength);
    window.InterviewAudioPlayer?.stop();
    card.querySelector('.answer-text').textContent = text(item);
    card.querySelectorAll('[data-answer-length]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
    // Length controls select prose; do not leave it hidden by keyword mode.
    document.querySelector('[data-toggle-group="answer"][data-toggle-value="full"]')?.click();
    window.dispatchEvent(new Event('interview-answer-changed'));
  });
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  enhance();
})();
