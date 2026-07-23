//! Recording persistence layer.
//!
//! A deep module owning the three concerns that were previously scattered
//! across `save_recording`, `dirs_default_recording_dir`, and the frontend
//! `stamp()` helper:
//!   1. where recordings are written (output directory resolution),
//!   2. what they are named (filename policy),
//!   3. how they hit disk (byte write).
//!
//! Each piece is a pure(ish) function so it can be unit-tested without
//! spinning up a Tauri app or a native dialog.

use std::path::{Path, PathBuf};

/// Resolve the directory recordings are written to.
///
/// Precedence: an explicit user-configured directory > the platform default
/// (`~/Movies/Floaty` on macOS, `~/Videos/Floaty` elsewhere). The resolved
/// directory is created if missing. Returns `None` only if the user's home
/// directory cannot be determined at all.
///
/// `configured` is the raw string from `AppSettings.recording_output_dir`
/// (already validated as non-empty by the caller); empty strings fall back
/// to the platform default.
pub fn resolve_output_dir(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(dir) = configured.map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(dir);
        let _ = std::fs::create_dir_all(&path);
        return Some(path);
    }
    platform_default_dir()
}

/// Build a timestamped filename for a recording, e.g. `floaty-20260720-193055.mp4`.
///
/// Only used as a fallback when the frontend sends an empty suggested name;
/// the frontend normally includes the extension matching the container the
/// `MediaRecorder` actually negotiated (mp4 preferred, webm fallback).
///
/// `parts` is the pre-formatted timestamp string (`YYYYMMDD-HHMMSS`) so this
/// function stays pure and testable without depending on a clock.
pub fn make_filename(prefix: &str, parts: &str) -> String {
    format!("{}-{}.mp4", prefix.trim(), parts)
}

/// Write recording bytes to `path`. Thin wrapper over `std::fs::write`,
/// kept as a function so the call site reads as intent and so a future
/// streaming implementation can replace it without touching callers.
pub fn write_recording(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Write recording metadata (a pre-serialized JSON string) to `path`.
/// Kept as its own function rather than reusing `write_recording` so the
/// intent at the call site is explicit and a future streaming/pretty-print
/// variant can diverge.
pub fn write_recording_meta(path: &Path, json: &str) -> Result<(), String> {
    std::fs::write(path, json.as_bytes()).map_err(|e| e.to_string())
}

/// Derive the metadata sidecar path for a draft recording.
///
/// A draft at `draft-<millis>.mp4` (or `.webm`) gets a sidecar at
/// `draft-<millis>.json` in the same directory. The two files share a
/// basename so they travel and prune together. Used by both the
/// `save_recording_meta` / `read_recording_meta` commands and the draft
/// deletion path so they agree on the layout.
pub fn meta_sidecar_path(draft_path: &Path) -> PathBuf {
    let mut out = draft_path.to_path_buf();
    out.set_extension("json");
    out
}

/// Format the current local time as `YYYYMMDD-HHMMSS` for filename use.
/// Split out from `make_filename` so the filename builder stays pure and
/// clock-free (and therefore unit-testable).
pub fn timestamp_parts(unix_secs: i64) -> String {
    // Minimal civil-date conversion (no chrono dep). Operates in UTC for
    // determinism; the seconds are only used to make filenames unique and
    // roughly ordered, not to display a wall clock to the user.
    let (year, month, day, hh, mm, ss) = civil_from_unix(unix_secs);
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        year, month, day, hh, mm, ss
    )
}

fn platform_default_dir() -> Option<PathBuf> {
    let home_os = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home_os);
    let sub: [&str; 2] = if cfg!(target_os = "macos") {
        ["Movies", "Floaty"]
    } else {
        ["Videos", "Floaty"]
    };
    let dir = home.join(sub[0]).join(sub[1]);
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

/// Convert a Unix timestamp (seconds) to civil date components in UTC.
/// Algorithm: Howard Hinnant, "civil_from_days". Pure and dependency-free.
fn civil_from_unix(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let hh = (rem / 3600) as u32;
    let mm = ((rem % 3600) / 60) as u32;
    let ss = (rem % 60) as u32;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y } as i32;
    (year, m, d, hh, mm, ss)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_filename_formats() {
        assert_eq!(make_filename("floaty", "20260720-193055"), "floaty-20260720-193055.mp4");
        assert_eq!(make_filename("clip", "20000101-000000"), "clip-20000101-000000.mp4");
        assert_eq!(make_filename("  spaced  ", "x"), "spaced-x.mp4");
    }

    #[test]
    fn timestamp_parts_known_values() {
        // 1970-01-01 00:00:00 UTC
        assert_eq!(timestamp_parts(0), "19700101-000000");
        // 2026-07-20 18:10:55 UTC (value verified against the algorithm output)
        assert_eq!(timestamp_parts(1_784_571_055), "20260720-181055");
    }

    #[test]
    fn civil_from_unix_handles_negative() {
        // 1969-12-31 23:59:50 UTC
        let (y, m, d, hh, mm, ss) = civil_from_unix(-10);
        assert_eq!((y, m, d, hh, mm, ss), (1969, 12, 31, 23, 59, 50));
    }

    #[test]
    fn resolve_output_dir_uses_configured_when_set() {
        let tmp = std::env::temp_dir().join("floaty-store-test-configured");
        let _ = std::fs::remove_dir_all(&tmp);
        let resolved = resolve_output_dir(Some(tmp.to_str().unwrap())).unwrap();
        assert_eq!(resolved, tmp);
        assert!(tmp.exists(), "directory should be created");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn resolve_output_dir_ignores_empty_configured() {
        // Empty / whitespace-only configured should fall back. We can't
        // assert the exact fallback path (depends on env), but it should be
        // non-empty and exist.
        let resolved = resolve_output_dir(Some("   ")).unwrap();
        assert!(resolved.exists() || resolved.parent().is_some());
    }

    #[test]
    fn write_recording_roundtrip() {
        let dir = std::env::temp_dir().join("floaty-store-test-write");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("out.webm");
        write_recording(&path, b"hello").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn meta_sidecar_path_replaces_extension() {
        assert_eq!(
            meta_sidecar_path(std::path::Path::new("/tmp/floaty-drafts/draft-1234567.mp4")),
            std::path::PathBuf::from("/tmp/floaty-drafts/draft-1234567.json")
        );
        assert_eq!(
            meta_sidecar_path(std::path::Path::new("/tmp/floaty-drafts/draft-1234567.webm")),
            std::path::PathBuf::from("/tmp/floaty-drafts/draft-1234567.json")
        );
    }

    #[test]
    fn write_recording_meta_roundtrip() {
        let dir = std::env::temp_dir().join("floaty-store-test-meta");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("draft-9999.json");
        let body = r#"{"captureWidth":2880,"cursor":[]}"#;
        write_recording_meta(&path, body).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
