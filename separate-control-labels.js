(() => {
  function separateReadingSizeLabel() {
    const group = document.querySelector('.reading-size-control');
    if (!group || group.closest('.labeled-segment-control')) return;

    const label = group.querySelector(':scope > span');
    if (!label) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'labeled-segment-control reading-size-setting';
    label.className = 'segment-control-label';

    group.parentNode.insertBefore(wrapper, group);
    wrapper.append(label, group);
  }

  function separateMemoryLabels() {
    document.querySelectorAll('.memory-toggle-group').forEach(group => {
      if (group.closest('.memory-setting-row')) return;

      const label = group.querySelector(':scope > .memory-toggle-label');
      if (!label) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'memory-setting-row';

      group.parentNode.insertBefore(wrapper, group);
      wrapper.append(label, group);
    });
  }

  function apply() {
    separateReadingSizeLabel();
    separateMemoryLabels();
  }

  apply();

  const root = document.querySelector('.study-tools');
  if (root) {
    const observer = new MutationObserver(() => apply());
    observer.observe(root, { childList: true, subtree: true });
  }
})();
