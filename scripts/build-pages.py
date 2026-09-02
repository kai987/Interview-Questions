#!/usr/bin/env python3
from pathlib import Path
import os
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
SHA = os.environ.get("GITHUB_SHA", "dev")[:12]

SKIP_DIRS = {".git", ".github", "dist", "scripts"}
COPY_EXTS = {".html", ".css", ".js", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".txt", ".md"}

if DIST.exists():
    shutil.rmtree(DIST)
DIST.mkdir(parents=True)

for src in ROOT.rglob("*"):
    if not src.is_file():
        continue
    rel = src.relative_to(ROOT)
    if rel.parts and rel.parts[0] in SKIP_DIRS:
        continue
    if src.suffix.lower() not in COPY_EXTS and src.name not in {"CNAME", ".nojekyll"}:
        continue
    dest = DIST / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)

asset_version_re = re.compile(r"((?:\./)?[^'\"\s)>]+\.(?:css|js))(?:\?v=[^'\"\s)>]+)?")

for path in list(DIST.rglob("*.html")) + list(DIST.rglob("*.js")):
    text = path.read_text(encoding="utf-8")
    text = asset_version_re.sub(lambda m: f"{m.group(1)}?v={SHA}", text)
    path.write_text(text, encoding="utf-8")

(DIST / ".nojekyll").write_text("", encoding="utf-8")
print(f"Built GitHub Pages artifact with asset version {SHA}")
