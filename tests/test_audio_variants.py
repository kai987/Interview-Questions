import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import _generate_aivis_audio_core as core
import _generate_aivis_audio_launcher as launcher


class AudioVariantTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.set_dir = self.root / "test-set"
        self.set_dir.mkdir()
        self.manifest = self.set_dir / "manifest.json"
        self.row = {"id": 1, "sort_order": 1, "question": "Question", "answer": "Full answer",
                    "answer_variants": {"short": "Short answer", "standard": "Full answer"}}
        self.args = argparse.Namespace(set_slug="test-set", output_dir=str(self.root), mode="combined",
                                       answer_variant="all", question_id=None, sort_order=None, limit=None,
                                       supabase_url="https://example.test", supabase_key="test-key")

    def audio_file(self, variant, legacy=False):
        digest = core.source_hash(self.row, variant)
        filename = "q1.mp3" if legacy else f"q1-{digest}.mp3"
        data = f"synthetic audio {digest}".encode()
        (self.set_dir / filename).write_bytes(data)
        manifest = core.load_manifest(self.manifest)
        manifest["files"][filename] = {"question_id": 1, "sort_order": 1, "source_hash": digest,
                                       "audio_sha256": hashlib.sha256(data).hexdigest(), "duration_seconds": 999}
        core.save_manifest(self.manifest, manifest)
        return filename

    def upload(self, rows=None, latest=None):
        rows = rows or [self.row]
        with patch.object(launcher, "jwt_subject", return_value="test-user"), patch.object(
            core, "load_interview_set", side_effect=[({}, rows), ({}, latest if latest is not None else rows)]
        ) as read, patch.object(launcher, "upload_mp3") as upload, patch.object(
            core, "http_request", return_value=[{"question_id": 1}]
        ) as request, patch.object(core, "audio_duration_seconds", return_value=1.25):
            count = launcher.upload_local_audio(self.args, access_token="test-token", bucket=launcher.DEFAULT_STORAGE_BUCKET)
        return count, upload, request, read

    def test_exact_effective_text_and_fallback_variants_deduplicate(self):
        targets = core.audio_targets(self.row, "combined", "all")
        self.assertEqual(len(targets), 2)
        self.assertEqual(targets[0]["answer_variants"], ["full", "standard"])
        self.assertEqual(targets[1]["answer_variants"], ["short"])
        self.assertEqual(targets[1]["source_hash"], hashlib.sha256(b"Question\nShort answer").hexdigest())
        self.row["answer_variants"]["full"] = "Full override"
        self.assertEqual(core.effective_answer(self.row, "full"), "Full override")
        self.row["answer_variants"]["short"] = ""
        self.assertEqual(core.effective_answer(self.row, "short"), "Full answer")

    def test_combined_defaults_all_but_other_modes_keep_full(self):
        parser = core.build_parser()
        self.assertEqual(core.selected_answer_variant(parser.parse_args([])), "all")
        self.assertEqual(core.selected_answer_variant(parser.parse_args(["--mode", "split"])), "full")
        with self.assertRaises(core.CliError):
            core.selected_answer_variant(parser.parse_args(["--mode", "split", "--answer-variant", "all"]))

    def test_upload_deduplicates_and_registers_every_matching_variant(self):
        self.audio_file("full")
        self.audio_file("short")
        count, uploaded, request, read = self.upload()
        self.assertEqual(count, 2)
        self.assertEqual(uploaded.call_count, 2)
        self.assertEqual(read.call_count, 2)
        body = request.call_args.kwargs["json_body"]
        self.assertEqual(set(body["audio_variants"]), {"full", "short", "standard"})
        self.assertEqual(body["audio_variants"]["full"], body["audio_variants"]["standard"])
        self.assertEqual(body["audio_text_hash"], core.source_hash(self.row))
        self.assertEqual(body["duration_seconds"], 1.25)
        self.assertEqual(body["audio_variants"]["short"]["duration_seconds"], 1.25)

    def test_upload_uses_legacy_verified_bytes_with_versioned_remote_name(self):
        self.audio_file("full", legacy=True)
        self.args.answer_variant = "full"
        count, upload, _, _ = self.upload()
        self.assertEqual(count, 1)
        self.assertEqual(upload.call_args.kwargs["object_path"], f"test-user/test-set/q1-{core.source_hash(self.row)}.mp3")

    def test_upload_does_not_rewrite_a_manifest_with_already_measured_durations(self):
        filename = self.audio_file("full")
        self.args.answer_variant = "full"
        manifest = core.load_manifest(self.manifest)
        manifest["files"][filename]["duration_seconds"] = 1.25
        core.save_manifest(self.manifest, manifest)
        with patch.object(core, "save_manifest") as save:
            self.upload()
        save.assert_not_called()

    def test_short_upload_preserves_latest_nonuploaded_metadata_and_full_fields(self):
        self.audio_file("short")
        self.args.answer_variant = "short"
        latest = {**self.row, "audio_variants": {"full": {"audio_text_hash": "existing"}, "standard": {"duration_seconds": 45}}}
        _, _, request, _ = self.upload(latest=[latest])
        body = request.call_args.kwargs["json_body"]
        self.assertEqual(body["audio_variants"]["full"], latest["audio_variants"]["full"])
        self.assertEqual(body["audio_variants"]["standard"], latest["audio_variants"]["standard"])
        self.assertNotIn("audio_text_hash", body)
        self.assertNotIn("duration_seconds", body)

    def test_changed_live_answer_is_rejected_before_upload(self):
        self.audio_file("short")
        self.args.answer_variant = "short"
        self.row["answer_variants"]["short"] = "Updated answer"
        with patch.object(launcher, "jwt_subject", return_value="test-user"), patch.object(
            core, "load_interview_set", return_value=({}, [self.row])
        ), patch.object(launcher, "upload_mp3") as upload, self.assertRaises(core.CliError):
            launcher.upload_local_audio(self.args, access_token="test-token", bucket=launcher.DEFAULT_STORAGE_BUCKET)
        upload.assert_not_called()

    def test_selected_alias_updates_every_reference_to_the_same_audio_object(self):
        self.audio_file("standard")
        self.args.answer_variant = "standard"
        self.row["audio_variants"] = {"full": {"audio_sha256": "old-voice-bytes"}, "short": {"audio_sha256": "unrelated-short"}}
        count, _, request, _ = self.upload()
        body = request.call_args.kwargs["json_body"]
        self.assertEqual(count, 1)
        self.assertEqual(body["audio_variants"]["full"], body["audio_variants"]["standard"])
        self.assertNotEqual(body["audio_variants"]["full"]["audio_sha256"], "old-voice-bytes")
        self.assertEqual(body["audio_variants"]["short"], {"audio_sha256": "unrelated-short"})
        self.assertEqual(body["audio_text_hash"], core.source_hash(self.row))

    def test_zero_row_registration_is_not_reported_as_success(self):
        self.audio_file("full")
        self.args.answer_variant = "full"
        with patch.object(launcher, "jwt_subject", return_value="test-user"), patch.object(
            core, "load_interview_set", return_value=({}, [self.row])
        ), patch.object(launcher, "upload_mp3"), patch.object(core, "audio_duration_seconds", return_value=1.25), patch.object(
            core, "http_request", return_value=[]
        ), self.assertRaisesRegex(core.CliError, "not confirmed"):
            launcher.upload_local_audio(self.args, access_token="test-token", bucket=launcher.DEFAULT_STORAGE_BUCKET)

    def test_changed_audio_bytes_are_rejected(self):
        filename = self.audio_file("full")
        (self.set_dir / filename).write_bytes(b"changed bytes")
        self.args.answer_variant = "full"
        with self.assertRaisesRegex(core.CliError, "bytes do not match"):
            self.upload()

    def test_text_changed_during_upload_does_not_register_stale_metadata(self):
        self.audio_file("full")
        self.args.answer_variant = "full"
        latest = {**self.row, "answer": "Changed while uploading"}
        with patch.object(launcher, "jwt_subject", return_value="test-user"), patch.object(
            core, "load_interview_set", side_effect=[({}, [self.row]), ({}, [latest])]
        ), patch.object(launcher, "upload_mp3"), patch.object(core, "audio_duration_seconds", return_value=1.25), patch.object(
            core, "http_request"
        ) as request, self.assertRaisesRegex(core.CliError, "changed during upload"):
            launcher.upload_local_audio(self.args, access_token="test-token", bucket=launcher.DEFAULT_STORAGE_BUCKET)
        request.assert_not_called()

    def write_export(self):
        path = self.root / "input.json"
        path.write_text(json.dumps({"interview_set": {"id": 1, "slug": "test-set"}, "rows": [self.row]}))
        return path

    def wav(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(b"\0\0" * 12000)
        return output.getvalue()

    def generate(self, extra=()):
        argv = ["generate", "--input-json", str(self.write_export()), "--set", "test-set", "--style-id", "7",
                "--output-dir", str(self.root), "--pause", "0", *extra]
        with patch.object(sys, "argv", argv), patch.object(core, "get_supabase_token", side_effect=AssertionError("Unexpected authentication")), patch.object(
            core, "load_interview_set", side_effect=AssertionError("Unexpected live data request")
        ), patch.object(core, "get_speakers", return_value=[]), patch.object(core, "synthesize", return_value=self.wav()) as synthesize:
            self.assertEqual(core.main(), 0)
        return synthesize

    def test_offline_export_generates_each_distinct_text_without_authentication(self):
        synthesized = self.generate()
        self.assertEqual(synthesized.call_count, 2)
        files = core.load_manifest(self.manifest)["files"]
        self.assertEqual(len(files), 2)
        self.assertEqual(files[f"q1-{core.source_hash(self.row)}.wav"]["answer_variants"], ["full", "standard"])
        self.assertTrue(all(metadata["duration_seconds"] == 0.5 for metadata in files.values()))

    def test_verified_legacy_generation_reuses_bytes_without_synthesis(self):
        self.row["answer_variants"] = {}
        data = self.wav()
        (self.set_dir / "q1.wav").write_bytes(data)
        text = core.target_texts(self.row, "combined")[0][1]
        core.save_manifest(self.manifest, {"files": {"q1.wav": {
            "question_id": 1, "sort_order": 1, "source_hash": core.source_hash(self.row),
            "audio_sha256": hashlib.sha256(data).hexdigest(),
            "generation_hash": core.generation_hash(text, style_id=7, speed_scale=0.95, pitch_scale=0.0, intonation_scale=1.0, volume_scale=1.0),
        }}})
        synthesized = self.generate()
        synthesized.assert_not_called()
        self.assertEqual((self.set_dir / f"q1-{core.source_hash(self.row)}.wav").read_bytes(), data)

    def test_generation_replaces_tampered_audio_instead_of_blessing_its_hash(self):
        self.generate()
        filename = f"q1-{core.source_hash(self.row)}.wav"
        (self.set_dir / filename).write_bytes(b"tampered")
        self.assertEqual(self.generate().call_count, 1)

    def test_exports_cannot_cross_sets_or_be_used_for_upload(self):
        path = self.write_export()
        with self.assertRaisesRegex(core.CliError, "does not match"):
            core.load_input_json(str(path), "another-set")
        self.args.input_json = str(path)
        with self.assertRaisesRegex(core.CliError, "authenticated live data"):
            launcher.upload_local_audio(self.args, access_token="unused", bucket=launcher.DEFAULT_STORAGE_BUCKET)
        with self.assertRaises(core.CliError):
            core.validate_set_slug("../outside")


if __name__ == "__main__":
    unittest.main()
