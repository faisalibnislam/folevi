//! Library paths and note file names, as packages/local-store/src/layout.ts defines them (restated here; the
//! tests check a corpus against the reference's answers).
use crate::shell::ShellError;

pub const LIBRARY_FILE: &str = "folevi-library.json";
pub const NOTES_DIR: &str = "notes";
pub const FILES_DIR: &str = "files";
pub const HISTORY_DIR: &str = "history";
pub const TMP_DIR: &str = ".folevi-tmp";
pub const NOTE_EXT: &str = ".fnote";

/// Library paths are relative, use forward slashes, and never contain `..`, empty parts or control characters.
pub fn is_valid_library_path(path: &str) -> bool {
    let len = path.encode_utf16().count();
    if len == 0 || len > 1024 {
        return false;
    }
    if path.starts_with('/') || path.ends_with('/') || path.contains('\\') || path.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f) {
        return false;
    }
    path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

pub fn check_path(path: &str) -> Result<&str, ShellError> {
    if is_valid_library_path(path) {
        Ok(path)
    } else {
        Err(ShellError::new("invalid_path", "That isn't a valid library path.").with_path(path))
    }
}

/// A directory argument: "" (the whole library) or a valid path.
pub fn check_dir(dir: &str) -> Result<&str, ShellError> {
    if dir.is_empty() {
        Ok(dir)
    } else {
        check_path(dir)
    }
}

