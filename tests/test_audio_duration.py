import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import _generate_aivis_audio_core as core
import _generate_aivis_audio_launcher as launcher


class AudioDurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_wav(self, frames=12000):
        path = self.root / "sample.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\0\0" * frames)
        return path

    def test_wav_duration_uses_frames_without_ffprobe(self):
        with patch.object(core.shutil, "which", return_value=None):
            self.assertEqual(core.audio_duration_seconds(self.make_wav()), 0.5)

    def test_empty_wav_is_rejected(self):
        with self.assertRaises(core.CliError):
            core.audio_duration_seconds(self.make_wav(0))

    def test_invalid_probe_duration_is_rejected(self):
        for value in ["NaN", "inf", "0", "-1", "N/A"]:
            with self.subTest(value=value), patch.object(core.shutil, "which", return_value="ffprobe"), patch.object(
                core.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, value, "")
            ), self.assertRaises(core.CliError):
                core.audio_duration_seconds(self.root / "invalid.mp3")

    def test_upload_registers_measured_mp3_duration_with_its_hash(self):
        ffmpeg = core.shutil.which("ffmpeg")
        if not ffmpeg or not core.shutil.which("ffprobe"):
            self.skipTest("FFmpeg and ffprobe required for MP3 integration test")
        set_dir = self.root / "test-set"
        set_dir.mkdir()
        mp3 = set_dir / "q1.mp3"
        subprocess.run([ffmpeg, "-v", "error", "-i", str(self.make_wav()), str(mp3)], check=True)
        row = {"id": 1, "question": "Question", "answer": "Answer"}
        digest = hashlib.sha256(b"Question\nAnswer").hexdigest()
        metadata = {"question_id": 1, "sort_order": 1, "source_hash": digest,
                    "audio_sha256": hashlib.sha256(mp3.read_bytes()).hexdigest(), "duration_seconds": 999}
        manifest = set_dir / "manifest.json"
        manifest.write_text(json.dumps({"files": {"q1.mp3": metadata}}))
        args = argparse.Namespace(set_slug="test-set", output_dir=str(self.root), mode="combined",
                                  question_id=None, sort_order=None, limit=None,
                                  supabase_url="https://example.test", supabase_key="test-key")
        with patch.object(launcher, "jwt_subject", return_value="test-user"), patch.object(
            core, "load_interview_set", return_value=({}, [row])
        ), patch.object(launcher, "upload_mp3") as upload, patch.object(core, "http_request") as request:
            self.assertEqual(launcher.upload_local_audio(args, access_token="test-token", bucket=launcher.DEFAULT_STORAGE_BUCKET), 1)
        measured = core.audio_duration_seconds(mp3)
        self.assertGreaterEqual(measured, 0.5)
        self.assertLess(measured, 1)
        upload.assert_called_once()
        self.assertEqual(request.call_args.kwargs["json_body"], {"audio_text_hash": digest, "duration_seconds": measured})
        self.assertEqual(json.loads(manifest.read_text())["files"]["q1.mp3"]["duration_seconds"], measured)


if __name__ == "__main__":
    unittest.main()
