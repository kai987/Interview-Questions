import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';

const SUPABASE_URL = 'https://flpmblfscgcbrprwwckz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y';
const APP_URL = `${window.location.origin}${window.location.pathname}`;
const ACTIVE_SET_KEY = 'interview-active-set-id';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit'
  }
});

let session = null;
let bootComplete = false;
let interviewSets = [];
let activeSet = null;
const stateCache = new Map();
const saveTimers = new Map();

const authButton = document.getElementById('authButton');
const authDialog = document.getElementById('authDialog');
const authCloseButton = document.getElementById('authCloseButton');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const passwordLoginButton = document.getElementById('passwordLoginButton');
const magicLinkButton = document.getElementById('magicLinkButton');
const logoutButton = document.getElementById('logoutButton');
const authMessage = document.getElementById('authMessage');
const setSelect = document.getElementById('interviewSetSelect');
const activeSetTitle = document.getElementById('activeSetTitle');
const activeSetMeta = document.getElementById('activeSetMeta');
const heroCompany = document.getElementById('heroCompany');

function setAuthMessage(message, type = '') {
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.dataset.type = type;
}

function openAuthDialog() {
  if (!authDialog) return;
  if (session) {
    setAuthMessage('ログイン済みです。非公開題庫と個人向け回答を利用できます。', 'success');
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
  authDialog.showModal?.();
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
  const saved = Number(localStorage.getItem(ACTIVE_SET_KEY));
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

  localStorage.setItem(ACTIVE_SET_KEY, String(activeSet.id));
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
    item.privateUnlocked = true;
  });
}

function readLocalState() {
  let favorites = [];
  let practiced = [];
  let mastery = {};
  let ownAnswers = {};
  try { favorites = JSON.parse(localStorage.getItem('interview-favorites') || '[]'); } catch {}
  try { practiced = JSON.parse(localStorage.getItem('interview-practiced') || '[]'); } catch {}
  try { mastery = JSON.parse(localStorage.getItem('interview-mastery') || '{}') || {}; } catch {}
  try { ownAnswers = JSON.parse(localStorage.getItem('interview-own-answers') || '{}') || {}; } catch {}
  return {
    favorite: new Set((Array.isArray(favorites) ? favorites : []).map(Number)),
    practiced: new Set((Array.isArray(practiced) ? practiced : []).map(Number)),
    mastery,
    ownAnswers
  };
}

function writeLocalState(rows) {
  const favorites = [];
  const practiced = [];
  const mastery = {};
  const ownAnswers = {};
  stateCache.clear();
  (rows || []).forEach(row => {
    const id = Number(row.question_id);
    if (!Number.isFinite(id)) return;
    stateCache.set(id, {
      favorite: Boolean(row.favorite),
      practiced: Boolean(row.practiced),
      mastery: row.mastery || null,
      own_answer: row.own_answer || ''
    });
    if (row.favorite) favorites.push(id);
    if (row.practiced) practiced.push(id);
    if (row.mastery) mastery[id] = row.mastery;
    if (row.own_answer) ownAnswers[id] = row.own_answer;
  });
  localStorage.setItem('interview-favorites', JSON.stringify(favorites));
  localStorage.setItem('interview-practiced', JSON.stringify(practiced));
  localStorage.setItem('interview-mastery', JSON.stringify(mastery));
  localStorage.setItem('interview-own-answers', JSON.stringify(ownAnswers));
}

async function migrateLocalStateIfNeeded(remoteRows) {
  if (!session?.user?.id || (remoteRows || []).length) return remoteRows || [];
  const local = readLocalState();
  const rows = (window.INTERVIEW_DATA || []).map(item => {
    const id = Number(item.id);
    return {
      user_id: session.user.id,
      question_id: id,
      favorite: local.favorite.has(id),
      practiced: local.practiced.has(id),
      mastery: local.mastery[id] || null,
      own_answer: local.ownAnswers[id] || ''
    };
  }).filter(row => row.favorite || row.practiced || row.mastery || row.own_answer);

  if (!rows.length) return [];
  const { error } = await supabase.from('interview_user_state').upsert(rows, { onConflict: 'user_id,question_id' });
  if (error) console.warn('Could not migrate local interview state:', error.message);
  return rows;
}