/// `^[A-Za-z0-9_-]{1,64}$`
pub fn is_valid_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedNoteName {
    pub id: String,
    /// (provider, label): "dropbox" | "icloud" | "numbered" | "onedrive".
    pub copy: Option<(&'static str, String)>,
    pub placeholder: bool,
}

/// The real name behind `.<name>.icloud`, or None.
pub fn from_placeholder_name(name: &str) -> Option<&str> {
    let inner = name.strip_prefix('.')?.strip_suffix(".icloud")?;
    // `^\.(.+)\.icloud$`: at least one character, and `.` never matches a line break.
    if inner.is_empty() || inner.chars().any(is_line_break) {
        return None;
    }
    Some(inner)
}

pub fn placeholder_name(name: &str) -> String {
    format!(".{name}.icloud")
}

fn is_line_break(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `^(SHAPE)(?:-(.+))?$` for one fixed-length shape: the id, and the suffix after a dash (if any).
fn strict_shape<'a>(stem: &'a str, len: usize, ok: impl Fn(&[u8]) -> bool) -> Option<(&'a str, Option<&'a str>)> {
    let b = stem.as_bytes();
    if b.len() < len || !ok(&b[..len]) {
        return None;
    }
    let rest = &stem[len..];
    if rest.is_empty() {
        return Some((&stem[..len], None));
    }
    let suffix = rest.strip_prefix('-')?;
    if suffix.is_empty() || suffix.chars().any(is_line_break) {
        return None;
    }
    Some((&stem[..len], Some(suffix)))
}

fn class(b: &[u8], f: impl Fn(u8) -> bool) -> bool {
    b.iter().all(|&c| f(c))
}

fn shapes(stem: &str) -> Vec<Option<(&str, Option<&str>)>> {
    let hexl = |c: u8| c.is_ascii_digit() || (b'a'..=b'f').contains(&c);
    vec![
        // ULID
        strict_shape(stem, 26, |b| class(b, |c| c.is_ascii_digit() || c.is_ascii_uppercase())),
        // An HMAC name
        strict_shape(stem, 26, |b| class(b, |c| c.is_ascii_digit() || c.is_ascii_lowercase())),
        // daily-YYYY-MM-DD-<16 hex>
        strict_shape(stem, 33, |b| {
            b.starts_with(b"daily-")
                && class(&b[6..10], |c| c.is_ascii_digit())
                && b[10] == b'-'
                && class(&b[11..13], |c| c.is_ascii_digit())
                && b[13] == b'-'
                && class(&b[14..16], |c| c.is_ascii_digit())
                && b[16] == b'-'
                && class(&b[17..33], hexl)
        }),
        // inbox-<16 hex>
        strict_shape(stem, 22, |b| b.starts_with(b"inbox-") && class(&b[6..22], hexl)),
    ]
}

/// local-store's `parseNoteFileName`: the id of a note file, a provider's copy of one, or an iCloud placeholder.
pub fn parse_note_file_name(file_name: &str) -> Option<ParsedNoteName> {
    let mut name = file_name;
    let mut placeholder = false;
    if let Some(real) = from_placeholder_name(name) {
        name = real;
        placeholder = true;
    }
    let stem = name.strip_suffix(NOTE_EXT)?;
    match stem.find([' ', '(']) {
        Some(0) => None,
        Some(cut) => {
            let id = &stem[..cut];
            let rest = &stem[cut..];
            if !is_valid_id(id) {
                return None;
            }
            let provider = if rest.starts_with(" (")
                && rest.ends_with(')')
                && rest.len() >= 3
                && !rest.chars().any(is_line_break)
                && rest[2..rest.len() - 1].to_lowercase().contains("conflict")
            {
                Some("dropbox")
            } else if {
                let r = rest.strip_prefix(' ').unwrap_or(rest);
                r.strip_prefix('(').and_then(|r| r.strip_suffix(')')).is_some_and(all_digits)
            } {
                Some("numbered")
            } else if rest.strip_prefix(' ').is_some_and(all_digits) {
                Some("icloud")
            } else {
                None
            };
            provider.map(|p| ParsedNoteName { id: id.to_string(), copy: Some((p, rest.trim().to_string())), placeholder })
        }
        None => {
            for shape in shapes(stem).into_iter().flatten() {
                match shape {
                    (id, None) => return Some(ParsedNoteName { id: id.to_string(), copy: None, placeholder }),
                    (id, Some(suffix)) if is_valid_id(suffix) => {
                        return Some(ParsedNoteName { id: id.to_string(), copy: Some(("onedrive", suffix.to_string())), placeholder })
                    }
                    _ => {}
                }
            }
            if is_valid_id(stem) {
                Some(ParsedNoteName { id: stem.to_string(), copy: None, placeholder })
            } else {
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ULID: &str = "01J9ZDOC000000000000000001";
    const HMAC: &str = "7k2m9q4r1t8v3w6x0y5z2a7b4c";

    #[test]
    fn path_validation_matches_local_store() {
        let long_ok = "x".repeat(1024);
        let long_bad = "x".repeat(1025);
        let cases: Vec<(&str, bool)> = vec![
            ("", false),
            ("notes/a.fnote", true),
            ("/abs", false),
            ("../x", false),
            ("notes/../x", false),
            ("notes//x", false),
            ("notes/x/", false),
            ("notes\\x", false),
            ("notes/\u{0}", false),
            ("notes/a\u{7f}", false),
            (".", false),
            ("..", false),
            ("a/./b", false),
            (".folevi-tmp/x", true),
            ("files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", true),
            (&long_ok, true),
            (&long_bad, false),
            ("notes/Ünïcode name.fnote", true),
        ];
        for (p, want) in cases {
            assert_eq!(is_valid_library_path(p), want, "{p:?}");
        }
        assert_eq!(check_path("../x").unwrap_err().code, "invalid_path");
        assert_eq!(check_dir("").unwrap(), "");
    }

    #[test]
    fn note_names_copies_and_placeholders() {
        let p = |n: &str| parse_note_file_name(n);
        let plain = |id: &str, ph: bool| Some(ParsedNoteName { id: id.into(), copy: None, placeholder: ph });
        let copy = |id: &str, prov: &'static str, label: &str| Some(ParsedNoteName { id: id.into(), copy: Some((prov, label.into())), placeholder: false });
        assert_eq!(p(&format!("{ULID}.fnote")), plain(ULID, false));
        assert_eq!(p(&format!("{HMAC}.fnote")), plain(HMAC, false));
        assert_eq!(p(&format!("{ULID} (Faisal's conflicted copy 2026-10-20).fnote")), copy(ULID, "dropbox", "(Faisal's conflicted copy 2026-10-20)"));
        assert_eq!(p(&format!("{ULID} (Case Conflict).fnote")), copy(ULID, "dropbox", "(Case Conflict)"));
        assert_eq!(p(&format!("{ULID} 2.fnote")), copy(ULID, "icloud", "2"));
        assert_eq!(p(&format!("{ULID}(1).fnote")), copy(ULID, "numbered", "(1)"));
        assert_eq!(p(&format!("{ULID} (1).fnote")), copy(ULID, "numbered", "(1)"));
        assert_eq!(p(&format!("{ULID}-MACBOOK.fnote")), copy(ULID, "onedrive", "MACBOOK"));
        assert_eq!(p(&format!("{HMAC}-MACBOOK.fnote")), copy(HMAC, "onedrive", "MACBOOK"));
        assert_eq!(p(&format!(".{ULID}.fnote.icloud")), plain(ULID, true));
        assert_eq!(
            p(&format!(".{HMAC} 2.fnote.icloud")),
            Some(ParsedNoteName { id: HMAC.into(), copy: Some(("icloud", "2".into())), placeholder: true })
        );
        assert_eq!(p("daily-2026-10-20-0123456789abcdef.fnote"), plain("daily-2026-10-20-0123456789abcdef", false));
        assert_eq!(p("inbox-0123456789abcdef.fnote"), plain("inbox-0123456789abcdef", false));
        assert_eq!(p("inbox-0123456789abcdef-PC.fnote"), copy("inbox-0123456789abcdef", "onedrive", "PC"));
        assert_eq!(p("plain-id.fnote"), plain("plain-id", false));
        assert_eq!(p(&format!("{ULID}.txt")), None);
        assert_eq!(p(" lead.fnote"), None);
        assert_eq!(p(&format!("{ULID} weird.fnote")), None);
        assert_eq!(p(".DS_Store"), None);
    }
}
