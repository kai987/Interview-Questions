# Local AivisSpeech audio generation

This repository includes a local-only CLI for generating interview-practice WAV files with AivisSpeech.

The generated audio may contain private interview answers, so `local-audio/` is excluded by `.gitignore` and must not be committed to the public repository.

## 1. Start AivisSpeech

Start AivisSpeech / AivisSpeech Engine on your Mac. The CLI uses this endpoint by default:

```text
http://127.0.0.1:10101
```

If your engine uses a different URL, pass `--engine-url`.

## 2. Find the voice/style ID

```bash
python3 scripts/generate_aivis_audio.py --list-voices
```

Example output:

```text
Speaker Name
  style-id=123456  Normal
  style-id=123457  Happy
```

Use the desired numeric `style-id` in the generation commands below.

## 3. One-time passwordless Supabase session import

The CLI no longer asks for a Supabase password.

Open the Interview Questions site in Chrome and make sure you are already logged in. Then open DevTools → Console and run:

```js
copy(localStorage.getItem('sb-flpmblfscgcbrprwwckz-auth-token'))
```

Then in Terminal, from the repository root:

```bash
pbpaste | python3 scripts/generate_aivis_audio.py --import-session
```

The CLI stores only the short-lived Supabase `access_token` at:

```text
~/.config/interview-questions/supabase-session.json
```

The file permission is set to `600` when possible.

For safety, the CLI deliberately does **not** store or rotate the browser's Supabase `refresh_token`. Refresh tokens are rotated by Supabase and sharing them between the browser and a separate CLI can interfere with the browser session.

When the access token expires, repeat the same two commands above. No password is required.

To use a custom session path:

```bash
pbpaste | python3 scripts/generate_aivis_audio.py \
  --import-session \
  --session-file ~/.config/interview-questions/my-session.json
```

You can also set:

```bash
export INTERVIEW_SUPABASE_SESSION_FILE="$HOME/.config/interview-questions/my-session.json"
```

## 4. List interview sets

After importing the browser session:

```bash
python3 scripts/generate_aivis_audio.py --list-sets
```

No email or password prompt should appear.

## 5. Generate all audio for ConglomerateSynergy

Replace `123456` with the AivisSpeech style ID you want to use:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456
```

Default output:

```text
local-audio/
└── conglomerate-synergy-system-engineer/
    ├── q44.wav
    ├── q45.wav
    ├── q46.wav
    ├── ...
    ├── q86.wav
    └── manifest.json
```

The default `combined` mode reads:

```text
質問。<question>。回答例。<answer>
```

## 6. Generate only one question

By question number within the selected company (`sort_order`):

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

## 7. Generate question and answer as separate WAV files

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --mode split
```

Output example:

```text
q44-question.wav
q44-answer.wav
q45-question.wav
q45-answer.wav
```

Other modes:

```text
--mode combined   q44.wav containing question + answer (default)
--mode split      q44-question.wav and q44-answer.wav
--mode question   question audio only
--mode answer     answer audio only
```

## 8. Voice tuning

Example:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --speed 0.92 \
  --pitch 0.0 \
  --intonation 1.05 \
  --volume 1.0
```

Options correspond to AivisSpeech synthesis values:

```text
--speed       speedScale
--pitch       pitchScale
--intonation  intonationScale
--volume      volumeScale
```

For interview practice, a speed around `0.90` to `0.98` is usually easy to shadow.

## 9. Regeneration behavior

The CLI creates `manifest.json` and stores a hash of the source text + voice settings for each WAV.

Running the same command again skips unchanged audio automatically:

```text
SKIP  q44.wav
SKIP  q45.wav
```

If an interview answer changes in Supabase, its hash changes and that WAV is regenerated automatically.

To force regeneration of everything:

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --overwrite
```

## 10. Preview without synthesizing

```bash
python3 scripts/generate_aivis_audio.py \
  --set conglomerate-synergy-system-engineer \
  --style-id 123456 \
  --dry-run
```

## 11. Custom AivisSpeech Engine URL

```bash
python3 scripts/generate_aivis_audio.py \
  --engine-url http://127.0.0.1:10101 \
  --list-voices
```

Or:

```bash
export AIVIS_ENGINE_URL='http://127.0.0.1:10101'
```

## Privacy

`local-audio/` can contain spoken versions of private employment history, school information, visa details, salary expectations, and other personal interview content. Keep it local and do not remove it from `.gitignore` unless you intentionally want to publish those files.

The local Supabase access-token file is stored outside the repository under `~/.config/interview-questions/`. Do not copy it into the repository or share it.
