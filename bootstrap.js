---
---
{% assign asset_version = site.github.build_revision | default: 'dev' %}
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';
import { queueLocalStateMigration, mergeScopedLocalState } from './state-migration.js?v={{ asset_version }}';

const SUPABASE_URL = 'https://qxekaaxgsugcneeumjzi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9jUDxgO6K0VTOVFkkbaNQg_YPVzFuvJ';
const APP_URL = `${window.location.origin}${window.location.pathname}`;
const ACTIVE_SET_KEY = 'interview-active-set-id';
const preferences = window.InterviewStorage.preferences;
const durableStorage = window.InterviewStorage.durable;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit'
  }
});

let session = null;
let interviewSets = [];
let activeSet = null;
const stateCache = new Map();
let stateSync = null;
let stateSyncOwnerId = null;
let privateDataReady = false;
let loadFailure = null;

const authButton = document.getElementById('authButton');
const authDialog = document.getElementById('authDialog');
const authCloseButton = document.getElementById('authCloseButton');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const passwordLoginButton = document.getElementById('passwordLoginButton');
const magicLinkButton = document.getElementById('magicLinkButton');
const forgotPasswordButton = document.getElementById('forgotPasswordButton');
const updatePasswordButton = document.getElementById('updatePasswordButton');
const recoveryFields = document.getElementById('passwordRecoveryFields');
const newAuthPassword = document.getElementById('newAuthPassword');
const confirmAuthPassword = document.getElementById('confirmAuthPassword');
const logoutButton = document.getElementById('logoutButton');
const authMessage = document.getElementById('authMessage');
const setSelect = document.getElementById('interviewSetSelect');
const activeSetTitle = document.getElementById('activeSetTitle');
const activeSetMeta = document.getElementById('activeSetMeta');
const heroCompany = document.getElementById('heroCompany');
let passwordRecoveryOwner = null;

// URL recovery is processed while getSession initializes the SDK. Subscribe
// before awaiting it, so a cold start cannot miss PASSWORD_RECOVERY.
supabase.auth.onAuthStateChange((event, nextSession) => {
  if (event !== 'PASSWORD_RECOVERY' || !nextSession?.user?.id) return;
  passwordRecoveryOwner = nextSession.user.id;
  setTimeout(() => { if (session) openAuthDialog(); }, 0);
});

function showLoadFailure(scope) {
  loadFailure = scope;
  const notice = document.createElement('div');
  notice.id = 'libraryLoadNotice';
  notice.className = 'library-load-notice';
  notice.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.textContent = scope === 'private'
    ? '個人向け回答と学習状態を読み込めませんでした。質問は表示できます。接続を確認して再読み込みしてください。'
    : '題庫を読み込めませんでした。接続を確認して、もう一度お試しください。';
  const retry = document.createElement('button');
  retry.id = 'retryLibraryLoad';
  retry.type = 'button';
  retry.textContent = '再読み込み';
  retry.addEventListener('click', () => { retry.disabled = true; window.location.reload(); });
  notice.append(message, retry);
  document.querySelector('.interview-library-wrap')?.append(notice);
  if (scope === 'library') {
    if (activeSetTitle) activeSetTitle.textContent = '題庫の読み込みに失敗しました';
    if (activeSetMeta) activeSetMeta.textContent = '接続を確認して再読み込みしてください';
    if (!interviewSets.length) {
      setSelect.replaceChildren(new Option('読み込みに失敗しました', ''));
      setSelect.disabled = true;
    }
  }
}

function setAuthMessage(message, type = '') {
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.dataset.type = type;
}

