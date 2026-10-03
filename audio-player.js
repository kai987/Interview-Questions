(() => {
  const SUPABASE_URL = 'https://flpmblfscgcbrprwwckz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y';
  const SUPABASE_PROJECT_REF = 'flpmblfscgcbrprwwckz';
  const SESSION_STORAGE_KEY = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
  const AUDIO_BUCKET = 'interview-audio';
  const AUDIO_LOAD_TIMEOUT_MS = 15000;

  let speakingId = null;
  let activePlaybackKey = null;
  let playbackRequest = 0;
  let activeAudio = null;
  let activeProgressNote = null;
  let activeSeekControl = null;
  let seekPointerId = -1;
  let activeUtterance = null;
  let playbackPaused = false;
  let audioPlayAttempt = 0;
  let activeLoadController = null;
  const privateAudioCache = new Map();
  const audioPreviews = new Map();
  const recordingPreviews = new Map();

  class AudioLoadError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  function feedbackFor(button) {
    const toolbar = button.closest('.qa-toolbar');
    if (!toolbar) return null;
    let feedback = toolbar.parentElement.querySelector('.audio-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.className = 'audio-feedback';
      feedback.setAttribute('role', 'status');
      const message = document.createElement('span');
      message.className = 'audio-feedback-message';
      feedback.append(message);
      for (const [className, label] of [['audio-retry-button', '録音を再試行'], ['audio-browser-button', 'ブラウザ音声で読む']]) {
        const action = document.createElement('button');
        action.type = 'button';
        action.className = `training-action ${className}`;
        action.textContent = label;
        feedback.append(action);
      }
      toolbar.after(feedback);
    }
    return feedback;
  }

  function showAudioFailure(button, error) {
    stopPlayback();
    const messages = {
      timeout: '録音の読み込みが時間切れになりました。通信状態を確認して再試行してください。',
      auth: '録音を読み込めません。ログイン状態を確認して再試行してください。',
      missing: 'この回答の録音はまだ用意されていません。',
      integrity: '録音を確認できませんでした。再試行してください。',
      decode: '録音を再生できませんでした。再試行してください。',
      network: '録音を読み込めませんでした。通信状態を確認して再試行してください。'
    };
    const feedback = feedbackFor(button);
    if (!feedback) return;
    feedback.querySelector('.audio-feedback-message').textContent = messages[error?.code] || messages.network;
    feedback.querySelector('.audio-browser-button').hidden = !('speechSynthesis' in window);
    feedback.hidden = false;
    const card = button.closest('.qa-card');
    if (card) delete card.dataset.audioPreviewLoaded;
    refreshPreviews();
  }

  function discardSource(source) {
    for (const [key, value] of audioPreviews) if (value.url === source.url) audioPreviews.delete(key);
    for (const [key, url] of privateAudioCache) {
      if (url !== source.url) continue;
      URL.revokeObjectURL(url);
      privateAudioCache.delete(key);
    }
  }

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
    activeLoadController?.abort();
    activeLoadController = null;
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
    activePlaybackKey = null;
    resetSpeechButtons();
    document.querySelectorAll('.audio-feedback').forEach(feedback => { feedback.hidden = true; });
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
          showAudioFailure(button, new AudioLoadError('decode'));
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

  function selectedAnswer(item, variant = window.InterviewAnswers?.selected(item) || 'full') {
    return item.answerVariants?.[variant] || item.answer || '';
  }

  function previewKey(item, variant = window.InterviewAnswers?.selected(item) || 'full') {
    return JSON.stringify([activeSetSlug(), item.id, item.question, selectedAnswer(item, variant),
      variant, item.audioVariants,
      item.audioTextHash, item.audioDurationSeconds]);
  }

  function parseRecording(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const encoded = String(value.audio_text_hash || '');
    const legacy = encoded.match(/^legacy:([a-f0-9]{64}):([a-f0-9]{64})$/);
    const hash = legacy ? legacy[1] : encoded;
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const bytes = value.audio_sha256 || legacy?.[2] || null;
    if (bytes && (!/^[a-f0-9]{64}$/.test(bytes) || (legacy && bytes !== legacy[2]))) return null;
    const duration = Number(value.duration_seconds);
    const objectPath = value.object_path;
    if (objectPath != null && (typeof objectPath !== 'string' || !bytes || legacy)) return null;
    return { hash, bytes, objectPath, legacy: Boolean(legacy), duration: Number.isFinite(duration) && duration > 0 ? duration : NaN };
  }

  function verifiedRecording(item, selected = window.InterviewAnswers?.selected(item) || 'full') {
    const key = previewKey(item, selected);
    if (recordingPreviews.has(key)) return recordingPreviews.get(key);
    const answer = selectedAnswer(item, selected);
    const variants = item.audioVariants || {};
    // Identical prose can share one recording, including standard === full.
    // Legacy flat fields remain a fallback for previously registered full audio.
    const candidates = [variants[selected], variants.full,
      { audio_text_hash: item.audioTextHash, duration_seconds: item.audioDurationSeconds },
      variants.short, variants.standard].map(parseRecording).filter(Boolean);
    const pending = (async () => {
      if (!answer || !crypto.subtle) return null;
      const hash = await sha256(new TextEncoder().encode(item.question + '\n' + answer));
      return candidates.find(candidate => candidate.hash === hash) || null;
    })().catch(() => null);
    recordingPreviews.set(key, pending);
    return pending;
  }

  function recordingFilename(item, recording) {
    return recording.legacy ? `q${Number(item.id)}.mp3` : `q${Number(item.id)}-${recording.hash}.mp3`;
  }

  function checkCancelled(signal) {
    if (signal.aborted) throw new AudioLoadError('cancelled');
  }

  async function resolveLocalAudio(item, recording, signal) {
    if (!isLocalDevelopment()) return null;
    const slug = activeSetSlug();
    if (!slug) return null;

    if (!recording.bytes) return null;
    const relative = `local-audio/${encodeURIComponent(slug)}/${recordingFilename(item, recording)}`;
    const url = new URL(relative, document.baseURI).href;
    try {
      const cacheKey = 'local:' + url + ':' + recording.bytes;
      if (privateAudioCache.has(cacheKey)) return privateAudioCache.get(cacheKey);
      const response = await fetch(url, { cache: 'no-store', signal });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (await sha256(await blob.arrayBuffer()) !== recording.bytes) return null;
      checkCancelled(signal);
      const objectUrl = URL.createObjectURL(blob);
      privateAudioCache.set(cacheKey, objectUrl);
      return objectUrl;
    } catch {
      checkCancelled(signal);
      return null;
    }
  }

  async function resolvePrivateStorageAudio(item, recording, signal) {
    const session = readBrowserSession();
    const accessToken = String(session?.access_token || '').trim();
    if (!accessToken) throw new AudioLoadError('auth');

    const slug = activeSetSlug();
    if (!slug) throw new AudioLoadError('missing');
    const userId = String(session?.user?.id || jwtSubject(accessToken) || '').trim();
    if (!userId) throw new AudioLoadError('auth');

    const filename = recordingFilename(item, recording);
    const immutablePath = `${userId}/${slug}/q${Number(item.id)}-${recording.hash}-${recording.bytes}.mp3`;
    if (recording.objectPath != null && recording.objectPath !== immutablePath) throw new AudioLoadError('integrity');
    const objectPath = recording.objectPath || `${userId}/${slug}/${filename}`;
    const cacheKey = objectPath + ':' + (recording.bytes || recording.hash);
    if (privateAudioCache.has(cacheKey)) return privateAudioCache.get(cacheKey);

    const encodedPath = objectPath.split('/').map(part => encodeURIComponent(part)).join('/');
    const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${AUDIO_BUCKET}/${encodedPath}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal,
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (response.status === 401 || response.status === 403) throw new AudioLoadError('auth');
      if (response.status === 400 || response.status === 404) throw new AudioLoadError('missing');
      if (!response.ok) throw new AudioLoadError('network');

      const blob = await response.blob();
      if (!blob.size) throw new AudioLoadError('integrity');
      if (recording.bytes && await sha256(await blob.arrayBuffer()) !== recording.bytes) throw new AudioLoadError('integrity');
      checkCancelled(signal);
      const objectUrl = URL.createObjectURL(blob);
      privateAudioCache.set(cacheKey, objectUrl);
      return objectUrl;
    } catch (error) {
      checkCancelled(signal);
      throw error instanceof AudioLoadError ? error : new AudioLoadError('network');
    }
  }

  async function resolveAudioSource(item, recording, signal) {
    checkCancelled(signal);
    const local = await resolveLocalAudio(item, recording, signal);
    if (local) return { url: local, source: 'local' };

    const storage = await resolvePrivateStorageAudio(item, recording, signal);
    if (storage) return { url: storage, source: 'storage' };

    return null;
  }

  async function prepareAudio(item, signal) {
    const key = previewKey(item);
    if (audioPreviews.has(key)) return audioPreviews.get(key);
    const recording = await verifiedRecording(item);
    if (!recording) throw new AudioLoadError('missing');
    const source = await resolveAudioSource(item, recording, signal);
    if (!source) throw new AudioLoadError('missing');
    checkCancelled(signal);
    const result = { ...source, duration: recording.duration };
    // Cache completed work only: cancelling an in-flight load must allow retry.
    audioPreviews.set(key, result);
    return result;
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
        if (speakingId === item.id && activePlaybackKey !== key) stopPlayback();
        card.dataset.audioPreviewKey = key;
        delete card.dataset.audioPreviewLoaded;
        showAudioProgress({ currentTime: 0, duration: NaN }, note);
        note.title = '音声の長さを確認中';
      }
      if (card.dataset.audioPreviewLoaded === key) return;
      card.dataset.audioPreviewLoaded = key;
      // Saved durations are available without downloading or probing any audio.
      const preview = verifiedRecording(item);
      void preview.then(source => {
        if (!card.isConnected || card.dataset.audioPreviewKey !== key || speakingId === item.id) return;
        showAudioProgress({ currentTime: 0, duration: source?.duration ?? NaN }, note);
        note.title = source ? (Number.isFinite(source.duration) ? '再生時間 / 音声の長さ' : '再生時に音声の長さを確認します')
          : 'ブラウザ音声は長さの事前取得・位置指定に対応していません';
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
    const key = previewKey(item);
    if (speakingId === item.id && activePlaybackKey === key) {
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
    activePlaybackKey = key;
    setButtonState(button, '読込中…');

    const request = playbackRequest;
    const controller = new AbortController();
    activeLoadController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, AUDIO_LOAD_TIMEOUT_MS);
    let source;
    try {
      source = await prepareAudio(item, controller.signal);
    } catch (error) {
      if (speakingId === item.id && request === playbackRequest) {
        showAudioFailure(button, timedOut ? new AudioLoadError('timeout') : error);
      }
      return;
    } finally {
      clearTimeout(timeout);
      if (activeLoadController === controller) activeLoadController = null;
    }
    if (speakingId !== item.id || request !== playbackRequest) return;
    const note = toolbar?.querySelector('.audio-source-note');
    showAudioProgress({ currentTime: initialTime, duration: source?.duration ?? NaN }, note);
    if (note) note.title = source ? '再生時間 / 音声の長さ' : 'ブラウザ音声は長さの事前取得・位置指定に対応していません';

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
      discardSource(source);
      showAudioFailure(button, new AudioLoadError('decode'));
    };

    const attempt = ++audioPlayAttempt;
    try {
      await audio.play();
      if (activeAudio === audio && speakingId === item.id && attempt === audioPlayAttempt) setButtonState(button, '停止');
    } catch {
      if (activeAudio !== audio || attempt !== audioPlayAttempt) return;
      if (speakingId === item.id && request === playbackRequest) {
        discardSource(source);
        showAudioFailure(button, new AudioLoadError('decode'));
      }
    }
  }

  document.addEventListener('click', event => {
    const recovery = event.target.closest?.('.audio-retry-button, .audio-browser-button');
    if (recovery) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const card = recovery.closest('.qa-card');
      const button = card?.querySelector('[data-speech-id]');
      const item = (window.INTERVIEW_DATA || []).find(entry => Number(entry.id) === Number(button?.dataset.speechId));
      if (!item || !button) return;
      if (recovery.classList.contains('audio-retry-button')) void play(item, button);
      else {
        stopPlayback();
        speakingId = item.id;
        activePlaybackKey = previewKey(item);
        const note = card.querySelector('.audio-source-note');
        showAudioProgress({ currentTime: 0, duration: NaN }, note);
        if (note) note.title = 'ブラウザ音声は長さの事前取得・位置指定に対応していません';
        speakWithBrowser({ ...item, answer: selectedAnswer(item) }, button);
      }
      return;
    }
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
    async getDuration(item, variant) {
      const recording = await verifiedRecording(item, variant);
      return recording?.duration ?? NaN;
    },
    clearCache() {
      stopPlayback();
      audioPreviews.clear();
      recordingPreviews.clear();
      privateAudioCache.forEach(url => URL.revokeObjectURL(url));
      privateAudioCache.clear();
    }
  };
  window.dispatchEvent(new Event('interview-audio-ready'));
})();