async function loadPrivateData() {
  if (!session?.user?.id) return;
  const currentIds = new Set((window.INTERVIEW_DATA || []).map(item => Number(item.id)));
  if (!currentIds.size) {
    writeLocalState([]);
    return;
  }

  const [contentResult, stateResult] = await Promise.all([
    supabase.from('interview_private_content').select('question_id,answer,outline,tags').order('question_id'),
    supabase.from('interview_user_state').select('question_id,favorite,practiced,mastery,own_answer').order('question_id')
  ]);
  if (contentResult.error) throw contentResult.error;
  if (stateResult.error) throw stateResult.error;

  const scopedContent = (contentResult.data || []).filter(row => currentIds.has(Number(row.question_id)));
  const scopedState = (stateResult.data || []).filter(row => currentIds.has(Number(row.question_id)));
  mergePrivateContent(scopedContent);
  const migratedRows = await migrateLocalStateIfNeeded(scopedState);
  writeLocalState(migratedRows.length ? migratedRows : scopedState);
}

function clearPrivateLocalState() {
  ['interview-favorites', 'interview-practiced', 'interview-mastery', 'interview-own-answers'].forEach(key => localStorage.removeItem(key));
}

async function saveState(questionId, patch, { debounce = false } = {}) {
  if (!session?.user?.id) return;
  const id = Number(questionId);
  if (!Number.isFinite(id)) return;
  const current = stateCache.get(id) || { favorite: false, practiced: false, mastery: null, own_answer: '' };
  const next = { ...current, ...patch };
  stateCache.set(id, next);

  const commit = async () => {
    const row = stateCache.get(id) || next;
    const { error } = await supabase.from('interview_user_state').upsert({
      user_id: session.user.id,
      question_id: id,
      favorite: Boolean(row.favorite),
      practiced: Boolean(row.practiced),
      mastery: row.mastery || null,
      own_answer: String(row.own_answer || '').slice(0, 20000)
    }, { onConflict: 'user_id,question_id' });
    if (error) console.warn('Could not sync interview state:', error.message);
  };

  if (!debounce) return commit();
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(commit, 500));
}

window.InterviewPrivateStore = {
  saveState,
  isAuthenticated: () => Boolean(session),
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

async function logout() {
  logoutButton.disabled = true;
  await supabase.auth.signOut();
  clearPrivateLocalState();
  window.location.reload();
}

authButton?.addEventListener('click', openAuthDialog);
authCloseButton?.addEventListener('click', closeAuthDialog);
passwordLoginButton?.addEventListener('click', passwordLogin);
magicLinkButton?.addEventListener('click', sendMagicLink);
logoutButton?.addEventListener('click', logout);
authDialog?.addEventListener('click', event => {
  if (event.target === authDialog) closeAuthDialog();
});
setSelect?.addEventListener('change', event => {
  const nextId = Number(event.target.value);
  if (!Number.isFinite(nextId) || Number(activeSet?.id) === nextId) return;
  localStorage.setItem(ACTIVE_SET_KEY, String(nextId));
  window.location.reload();
});

try {
  const { data: { session: initialSession } } = await supabase.auth.getSession();
  session = initialSession;
} catch (error) {
  console.warn('Could not restore Supabase session:', error?.message || error);
  session = null;
}
updateAuthButton();

try {
  await loadInterviewLibrary();
  if (session) await loadPrivateData();
} catch (error) {
  console.warn('Could not load interview library:', error?.message || error);
  window.INTERVIEW_DATA = [];
  interviewSets = [];
  activeSet = null;
  renderSetSwitcher();
}

supabase.auth.onAuthStateChange((event, nextSession) => {
  session = nextSession;
  updateAuthButton();
  if (!bootComplete) return;
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    if (event === 'SIGNED_OUT') clearPrivateLocalState();
    window.location.reload();
  }
});

await import('./app.js?v=6');
await import('./training.js?v=2');
await import('./study-hints.js?v=2');
await import('./separate-control-labels.js?v=1');
await import('./expand-practice-fix.js?v=1');
await import('./ios-segmented.js?v=4');
await import('./privacy-ui.js?v=1');

bootComplete = true;
document.body.classList.toggle('private-mode-unlocked', Boolean(session));
document.body.classList.toggle('guest-mode', !session);
