# Interview audio audit (Rust)

Read-only offline sidecar for the existing Python AivisSpeech tool. The existing
Python generation, upload, browser session handling, and Supabase RLS remain
unchanged. No network requests, login, uploads, synthesis, file repair, or cache
deletion are performed. Run the audit while audio generation is stopped.

## Build and use

Install a current stable Rust toolchain (Cargo) and FFmpeg/ffprobe. On macOS use
an existing Rust installation and, if needed, `brew install ffmpeg`.

From the repository root:

```sh
cargo build --locked --release --manifest-path tools/interview-audio-audit/Cargo.toml
tools/interview-audio-audit/target/release/interview-audio-audit --root local-audio
tools/interview-audio-audit/target/release/interview-audio-audit --root local-audio --set example-set
```

The tool audits manifests in set directories, checks filenames and question
identity, streams SHA-256 of the actual bytes, measures PCM WAV durations
directly from sample frames and MP3 durations via the same ffprobe
format-duration calculation used by Python. It checks stored durations to
six-decimal precision, verifies that versioned filenames match the stored
source hash, and reports duplicate groups of byte-identical verified files.
Legacy filenames and missing generation hash/variant alias metadata are
supported; the latter are warnings, not proof of generation-settings reuse.
Invalid or missing hashes, durations and audio files fail the audit.

The JSON report contains set/filename/ID, measured duration, byte count,
digests, issue codes and duplicate groups, never the actual answer text or
recording data. Treat the report as private (filenames and set names may reveal
personal interview history). Do not commit it or private exports.

`--jobs 1..8` controls bounded parallel reading/probing; defaults to 2, including
on Mac. Reports are sorted deterministically. Exit 0 means the local manifest
and its listed files passed; exit 1 means an integrity/schema/file failure;
invalid command-line arguments exit 2. Empty manifest coverage is not evidence
that recordings exist. Unlisted files are not claimed as verified.
The stricter auditor rejects unsafe filenames, symlinked listed files,
duplicate manifest file keys, and truncated/unsupported PCM files.

## Optional local source coverage

Use the same explicitly exported JSON schema as the Python generator. It is
read-only and never authorizes upload:

```sh
tools/interview-audio-audit/target/release/interview-audio-audit \
  --root local-audio --set example-set \
  --input-json /absolute/private/path/interview-export.json
```

The tool independently derives each full/short/standard effective source hash
from exact UTF-8 question + newline + answer bytes (including whitespace).
Equal effective answers form one combined recording target with all aliases.
The coverage plan defaults to MP3, or accepts `--format wav`. It recognizes
verified legacy q<ID> files only when their source hash is current. Each
expected target is ready, missing, or needs_review. Old intact recordings can
remain in the cache; they are not claimed as current recordings. Add
`--require-complete` to fail if any target is not ready. A ready target is only
a verified local recording of the supplied text; the current voice, generation
parameters and live authenticated database are not verified by this tool.

## Rust/Python parity

```sh
cargo test --locked --manifest-path tools/interview-audio-audit/Cargo.toml
cargo build --locked --release --manifest-path tools/interview-audio-audit/Cargo.toml
python3 tools/interview-audio-audit/parity.py \
  --binary tools/interview-audio-audit/target/release/interview-audio-audit
```

Parity uses the production Python `audio_duration_seconds` and
`audio_targets` functions on synthetic MP3/WAV fixtures, comparing duration,
hash, byte count, exact source and alias grouping, legacy matching and
deterministic parallel output. Failure cases include corrupted/truncated files,
missing files, stale answers, invalid manifests and path/symlink rejection.
The test checks that all fixture file bytes and paths remain unchanged during
each audit. CI runs independently on audio-tool changes, with no credentials
or private recordings. The production Python workflow stays authoritative for
synthesis/reuse/upload decisions until a separate measured integration.
