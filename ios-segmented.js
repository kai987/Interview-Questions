(() => {
  const groupSelector = '.mode-switch, .reading-size-control, .memory-toggle-group, .ios-timer-segment';
  const buttonSelector = '.mode-button.is-active, .reading-size-button.is-active, .memory-toggle-button.is-active, .timer-setting-button.is-active';

  function markTimerGroups() {
    document.querySelectorAll('.timer-setting-button').forEach(button => {
      const group = button.closest('.training-tools__group');
      if (group) group.classList.add('ios-timer-segment');
    });
  }

  function ensureThumb(group) {
    let thumb = group.querySelector(':scope > .ios-segment-thumb');
    if (!thumb) {
      thumb = document.createElement('span');
      thumb.className = 'ios-segment-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      group.prepend(thumb);
    }
    return thumb;
  }

  function syncGroup(group, immediate = false) {
    const active = group.querySelector(buttonSelector);
    const thumb = ensureThumb(group);

    if (!active || !group.contains(active)) {
      group.classList.remove('ios-segment-ready');
      return;
    }

    const x = active.offsetLeft;
    const y = active.offsetTop;
    const width = active.offsetWidth;
    const height = active.offsetHeight;

    if (immediate) thumb.classList.add('is-immediate');

    thumb.style.width = `${width}px`;
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    group.classList.add('ios-segment-ready');

    if (immediate) {
      requestAnimationFrame(() => thumb.classList.remove('is-immediate'));
    }
  }

  function syncAll(immediate = false) {
    markTimerGroups();
    document.querySelectorAll(groupSelector).forEach(group => syncGroup(group, immediate));
  }

  let frame = 0;
  function scheduleSync() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => syncAll(false));
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.mode-button, .reading-size-button, .memory-toggle-button, .timer-setting-button')) return;
    requestAnimationFrame(() => requestAnimationFrame(scheduleSync));
  }, true);

  const observer = new MutationObserver(mutations => {
    const needsSync = mutations.some(mutation => {
      if (mutation.type === 'childList') return true;
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        return mutation.target.matches?.('.mode-button, .reading-size-button, .memory-toggle-button, .timer-setting-button');
      }
      return false;
    });
    if (needsSync) scheduleSync();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(scheduleSync);
    const observeGroups = () => {
      document.querySelectorAll(groupSelector).forEach(group => resizeObserver.observe(group));
    };
    observeGroups();
    const groupObserver = new MutationObserver(observeGroups);
    groupObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('resize', scheduleSync, { passive: true });
  window.addEventListener('pageshow', () => syncAll(true));

  requestAnimationFrame(() => syncAll(true));
})();
