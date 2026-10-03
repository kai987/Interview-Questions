const LEVELS = new Set(['learning', 'okay', 'confident']);

// Only question IDs and self-ratings are stored here; answers stay in the
// existing private-content and study-state stores.
export function createPracticeSessionStore({ storage, ownerId, setId, questionIds, now = Date.now }) {
  const owner = String(ownerId || 'guest');
  const set = Number(setId);
  const validIds = new Set(questionIds.map(Number));
  const key = `interview-practice-session:${encodeURIComponent(owner)}:${set}`;
  const enabled = Number.isSafeInteger(set) && set > 0;

  function validate(value) {
    if (!value || value.version !== 1 || value.ownerId !== owner || value.setId !== set
      || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 10
      || value.ids.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(value.ids).size !== value.ids.length
      || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.ids.length
      || !value.ratings || typeof value.ratings !== 'object' || Array.isArray(value.ratings)
      || !Number.isFinite(value.updatedAt)) return null;
    if (Object.entries(value.ratings).some(([id, level]) =>
      !value.ids.includes(Number(id)) || !LEVELS.has(level))) return null;
    // If questions were removed, resume at the next surviving question rather
    // than bringing a deleted question or a different company's ID back.
    const current = value.ids.slice(value.index).find(id => validIds.has(id));
    if (current === undefined) return null;
    const ids = value.ids.filter(id => validIds.has(id));
    return {
      ids, index: ids.indexOf(current),
      ratings: Object.fromEntries(Object.entries(value.ratings).filter(([id]) => validIds.has(Number(id)))),
      updatedAt: value.updatedAt
    };
  }

  return {
    load() {
      if (!enabled) return null;
      try { return validate(JSON.parse(storage.getItem(key) || 'null')); }
      catch { return null; }
    },
    save({ ids, index, ratings }) {
      if (!enabled) return false;
      const value = { version: 1, ownerId: owner, setId: set, ids, index, ratings, updatedAt: now() };
      const valid = validate(value);
      if (!valid || valid.ids.length !== ids.length) return false;
      try { storage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    clear() {
      if (!enabled) return true;
      try { storage.removeItem(key); return true; }
      catch { return false; }
    }
  };
}
