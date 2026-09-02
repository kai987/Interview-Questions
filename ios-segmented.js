(() => {
  const groupSelector = '.mode-switch, .reading-size-control, .memory-toggle-group, .ios-timer-segment';
  const clickableSelector = '.mode-button, .reading-size-button, .memory-toggle-button, .timer-setting-button';
  const activeSelector = '.mode-button.is-active, .reading-size-button.is-active, .memory-toggle-button.is-active, .timer-setting-button.is-active';

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

  function moveThumbTo(group, target, immediate = false) {
    if (!group || !target || !group.contains(target)) return;
    const thumb = ensureThumb(group);

    if (immediate) thumb.classList.add('is-immediate');

    thumb.style.left = `${target.offsetLeft}px`;
    thumb.style.top = `${target.offsetTop}px`;
    thumb.style.width = `${target.offsetWidth}px`;
    thumb.style.height = `${target.offsetHeight}px`;
    group.classList.add('ios-segment-ready');

    if (immediate) {
      requestAnimationFrame(() => thumb.classList.remove('is-immediate'));
    }
  }

  function syncGroup(group, immediate = false) {
    const active = group.querySelector(activeSelector);
    if (!active) {
      group.classList.remove('ios-segment-ready');
      return;
    }
    moveThumbTo(group, active, immediate);
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

  // Move immediately to the clicked option. This does not depend on when
  // the owning script updates .is-active, so the visual slide is guaranteed.
  document.addEventListener('click', event => {
    const button = event.target.closest(clickableSelector);
    if (!button) return;

    markTimerGroups();
    const group = button.closest(groupSelector);
    if (group) moveThumbTo(group, button, false);

    // Reconcile with the actual application state after all click handlers run.
    requestAnimationFrame(() => requestAnimationFrame(scheduleSync));
  }, true);

  const observer = new MutationObserver(mutations => {
    const needsSync = mutations.some(mutation => {
      if (mutation.type === 'childList') return true;
      return mutation.type === 'attributes' && mutation.attributeName === 'class' && mutation.target.matches?.(clickableSelector);
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
    const observed = new WeakSet();
    const observeGroups = () => {
      markTimerGroups();
      document.querySelectorAll(groupSelector).forEach(group => {
        if (!observed.has(group)) {
          resizeObserver.observe(group);
          observed.add(group);
        }
      });
    };
    observeGroups();
    const groupObserver = new MutationObserver(observeGroups);
    groupObserver.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('resize', scheduleSync, { passive: true });
  window.addEventListener('pageshow', () => syncAll(true));

  requestAnimationFrame(() => syncAll(true));
})();
