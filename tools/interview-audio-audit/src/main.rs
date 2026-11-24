use anyhow::{Context, Result, bail, ensure};
use clap::{Parser, ValueEnum};
use serde::{Deserialize, Serialize, de::{self, MapAccess, Visitor}};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt, fs::{self, File}, io::{self, Read, Seek, SeekFrom},
    marker::PhantomData,
    path::{Path, PathBuf}, process::{Command, ExitCode, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    thread, time::{Duration, Instant},
};

const VARIANTS: [&str; 3] = ["full", "short", "standard"];

#[derive(Clone, Copy, Debug, ValueEnum)]
enum AudioFormat { Mp3, Wav }
impl AudioFormat {
    fn extension(self) -> &'static str {
        match self { Self::Mp3 => "mp3", Self::Wav => "wav" }
    }
}
#[derive(Parser)]
#[command(about = "Read-only offline interview recording audit and optional source coverage plan")]
struct Args {
    /// Directory containing set-slug/manifest.json (never modified)
    #[arg(long, default_value = "local-audio")]
    root: PathBuf,
    /// Restrict to one set; required with --input-json
    #[arg(long)]
    set: Option<String>,
    /// Explicit local export; no network or login, no question text in the report
    #[arg(long, requires = "set")]
    input_json: Option<PathBuf>,
    /// Format of combined recordings in the optional coverage plan
    #[arg(long, value_enum, default_value = "mp3")]
    format: AudioFormat,
    /// Bounded file/probe concurrency (local default is two)
    #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u8).range(1..=8))]
    jobs: u8,
    /// Treat incomplete export coverage as a failing check
    #[arg(long, requires = "input_json")]
    require_complete: bool,
}

type Map<T> = BTreeMap<String, T>;

// Duplicate manifest identities must not silently overwrite each other.
fn unique_map<'de, D, T>(d: D) -> Result<Map<T>, D::Error>
where D: serde::Deserializer<'de>, T: Deserialize<'de> {
    struct Unique<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for Unique<T> {
        type Value = Map<T>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("an object with unique keys")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, T>()? {
                if result.insert(key, value).is_some() {
                    return Err(de::Error::custom("duplicate manifest file key"));
                }
            }
            Ok(result)
        }
    }
    d.deserialize_map(Unique(PhantomData))
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(deserialize_with = "unique_map")]
    files: Map<Value>,
}
#[derive(Clone, Deserialize)]
struct Metadata {
    question_id: u64,
    source_hash: String,
    audio_sha256: String,
    #[serde(default)]
    duration_seconds: Option<f64>,
    #[serde(default)]
    generation_hash: Option<String>,
    #[serde(default)]
    answer_variants: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Export {
    interview_set: ExportSet,
    rows: Vec<ExportRow>,
}
#[derive(Deserialize)]
struct ExportSet {
    slug: String,
    #[serde(default)]
    id: Value,
}
#[derive(Deserialize)]
struct ExportRow {
    id: u64,
    question: String,
    #[serde(default)]
    answer: String,
    #[serde(default)]
    set_id: Value,
    #[serde(default)]
    answer_variants: Option<Map<Value>>,
}
struct Work {
    set: String,
    dir: PathBuf,
    filename: String,
    value: Value,
}
#[derive(Debug, Serialize)]
struct Recording {
    set: String,
    filename: String,
    question_id: Option<u64>,
    source_hash: Option<String>,
    audio_sha256: Option<String>,
    duration_seconds: Option<f64>,
    bytes: Option<u64>,
    valid: bool,
    issues: Vec<&'static str>,
    warnings: Vec<&'static str>,
}
#[derive(Debug, Serialize)]
struct Target {
    question_id: u64,
    source_hash: String,
    answer_variants: Vec<String>,
    filename: String,
    status: &'static str,
    matched_file: Option<String>,
}
#[derive(Serialize)]
struct Coverage {
    set: String,
    targets: Vec<Target>,
    ready: usize,
    missing: usize,
    needs_review: usize,
    complete: bool,
}
#[derive(Serialize)]
struct Duplicate {
    audio_sha256: String,
    files: Vec<String>,
}
#[derive(Serialize)]
struct Report {
    valid: bool,
    sets: usize,
    recordings: Vec<Recording>,
    verified: usize,
    failed: usize,
    verified_bytes: u64,
    duplicate_byte_groups: Vec<Duplicate>,
    coverage: Option<Coverage>,
}

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
fn hex_digest(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn hash_text(row: &ExportRow, variant: &str) -> String {
    let answer = row.answer_variants.as_ref().and_then(|v| v.get(variant))
        .and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(&row.answer);
    let mut hash = Sha256::new();
    hash.update(row.question.as_bytes());
    hash.update(b"\n");
    hash.update(answer.as_bytes());
    format!("{:x}", hash.finalize())
}
fn hash_file(file: &mut File) -> io::Result<String> {
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

// Only known generated filenames are accepted. No path traversal, URL, or
// arbitrary file name from a manifest is ever handed to the audio reader.
fn name_parts(name: &str) -> Option<(u64, Option<&str>, &str)> {
    let (stem, extension) = name.rsplit_once('.')?;
    if !matches!(extension, "mp3" | "wav") { return None; }
    let rest = stem.strip_prefix('q')?;
    let (id, suffix) = rest.split_once('-').map_or((rest, None), |(a, b)| (a, Some(b)));
    let number = id.parse::<u64>().ok()?;
    if number == 0 || number.to_string() != id { return None; }
    match suffix {
        None | Some("question" | "answer") => Some((number, None, extension)),
        Some(value) if hex_digest(value) => Some((number, Some(value), extension)),
        _ => None,
    }
}
fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_file()).unwrap_or(false)
}
fn directory(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_dir()).unwrap_or(false)
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    ensure!(regular(path), "input is missing or is not a regular file");
    // Do not echo parser input or potentially private question text.
    let file = File::open(path).context("cannot open input file")?;
    serde_json::from_reader(io::BufReader::new(file))
        .map_err(|_| anyhow::anyhow!("invalid JSON, duplicate identity, or unsupported input schema"))
}
fn le16(bytes: &[u8]) -> u16 { u16::from_le_bytes(bytes.try_into().unwrap()) }
fn le32(bytes: &[u8]) -> u32 { u32::from_le_bytes(bytes.try_into().unwrap()) }

