#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
dist = root / "dist"
index = dist / "index.html"
bootstrap = dist / "bootstrap.js"

if not index.exists():
    print("dist/index.html is missing", file=sys.stderr)
    sys.exit(1)

if not bootstrap.exists():
    print("dist/bootstrap.js is missing", file=sys.stderr)
    sys.exit(1)

text = index.read_text(encoding="utf-8")
manual_versions = re.findall(r"\.(?:css|js)\?v=(?:1|2|3|4|5|6)(?=[\"'])", text)
if manual_versions:
    print(f"Manual asset versions remain in dist/index.html: {manual_versions}", file=sys.stderr)
    sys.exit(1)

if "bootstrap.js?v=" not in text:
    print("Versioned bootstrap.js reference is missing", file=sys.stderr)
    sys.exit(1)

bootstrap_text = bootstrap.read_text(encoding="utf-8")
expected_supabase_import = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm"
if expected_supabase_import not in bootstrap_text:
    print("Supabase CDN import was altered during the Pages build", file=sys.stderr)
    sys.exit(1)

if "https://cdn.js?v=" in bootstrap_text:
    print("External CDN URL was incorrectly cache-busted", file=sys.stderr)
    sys.exit(1)

print("Pages build verification passed")
