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

Local audio is attempted on localhost / 127.0.0.1 / 0.0.0.0 / .local hosts. Serve the repository with `python3 scripts/serve_local.py --port 8000` so its Jekyll headers are expanded correctly.

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

The active audio library and manifests contain MP3 files only. Five historical WAV entries (q44–q48) were retired in favor of their existing, verified MP3 replacements; their originals were backed up outside the repository. AivisSpeech's WAV response is converted in memory, so the public generation command does not leave WAV files on disk.

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

## Answer revision verification

Combined recordings are now uploaded as `q<ID>-<source-hash>.mp3`. The hash is SHA-256 of the exact UTF-8 `question + "\n" + answer`. After uploading, the CLI registers that hash in the owner's `interview_private_content.audio_text_hash`.

The manifest also records `source_hash`, `audio_sha256`, and `duration_seconds`. Duration is measured from the final MP3 with `ffprobe` (included with FFmpeg); WAV duration uses sample frames. Upload refuses a file whose text or bytes differ from the current answer/manifest. Run normal generation first to upgrade an older manifest. An unchanged generation hash can reuse existing audio and backfill these fields.

Generation, reuse of unchanged files, and `--upload-only` all measure the final file's duration. The upload registers `duration_seconds` together with `audio_text_hash` in the private content row. The page can display the saved total without fetching audio; actual playback metadata then calibrates the total. Missing durations retain the metadata-loading fallback. Browser speech has no known total and cannot be seeked.

To measure existing local audio without synthesis, login, or upload:

```bash
python3 scripts/backfill_audio_durations.py --dry-run
python3 scripts/backfill_audio_durations.py
```

This updates manifests only. To register a verified recording and its duration in Supabase, use the existing `--upload-only` flow. The `duration_seconds` schema addition is documented in README. The September 13 backfill registered durations only for existing database audio hashes that matched the local MP3 bytes and current answer; it did not regenerate or upload recordings.

Duration checks: `python3 -m unittest discover -s tests -p 'test_*.py'`.

Existing verified recordings use the temporary registration format `legacy:<source-hash>:<audio-sha256>` and retain their old filename. The browser verifies both the current text and downloaded MP3 bytes before playing these recordings. New uploads always use the versioned filename. Short/standard answer variants use the browser's current Japanese voice; a full-answer recording is never played for different text.
