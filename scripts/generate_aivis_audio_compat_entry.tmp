#!/usr/bin/env python3
"""Public CLI entrypoint with Supabase session-storage compatibility."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import _generate_aivis_audio_launcher as launcher
from session_import_compat import decode_supabase_storage_value


def import_session_compat(path: Path) -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        raise launcher.core.CliError(
            "No browser session was received on stdin. Copy the logged-in Supabase localStorage value, then pipe pbpaste into this command."
        )

    try:
        value: Any = decode_supabase_storage_value(raw)
    except ValueError as error:
        raise launcher.core.CliError(
            "Could not decode the copied Supabase browser session. Make sure the Interview Questions site is logged in before copying localStorage."
        ) from error

    session = launcher.normalize_browser_session(value)
    launcher.save_session(path, session)

    exp = session.get("expires_at")
    remaining = int(exp - time.time()) if isinstance(exp, (int, float)) else None
    user = session.get("user") if isinstance(session.get("user"), dict) else {}
    email = user.get("email") if isinstance(user, dict) else None

    print(f"Saved passwordless Supabase access token to: {path}")
    if email:
        print(f"User: {email}")
    if remaining is not None:
        print(f"Token remaining: about {max(remaining, 0) // 60} minutes")
    print("The browser refresh token was not stored.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--import-session", action="store_true")
    parser.add_argument(
        "--session-file",
        default=os.environ.get(
            "INTERVIEW_SUPABASE_SESSION_FILE",
            str(launcher.DEFAULT_SESSION_FILE),
        ),
    )
    known, remaining = parser.parse_known_args()

    if known.import_session:
        if remaining:
            raise launcher.core.CliError(
                f"Unexpected arguments with --import-session: {' '.join(remaining)}"
            )
        path = Path(known.session_file).expanduser().resolve()
        return import_session_compat(path)

    return launcher.main()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        raise SystemExit(130)
    except launcher.core.CliError as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
