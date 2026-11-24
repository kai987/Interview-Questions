#!/usr/bin/env python3
"""Offline Rust/Python contract comparison; only synthetic recordings and text."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import _generate_aivis_audio_core as core

BINARY = None
SLUG = "synthetic-set"
ROWS = [
    {"id": 1, "set_id": 1, "question": "ＡＩ\r\n質問 😀", "answer": " 回答\nです。 ",
     "answer_variants": {"short": "短い回答", "standard": " 回答\nです。 "}},
    {"id": 2, "set_id": 1, "question": "二番目の質問", "answer": "回答二",
     "answer_variants": {"short": ""}},
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def wav(path, frames=12001, rate=24000, channels=1, width=2):
    with wave.open(str(path), "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(width)
        out.setframerate(rate)
        out.writeframes(b"\0" * frames * channels * width)


class AudioAuditParity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.set_dir = self.root / SLUG
        self.set_dir.mkdir()
        self.manifest = self.set_dir / "manifest.json"
        self.export = self.root / "export.json"
        self.export.write_text(json.dumps({
            "interview_set": {"id": 1, "slug": SLUG}, "rows": ROWS,
        }, ensure_ascii=False), encoding="utf-8")
        self.files = {}
        self.wav = self.root / "fixture.wav"
        wav(self.wav)
        self.mp3 = self.root / "fixture.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(self.wav),
                        "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "96k", str(self.mp3)],
                       check=True, timeout=30)
        self.targets = [target for row in ROWS for target in core.audio_targets(row, "combined", "all")]

    def add(self, target, *, filename=None, sample=None, **patch):
        name = filename or Path(target["filename"]).with_suffix(".mp3").name
        dest = self.set_dir / name
        shutil.copyfile(sample or self.mp3, dest)
        qid = int(name.split(".")[0].split("-")[0][1:])
        self.files[name] = {
            "question_id": qid, "source_hash": target["source_hash"],
            "audio_sha256": sha(dest.read_bytes()), "duration_seconds": core.audio_duration_seconds(dest),
            "generation_hash": "b" * 64, "answer_variants": target["answer_variants"],
            **patch,
        }
        return dest

    def save(self):
        self.manifest.write_text(json.dumps({"files": self.files}, ensure_ascii=False), encoding="utf-8")

    def snapshot(self):
        return {str(p.relative_to(self.root)): sha(p.read_bytes()) for p in self.root.rglob("*") if p.is_file()}

    def run_audit(self, *args, code=0, unchanged=True):
        before = self.snapshot() if unchanged else None
        result = subprocess.run([str(BINARY), "--root", str(self.root), *args],
                                text=True, capture_output=True, timeout=90)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        if unchanged:
            self.assertEqual(self.snapshot(), before, "auditor changed or created a file")
        return json.loads(result.stdout)

    def healthy(self):
        self.add(self.targets[0])
        self.add(self.targets[1], filename="q1.mp3")
        self.add(self.targets[2])
        self.add(self.targets[0], filename="q1-question.wav", sample=self.wav)
        self.save()

    def assert_measurements(self, report):
        for recording in report["recordings"]:
            path = self.set_dir / recording["filename"]
            self.assertEqual(recording["audio_sha256"], sha(path.read_bytes()))
            self.assertEqual(recording["bytes"], path.stat().st_size)
            self.assertAlmostEqual(recording["duration_seconds"], core.audio_duration_seconds(path), places=6)
            self.assertEqual(recording["source_hash"], self.files[path.name]["source_hash"])
            self.assertTrue(recording["valid"], recording)

    def test_valid_bytes_duration_aliases_legacy_and_parallel_determinism(self):
        self.healthy()
        args = ("--set", SLUG, "--input-json", str(self.export), "--require-complete")
        report = self.run_audit(*args, "--jobs", "1")
        self.assertEqual(report, self.run_audit(*args, "--jobs", "4"))
        self.assertEqual((report["sets"], report["verified"], report["failed"]), (1, 4, 0))
        self.assert_measurements(report)
        self.assertEqual(report["verified_bytes"], sum((self.set_dir / f).stat().st_size for f in self.files))
        self.assertEqual(len(report["duplicate_byte_groups"]), 1)
        self.assertEqual(len(report["duplicate_byte_groups"][0]["files"]), 3)
        plan = report["coverage"]
        self.assertTrue(plan["complete"])
        self.assertEqual(plan["ready"], len(self.targets))
        for target, expected in zip(plan["targets"], self.targets, strict=True):
            self.assertEqual(target["source_hash"], expected["source_hash"])
            self.assertEqual(target["answer_variants"], expected["answer_variants"])
            self.assertEqual(target["filename"], Path(expected["filename"]).with_suffix(".mp3").name)
        self.assertEqual(plan["targets"][1]["matched_file"], "q1.mp3")
        self.assertNotIn(ROWS[0]["question"], json.dumps(report, ensure_ascii=False))
        self.assertNotIn(ROWS[0]["answer"], json.dumps(report, ensure_ascii=False))

    def test_missing_stale_and_damaged_targets_are_not_ready(self):
        self.add(self.targets[0])
        self.add(self.targets[1], filename="q1.mp3", source_hash="c" * 64)
        self.save()
        args = ("--set", SLUG, "--input-json", str(self.export))
        report = self.run_audit(*args)
        self.assertTrue(report["valid"], "old intact cache may remain")
        self.assertEqual([t["status"] for t in report["coverage"]["targets"]], ["ready", "missing", "missing"])
        self.assertFalse(report["coverage"]["complete"])
        self.run_audit(*args, "--require-complete", code=1)
        dest = self.set_dir / Path(self.targets[0]["filename"]).with_suffix(".mp3").name
        dest.write_bytes(dest.read_bytes() + b"tampered")
        report = self.run_audit(*args, code=1)
        self.assertIn("audio_hash_mismatch", next(r for r in report["recordings"] if r["filename"] == dest.name)["issues"])
        self.assertEqual(report["coverage"]["targets"][0]["status"], "needs_review")

    def test_wav_measurements_use_sample_frames_and_reject_empty_or_truncated(self):
        for qid, (rate, width, channels) in enumerate([(8000, 1, 1), (24000, 2, 1), (44100, 3, 2), (48000, 4, 2)], 10):
            sample = self.root / f"fixture-{qid}.wav"
            wav(sample, frames=12003, rate=rate, channels=channels, width=width)
            self.add(self.targets[0], filename=f"q{qid}.wav", sample=sample)
        self.save()
        self.assert_measurements(self.run_audit())
        dest = self.set_dir / "q10.wav"
        dest.write_bytes(dest.read_bytes()[:-4])
        self.files[dest.name]["audio_sha256"] = sha(dest.read_bytes())
        self.save()
        report = self.run_audit(code=1)
        self.assertIn("duration_unreadable", next(r for r in report["recordings"] if r["filename"] == dest.name)["issues"])
        # Valid container with no audio samples must fail, even with matching bytes.
        wav(dest, frames=0)
        self.files[dest.name]["audio_sha256"] = sha(dest.read_bytes())
        self.save()
        report = self.run_audit(code=1)
        self.assertIn("duration_unreadable", next(r for r in report["recordings"] if r["filename"] == dest.name)["issues"])

    def test_manifest_diagnostics_and_legacy_warnings(self):
        p = self.add(self.targets[0], filename="q1.mp3", duration_seconds=999,
                     generation_hash="not-a-hash", answer_variants=["full", "full"])
        q = self.add(self.targets[2])
        q.unlink()
        self.files["../outside.wav"] = self.files[p.name]
        self.save()
        report = self.run_audit(code=1)
        issues = {issue for row in report["recordings"] for issue in row["issues"]}
        self.assertTrue({"invalid_filename", "duration_mismatch", "invalid_generation_hash",
                         "invalid_answer_variants", "missing_or_unsafe_file"} <= issues, issues)
        self.files.clear()
        self.add(self.targets[0], filename="q1.mp3")
        self.files["q1.mp3"].pop("generation_hash")
        self.files["q1.mp3"].pop("answer_variants")
        self.save()
        report = self.run_audit()
        self.assertEqual(set(report["recordings"][0]["warnings"]),
                         {"legacy_generation_hash_missing", "legacy_answer_variants_missing"})

    def test_duplicate_identity_bad_export_and_symlink_fail_closed(self):
        self.manifest.write_text('{"files":{"q1.mp3":{},"q1.mp3":{}}}', encoding="utf-8")
        self.assertIn("error", self.run_audit(code=1))
        self.add(self.targets[0], filename="q1.mp3")
        self.save()
        bad = json.loads(self.export.read_text(encoding="utf-8"))
        bad["rows"].append(bad["rows"][0])
        self.export.write_text(json.dumps(bad), encoding="utf-8")
        self.assertIn("error", self.run_audit("--set", SLUG, "--input-json", str(self.export), code=1))
        path = self.set_dir / "q1.mp3"
        path.unlink()
        path.symlink_to(self.mp3)
        report = self.run_audit(code=1)
        self.assertIn("missing_or_unsafe_file", report["recordings"][0]["issues"])
        self.assertIsNone(report["recordings"][0]["audio_sha256"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    args = parser.parse_args()
    BINARY = args.binary.resolve()
    if not BINARY.is_file():
        parser.error("compiled Rust auditor not found")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        parser.error("FFmpeg and ffprobe are required; parity must not silently skip MP3 tests")
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AudioAuditParity)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
