# Local AivisSpeech audio generation

This repository includes a local CLI for generating compact MP3 interview-practice audio with AivisSpeech and optionally uploading it to private Supabase Storage.

Generated audio may contain private interview answers, so `local-audio/` is excluded by `.gitignore` and must not be committed to the public repository.

## Playback priority

The website now uses this order when you press `音声で練習`:

```text
local development: local-audio/<set-slug>/q<ID>.mp3
        ↓ if missing
logged-in user: private Supabase Storage interview-audio/<user-id>/<set-slug>/q<ID>.mp3
        ↓ if missing
browser speechSynthesis fallback
```

Local audio is attempted on localhost / 127.0.0.1 / 0.0.0.0 / .local hosts. Serve the repository over HTTP (for example `python3 -m http.server 8000`) rather than opening `index.html` directly with `file://`.

## One-time passwordless session import

Open the logged-in Interview Questions site in Chrome, then DevTools → Console:

```js
copy(localStorage.getItem('sb-flpmblfscgcbrprwwckz-auth-token'))
```

Then:

```bash
pbpaste | python3 scripts/generate_aivis_audio.py --import-session
```

## Generate MP3 locally

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 497929760
```

Default output is mono 96 kbps MP3 under `local-audio/<set-slug>/`.

## Generate and upload

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 497929760 \
  --upload
```

Objects are uploaded to the private bucket path:

```text
interview-audio/<your-user-id>/<set-slug>/q<ID>.mp3
```

## Upload existing files only

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --upload-only
```

`--upload-only` uses the existing `manifest.json` and does not run AivisSpeech or ffmpeg.

## Useful options

```text
--sort-order 1        only one question in the current set
--question-id 44      only one global DB question ID
--mode combined       q44.mp3 (default; website playback uses this)
--mode split          q44-question.mp3 + q44-answer.mp3
--mp3-bitrate 128k    change MP3 bitrate
--overwrite           regenerate unchanged files
```

## Privacy

Keep `local-audio/` gitignored. Online audio belongs in the private `interview-audio` Supabase Storage bucket, where RLS limits access to the authenticated user's UUID folder.
