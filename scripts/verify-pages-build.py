#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
index = dist / "index.html"

if not index.exists():
    print("dist/index.html is missing", file=sys.stderr)
    sys.exit(1)

text = index.read_text(encoding="utf-8")
manual_versions = re.findall(r"\.(?:css|js)\?v=(?:1|2|3|4|5|6)(?=[\"'])", text)
if manual_versions:
    print(f"Manual asset versions remain in dist/index.html: {manual_versions}", file=sys.stderr)
    sys.exit(1)

if "bootstrap.js?v=" not in text:
    print("Versioned bootstrap.js reference is missing", file=sys.stderr)
    sys.exit(1)

print("Pages build verification passed")
