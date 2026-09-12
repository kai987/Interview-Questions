(() => {
  const SUPABASE_URL = 'https://flpmblfscgcbrprwwckz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y';
  const SUPABASE_PROJECT_REF = 'flpmblfscgcbrprwwckz';
  const SESSION_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
  const AUDIO_BUCKET = 'interview-audio';

  let speakingId = null;
  let playbackRequest = 0;
  let activeAudio = null;
  let activeProgressNote = null;
  let activeSeekControl = null;
  let seekPointerId = -1;
  let activeUtterance = null;
  let playbackPaused = false;
  let audioPlayAttempt = 0;
  const privateAudioCache = new Map();
  const audioPreviews = new Map();

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
      setButtonState(button, '音声で練習', false);
    });
  }

  function setButtonState(button, label, active = true) {
    if (!button) return;
    button.classList.toggle('is-speaking', active);
    const span = button.querySelector('span');
    if (span) span.textContent = label;
    button.setAttribute('aria-label', label === '停止' ? '読み上げを一時停止する'
      : label === '再開' ? '読み上げを再開する'
      : label === '読込中…' ? '音声を読み込み中' : 'この問答を読み上げる');
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const wholeSeconds = Math.floor(seconds);
    return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  }

  function showAudioProgress(audio, note, currentTime = audio.currentTime) {
    if (!note) return;
    const progress = `${formatTime(currentTime)} / ${formatTime(audio.duration)}`;
    if (note.textContent !== progress) note.textContent = progress;
    const slider = note.closest('.qa-toolbar')?.querySelector('.audio-seek');
    if (slider) {
      const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
      slider.disabled = !hasDuration;
      slider.max = hasDuration ? String(audio.duration) : '0';
      if (!slider.hasPointerCapture(seekPointerId)) {
        slider.value = String(currentTime);
      }
      slider.setAttribute('aria-valuetext', progress);
      slider.closest('.audio-seek-control').style.setProperty('--audio-progress', `${hasDuration ? Math.min(100, Math.max(0, Number(slider.value) / audio.duration * 100)) : 0}%`);
    }
  }

  function clearSeekControl() {
    activeSeekControl = null;
    seekPointerId = -1;
  }

  function stopPlayback() {
    playbackRequest += 1;
    audioPlayAttempt += 1;
    playbackPaused = false;
    if (activeAudio) {
      const audio = activeAudio;
      showAudioProgress(audio, activeProgressNote, 0);
      activeAudio = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    activeProgressNote = null;
    clearSeekControl();
    activeUtterance = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speakingId = null;
    resetSpeechButtons();
  }

  function pausePlayback(button) {
    playbackPaused = true;
    // Invalidate a pending play() promise without discarding the current position.
    audioPlayAttempt += 1;
    if (activeAudio) activeAudio.pause();
    if (activeUtterance) window.speechSynthesis.pause();
    setButtonState(button, '再開', false);
  }

  async function resumePlayback(button) {
    playbackPaused = false;
    setButtonState(button, '停止');
    if (activeAudio) {
      const audio = activeAudio;
      const attempt = ++audioPlayAttempt;
      try {
        if (audio.ended) audio.currentTime = 0;
        await audio.play();
      } catch {
        if (activeAudio === audio && audioPlayAttempt === attempt) {
          playbackPaused = true;
          setButtonState(button, '再開', false);
        }
      }
    } else if (activeUtterance) {
      window.speechSynthesis.resume();
    }
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

  async function sha256(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifiedRevision(item) {
    if (!item.answer || !item.audioTextHash || !crypto.subtle) return null;
    const parts = item.audioTextHash.split(':');
    const legacy = parts[0] === 'legacy';
    const hash = legacy ? parts[1] : parts[0];
    if (!/^[a-f0-9]{64}$/.test(hash || '')) return null;
    if (await sha256(new TextEncoder().encode(item.question + '\n' + item.answer)) !== hash) return null;
    return { hash, legacy, bytes: legacy ? parts[2] : null };
  }

  async function resolveLocalAudio(item) {
    if (!isLocalDevelopment()) return null;
    const slug = activeSetSlug();
    if (!slug) return null;

    const revision = await verifiedRevision(item);
    if (!revision?.bytes) return null;
    const relative = `local-audio/${encodeURIComponent(slug)}/q${Number(item.id)}.mp3`;
    const url = new URL(relative, document.baseURI).href;
    try {
      const cacheKey = 'local:' + url + ':' + item.audioTextHash;
      if (privateAudioCache.has(cacheKey)) return privateAudioCache.get(cacheKey);
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (await sha256(await blob.arrayBuffer()) !== revision.bytes) return null;
      const objectUrl = URL.createObjectURL(blob);
      privateAudioCache.set(cacheKey, objectUrl);
      return objectUrl;
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

    const revision = await verifiedRevision(item);
    if (!revision) return null;
    const filename = revision.legacy ? `q${Number(item.id)}.mp3` : `q${Number(item.id)}-${revision.hash}.mp3`;
    const objectPath = `${userId}/${slug}/${filename}`;
    const cacheKey = objectPath + ':' + item.audioTextHash;
    if (privateAudioCache.has(cacheKey)) return privateAudioCache.get(cacheKey);

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
      if (revision.bytes && await sha256(await blob.arrayBuffer()) !== revision.bytes) return null;
      const objectUrl = URL.createObjectURL(blob);
      privateAudioCache.set(cacheKey, objectUrl);
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

  function previewKey(item) {
    return JSON.stringify([activeSetSlug(), item.id, item.audioTextHash, item.audioDurationSeconds, item.question,
      window.InterviewAnswers?.text(item) ?? item.answer]);
  }

  function savedDuration(item) {
    const duration = Number(item.audioDurationSeconds);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  function prepareAudio(item) {
    const key = previewKey(item);
    if (audioPreviews.has(key)) return audioPreviews.get(key);
    const pending = (async () => {
      if ((window.InterviewAnswers?.text(item) ?? item.answer) !== item.answer) return null;
      const source = await resolveAudioSource(item);
      if (!source) return null;
      if (savedDuration(item)) return { ...source, duration: savedDuration(item) };
      const duration = await new Promise(resolve => {
        const probe = new Audio();
        const finish = () => {
          clearTimeout(timeout);
          const duration = probe.duration;
          probe.onloadedmetadata = probe.onerror = null;
          probe.removeAttribute('src');
          probe.load();
          resolve(duration);
        };
        const timeout = setTimeout(finish, 10000);
        probe.onloadedmetadata = probe.onerror = finish;
        probe.preload = 'metadata';
        probe.src = source.url;
      });
      return { ...source, duration };
    })();
    audioPreviews.set(key, pending);
    // Allow a failed request to be retried when the user presses Play.
    pending.then(source => { if (!source) audioPreviews.delete(key); });
    return pending;
  }

  function refreshPreviews() {
    if (activeProgressNote && !activeProgressNote.isConnected) stopPlayback();
    const items = new Map((window.INTERVIEW_DATA || []).map(item => [Number(item.id), item]));
    document.querySelectorAll('.qa-card').forEach(card => {
      const item = items.get(Number(card.id.slice(2)));
      const note = card.querySelector('.audio-source-note');
      if (!item || !note) return;
      const key = previewKey(item);
      if (card.dataset.audioPreviewKey !== key) {
        card.dataset.audioPreviewKey = key;
        delete card.dataset.audioPreviewLoaded;
        showAudioProgress({ currentTime: 0, duration: NaN }, note);
        note.title = '音声の長さを確認中';
      }
      if (card.dataset.audioPreviewLoaded === key) return;
      const duration = savedDuration(item);
      if (!duration && (!card.open || card.hidden)) return;
      card.dataset.audioPreviewLoaded = key;
      const preview = duration
        ? Promise.resolve((window.InterviewAnswers?.text(item) ?? item.answer) === item.answer
          ? verifiedRevision(item) : null).then(revision => revision ? { duration } : null)
        : prepareAudio(item);
      void preview.then(source => {
        if (!card.isConnected || card.dataset.audioPreviewKey !== key || speakingId === item.id) return;
        showAudioProgress({ currentTime: 0, duration: source?.duration ?? NaN }, note);
        note.title = source ? '再生時間 / 音声の長さ' : 'ブラウザ音声は長さの事前取得・位置指定に対応していません';
      });
    });
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
    // cancel() can leave the synthesis engine paused when switching questions.
    window.speechSynthesis.resume();
  }

  async function play(item, button) {
    if (speakingId === item.id) {
      if (playbackPaused) await resumePlayback(button);
      else if (activeAudio || activeUtterance) pausePlayback(button);
      else stopPlayback(); // A second click while resolving the source cancels loading.
      return;
    }

    const toolbar = button.closest('.qa-toolbar');
    const slider = toolbar?.querySelector('.audio-seek');
    const initialTime = Number(slider?.value) || 0;
    stopPlayback();
    speakingId = item.id;
    setButtonState(button, '読込中…');

    const request = playbackRequest;
    const answer = window.InterviewAnswers?.text(item) ?? item.answer;
    const spokenItem = { ...item, answer };
    const source = await prepareAudio(item);
    if (speakingId !== item.id || request !== playbackRequest) return;
    const note = toolbar?.querySelector('.audio-source-note');
    showAudioProgress({ currentTime: initialTime, duration: source?.duration ?? NaN }, note);
    if (note) note.title = source ? '再生時間 / 音声の長さ' : 'ブラウザ音声は長さの事前取得・位置指定に対応していません';

    if (!source) {
      speakWithBrowser(spokenItem, button);
      return;
    }

    const audio = new Audio(source.url);
    activeAudio = audio;
    activeProgressNote = note;
    activeSeekControl = slider;
    audio.preload = 'auto';
    if (Number.isFinite(source.duration) && initialTime < source.duration) audio.currentTime = initialTime;
    const updateProgress = () => {
      if (activeAudio === audio) showAudioProgress({
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : source.duration
      }, note);
    };
    audio.onloadedmetadata = updateProgress;
    audio.ondurationchange = updateProgress;
    audio.ontimeupdate = updateProgress;
    audio.onpause = updateProgress;
    audio.onseeked = updateProgress;
    updateProgress();
    audio.onended = () => {
      if (activeAudio !== audio) return;
      audioPlayAttempt += 1;
      playbackPaused = true;
      updateProgress();
      setButtonState(button, '音声で練習', false);
    };
    audio.onerror = () => {
      if (activeAudio !== audio || speakingId !== item.id || request !== playbackRequest) return;
      if (playbackPaused) { stopPlayback(); return; }
      activeAudio = null;
      activeProgressNote = null;
      clearSeekControl();
      showAudioProgress({ currentTime: 0, duration: NaN }, note);
      if (note) note.title = 'ブラウザ音声は長さの事前取得・位置指定に対応していません';
      speakWithBrowser(spokenItem, button);
    };

    const attempt = ++audioPlayAttempt;
    try {
      await audio.play();
      if (activeAudio === audio && speakingId === item.id && attempt === audioPlayAttempt) setButtonState(button, '停止');
    } catch {
      if (activeAudio !== audio || attempt !== audioPlayAttempt) return;
      if (activeAudio === audio) activeAudio = null;
      activeProgressNote = null;
      clearSeekControl();
      if (speakingId === item.id && request === playbackRequest) {
        showAudioProgress({ currentTime: 0, duration: NaN }, note);
        if (note) note.title = 'ブラウザ音声は長さの事前取得・位置指定に対応していません';
        speakWithBrowser(spokenItem, button);
      }
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

  document.addEventListener('pointerdown', event => {
    const slider = event.target.closest?.('.audio-seek');
    if (!slider || slider.disabled) return;
    seekPointerId = event.pointerId;
    slider.setPointerCapture(event.pointerId);
  });
  document.addEventListener('lostpointercapture', event => {
    if (event.target === activeSeekControl && activeAudio) showAudioProgress(activeAudio, activeProgressNote);
  }, true);
  document.addEventListener('input', event => {
    const slider = event.target.closest?.('.audio-seek');
    if (!slider || slider.disabled) return;
    const toolbar = slider.closest('.qa-toolbar');
    const time = Math.min(Number(slider.max), Math.max(0, Number(slider.value)));
    if (slider === activeSeekControl && activeAudio) {
      activeAudio.currentTime = time;
      showAudioProgress(activeAudio, activeProgressNote);
      if (playbackPaused) setButtonState(toolbar.querySelector('.speech-button'), '再開', false);
    } else {
      showAudioProgress({ currentTime: time, duration: Number(slider.max) }, toolbar.querySelector('.audio-source-note'));
    }
  });

  const root = document.getElementById('questionSections');
  if (root) {
    new MutationObserver(refreshPreviews).observe(root, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'class']
    });
    root.addEventListener('toggle', refreshPreviews, true);
  }
  window.addEventListener('interview-answer-changed', refreshPreviews);
  refreshPreviews();

  window.addEventListener('beforeunload', () => {
    stopPlayback();
    privateAudioCache.forEach(url => URL.revokeObjectURL(url));
    privateAudioCache.clear();
  });

  window.InterviewAudioPlayer = {
    stop: stopPlayback,
    isLocalDevelopment,
    clearCache() {
      audioPreviews.clear();
      privateAudioCache.forEach(url => URL.revokeObjectURL(url));
      privateAudioCache.clear();
    }
  };
})();
