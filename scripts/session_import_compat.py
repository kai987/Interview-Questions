from __future__ import annotations

import base64
import json
from typing import Any


def decode_supabase_storage_value(raw: str) -> Any:
    """Decode Supabase auth storage copied from browser localStorage.

    Accepts plain JSON, JSON-encoded strings, and Supabase's `base64-` base64url
    representation. The function deliberately returns the decoded value without
    logging it because it may contain credentials.
    """
    value: Any = raw.strip()
    if not value:
        raise ValueError("clipboard is empty")

    for _ in range(5):
        if not isinstance(value, str):
            return value

        text = value.strip()
        if text in {"null", "undefined"}:
            raise ValueError("browser session value is empty")

        if text.startswith("base64-"):
            encoded = text[len("base64-") :]
            if not encoded:
                raise ValueError("base64 session payload is empty")
            try:
                encoded += "=" * (-len(encoded) % 4)
                value = base64.urlsafe_b64decode(encoded.encode("ascii")).decode("utf-8")
            except (ValueError, UnicodeDecodeError) as error:
                raise ValueError("could not decode Supabase base64 session") from error
            continue

        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            return value

    return value
