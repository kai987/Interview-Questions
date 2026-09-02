(() => {
  const expandButton = document.getElementById('expandAllButton');
  const questionSections = document.getElementById('questionSections');
  if (!expandButton || !questionSections) return;

  const isPracticeMode = () => document.body.classList.contains('practice-mode');

  function visibleCards() {
    return [...questionSections.querySelectorAll('.qa-card')];
  }

  function setButtonState(expanded) {
    if (!isPracticeMode()) return;
    const icon = expandButton.querySelector('svg');
    expandButton.setAttribute('aria-pressed', String(expanded));
    expandButton.setAttribute('aria-label', expanded ? 'すべての回答例を隠す' : 'すべての回答例を表示');
    expandButton.setAttribute('title', expanded ? 'すべての回答例を隠す' : 'すべての回答例を表示');
    if (icon) {
      icon.style.transition = 'transform .2s ease';
      icon.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
    }
  }

  function syncButtonFromDom() {
    if (!isPracticeMode()) return;
    const cards = visibleCards();
    const allRevealed = cards.length > 0 && cards.every(card => card.classList.contains('practice-revealed'));
    setButtonState(allRevealed);
  }

  // Run before the original expand handler. Trigger each card's own reveal button so
  // the original app state (revealedIds) stays synchronized with the rendered UI.
  expandButton.addEventListener('click', event => {
    if (!isPracticeMode()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const cards = visibleCards();
    if (!cards.length) return;

    const allRevealed = cards.every(card => card.classList.contains('practice-revealed'));
    const shouldReveal = !allRevealed;

    cards.forEach(card => {
      const currentlyRevealed = card.classList.contains('practice-revealed');
      if (currentlyRevealed === shouldReveal) return;
      const revealButton = card.querySelector('[data-reveal-id]');
      revealButton?.click();
    });

    setButtonState(shouldReveal);

    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = shouldReveal ? 'すべての回答例を表示しました' : 'すべての回答例を隠しました';
      toast.classList.add('is-visible');
      window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
    }
  }, true);

  // Keep the global button in sync when a single answer is revealed/hidden.
  questionSections.addEventListener('click', event => {
    if (!event.target.closest('[data-reveal-id]')) return;
    queueMicrotask(syncButtonFromDom);
  });

  // Re-rendering after search/favorite/practice actions should also refresh the state.
  const observer = new MutationObserver(() => requestAnimationFrame(syncButtonFromDom));
  observer.observe(questionSections, { childList: true, subtree: true });

  requestAnimationFrame(syncButtonFromDom);
})();
