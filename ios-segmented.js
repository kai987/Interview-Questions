(() => {
  const selector = '.mode-switch, .reading-size-control, .memory-toggle-group, .ios-timer-segment';
  const activeSelector = '.is-active';

  function markTimerGroup() {
    document.querySelectorAll('.timer-setting-button').forEach(button => {
      const group = button.closest('.training-tools__group');
      if (group) group.classList.add('ios-timer-segment');
    });
  }

  function syncGroup(group) {
    const active = group.querySelector(activeSelector);
    if (!active || !group.contains(active)) {
      group.classList.remove('ios-segment-ready');
      return;
    }

    const groupRect = group.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const x = activeRect.left - groupRect.left;
    const y = activeRect.top - groupRect.top;

    group.style.setProperty('--ios-thumb-x', `${Math.round(x)}px`);
    group.style.setProperty('--ios-thumb-y', `${Math.round(y)}px`);
    group.style.setProperty('--ios-thumb-width', `${Math.round(activeRect.width)}px`);
    group.style.setProperty('--ios-thumb-height', `${Math.round(activeRect.height)}px`);
    group.classList.add('ios-segment-ready');
  }

  function syncAll() {
    markTimerGroup();
    document.querySelectorAll(selector).forEach(syncGroup);
  }

  let frame = 0;
  function scheduleSync() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(syncAll);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('.mode-button, .reading-size-button, .memory-toggle-button, .timer-setting-button')) {
      requestAnimationFrame(scheduleSync);
    }
  }, true);

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'childList' || mutation.attributeName === 'class')) {
      scheduleSync();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(scheduleSync);
    document.querySelectorAll('.study-tools, .training-tools').forEach(node => resizeObserver.observe(node));
  } else {
    window.addEventListener('resize', scheduleSync, { passive: true });
  }

  window.addEventListener('resize', scheduleSync, { passive: true });
  requestAnimationFrame(syncAll);
})();