function openAuthDialog() {
  if (!authDialog) return;
  const recovery = Boolean(session?.user?.id && passwordRecoveryOwner === session.user.id);
  document.getElementById('authDialogTitle').textContent = recovery ? 'パスワードの再設定' : 'プライベートモード';
  recoveryFields.hidden = !recovery;
  updatePasswordButton.hidden = !recovery;
  forgotPasswordButton.hidden = Boolean(session);
  authEmail.closest('.auth-field').hidden = recovery;
  if (session) {
    setAuthMessage(recovery ? '新しいパスワードを入力してください。' : 'ログイン済みです。非公開題庫と個人向け回答を利用できます。', recovery ? '' : 'success');
    logoutButton.hidden = false;
    passwordLoginButton.hidden = true;
    magicLinkButton.hidden = true;
    authPassword.closest('.auth-field')?.setAttribute('hidden', '');
  } else {
    logoutButton.hidden = true;
    passwordLoginButton.hidden = false;
    magicLinkButton.hidden = false;
    authPassword.closest('.auth-field')?.removeAttribute('hidden');
    setAuthMessage('登録済みのアカウントでログインしてください。');
  }
  if (!authDialog.open) authDialog.showModal?.();
}

function closeAuthDialog() {
  authDialog?.close?.();
}

function updateAuthButton() {
  if (!authButton) return;
  authButton.classList.toggle('is-authenticated', Boolean(session));
  authButton.textContent = session ? 'ログイン中' : 'ログイン';
  authButton.setAttribute('aria-label', session ? 'ログイン状態を確認' : 'ログイン');
}

function chooseActiveSet(sets) {
  // A URL also carries the selection when browser preferences cannot be saved.
  const requested = Number(new URL(window.location.href).searchParams.get('set'));
  const linked = sets.find(set => Number(set.id) === requested);
  if (linked) return linked;
  const saved = Number(preferences.getItem(ACTIVE_SET_KEY));
  if (Number.isFinite(saved)) {
    const matched = sets.find(set => Number(set.id) === saved);
    if (matched) return matched;
  }
  return sets.find(set => set.is_public) || sets[0] || null;
}

function renderSetSwitcher(questionCount = null) {
  if (!setSelect) return;
  setSelect.replaceChildren();

  if (!interviewSets.length || !activeSet) {
    const option = document.createElement('option');
    option.textContent = session ? '利用可能な題庫がありません' : '公開題庫がありません';
    option.value = '';
    setSelect.appendChild(option);
    setSelect.disabled = true;
    if (activeSetTitle) activeSetTitle.textContent = session ? '題庫がありません' : 'ログインすると非公開題庫を表示できます';
    if (activeSetMeta) activeSetMeta.textContent = session ? '新しい題庫をSupabaseへ追加してください' : '公開題庫がない場合はログインしてください';
    if (heroCompany) heroCompany.textContent = 'Interview Library';
    return;
  }

  interviewSets.forEach(set => {
    const option = document.createElement('option');
    option.value = String(set.id);
    option.textContent = `${set.company}｜${set.position}${set.is_public ? '' : ' 🔒'}`;
    option.selected = Number(set.id) === Number(activeSet.id);
    setSelect.appendChild(option);
  });
  setSelect.disabled = interviewSets.length <= 1;

  if (activeSetTitle) activeSetTitle.textContent = `${activeSet.company}｜${activeSet.position}`;
  const visibility = activeSet.is_public ? '公開題庫' : 'プライベート題庫';
  const countText = Number.isFinite(questionCount) ? ` · ${questionCount}問` : '';
  if (activeSetMeta) activeSetMeta.textContent = `${activeSet.location || '勤務地未設定'} · ${visibility}${countText}`;
  if (heroCompany) heroCompany.textContent = [activeSet.company, activeSet.location, activeSet.position].filter(Boolean).join('｜');
  document.title = `${activeSet.company}｜${activeSet.position}｜Interview Questions`;
}

