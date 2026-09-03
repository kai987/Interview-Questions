#!/usr/bin/env python3
"""Passwordless launcher for the local AivisSpeech interview-audio CLI.

The browser session is imported once from Supabase localStorage. Only the short-lived
access token is stored locally; the browser refresh token is deliberately NOT stored
or rotated by this CLI, so command-line use cannot disturb the browser's session.

AivisSpeech returns WAV audio. This launcher converts that WAV data in memory with
ffmpeg and writes compact mono MP3 files by default, so no intermediate WAV files are
saved to disk.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import ssl
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import _generate_aivis_audio_core as core

PROJECT_REF = "flpmblfscgcbrprwwckz"
STORAGE_KEY = f"sb-{PROJECT_REF}-auth-token"
DEFAULT_SESSION_FILE = Path("~/.config/interview-questions/supabase-session.json").expanduser()
DEFAULT_MP3_BITRATE = os.environ.get("AIVIS_MP3_BITRATE", "96k")
SESSION_FILE = DEFAULT_SESSION_FILE


def find_ca_bundle() -> str | None:
    """Find a trusted CA bundle without disabling TLS verification."""
    env_path = os.environ.get("SSL_CERT_FILE")
    if env_path and Path(env_path).expanduser().is_file():
        return str(Path(env_path).expanduser())

    try:
        import certifi  # type: ignore

        certifi_path = certifi.where()
        if certifi_path and Path(certifi_path).is_file():
            return certifi_path
    except ImportError:
        pass

    candidates = [
        "/etc/ssl/cert.pem",
        "/opt/homebrew/etc/openssl@3/cert.pem",
        "/opt/homebrew/etc/openssl/cert.pem",
        "/usr/local/etc/openssl@3/cert.pem",
        "/usr/local/etc/openssl/cert.pem",
    ]
    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    return None


def configure_ssl() -> str:
    """Make urllib use a verified CA bundle that works reliably on macOS."""
    ca_bundle = find_ca_bundle()
    context = ssl.create_default_context(cafile=ca_bundle) if ca_bundle else ssl.create_default_context()
    original_urlopen = core.urlopen

    def verified_urlopen(url: Any, *args: Any, **kwargs: Any) -> Any:
        target = getattr(url, "full_url", str(url))
        if str(target).startswith("https://"):
            kwargs.setdefault("context", context)
        return original_urlopen(url, *args, **kwargs)

    core.urlopen = verified_urlopen
    return ca_bundle or "Python default certificate store"


def configure_mp3_output(bitrate: str) -> None:
    """Convert AivisSpeech WAV bytes to mono MP3 without writing a temporary WAV."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise core.CliError(
            "ffmpeg was not found. Install it first, for example:\n"
            "  brew install ffmpeg"
        )

    original_synthesize = core.synthesize
    original_target_texts = core.target_texts
    original_generation_hash = core.generation_hash

    def mp3_target_texts(row: dict[str, Any], mode: str) -> list[tuple[str, str]]:
        targets = original_target_texts(row, mode)
        return [
            ((filename[:-4] + ".mp3") if filename.lower().endswith(".wav") else filename, text)
            for filename, text in targets
        ]

    def mp3_synthesize(
        engine_url: str,
        style_id: int,
        text: str,
        *,
        speed_scale: float,
        pitch_scale: float,
        intonation_scale: float,
        volume_scale: float,
    ) -> bytes:
        wav_data = original_synthesize(
            engine_url,
            style_id,
            text,
            speed_scale=speed_scale,
            pitch_scale=pitch_scale,
            intonation_scale=intonation_scale,
            volume_scale=volume_scale,
        )

        process = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "wav",
                "-i",
                "pipe:0",
                "-vn",
                "-ac",
                "1",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                bitrate,
                "-f",
                "mp3",
                "pipe:1",
            ],
            input=wav_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode != 0:
            detail = process.stderr.decode("utf-8", errors="replace").strip()
            raise core.CliError(f"ffmpeg MP3 conversion failed:\n{detail}")
        if not process.stdout:
            raise core.CliError("ffmpeg returned an empty MP3 file.")
        return process.stdout

    def mp3_generation_hash(
        text: str,
        *,
        style_id: int,
        speed_scale: float,
        pitch_scale: float,
        intonation_scale: float,
        volume_scale: float,
    ) -> str:
        base_hash = original_generation_hash(
            text,
            style_id=style_id,
            speed_scale=speed_scale,
            pitch_scale=pitch_scale,
            intonation_scale=intonation_scale,
            volume_scale=volume_scale,
        )
        return hashlib.sha256(f"{base_hash}|mp3|mono|{bitrate}".encode("utf-8")).hexdigest()

    core.target_texts = mp3_target_texts
    core.synthesize = mp3_synthesize
    core.generation_hash = mp3_generation_hash


