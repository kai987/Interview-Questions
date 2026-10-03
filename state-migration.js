// Queue legacy local records before replacing the UI cache with cloud data.
// A partly populated cloud account must not discard other, still-local answers.
export function queueLocalStateMigration({ questionIds, remoteRows, local, sync }) {
  const knownIds = new Set(remoteRows.map(row => Number(row.question_id)));
  const pending = new Map(sync.pendingRows().map(row => [Number(row.question_id), row]));
  for (const id of questionIds) {
    if (knownIds.has(id)) continue;
    const row = {
      favorite: local.favorite.has(id),
      practiced: local.practiced.has(id),
      mastery: local.mastery[id] || null,
      own_answer: String(local.ownAnswers[id] || '').slice(0, 20000),
      last_practiced_at: local.reviewHistory?.[id] || null
    };
    // A pending favorite toggle must not hide a still-unmigrated answer, while
    // an explicitly pending value (including false or an empty answer) wins.
    const patch = Object.fromEntries(Object.entries(row).filter(([field, value]) =>
      value && !Object.hasOwn(pending.get(id) || {}, field)));
    if (Object.keys(patch).length) sync.save(id, patch, { defer: true, migration: true });
  }
}

// Refresh one library without erasing legacy drafts in libraries not opened yet.
export function mergeScopedLocalState({ questionIds, rows, local }) {
  const next = {
    favorite: new Set(local.favorite), practiced: new Set(local.practiced),
    mastery: { ...local.mastery }, ownAnswers: { ...local.ownAnswers },
    reviewHistory: { ...local.reviewHistory }
  };
  for (const id of questionIds) {
    next.favorite.delete(id);
    next.practiced.delete(id);
    delete next.mastery[id];
    delete next.ownAnswers[id];
    delete next.reviewHistory[id];
  }
  for (const row of rows) {
    const id = Number(row.question_id);
    if (!questionIds.has(id)) continue;
    if (row.favorite) next.favorite.add(id);
    if (row.practiced) next.practiced.add(id);
    if (row.mastery) next.mastery[id] = row.mastery;
    if (row.own_answer) next.ownAnswers[id] = row.own_answer;
    if (row.last_practiced_at) next.reviewHistory[id] = row.last_practiced_at;
  }
  return next;
}