async function loadInterviewLibrary() {
  const { data: sets, error: setError } = await supabase
    .from('interview_sets')
    .select('id,slug,company,position,location,job_url,is_public,is_archived,sort_order')
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (setError) throw setError;

  interviewSets = Array.isArray(sets) ? sets : [];
  activeSet = chooseActiveSet(interviewSets);
  renderSetSwitcher();

  if (!activeSet) {
    window.INTERVIEW_DATA = [];
    window.InterviewLibrary = { sets: interviewSets, activeSet: null };
    return [];
  }

  preferences.setItem(ACTIVE_SET_KEY, String(activeSet.id));
  const { data: questions, error: questionError } = await supabase
    .from('interview_questions')
    .select('id,category,question,question_zh,sort_order')
    .eq('set_id', activeSet.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (questionError) throw questionError;

  window.INTERVIEW_DATA = (questions || []).map(row => ({
    id: Number(row.id),
    category: row.category || 'その他',
    question: row.question || '',
    questionZh: row.question_zh || '',
    answer: '',
    outline: '',
    tags: []
  }));
  window.InterviewLibrary = { sets: interviewSets, activeSet };
  renderSetSwitcher(window.INTERVIEW_DATA.length);
  return window.INTERVIEW_DATA;
}

function mergePrivateContent(rows) {
  const byId = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
  (rows || []).forEach(row => {
    const item = byId.get(Number(row.question_id));
    if (!item) return;
    item.answer = row.answer || '';
    item.outline = row.outline || '';
    item.tags = Array.isArray(row.tags) ? row.tags : [];
    item.answerVariants = row.answer_variants || {};
    item.audioTextHash = row.audio_text_hash || '';
    item.audioDurationSeconds = row.duration_seconds ?? null;
    item.audioVariants = row.audio_variants && typeof row.audio_variants === 'object' && !Array.isArray(row.audio_variants)
      ? row.audio_variants : {};
    item.privateUnlocked = true;
  });
}

function readLocalState() {
  let favorites = [];
  let practiced = [];
  let mastery = {};
  let ownAnswers = {};
  let reviewHistory = {};
  try { favorites = JSON.parse(localStorage.getItem('interview-favorites') || '[]'); } catch {}
  try { practiced = JSON.parse(localStorage.getItem('interview-practiced') || '[]'); } catch {}
  try { mastery = JSON.parse(localStorage.getItem('interview-mastery') || '{}') || {}; } catch {}
  try { ownAnswers = JSON.parse(localStorage.getItem('interview-own-answers') || '{}') || {}; } catch {}
  try { reviewHistory = JSON.parse(localStorage.getItem('interview-review-history') || '{}') || {}; } catch {}
  return {
    favorite: new Set((Array.isArray(favorites) ? favorites : []).map(Number)),
    practiced: new Set((Array.isArray(practiced) ? practiced : []).map(Number)),
    mastery,
    ownAnswers,
    reviewHistory
  };
}

function writeLocalState(rows) {
  const local = mergeScopedLocalState({
    questionIds: new Set((window.INTERVIEW_DATA || []).map(item => Number(item.id))),
    rows: rows || [], local: readLocalState()
  });
  stateCache.clear();
  (rows || []).forEach(row => {
    const id = Number(row.question_id);
    if (!Number.isFinite(id)) return;
    stateCache.set(id, {
      favorite: Boolean(row.favorite),
      practiced: Boolean(row.practiced),
      mastery: row.mastery || null,
      own_answer: row.own_answer || '',
      last_practiced_at: row.last_practiced_at || null
    });
  });
  const values = {
    'interview-favorites': [...local.favorite], 'interview-practiced': [...local.practiced],
    'interview-mastery': local.mastery, 'interview-own-answers': local.ownAnswers,
    'interview-review-history': local.reviewHistory
  };
  for (const [key, value] of Object.entries(values)) {
    // The cloud snapshot remains usable in memory when the optional UI cache is full.
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
}

async function loadPrivateData() {
  if (!session?.user?.id) return;
  const currentIds = new Set((window.INTERVIEW_DATA || []).map(item => Number(item.id)));
  if (!currentIds.size) {
    return;
  }

  const [contentResult, stateResult] = await Promise.all([
    supabase.from('interview_private_content').select('question_id,answer,outline,tags,answer_variants,audio_text_hash,duration_seconds,audio_variants').order('question_id'),
    supabase.from('interview_user_state').select('question_id,favorite,practiced,mastery,own_answer,last_practiced_at').order('question_id')
  ]);
  if (contentResult.error) throw contentResult.error;
  if (stateResult.error) throw stateResult.error;

  const scopedContent = (contentResult.data || []).filter(row => currentIds.has(Number(row.question_id)));
  const scopedState = (stateResult.data || []).filter(row => currentIds.has(Number(row.question_id)));
  mergePrivateContent(scopedContent);
  queueLocalStateMigration({ questionIds: currentIds, remoteRows: scopedState, local: readLocalState(), sync: stateSync });
  const merged = new Map(scopedState.map(row => [Number(row.question_id), row]));
  for (const row of stateSync?.pendingRows() || []) {
    if (currentIds.has(row.question_id)) merged.set(row.question_id, { ...merged.get(row.question_id), ...row });
  }
  writeLocalState([...merged.values()]);
}

function clearPrivateLocalState() {
  ['interview-favorites', 'interview-practiced', 'interview-mastery', 'interview-own-answers', 'interview-review-history'].forEach(key => {
    try { localStorage.removeItem(key); } catch {}
  });
}

function saveState(questionId, patch, options = {}) {
  if (!session?.user?.id || !stateSync || !privateDataReady) return;
  const id = Number(questionId);
  // Only send fields this action changed; another tab may have newer values
  // for the other fields of the same question.
  const allowed = ['favorite', 'practiced', 'mastery', 'own_answer', 'last_practiced_at'];
  const changes = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
  if ('own_answer' in changes) changes.own_answer = String(changes.own_answer || '').slice(0, 20000);
  if (!Object.keys(changes).length) return;
  const current = stateCache.get(id) || { favorite: false, practiced: false, mastery: null, own_answer: '', last_practiced_at: null };
  const next = { ...current, ...changes };
  stateCache.set(id, next);
  stateSync.save(id, changes, options);
}

window.InterviewPrivateStore = {
  saveState,
  getOwnerId: () => session?.user?.id || null,
  getActiveSet: () => activeSet,
  getState: id => privateDataReady ? { ...stateCache.get(Number(id)) } : null,
  getSyncStatus: id => stateSync?.getStatus(id) || 'local',
  retry: () => stateSync?.retry(),
  hasPending: () => stateSync?.hasPending() || false,
  hasUnpersisted: hasUnpersistedDrafts,
  isAuthenticated: () => Boolean(session),
  isReady: () => privateDataReady,
  openLogin: openAuthDialog
};

async function passwordLogin() {
  const email = authEmail?.value.trim();
  const password = authPassword?.value || '';
  if (!email || !password) return setAuthMessage('メールアドレスとパスワードを入力してください。', 'error');
  passwordLoginButton.disabled = true;
  setAuthMessage('ログインしています…');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  passwordLoginButton.disabled = false;
  if (error) return setAuthMessage(error.message, 'error');
  setAuthMessage('ログインしました。題庫と個人データを読み込みます…', 'success');
  window.location.reload();
}

async function sendMagicLink() {
  const email = authEmail?.value.trim();
  if (!email) return setAuthMessage('メールアドレスを入力してください。', 'error');
  magicLinkButton.disabled = true;
  setAuthMessage('ログインリンクを送信しています…');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: APP_URL }
  });
  magicLinkButton.disabled = false;
  if (error) return setAuthMessage(error.message, 'error');
  setAuthMessage('メールを確認し、ログインリンクを開いてください。', 'success');
}

