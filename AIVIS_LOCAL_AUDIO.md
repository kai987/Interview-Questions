# Local AivisSpeech audio generation

This repository includes a local-only CLI for generating interview-practice MP3 files with AivisSpeech.

AivisSpeech itself returns WAV audio. The CLI keeps that WAV data only in memory and immediately converts it with `ffmpeg` to compact mono MP3, so no intermediate WAV files are saved to disk.

Generated audio may contain private interview answers, so `local-audio/` is excluded by `.gitignore` and must not be committed to the public repository.

## 1. Requirements

Start AivisSpeech / AivisSpeech Engine on your Mac. The CLI uses this endpoint by default:

```text
http://127.0.0.1:10101
```

The MP3 conversion also requires `ffmpeg`:

```bash
brew install ffmpeg
```

## 2. Find the voice/style ID

```bash
python3 scripts/generate_aivis_audio.py --list-voices
```

Example:

```text
Speaker Name
  style-id=123456  Normal
```

## 3. One-time passwordless Supabase session import

Open the logged-in Interview Questions site in Chrome. In DevTools → Console run:

```js
copy(localStorage.getItem('sb-flpmblfscgcbrprwwckz-auth-token'))
```

Then in Terminal:

```bash
pbpaste | python3 scripts/generate_aivis_audio.py --import-session
```

The CLI stores only the short-lived access token at:

```text
~/.config/interview-questions/supabase-session.json
```

When it expires, repeat the same import. No Supabase password is required.

## 4. Generate all ConglomerateSynergy audio

Replace `123456` with your AivisSpeech style ID:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456
```

Default output:

```text
local-audio/
└── conglomerate-synergy-system-engineer/
    ├── q44.mp3
    ├── q45.mp3
    ├── q46.mp3
    ├── ...
    ├── q86.mp3
    └── manifest.json
```

The default MP3 settings are:

```text
mono
96 kbps
```

This is generally enough for clear interview-practice speech while keeping file size small.

To choose another bitrate:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --mp3-bitrate 128k
```

You can also set a default:

```bash
export AIVIS_MP3_BITRATE=96k
```

## 5. Generate only one question

By question order inside the company set:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --sort-order 1
```

Or by global database question ID:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --question-id 44
```

## 6. Split question and answer into separate MP3 files

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --mode split
```

Output:

```text
q44-question.mp3
q44-answer.mp3
q45-question.mp3
q45-answer.mp3
```

Modes:

```text
--mode combined   q44.mp3 containing question + answer (default)
--mode split      q44-question.mp3 and q44-answer.mp3
--mode question   question MP3 only
--mode answer     answer MP3 only
```

## 7. Voice tuning

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --speed 0.92 \
  --pitch 0.0 \
  --intonation 1.05 \
  --volume 1.0
```

For interview shadowing, a speed around `0.90` to `0.98` is usually comfortable.

## 8. Regeneration behavior

`manifest.json` stores a hash of the source text, voice settings, MP3 format, and bitrate.

Running the same command again skips unchanged files:

```text
SKIP  q44.mp3
SKIP  q45.mp3
```

If the Supabase answer or voice settings change, only the affected MP3 files are regenerated.

Force regeneration:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --overwrite
```

## 9. SSL diagnostics

```bash
python3 scripts/generate_aivis_audio.py --ssl-info
```

If your Python CA bundle is broken on macOS:

```bash
python3 -m pip install --upgrade certifi
```

## Privacy

`local-audio/` can contain spoken versions of private employment history, school information, visa details, salary expectations, and other personal interview content. Keep it local.

The local Supabase access-token file is stored outside the repository under `~/.config/interview-questions/`. Do not copy it into the repository or share it.