/// WAV files generated by AivisSpeech are little-endian PCM RIFF files.
/// Measure sample frames like Python wave; reject truncated/unsupported data
/// rather than using estimates. No external process is started for WAV.
fn wav_duration(file: &mut File) -> Result<f64> {
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(0))?;
    let mut header = [0; 12];
    file.read_exact(&mut header)?;
    ensure!(&header[..4] == b"RIFF" && &header[8..] == b"WAVE", "not a RIFF WAV");
    let end = u64::from(le32(&header[4..8])) + 8;
    ensure!(end >= 12 && end <= length, "truncated WAV");
    let mut format = None;
    while file.stream_position()? + 8 <= end {
        let mut chunk = [0; 8];
        file.read_exact(&mut chunk)?;
        let size = u64::from(le32(&chunk[4..]));
        let start = file.stream_position()?;
        ensure!(start + size <= end, "truncated WAV chunk");
        if &chunk[..4] == b"fmt " {
            ensure!(size >= 16, "invalid WAV format");
            let mut fmt = [0u8; 40];
            let read_size = size.min(40) as usize;
            file.read_exact(&mut fmt[..read_size])?;
            let code = le16(&fmt[..2]);
            // WAVE_FORMAT_EXTENSIBLE with the PCM subtype is also accepted by
            // Python 3.12+ wave. Other encodings are not assumed to be PCM.
            let pcm_guid = [1,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113];
            ensure!(code == 1 || (code == 0xfffe && size >= 40 && le16(&fmt[16..18]) >= 22
                && fmt[24..40] == pcm_guid), "unsupported WAV encoding");
            let channels = u64::from(le16(&fmt[2..4]));
            let rate = u64::from(le32(&fmt[4..8]));
            let bits = u64::from(le16(&fmt[14..16]));
            let frame_size = channels * bits.div_ceil(8);
            ensure!(channels > 0 && rate > 0 && bits > 0 && frame_size == u64::from(le16(&fmt[12..14])), "invalid WAV frame layout");
            format = Some((frame_size, rate));
        } else if &chunk[..4] == b"data" {
            let (frame_size, rate) = format.context("WAV data before format")?;
            ensure!(size > 0 && size % frame_size == 0, "invalid or empty WAV data");
            return Ok((size / frame_size) as f64 / rate as f64);
        }
        file.seek(SeekFrom::Start(start + size + size % 2))?;
    }
    bail!("WAV data chunk missing")
}

