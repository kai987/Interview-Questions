import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';

const SUPABASE_URL = 'https://flpmblfscgcbrprwwckz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y';
const APP_URL = `${window.location.origin}${window.location.pathname}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
let session = null;
let bootComplete = false;
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
function setAuthMessage(message, type = '') { if (!authMessage) return; authMessage.textContent = message; authMessage.dataset.type = type; }
function openAuthDialog() { if (!authDialog) return; if (session) { setAuthMessage('ログイン済みです。', 'success'); logoutButton.hidden = false; passwordLoginButton.hidden = true; magicLinkButton.hidden = true; authPassword.closest('.auth-field')?.setAttribute('hidden', ''); } else { logoutButton.hidden = true; passwordLoginButton.hidden = false; magicLinkButton.hidden = false; authPassword.closest('.auth-field')?.removeAttribute('hidden'); setAuthMessage('登録済みのアカウントでログインしてください。'); } authDialog.showModal?.(); }
function closeAuthDialog() { authDialog?.close?.(); }
function updateAuthButton() { if (!authButton) return; authButton.classList.toggle('is-authenticated', Boolean(session)); authButton.textContent = session ? 'ログイン中' : 'ログイン'; authButton.setAttribute('aria-label', session ? 'ログイン状態を確認' : 'ログイン'); }
function mergePrivateContent(rows) { const byId = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item])); (rows || []).forEach(row => { const item = byId.get(Number(row.question_id)); if (!item) return; item.answer = row.answer || ''; item.outline = row.outline || ''; item.tags = Array.isArray(row.tags) ? row.tags : []; item.privateUnlocked = true; }); }
function readLocalState() { let favorites = [], practiced = [], mastery = {}, ownAnswers = {}; try { favorites = JSON.parse(localStorage.getItem('interview-favorites') || '[]'); } catch {} try { practiced = JSON.parse(localStorage.getItem('interview-practiced') || '[]'); } catch {} try { mastery = JSON.parse(localStorage.getItem('interview-mastery') || '{}') || {}; } catch {} try { ownAnswers = JSON.parse(localStorage.getItem('interview-own-answers') || '{}') || {}; } catch {} return { favorite: new Set(favorites.map(Number)), practiced: new Set(practiced.map(Number)), mastery, ownAnswers }; }
function writeLocalState(rows) { const favorites = [], practiced = [], mastery = {}, ownAnswers = {}; stateCache.clear(); (rows || []).forEach(row => { const id = Number(row.question_id); stateCache.set(id, { favorite:Boolean(row.favorite), practiced:Boolean(row.practiced), mastery:row.mastery || null, own_answer:row.own_answer || '' }); if (row.favorite) favorites.push(id); if (row.practiced) practiced.push(id); if (row.mastery) mastery[id] = row.mastery; if (row.own_answer) ownAnswers[id] = row.own_answer; }); localStorage.setItem('interview-favorites', JSON.stringify(favorites)); localStorage.setItem('interview-practiced', JSON.stringify(practiced)); localStorage.setItem('interview-mastery', JSON.stringify(mastery)); localStorage.setItem('interview-own-answers', JSON.stringify(ownAnswers)); }
async function migrateLocalStateIfNeeded(remoteRows) { if (!session?.user?.id || (remoteRows || []).length) return remoteRows || []; const local = readLocalState(); const rows = (window.INTERVIEW_DATA || []).map(item => { const id = Number(item.id); return { user_id:session.user.id, question_id:id, favorite:local.favorite.has(id), practiced:local.practiced.has(id), mastery:local.mastery[id] || null, own_answer:local.ownAnswers[id] || '' }; }).filter(row => row.favorite || row.practiced || row.mastery || row.own_answer); if (!rows.length) return []; const { error } = await supabase.from('interview_user_state').upsert(rows, { onConflict:'user_id,question_id' }); if (error) console.warn('Could not migrate local interview state:', error.message); return rows; }
async function loadPrivateData() { if (!session?.user?.id) return; const [{ data:content, error:contentError }, { data:remoteState, error:stateError }] = await Promise.all([ supabase.from('interview_private_content').select('question_id,answer,outline,tags').order('question_id'), supabase.from('interview_user_state').select('question_id,favorite,practiced,mastery,own_answer').order('question_id') ]); if (contentError) throw contentError; if (stateError) throw stateError; mergePrivateContent(content || []); const rows = await migrateLocalStateIfNeeded(remoteState || []); writeLocalState(rows.length ? rows : (remoteState || [])); }
function clearPrivateLocalState() { ['interview-favorites','interview-practiced','interview-mastery','interview-own-answers'].forEach(key => localStorage.removeItem(key)); }
async function saveState(questionId, patch, { debounce = false } = {}) { if (!session?.user?.id) return; const id = Number(questionId); if (!Number.isFinite(id)) return; const current = stateCache.get(id) || { favorite:false, practiced:false, mastery:null, own_answer:'' }; const next = { ...current, ...patch }; stateCache.set(id, next); const commit = async () => { const row = stateCache.get(id) || next; const { error } = await supabase.from('interview_user_state').upsert({ user_id:session.user.id, question_id:id, favorite:Boolean(row.favorite), practiced:Boolean(row.practiced), mastery:row.mastery || null, own_answer:String(row.own_answer || '').slice(0,20000) }, { onConflict:'user_id,question_id' }); if (error) console.warn('Could not sync interview state:', error.message); }; if (!debounce) return commit(); clearTimeout(saveTimers.get(id)); saveTimers.set(id, setTimeout(commit, 500)); }
window.InterviewPrivateStore = { saveState, isAuthenticated:() => Boolean(session), openLogin:openAuthDialog };
async function passwordLogin() { const email = authEmail?.value.trim(); const password = authPassword?.value || ''; if (!email || !password) return setAuthMessage('メールアドレスとパスワードを入力してください。', 'error'); passwordLoginButton.disabled = true; setAuthMessage('ログインしています…'); const { error } = await supabase.auth.signInWithPassword({ email, password }); passwordLoginButton.disabled = false; if (error) return setAuthMessage(error.message, 'error'); setAuthMessage('ログインしました。個人データを読み込みます…', 'success'); window.location.reload(); }
async function sendMagicLink() { const email = authEmail?.value.trim(); if (!email) return setAuthMessage('メールアドレスを入力してください。', 'error'); magicLinkButton.disabled = true; setAuthMessage('ログインリンクを送信しています…'); const { error } = await supabase.auth.signInWithOtp({ email, options:{ shouldCreateUser:false, emailRedirectTo:APP_URL } }); magicLinkButton.disabled = false; if (error) return setAuthMessage(error.message, 'error'); setAuthMessage('メールを確認し、ログインリンクを開いてください。', 'success'); }
async function logout() { logoutButton.disabled = true; await supabase.auth.signOut(); clearPrivateLocalState(); window.location.reload(); }
authButton?.addEventListener('click', openAuthDialog); authCloseButton?.addEventListener('click', closeAuthDialog); passwordLoginButton?.addEventListener('click', passwordLogin); magicLinkButton?.addEventListener('click', sendMagicLink); logoutButton?.addEventListener('click', logout); authDialog?.addEventListener('click', event => { if (event.target === authDialog) closeAuthDialog(); });
try { const { data:{ session:initialSession } } = await supabase.auth.getSession(); session = initialSession; updateAuthButton(); if (session) await loadPrivateData(); } catch (error) { console.warn('Supabase unavailable; continuing in guest mode:', error?.message || error); session = null; updateAuthButton(); }
supabase.auth.onAuthStateChange((event, nextSession) => { session = nextSession; updateAuthButton(); if (!bootComplete) return; if (event === 'SIGNED_IN') window.location.reload(); if (event === 'SIGNED_OUT') { clearPrivateLocalState(); window.location.reload(); } });
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