async function sendPasswordReset() {
  const email = authEmail?.value.trim();
  if (!email || !authEmail.checkValidity()) return setAuthMessage('正しいメールアドレスを入力してください。', 'error');
  forgotPasswordButton.disabled = true;
  setAuthMessage('パスワード再設定メールを送信しています…');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
    if (error) throw error;
    setAuthMessage('登録済みの場合、再設定メールが届きます。メールのリンクを開いてください。', 'success');
  } catch (error) {
    setAuthMessage(error?.message || '送信できませんでした。もう一度お試しください。', 'error');
  } finally {
    forgotPasswordButton.disabled = false;
  }
}

async function updateRecoveredPassword() {
  if (!session?.user?.id || passwordRecoveryOwner !== session.user.id) return;
  const password = newAuthPassword.value;
  if (password.length < 8) return setAuthMessage('パスワードは8文字以上で入力してください。', 'error');
  if (password !== confirmAuthPassword.value) return setAuthMessage('確認用のパスワードが一致しません。', 'error');
  updatePasswordButton.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    newAuthPassword.value = '';
    confirmAuthPassword.value = '';
    passwordRecoveryOwner = null;
    setAuthMessage('パスワードを更新しました。題庫を読み込みます…', 'success');
    window.location.reload();
  } catch (error) {
    setAuthMessage(error?.message || '更新できませんでした。もう一度お試しください。', 'error');
  } finally {
    updatePasswordButton.disabled = false;
  }
}

