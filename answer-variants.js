(() => {
  const root = document.getElementById('questionSections');
  if (!root) return;
  const byId = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
  const selection = new Map();
  const labels = { short: '結論', standard: '標準', full: '深掘り' };
  const durationRequests = new WeakMap();
  function selected(item) { return selection.get(Number(item.id)) || 'full'; }
  function text(item) { return item.answerVariants?.[selected(item)] || item.answer || ''; }
  window.InterviewAnswers = { text, selected };
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
    const whole = Math.floor(seconds);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }
  function updateDurations(card, item) {
    const getDuration = window.InterviewAudioPlayer?.getDuration;
    if (!getDuration) return;
    const key = JSON.stringify([item.question, item.answer, item.answerVariants,
      item.audioVariants, item.audioTextHash, item.audioDurationSeconds]);
    if (durationRequests.get(card)?.key === key) return;
    const request = { key };
    durationRequests.set(card, request);
    card.querySelectorAll('[data-answer-length]').forEach(button => {
      Promise.resolve(getDuration(item, button.dataset.answerLength)).catch(() => NaN).then(duration => {
        if (!card.isConnected || durationRequests.get(card) !== request) return;
        const formatted = formatDuration(duration);
        const badge = button.querySelector('.answer-length-duration');
        if (badge && badge.textContent !== formatted) badge.textContent = formatted;
        button.title = Number.isFinite(duration) && duration > 0 ? '質問を含む録音時間' : '録音時間は未登録です';
      });
    });
  }
  function enhance() {
    root.querySelectorAll('.qa-card').forEach(card => {
      const item = byId.get(Number(card.id.slice(2)));
      if (!item?.answerVariants?.short) return;
      if (card.querySelector('.answer-length-control')) { updateDurations(card, item); return; }
      const toolbar = card.querySelector('.qa-toolbar');
      if (!toolbar) return;
      const controls = document.createElement('div');
      controls.className = 'answer-length-control';
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', '回答例の長さ');
      for (const [value, label] of Object.entries(labels)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'training-action';
        const name = document.createElement('span'); name.className = 'answer-length-label'; name.textContent = label;
        const duration = document.createElement('span'); duration.className = 'answer-length-duration'; duration.textContent = '--:--';
        button.append(name, duration); button.dataset.answerLength = value;
        button.setAttribute('aria-pressed', String(selected(item) === value));
        controls.append(button);
      }
      const note = document.createElement('p'); note.className = 'answer-duration-note';
      note.textContent = '表示は質問を含む録音時間です。自分の回答時間は、話す速さに合わせて調整してください。';
      toolbar.after(controls, note);
      const answer = card.querySelector('.answer-text');
      // app.js starts with item.answer (standard); sync the selected version even for the default full.
      // Preserve existing highlights when the rendered text already matches.
      if (answer && answer.textContent !== text(item)) answer.textContent = text(item);
      updateDurations(card, item);
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
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
      && (node.matches('.qa-card') || node.querySelector('.qa-card'))))) enhance();
  });
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('interview-audio-ready', enhance);
  window.addEventListener('interview-answer-changed', enhance);
  enhance();
})();
