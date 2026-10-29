(() => {
  if (globalThis.InterviewStorage) return;

  // Only display preferences may fall back to memory. Credentials, answers,
  // pending edits, and practice progress must never appear durably saved here.
  const preferenceKeys = new Set([
    'interview-theme', 'interview-reading-size', 'interview-practice-mode',
    'interview-timer-seconds', 'interview-chinese-hints', 'interview-answer-view',
    'interview-active-set-id'
  ]);
  const remembered = new Map();
  const unsaved = new Map();

  const preferences = {
    getItem(key) {
      key = String(key);
      if (unsaved.has(key)) return unsaved.get(key);
      try {
        const value = globalThis.localStorage.getItem(key);
        if (preferenceKeys.has(key)) remembered.set(key, value);
        return value;
      } catch {
        return remembered.get(key) ?? null;
      }
    },
    setItem(key, value) {
      key = String(key);
      value = String(value);
      try {
        globalThis.localStorage.setItem(key, value);
        if (preferenceKeys.has(key)) remembered.set(key, value);
        unsaved.delete(key);
        return true;
      } catch {
        if (preferenceKeys.has(key)) {
          remembered.set(key, value);
          unsaved.set(key, value);
        }
        return false;
      }
    },
    removeItem(key) {
      key = String(key);
      try {
        globalThis.localStorage.removeItem(key);
        if (preferenceKeys.has(key)) remembered.set(key, null);
        unsaved.delete(key);
        return true;
      } catch {
        if (preferenceKeys.has(key)) {
          remembered.set(key, null);
          unsaved.set(key, null);
        }
        return false;
      }
    }
  };

  // Resolve localStorage inside each operation, so callers can catch even a
  // blocked property getter. A failed durable operation always throws.
  const durable = {
    get length() { return globalThis.localStorage.length; },
    key(index) { return globalThis.localStorage.key(index); },
    getItem(key) { return globalThis.localStorage.getItem(key); },
    setItem(key, value) { return globalThis.localStorage.setItem(key, value); },
    removeItem(key) { return globalThis.localStorage.removeItem(key); }
  };

  globalThis.InterviewStorage = { preferences, durable };
})();