/// Match the production Python ffprobe format-duration contract for MP3,
/// retaining encoder padding. Force the MP3 demuxer and local-file protocol;
/// the auditor never treats a manifest entry as a network URL.
fn mp3_duration(path: &Path) -> Result<f64> {
    let mut child = Command::new("ffprobe").args([
        "-v", "error", "-f", "mp3", "-protocol_whitelist", "file",
        "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
    ]).arg(path).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().context("ffprobe is required for MP3")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output()?;
                ensure!(status.success(), "ffprobe rejected MP3");
                return Ok(std::str::from_utf8(&output.stdout)?.trim().parse()?);
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                bail!("ffprobe failed or exceeded 30 seconds")
            }
        }
    }
}
fn rounded_duration(value: f64) -> Result<f64> {
    ensure!(value.is_finite() && value > 0.0, "invalid duration");
    let rounded: f64 = format!("{value:.6}").parse()?;
    ensure!(rounded > 0.0, "duration rounded to zero");
    Ok(rounded)
}

fn inspect(work: &Work) -> Recording {
    let mut out = Recording {
        set: work.set.clone(), filename: work.filename.clone(), question_id: None,
        source_hash: None, audio_sha256: None, duration_seconds: None, bytes: None,
        valid: false, issues: vec![], warnings: vec![],
    };
    let Some((qid, name_hash, extension)) = name_parts(&work.filename) else {
        out.issues.push("invalid_filename");
        return out;
    };
    out.question_id = Some(qid);
    let Ok(meta) = serde_json::from_value::<Metadata>(work.value.clone()) else {
        out.issues.push("invalid_metadata");
        return out;
    };
    if meta.question_id != qid { out.issues.push("question_id_mismatch"); }
    if !hex_digest(&meta.source_hash) {
        out.issues.push("invalid_source_hash");
    } else {
        out.source_hash = Some(meta.source_hash.clone());
        if name_hash.is_some_and(|h| h != meta.source_hash) {
            out.issues.push("filename_source_hash_mismatch");
        }
    }
    if !hex_digest(&meta.audio_sha256) { out.issues.push("invalid_audio_hash"); }
    match &meta.generation_hash {
        Some(hash) if !hex_digest(hash) => out.issues.push("invalid_generation_hash"),
        None => out.warnings.push("legacy_generation_hash_missing"),
        _ => {}
    }
    match &meta.answer_variants {
        Some(values) if values.is_empty() || values.iter().any(|s| !VARIANTS.contains(&s.as_str()))
            || values.iter().collect::<BTreeSet<_>>().len() != values.len() => out.issues.push("invalid_answer_variants"),
        None => out.warnings.push("legacy_answer_variants_missing"),
        _ => {}
    }
    let path = work.dir.join(&work.filename);
    if !regular(&path) {
        out.issues.push("missing_or_unsafe_file");
        return out;
    }
    let result = (|| -> Result<()> {
        let mut file = File::open(&path)?;
        let before = file.metadata()?;
        out.bytes = Some(before.len());
        let digest = hash_file(&mut file)?;
        if digest != meta.audio_sha256 { out.issues.push("audio_hash_mismatch"); }
        out.audio_sha256 = Some(digest);
        let duration = if extension == "wav" { wav_duration(&mut file) } else { mp3_duration(&path) };
        match duration.and_then(rounded_duration) {
            Ok(measured) => {
                out.duration_seconds = Some(measured);
                match meta.duration_seconds {
                    Some(stored) if stored.is_finite() && stored > 0.0 => {
                        // Existing uploader uses measured duration rounded to six decimals.
                        if (stored - measured).abs() > 0.0000005 { out.issues.push("duration_mismatch"); }
                    }
                    _ => out.issues.push("missing_or_invalid_duration"),
                }
            }
            Err(_) => out.issues.push("duration_unreadable"),
        }
        let after = fs::symlink_metadata(&path)?;
        if !after.file_type().is_file() || before.len() != after.len() || before.modified()? != after.modified()? {
            out.issues.push("file_changed_during_audit");
        }
        Ok(())
    })();
    if result.is_err() { out.issues.push("file_read_failed"); }
    out.valid = out.issues.is_empty();
    out
}