def jwt_exp(access_token: str) -> int | None:
    try:
        payload = access_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload.encode("ascii")).decode("utf-8"))
        value = data.get("exp")
        return int(value) if value is not None else None
    except (IndexError, ValueError, TypeError, json.JSONDecodeError):
        return None


def normalize_browser_session(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise core.CliError("The imported browser session is not valid JSON.") from error

    if not isinstance(value, dict):
        raise core.CliError("The imported browser session must be a JSON object.")

    if isinstance(value.get("session"), dict):
        value = value["session"]
    elif isinstance(value.get("currentSession"), dict):
        value = value["currentSession"]

    access_token = str(value.get("access_token") or "").strip()
    if not access_token:
        raise core.CliError("No access_token was found in the imported browser session.")

    safe_session: dict[str, Any] = {
        "access_token": access_token,
        "expires_at": value.get("expires_at") or jwt_exp(access_token),
    }
    user = value.get("user")
    if isinstance(user, dict):
        safe_session["user"] = {
            key: user.get(key)
            for key in ("id", "email")
            if user.get(key) is not None
        }
    return safe_session


def save_session(path: Path, session: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def import_session_from_stdin(path: Path) -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        raise core.CliError(
            "No session JSON was received on stdin. Copy the browser session first, then pipe pbpaste into this command."
        )
    try:
        value: Any = json.loads(raw)
    except json.JSONDecodeError as error:
        raise core.CliError("stdin does not contain valid Supabase session JSON.") from error

    session = normalize_browser_session(value)
    save_session(path, session)
    exp = session.get("expires_at")
    remaining = int(exp - time.time()) if isinstance(exp, (int, float)) else None
    email = ((session.get("user") or {}).get("email") if isinstance(session.get("user"), dict) else None)
    print(f"Saved passwordless Supabase access token to: {path}")
    if email:
        print(f"User: {email}")
    if remaining is not None:
        print(f"Token remaining: about {max(remaining, 0) // 60} minutes")
    print("The browser refresh token was not stored.")
    return 0


def passwordless_get_supabase_token(url: str, key: str, access_token: str | None) -> str:
    if access_token:
        return access_token

    path = SESSION_FILE
    if not path.exists():
        raise core.CliError(
            "No local Supabase session was found.\n\n"
            "One-time import:\n"
            f"  1. Open the logged-in Interview Questions site in Chrome.\n"
            f"  2. DevTools Console: copy(localStorage.getItem('{STORAGE_KEY}'))\n"
            "  3. Terminal: pbpaste | python3 scripts/generate_aivis_audio.py --import-session\n\n"
            "No Supabase password is required."
        )

    try:
        session = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise core.CliError(f"Could not read local session file: {path}") from error

    token = str((session or {}).get("access_token") or "").strip()
    if not token:
        raise core.CliError(f"No access_token is stored in: {path}")

    exp = (session or {}).get("expires_at") or jwt_exp(token)
    if isinstance(exp, (int, float)) and exp <= time.time() + 30:
        raise core.CliError(
            "The imported Supabase access token has expired.\n"
            "Re-import the current browser session (no password required):\n"
            f"  DevTools Console: copy(localStorage.getItem('{STORAGE_KEY}'))\n"
            "  Terminal: pbpaste | python3 scripts/generate_aivis_audio.py --import-session"
        )
    return token


def launcher_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--import-session", action="store_true")
    parser.add_argument("--ssl-info", action="store_true")
    parser.add_argument("--mp3-bitrate", default=DEFAULT_MP3_BITRATE)
    parser.add_argument(
        "--session-file",
        default=os.environ.get("INTERVIEW_SUPABASE_SESSION_FILE", str(DEFAULT_SESSION_FILE)),
    )
    return parser


def main() -> int:
    global SESSION_FILE
    launcher_args, remaining = launcher_parser().parse_known_args()
    SESSION_FILE = Path(launcher_args.session_file).expanduser().resolve()

    ca_source = configure_ssl()
    if launcher_args.ssl_info:
        print(f"TLS CA bundle: {ca_source}")
        return 0

    if launcher_args.import_session:
        if remaining:
            raise core.CliError(f"Unexpected arguments with --import-session: {' '.join(remaining)}")
        return import_session_from_stdin(SESSION_FILE)

    configure_mp3_output(launcher_args.mp3_bitrate)

    core.get_supabase_token = passwordless_get_supabase_token
    sys.argv = [sys.argv[0], *remaining]
    return core.main()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        raise SystemExit(130)
    except core.CliError as error:
        message = str(error)
        if "CERTIFICATE_VERIFY_FAILED" in message:
            message += (
                "\n\nmacOS certificate fix:\n"
                "  python3 -m pip install --upgrade certifi\n"
                "Then run the command again. You can inspect the selected CA bundle with:\n"
                "  python3 scripts/generate_aivis_audio.py --ssl-info"
            )
        print(f"Error: {message}", file=sys.stderr)
        raise SystemExit(1)