async function logout() {
  logoutButton.disabled = true;
  if (stateSync?.hasPending()) {
    await stateSync.retry();
    if (stateSync.hasPending()) {
      logoutButton.disabled = false;
      setAuthMessage('未同期の変更があります。接続を確認してから、もう一度ログアウトしてください。', 'error');
      return;
    }
  }
  const { error } = await supabase.auth.signOut();
  if (error) { logoutButton.disabled = false; setAuthMessage('ログアウトできませんでした。再度お試しください。', 'error'); return; }
  clearPrivateLocalState();
  window.location.reload();
}

authButton?.addEventListener('click', openAuthDialog);
authCloseButton?.addEventListener('click', closeAuthDialog);
passwordLoginButton?.addEventListener('click', passwordLogin);
magicLinkButton?.addEventListener('click', sendMagicLink);
forgotPasswordButton?.addEventListener('click', sendPasswordReset);
updatePasswordButton?.addEventListener('click', updateRecoveredPassword);
logoutButton?.addEventListener('click', logout);
authDialog?.addEventListener('click', event => {
  if (event.target === authDialog) closeAuthDialog();
});
function hasUnpersistedDrafts() {
  // An auth change must still clear the previous account's rendered content.
  return Boolean(session?.user?.id === stateSyncOwnerId && stateSync?.hasUnpersisted());
}

let unsavedDraftNotice = null;
function updateDraftNotice() {
  if (!hasUnpersistedDrafts()) {
    unsavedDraftNotice?.remove();
    unsavedDraftNotice = null;
  }
}

async function retryDrafts() {
  let timeout;
  try {
    // Leave a slow cloud request running, while allowing the user to keep editing.
    await Promise.race([
      stateSync?.retry(),
      new Promise(resolve => { timeout = setTimeout(resolve, 2000); })
    ]);
  } catch {
    // Keep the draft and its leave protection if retry itself is unavailable.
  } finally {
    clearTimeout(timeout);
    updateDraftNotice();
  }
}

function showDraftNotice() {
  if (unsavedDraftNotice) return;
  const notice = document.createElement('div');
  notice.id = 'unsavedDraftNotice';
  notice.className = 'library-load-notice';
  notice.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = '未保存の入力があります。題庫の切り替えを中止しました。同期を再試行するか、入力をコピーして保管してください。';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '同期を再試行';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    try { await retryDrafts(); } finally { retry.disabled = false; }
  });
  notice.append(text, retry);
  document.querySelector('.interview-library-wrap')?.append(notice);
  unsavedDraftNotice = notice;
}

window.addEventListener('interview-sync', updateDraftNotice);
window.addEventListener('beforeunload', event => {
  if (!hasUnpersistedDrafts()) return;
  event.preventDefault();
  event.returnValue = '';
});

setSelect?.addEventListener('change', async event => {
  const nextId = Number(event.target.value);
  if (!interviewSets.some(set => Number(set.id) === nextId) || Number(activeSet?.id) === nextId) return;
  setSelect.value = String(activeSet.id);
  setSelect.disabled = true;
  try {
    if (hasUnpersistedDrafts()) await retryDrafts();
    if (hasUnpersistedDrafts()) {
      showDraftNotice();
      return;
    }
    preferences.setItem(ACTIVE_SET_KEY, String(nextId));
    const target = new URL(window.location.href);
    target.searchParams.set('set', String(nextId));
    target.hash = '';
    window.location.assign(target.href);
  } finally {
    setSelect.disabled = interviewSets.length <= 1;
  }
});

