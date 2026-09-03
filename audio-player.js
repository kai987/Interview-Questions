(() => {
  const SUPABASE_URL = 'https://flpmblfscgcbrprwwckz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y';
  const SUPABASE_PROJECT_REF = 'flpmblfscgcbrprwwckz';
  const SESSION_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
  const AUDIO_BUCKET = 'interview-audio';

  let speakingId = null;
  let activeAudio = null;
  let activeUtterance = null;
  const privateAudioCache = new Map();

  function activeSetSlug() {
    return String(window.InterviewLibrary?.activeSet?.slug || '').trim();
  }

  function isLocalDevelopment() {
    const host = window.location.hostname;
    return window.location.protocol === 'file:'
      || ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)
      || host.endsWith('.local');
  }

  function resetSpeechButtons() {
    document.querySelectorAll('.speech-button').forEach(button => {
      button.classList.remove('is-speaking');
      const label = button.querySelector('span');
      if (label) label.textContent = '音声で練習';
    });
  }

  function setButtonState(button, label, active = true) {
    if (!button) return;
    button.classList.toggle('is-speaking', active);
    const span = button.querySelector('span');
    if (span) span.textContent = label;
  }

  function stopPlayback() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.removeAttribute('src');
      activeAudio.load();
      activeAudio = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    activeUtterance = null;
    speakingId = null;
    resetSpeechButtons();
  }

  function readBrowserSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed.session && typeof parsed.session === 'object' ? parsed.session : parsed;
    } catch {
      return null;
    }
  }

  function jwtSubject(token) {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      const data = JSON.parse(atob(padded));
      return data?.sub || null;
    } catch {
      return null;
    }
  }

  async function resolveLocalAudio(item) {
    if (!isLocalDevelopment()) return null;
    const slug = activeSetSlug();
    if (!slug) return null;

    const relative = `local-audio/${encodeURIComponent(slug)}/q${Number(item.id)}.mp3`;
    const url = new URL(relative, document.baseURI).href;
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return response.ok ? url : null;
    } catch {
      return null;
    }
  }

  async function resolvePrivateStorageAudio(item) {
    const session = readBrowserSession();
    const accessToken = String(session?.access_token || '').trim();
    if (!accessToken) return null;

    const slug = activeSetSlug();
    if (!slug) return null;
    const userId = String(session?.user?.id || jwtSubject(accessToken) || '').trim();
    if (!userId) return null;

    const filename = `q${Number(item.id)}.mp3`;
    const objectPath = `${userId}/${slug}/${filename}`;
    if (privateAudioCache.has(objectPath)) return privateAudioCache.get(objectPath);

    const encodedPath = objectPath.split('/').map(part => encodeURIComponent(part)).join('/');
    const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${AUDIO_BUCKET}/${encodedPath}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
        return null;
      }
      if (!response.ok) {
        console.warn('Could not load private interview audio:', response.status, response.statusText);
        return null;
      }

      const blob = await response.blob();
      if (!blob.size) return null;
      const objectUrl = URL.createObjectURL(blob);
      privateAudioCache.set(objectPath, objectUrl);
      return objectUrl;
    } catch (error) {
      console.warn('Could not load private interview audio:', error);
      return null;
    }
  }

  async function resolveAudioSource(item) {
    const local = await resolveLocalAudio(item);
    if (local) return { url: local, source: 'local' };

    const storage = await resolvePrivateStorageAudio(item);
    if (storage) return { url: storage, source: 'storage' };

    return null;
  }

  function getJapaneseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find(voice => voice.lang === 'ja-JP')
      || voices.find(voice => voice.lang?.startsWith('ja'))
      || null;
  }

  function speakWithBrowser(item, button) {
    if (!('speechSynthesis' in window)) {
      stopPlayback();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(`質問。${item.question}。回答例。${item.answer}`);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voice = getJapaneseVoice();
    if (voice) utterance.voice = voice;

    activeUtterance = utterance;
    setButtonState(button, '停止');
    utterance.onend = () => {
      if (activeUtterance === utterance) stopPlayback();
    };
    utterance.onerror = () => {
      if (activeUtterance === utterance) stopPlayback();
    };
    window.speechSynthesis.speak(utterance);
  }

  async function play(item, button) {
    if (speakingId === item.id) {
      stopPlayback();
      return;
    }

    stopPlayback();
    speakingId = item.id;
    setButtonState(button, '読込中…');

    const source = await resolveAudioSource(item);
    if (speakingId !== item.id) return;

    if (!source) {
      speakWithBrowser(item, button);
      return;
    }

    const audio = new Audio(source.url);
    activeAudio = audio;
    audio.preload = 'auto';
    audio.onended = () => {
      if (activeAudio === audio) stopPlayback();
    };
    audio.onerror = () => {
      if (activeAudio !== audio || speakingId !== item.id) return;
      activeAudio = null;
      speakWithBrowser(item, button);
    };

    try {
      await audio.play();
      if (activeAudio === audio && speakingId === item.id) setButtonState(button, '停止');
    } catch {
      if (activeAudio === audio) activeAudio = null;
      if (speakingId === item.id) speakWithBrowser(item, button);
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-speech-id]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const id = Number(button.dataset.speechId);
    const item = (window.INTERVIEW_DATA || []).find(entry => Number(entry.id) === id);
    if (item) void play(item, button);
  }, true);

  window.addEventListener('beforeunload', () => {
    stopPlayback();
    privateAudioCache.forEach(url => URL.revokeObjectURL(url));
    privateAudioCache.clear();
  });

  window.InterviewAudioPlayer = {
    stop: stopPlayback,
    isLocalDevelopment,
    clearCache() {
      privateAudioCache.forEach(url => URL.revokeObjectURL(url));
      privateAudioCache.clear();
    }
  };
})();
