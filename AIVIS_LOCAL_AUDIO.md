# Local AivisSpeech audio generation

This repository includes a local CLI for generating compact MP3 interview-practice audio with AivisSpeech and optionally uploading it to private Supabase Storage.

Generated audio may contain private interview answers, so `local-audio/` is excluded by `.gitignore` and must not be committed to the public repository.

## Playback priority

The website now uses this order when you press `音声で練習`:

```text
local development: local-audio/<set-slug>/q<ID>-<source-hash>.mp3
        ↓ if missing
logged-in user: private Supabase Storage interview-audio/<user-id>/<set-slug>/q<ID>-<source-hash>.mp3
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

Combined mode defaults to `--answer-variant all`: full, short, and standard. Each variant uses `answer_variants[variant]` when nonempty, otherwise `answer`, matching the website. Identical effective question/answer text shares one recording. For example, a standard answer identical to the full answer produces one file for both.

New local files are named `q<ID>-<source-hash>.mp3`. AivisSpeech's WAV response is converted in memory, so the public generation command does not leave WAV files on disk.

## Generate from a trusted export without login

An explicitly supplied export can be used for local generation when the CLI session has expired:

```bash
python3 scripts/generate_aivis_audio.py \
  --set example-set \
  --input-json /absolute/private/path/interview-export.json \
  --style-id 497929760
```

The JSON shape is `{ "interview_set": { "id": 1, "slug": "example-set" }, "rows": [...] }`. Each row contains a unique positive integer `id`, string `question` and `answer`, optional `sort_order`/`set_id`, and `answer_variants` such as `{ "short": "短い回答", "standard": "標準の回答" }`.

The export must match `--set`. Input JSON never authenticates or supplies upload data: it cannot be combined with `--upload` or `--upload-only`. Keep private exports in `local-audio/` or outside the repository. Upload generated files separately without `--input-json` to revalidate them against authenticated live data.

## Generate and upload

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 497929760 \
  --upload
```

Objects are uploaded to the private bucket path:

```text
interview-audio/<your-user-id>/<set-slug>/q<ID>-<source-hash>.mp3
```

## Upload existing files only

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --upload-only
```

`--upload-only` uses the existing `manifest.json` and does not run synthesis or conversion. It does use ffprobe to measure the final MP3. It rereads authenticated live questions/variants and accepts only matching source and byte hashes. Missing or stale variants are reported and skipped; no matching files is an error.

## Useful options

```text
--sort-order 1        only one question in the current set
--question-id 44      only one global DB question ID
--mode combined       q44-<source-hash>.mp3 (default; website playback uses this)
--mode split          q44-question.mp3 + q44-answer.mp3
--answer-variant all  all distinct effective answers (combined default)
--answer-variant short / standard / full   only the selected answer length
--mp3-bitrate 128k    change MP3 bitrate
--overwrite           regenerate unchanged files
```

Auxiliary `split`, `question`, and `answer` modes keep their original filenames and accept only the full variant. They do not register website playback metadata.

## Privacy

Keep `local-audio/` gitignored. Online audio belongs in the private `interview-audio` Supabase Storage bucket, where RLS limits access to the authenticated user's UUID folder.

## Answer revision verification

Combined recordings use SHA-256 of the exact UTF-8 `question + "\n" + effective_answer` as the source hash. Whitespace cleanup applies only to synthesis, not revision checking. The manifest records `source_hash`, `audio_sha256`, `duration_seconds`, the generation settings hash, and an `answer_variants` list of aliases sharing this file.

After uploads, the CLI rereads current text and existing metadata, rejects changed text, then registers each matching variant in `interview_private_content.audio_variants`:

```json
{
  "short": {
    "audio_text_hash": "<source-hash>",
    "audio_sha256": "<MP3-byte-hash>",
    "duration_seconds": 28.392
  }
}
```

Unrelated variant metadata is preserved. Every current variant sharing an uploaded source hash receives the same metadata, including single-variant uploads: a new voice or encoding replaces their shared object bytes. When `full` is among those variants, the older flat `audio_text_hash` and `duration_seconds` fields are synchronized. Metadata registration must return one confirmed matching row; an empty update is an error.

Unchanged recordings are reused only when the source, generation settings and final bytes all match. A verified legacy `q<ID>.mp3` can seed the versioned local filename and upload under the versioned remote name. Old audio is not deleted automatically.

Generation, verified reuse, and upload all measure the final file with `ffprobe` (included with FFmpeg); WAV duration uses sample frames. Stored estimates are not trusted. The page displays the selected variant's saved total without downloading or probing audio. Missing duration shows `--:--` until playback metadata is available. Playback metadata calibrates the saved value. Browser speech has no known total and cannot be seeked.

To measure existing local audio without synthesis, login, or upload:

```bash
python3 scripts/backfill_audio_durations.py --dry-run
python3 scripts/backfill_audio_durations.py
```

This updates manifests only. To register a verified recording and its duration in Supabase, use the existing `--upload-only` flow. The `duration_seconds` schema addition is documented in README. The September 13 backfill registered durations only for existing database audio hashes that matched the local MP3 bytes and current answer; it did not regenerate or upload recordings.

Duration checks: `python3 -m unittest discover -s tests -p 'test_*.py'`.

Older verified recordings can retain the registration format `legacy:<source-hash>:<audio-sha256>` and their old filename. The browser verifies both current text and downloaded bytes. New uploads use the versioned filename for every answer length. Variants without a matching recording use browser speech; full audio is never played for different short/standard text.