try {
  const { data: { session: initialSession } } = await supabase.auth.getSession();
  session = initialSession;
} catch (error) {
  console.warn('Could not restore Supabase session:', error?.message || error);
  session = null;
}
updateAuthButton();
if (session?.user?.id && passwordRecoveryOwner === session.user.id) openAuthDialog();

if (session?.user?.id) {
  const ownerId = session.user.id;
  stateSyncOwnerId = ownerId;
  const { createStateSync } = await import('./sync-store.js?v={{ asset_version }}');
  stateSync = createStateSync({
    storage: durableStorage, ownerId,
    async send(id, row, { migration = {}, changes = row } = {}) {
      if (session?.user?.id !== ownerId) throw new Error('Account changed');
      // A legacy UI cache only fills a missing cloud row. It cannot replace an
      // edit another tab/device already saved after our initial read.
      if (Object.keys(migration).length) {
        const { error } = await supabase.from('interview_user_state').upsert(
          { ...migration, user_id: ownerId, question_id: id },
          { onConflict: 'user_id,question_id', ignoreDuplicates: true });
        if (error) throw error;
      }
      if (Object.keys(changes).length) {
        if (session?.user?.id !== ownerId) throw new Error('Account changed');
        const { error } = await supabase.from('interview_user_state').upsert(
          { ...changes, user_id: ownerId, question_id: id }, { onConflict: 'user_id,question_id' });
        if (error) throw error;
      }
    },
    notify(id, status) { window.dispatchEvent(new CustomEvent('interview-sync', { detail: { id, status } })); }
  });
  window.addEventListener('online', () => void stateSync.retry());
  window.addEventListener('pagehide', () => void stateSync.retry());
}

try {
  await loadInterviewLibrary();
} catch (error) {
  console.warn('Could not load interview library:', error?.message || error);
  window.INTERVIEW_DATA = [];
  showLoadFailure('library');
}
if (!loadFailure && session) {
  try {
    await loadPrivateData();
    privateDataReady = true;
  } catch (error) {
    console.warn('Could not load private interview content:', error?.message || error);
    showLoadFailure('private');
  }
}

supabase.auth.onAuthStateChange((event, nextSession) => {
  const previousOwner = session?.user?.id || null;
  const nextOwner = nextSession?.user?.id || null;
  session = nextSession;
  updateAuthButton();
  if (event === 'PASSWORD_RECOVERY' && nextSession?.user?.id) {
    passwordRecoveryOwner = nextSession.user.id;
    openAuthDialog();
    return;
  }
  // Repeated sign-in and token refresh events must not interrupt a practice session.
  if (previousOwner === nextOwner) return;
  passwordRecoveryOwner = null;
  newAuthPassword.value = '';
  confirmAuthPassword.value = '';
  privateDataReady = false;
  stateSync?.stop();
  stateCache.clear();
  if (previousOwner) clearPrivateLocalState();
  // Keep account-scoped pending edits for the previous owner to retry on return.
  // Scheduling outside the auth callback also handles a change during startup.
  setTimeout(() => window.location.reload(), 0);
});

await import('./app.js?v={{ asset_version }}');
const { createPracticeSessionStore } = await import('./practice-session-store.js?v={{ asset_version }}');
window.InterviewPracticeSessions = { create: createPracticeSessionStore };
await import('./training.js?v={{ asset_version }}');
await import('./study-hints.js?v={{ asset_version }}');
await import('./answer-variants.js?v={{ asset_version }}');
await import('./separate-control-labels.js?v={{ asset_version }}');
await import('./expand-practice-fix.js?v={{ asset_version }}');
await import('./ios-segmented.js?v={{ asset_version }}');
await import('./privacy-ui.js?v={{ asset_version }}');

document.body.classList.toggle('private-mode-unlocked', Boolean(session));
document.body.classList.toggle('guest-mode', !session);
if (loadFailure === 'library') {
  document.getElementById('emptyState').hidden = true;
  document.getElementById('resultSummary').textContent = '題庫を読み込めませんでした';
}

void stateSync?.retry();