fn coverage(export: Export, set: &str, format: AudioFormat, recordings: &[Recording]) -> Result<Coverage> {
    ensure!(export.interview_set.slug == set, "export set slug does not match --set");
    let mut ids = BTreeSet::new();
    let mut targets = vec![];
    let suffix = format.extension();
    for row in &export.rows {
        ensure!(row.id > 0 && ids.insert(row.id), "export requires unique positive question IDs");
        ensure!(row.set_id.is_null() || row.set_id == export.interview_set.id, "export row belongs to another set");
        if let Some(variants) = &row.answer_variants {
            ensure!(VARIANTS.iter().all(|v| variants.get(*v).is_none_or(Value::is_string)), "export answer variants must be strings");
        }
        // Python's audio_targets groups full, short, standard in this order.
        let mut groups: Vec<(String, Vec<String>)> = vec![];
        for variant in VARIANTS {
            let hash = hash_text(row, variant);
            if let Some((_, aliases)) = groups.iter_mut().find(|(h, _)| *h == hash) {
                aliases.push(variant.to_owned());
            } else { groups.push((hash, vec![variant.to_owned()])); }
        }
        for (hash, aliases) in groups {
            let filename = format!("q{}-{hash}.{suffix}", row.id);
            let legacy = format!("q{}.{suffix}", row.id);
            let candidates = [filename.as_str(), legacy.as_str()];
            let matching = candidates.iter().find_map(|name| recordings.iter().find(|r|
                r.set == set && r.filename == *name && r.valid && r.question_id == Some(row.id)
                    && r.source_hash.as_deref() == Some(hash.as_str())));
            let review = recordings.iter().any(|r| r.set == set && (r.filename == filename
                || (r.filename == legacy && r.source_hash.as_deref() == Some(hash.as_str()))));
            let status = if matching.is_some() { "ready" } else if review { "needs_review" } else { "missing" };
            targets.push(Target {
                question_id: row.id, source_hash: hash, answer_variants: aliases, filename, status,
                matched_file: matching.map(|r| r.filename.clone()),
            });
        }
    }
    ensure!(!targets.is_empty(), "export contains no questions");
    let ready = targets.iter().filter(|t| t.status == "ready").count();
    let missing = targets.iter().filter(|t| t.status == "missing").count();
    let needs_review = targets.len() - ready - missing;
    Ok(Coverage { set: set.to_owned(), complete: ready == targets.len(), targets, ready, missing, needs_review })
}

