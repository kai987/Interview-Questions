#!/usr/bin/env python3
"""Measure existing local audio into its manifests without synthesis or upload."""
import argparse
from pathlib import Path

import _generate_aivis_audio_core as core


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default=core.DEFAULT_OUTPUT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    manifests = sorted(Path(args.output_dir).expanduser().glob("*/manifest.json"))
    if not manifests:
        raise core.CliError("No audio manifests found.")
    measured = 0
    for path in manifests:
        manifest = core.load_manifest(path)
        count = 0
        for filename, entry in manifest.get("files", {}).items():
            file_path = path.parent / filename
            if not file_path.is_file():
                raise core.CliError(f"Manifest audio file is missing: {file_path}")
            entry["duration_seconds"] = core.audio_duration_seconds(file_path)
            count += 1
        if not args.dry_run:
            core.save_manifest(path, manifest)
        measured += count
        print(f"{path.parent.name}: {count} durations {'checked' if args.dry_run else 'saved'}")
    print(f"Total: {measured}. Audio files were not changed.")


if __name__ == "__main__":
    try:
        main()
    except core.CliError as error:
        raise SystemExit(str(error)) from error
