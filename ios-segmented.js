(() => {
  const groupSelector = '.mode-switch, .reading-size-control, .memory-toggle-group, .timer-segment-control';
  const clickableSelector = '.mode-button, .reading-size-button, .memory-toggle-button, .timer-setting-button';
  const activeSelector = '.mode-button.is-active, .reading-size-button.is-active, .memory-toggle-button.is-active, .timer-setting-button.is-active';

  function setupTimerGroups() {
    document.querySelectorAll('.timer-setting-button').forEach(button => {
      const outerGroup = button.closest('.training-tools__group');
      if (!outerGroup) return;

      let segment = outerGroup.querySelector(':scope > .timer-segment-control');
      if (!segment) {
        segment = document.createElement('div');
        segment.className = 'timer-segment-control';
        segment.setAttribute('role', 'group');
        segment.setAttribute('aria-label', '回答時間');

        const timerButtons = [...outerGroup.querySelectorAll(':scope > .timer-setting-button')];
        timerButtons.forEach(timerButton => segment.appendChild(timerButton));
        outerGroup.appendChild(segment);
      }

      outerGroup.classList.remove('ios-timer-segment');
      outerGroup.querySelectorAll(':scope > .ios-segment-thumb').forEach(node => node.remove());
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
    setupTimerGroups();
    document.querySelectorAll(groupSelector).forEach(group => syncGroup(group, immediate));
  }

  let frame = 0;
  function scheduleSync() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => syncAll(false));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest(clickableSelector);
    if (!button) return;

    setupTimerGroups();
    const group = button.closest(groupSelector);
    if (group) moveThumbTo(group, button, false);

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
      setupTimerGroups();
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