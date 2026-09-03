#!/usr/bin/env python3
"""Generate local interview-practice WAV files with AivisSpeech.

The script reads interview questions and the signed-in user's private answers from
Supabase, then sends the text to a local AivisSpeech Engine (default port 10101).
Generated audio is written under local-audio/, which is intentionally gitignored.

Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_SUPABASE_URL = "https://flpmblfscgcbrprwwckz.supabase.co"
DEFAULT_SUPABASE_KEY = "sb_publishable_l2Gja5i6yw4CLv54fJqvWg_01YKpu4Y"
DEFAULT_AIVIS_URL = "http://127.0.0.1:10101"
DEFAULT_OUTPUT_DIR = "local-audio"


class CliError(RuntimeError):
    pass


def http_request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    json_body: Any | None = None,
    timeout: float = 60.0,
    expect_json: bool = True,
) -> Any:
    data = None
    req_headers = dict(headers or {})
    if json_body is not None:
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    elif method.upper() in {"POST", "PUT", "PATCH"}:
        data = b""

    request = Request(url, data=data, headers=req_headers, method=method.upper())
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise CliError(f"HTTP {error.code} for {url}\n{body}") from error
    except URLError as error:
        raise CliError(f"Could not connect to {url}: {error.reason}") from error

    if not expect_json:
        return raw
    if not raw:
        return None
    return json.loads(raw.decode("utf-8"))


def api_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if params:
        url += "?" + urlencode(params, doseq=True, safe="(),.*")
    return url


def get_supabase_token(url: str, key: str, access_token: str | None) -> str:
    if access_token:
        return access_token

    email = os.environ.get("INTERVIEW_EMAIL") or os.environ.get("SUPABASE_EMAIL")
    password = os.environ.get("INTERVIEW_PASSWORD") or os.environ.get("SUPABASE_PASSWORD")

    if not email:
        email = input("Supabase login email: ").strip()
    if not password:
        password = getpass.getpass("Supabase password: ")
    if not email or not password:
        raise CliError("Supabase email/password is required.")

    response = http_request(
        api_url(url, "/auth/v1/token", {"grant_type": "password"}),
        method="POST",
        headers={"apikey": key},
        json_body={"email": email, "password": password},
    )
    token = (response or {}).get("access_token")
    if not token:
        raise CliError("Supabase login succeeded without an access token.")
    return token


def supabase_get(
    url: str,
    key: str,
    token: str,
    table: str,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    result = http_request(
        api_url(url, f"/rest/v1/{table}", params),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    return result if isinstance(result, list) else []


def list_interview_sets(url: str, key: str, token: str) -> list[dict[str, Any]]:
    return supabase_get(
        url,
        key,
        token,
        "interview_sets",
        {
            "select": "id,slug,company,position,location,is_public,is_archived,sort_order",
            "is_archived": "eq.false",
            "order": "sort_order.asc,id.asc",
        },
    )


def load_interview_set(
    url: str,
    key: str,
    token: str,
    slug: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    sets = supabase_get(
        url,
        key,
        token,
        "interview_sets",
        {
            "select": "id,slug,company,position,location,is_public",
            "slug": f"eq.{slug}",
            "is_archived": "eq.false",
            "limit": "1",
        },
    )
    if not sets:
        raise CliError(f"Interview set not found or not visible: {slug}")
    interview_set = sets[0]

    questions = supabase_get(
        url,
        key,
        token,
        "interview_questions",
        {
            "select": "id,category,question,question_zh,sort_order",
            "set_id": f"eq.{interview_set['id']}",
            "is_active": "eq.true",
            "order": "sort_order.asc,id.asc",
        },
    )
    if not questions:
        raise CliError(f"No active questions found for: {slug}")

    ids = [int(row["id"]) for row in questions]
    answers_by_id: dict[int, str] = {}
    for chunk in chunks(ids, 100):
        joined = ",".join(str(value) for value in chunk)
        private_rows = supabase_get(
            url,
            key,
            token,
            "interview_private_content",
            {
                "select": "question_id,answer",
                "question_id": f"in.({joined})",
                "order": "question_id.asc",
            },
        )
        for row in private_rows:
            answers_by_id[int(row["question_id"])] = str(row.get("answer") or "")

    for row in questions:
        row["answer"] = answers_by_id.get(int(row["id"]), "")
    return interview_set, questions


def chunks(values: list[int], size: int) -> Iterable[list[int]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def get_speakers(engine_url: str) -> list[dict[str, Any]]:
    result = http_request(api_url(engine_url, "/speakers"), timeout=15.0)
    return result if isinstance(result, list) else []


def print_speakers(engine_url: str) -> None:
    speakers = get_speakers(engine_url)
    if not speakers:
        print("No AivisSpeech speakers/styles were returned.")
        return
    for speaker in speakers:
        speaker_name = speaker.get("name") or "(unnamed speaker)"
        print(f"{speaker_name}")
        styles = speaker.get("styles") or []
        for style in styles:
            print(f"  style-id={style.get('id')}  {style.get('name', '')}")


def synthesize(
    engine_url: str,
    style_id: int,
    text: str,
    *,
    speed_scale: float,
    pitch_scale: float,
    intonation_scale: float,
    volume_scale: float,
) -> bytes:
    query = http_request(
        api_url(engine_url, "/audio_query", {"text": text, "speaker": style_id}),
        method="POST",
        timeout=120.0,
    )
    if not isinstance(query, dict):
        raise CliError("AivisSpeech /audio_query returned an unexpected response.")

    query["speedScale"] = speed_scale
    query["pitchScale"] = pitch_scale
    query["intonationScale"] = intonation_scale
    query["volumeScale"] = volume_scale

    return http_request(
        api_url(engine_url, "/synthesis", {"speaker": style_id}),
        method="POST",
        json_body=query,
        timeout=300.0,
        expect_json=False,
    )


def clean_tts_text(text: str) -> str:
    return "\n".join(line.strip() for line in text.replace("\r\n", "\n").split("\n") if line.strip())


def target_texts(row: dict[str, Any], mode: str) -> list[tuple[str, str]]:
    question = clean_tts_text(str(row.get("question") or ""))
    answer = clean_tts_text(str(row.get("answer") or ""))
    qid = int(row["id"])

    if mode == "combined":
        text = f"質問。{question}。回答例。{answer}" if answer else f"質問。{question}"
        return [(f"q{qid}.wav", text)]
    if mode == "split":
        targets = [(f"q{qid}-question.wav", f"質問。{question}")]
        if answer:
            targets.append((f"q{qid}-answer.wav", f"回答例。{answer}"))
        return targets
    if mode == "question":
        return [(f"q{qid}-question.wav", f"質問。{question}")]
    if mode == "answer":
        if not answer:
            return []
        return [(f"q{qid}-answer.wav", f"回答例。{answer}")]
    raise CliError(f"Unsupported mode: {mode}")


def generation_hash(
    text: str,
    *,
    style_id: int,
    speed_scale: float,
    pitch_scale: float,
    intonation_scale: float,
    volume_scale: float,
) -> str:
    payload = {
        "text": text,
        "style_id": style_id,
        "speed_scale": speed_scale,
        "pitch_scale": pitch_scale,
        "intonation_scale": intonation_scale,
        "volume_scale": volume_scale,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"files": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"files": {}}
    except (OSError, json.JSONDecodeError):
        return {"files": {}}


def save_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def select_questions(rows: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    selected = rows
    if args.question_id:
        ids = set(args.question_id)
        selected = [row for row in selected if int(row["id"]) in ids]
    if args.sort_order:
        orders = set(args.sort_order)
        selected = [row for row in selected if int(row["sort_order"]) in orders]
    if args.limit is not None:
        selected = selected[: args.limit]
    return selected


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate local interview WAV files using AivisSpeech.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--engine-url", default=os.environ.get("AIVIS_ENGINE_URL", DEFAULT_AIVIS_URL))
    parser.add_argument("--list-voices", action="store_true", help="List AivisSpeech speakers/styles and exit.")
    parser.add_argument("--list-sets", action="store_true", help="List interview sets visible to the signed-in user and exit.")
    parser.add_argument("--set", dest="set_slug", help="Interview set slug to generate.")
    parser.add_argument("--style-id", type=int, help="AivisSpeech style ID. Use --list-voices to find it.")
    parser.add_argument("--mode", choices=["combined", "split", "question", "answer"], default="combined")
    parser.add_argument("--question-id", type=int, action="append", help="Generate only this DB question ID; may be repeated.")
    parser.add_argument("--sort-order", type=int, action="append", help="Generate only this question number within the set; may be repeated.")
    parser.add_argument("--limit", type=int, help="Generate only the first N selected questions.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--speed", type=float, default=0.95, help="AivisSpeech speedScale.")
    parser.add_argument("--pitch", type=float, default=0.0, help="AivisSpeech pitchScale.")
    parser.add_argument("--intonation", type=float, default=1.0, help="AivisSpeech intonationScale.")
    parser.add_argument("--volume", type=float, default=1.0, help="AivisSpeech volumeScale.")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate files even when their generation hash is unchanged.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be generated without calling synthesis.")
    parser.add_argument("--pause", type=float, default=0.1, help="Seconds to wait between synthesis requests.")
    parser.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL", DEFAULT_SUPABASE_URL))
    parser.add_argument("--supabase-key", default=os.environ.get("SUPABASE_PUBLISHABLE_KEY", DEFAULT_SUPABASE_KEY))
    parser.add_argument("--access-token", default=os.environ.get("SUPABASE_ACCESS_TOKEN"), help=argparse.SUPPRESS)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.list_voices:
        print_speakers(args.engine_url)
        return 0

    token = get_supabase_token(args.supabase_url, args.supabase_key, args.access_token)

    if args.list_sets:
        sets = list_interview_sets(args.supabase_url, args.supabase_key, token)
        for row in sets:
            lock = "public" if row.get("is_public") else "private"
            print(f"{row.get('slug')}  [{lock}]  {row.get('company')} | {row.get('position')}")
        return 0

    if not args.set_slug:
        parser.error("--set is required unless --list-voices or --list-sets is used.")
    if args.style_id is None:
        parser.error("--style-id is required for audio generation. Use --list-voices first.")

    # Fail early with a useful error when AivisSpeech is not running or the style is invalid.
    speakers = get_speakers(args.engine_url)
    valid_style_ids = {
        int(style["id"])
        for speaker in speakers
        for style in (speaker.get("styles") or [])
        if style.get("id") is not None
    }
    if valid_style_ids and args.style_id not in valid_style_ids:
        raise CliError(f"style-id {args.style_id} was not found. Run with --list-voices.")

    interview_set, all_questions = load_interview_set(
        args.supabase_url,
        args.supabase_key,
        token,
        args.set_slug,
    )
    questions = select_questions(all_questions, args)
    if not questions:
        raise CliError("No questions matched the requested filters.")

    set_dir = Path(args.output_dir).expanduser().resolve() / args.set_slug
    set_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = set_dir / "manifest.json"
    manifest = load_manifest(manifest_path)
    manifest.setdefault("files", {})
    manifest.update(
        {
            "set": {
                "id": interview_set.get("id"),
                "slug": interview_set.get("slug"),
                "company": interview_set.get("company"),
                "position": interview_set.get("position"),
            },
            "engine_url": args.engine_url,
            "style_id": args.style_id,
            "mode": args.mode,
            "speed_scale": args.speed,
            "pitch_scale": args.pitch,
            "intonation_scale": args.intonation,
            "volume_scale": args.volume,
        }
    )

    total_targets = sum(len(target_texts(row, args.mode)) for row in questions)
    print(f"Set: {interview_set.get('company')} | {interview_set.get('position')}")
    print(f"Questions: {len(questions)} / Audio targets: {total_targets}")
    print(f"Output: {set_dir}")

    generated = 0
    skipped = 0
    for row in questions:
        for filename, text in target_texts(row, args.mode):
            output_path = set_dir / filename
            digest = generation_hash(
                text,
                style_id=args.style_id,
                speed_scale=args.speed,
                pitch_scale=args.pitch,
                intonation_scale=args.intonation,
                volume_scale=args.volume,
            )
            previous = manifest["files"].get(filename) or {}
            unchanged = output_path.exists() and previous.get("generation_hash") == digest

            if unchanged and not args.overwrite:
                print(f"SKIP  {filename}")
                skipped += 1
                continue

            print(f"GEN   {filename}  Q{row['sort_order']}  {row['question']}")
            if not args.dry_run:
                audio = synthesize(
                    args.engine_url,
                    args.style_id,
                    text,
                    speed_scale=args.speed,
                    pitch_scale=args.pitch,
                    intonation_scale=args.intonation,
                    volume_scale=args.volume,
                )
                output_path.write_bytes(audio)
                manifest["files"][filename] = {
                    "question_id": int(row["id"]),
                    "sort_order": int(row["sort_order"]),
                    "generation_hash": digest,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
                save_manifest(manifest_path, manifest)
                generated += 1
                if args.pause > 0:
                    time.sleep(args.pause)

    if args.dry_run:
        print("Dry run complete; no files were written.")
    else:
        print(f"Done. Generated: {generated}, skipped unchanged: {skipped}")
        print(f"Manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        raise SystemExit(130)
    except CliError as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