fn run(args: Args) -> Result<Report> {
    ensure!(directory(&args.root), "audio root is missing, not a directory, or a symlink");
    let root = args.root.canonicalize()?;
    let mut sets = vec![];
    if let Some(set) = &args.set {
        ensure!(valid_slug(set), "invalid set slug");
        let dir = root.join(set);
        ensure!(directory(&dir), "set directory is missing or unsafe");
        sets.push((set.clone(), dir));
    } else {
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() || !entry.path().join("manifest.json").exists() { continue; }
            let set = entry.file_name().into_string().map_err(|_| anyhow::anyhow!("invalid set directory name"))?;
            ensure!(valid_slug(&set), "invalid set slug");
            sets.push((set, entry.path()));
        }
        sets.sort_by(|a,b| a.0.cmp(&b.0));
    }
    ensure!(!sets.is_empty(), "no audio manifests found");
    let mut work = vec![];
    for (set, dir) in &sets {
        let manifest: Manifest = read_json(&dir.join("manifest.json")).with_context(|| format!("cannot read manifest for set {set}"))?;
        for (filename, value) in manifest.files {
            // Invalid filenames are never opened or included verbatim in logs.
            let filename = if name_parts(&filename).is_some() { filename } else { "[invalid filename]".into() };
            work.push(Work { set: set.clone(), dir: dir.clone(), filename, value });
        }
    }
    let cursor = AtomicUsize::new(0);
    let mut recordings = thread::scope(|scope| -> Result<Vec<Recording>> {
        let mut handles = vec![];
        for _ in 0..usize::from(args.jobs).min(work.len()) {
            let cursor = &cursor;
            let work = &work;
            handles.push(scope.spawn(move || {
                let mut results = vec![];
                loop {
                    let i = cursor.fetch_add(1, Ordering::Relaxed);
                    let Some(task) = work.get(i) else { break; };
                    results.push((i, inspect(task)));
                }
                results
            }));
        }
        let mut result = vec![];
        for h in handles { result.extend(h.join().map_err(|_| anyhow::anyhow!("audit worker failed"))?); }
        result.sort_by_key(|(index, _)| *index);
        Ok(result.into_iter().map(|(_, recording)| recording).collect())
    })?;
    recordings.sort_by(|a,b| (&a.set, &a.filename).cmp(&(&b.set, &b.filename)));
    let mut by_bytes: Map<Vec<String>> = BTreeMap::new();
    let mut verified_bytes = 0u64;
    for r in recordings.iter().filter(|r| r.valid) {
        verified_bytes = verified_bytes.checked_add(r.bytes.unwrap_or(0)).context("byte count overflow")?;
        if let Some(digest) = &r.audio_sha256 {
            by_bytes.entry(digest.clone()).or_default().push(format!("{}/{}", r.set, r.filename));
        }
    }
    let duplicate_byte_groups = by_bytes.into_iter().filter(|(_, files)| files.len() > 1)
        .map(|(audio_sha256, files)| Duplicate { audio_sha256, files }).collect();
    let coverage = if let Some(path) = args.input_json {
        Some(coverage(read_json(&path)?, args.set.as_deref().context("--set is required")?, args.format, &recordings)?)
    } else { None };
    let verified = recordings.iter().filter(|r| r.valid).count();
    let failed = recordings.len() - verified;
    let valid = failed == 0 && (!args.require_complete || coverage.as_ref().is_some_and(|c| c.complete));
    Ok(Report { valid, sets: sets.len(), recordings, verified, failed, verified_bytes, duplicate_byte_groups, coverage })
}

fn main() -> ExitCode {
    match run(Args::parse()) {
        Ok(report) => {
            let valid = report.valid;
            println!("{}", serde_json::to_string_pretty(&report).expect("serialize report"));
            if valid { ExitCode::SUCCESS } else { ExitCode::FAILURE }
        }
        Err(error) => {
            // No question text, credentials, session values or file contents.
            println!("{}", serde_json::json!({"valid": false, "error": error.to_string()}));
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn safe_filenames() {
        let hash = "a".repeat(64);
        assert_eq!(name_parts(&format!("q12-{hash}.mp3")).unwrap().0, 12);
        for bad in ["../q1.wav", "/q1.mp3", "q0.mp3", "q01.mp3", "q2-unknown.mp3", "q3.webm", "https://host/q1.mp3"] {
            assert!(name_parts(bad).is_none(), "{bad}");
        }
        assert!(name_parts("q1-question.wav").is_some());
        assert!(name_parts("q1-answer.mp3").is_some());
    }
    #[test]
    fn empty_alias_falls_back_without_normalization() {
        let row = ExportRow { id: 1, question: "ＡＩ\r\n質問".into(), answer: " 回答 ".into(),
            set_id: Value::Null, answer_variants: Some(BTreeMap::from([("short".into(), Value::String("".into()))])) };
        assert_eq!(hash_text(&row, "full"), hash_text(&row, "short"));
        assert_ne!(hash_text(&row, "full"), format!("{:x}", Sha256::digest("AI\n質問\n回答".as_bytes())));
    }
    #[test]
    fn duplicate_manifest_keys_rejected() {
        assert!(serde_json::from_str::<Manifest>(r#"{"files":{"q1.mp3":{},"q1.mp3":{}}}"#).is_err());
    }
}
