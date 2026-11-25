//! Where a library lives on Windows and Linux (docs/LOCAL_MODE_PLAN.md §3.1):
//! - "This device only": <home>/Documents/Folevi Library.
//! - "Choose a folder": any folder (a OneDrive, Dropbox or Google Drive folder, a USB drive, a network share),
//!   remembered in library.json. A folder that holds other things gets a "Folevi Library" folder inside it.
//! - "Sync with Dropbox" / "Sync with Google Drive": the page's own provider code (libSetCloud records it).
//! There's no "Sync with iCloud" here.
use std::path::{Path, PathBuf};

use super::paths::LIBRARY_FILE;

pub const DEVICE_FOLDER: &str = "Folevi Library";

pub fn device_location(home: &Path) -> PathBuf {
    home.join("Documents").join(DEVICE_FOLDER)
}

/// The library folder for a folder the person chose: it, if it's a library or empty; else "Folevi Library" in it.
pub fn library_folder_in(chosen: &Path) -> PathBuf {
    let Ok(items) = std::fs::read_dir(chosen) else { return chosen.to_path_buf() };
    let names: Vec<String> = items.flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
    if names.iter().any(|n| n == LIBRARY_FILE) {
        return chosen.to_path_buf();
    }
    let other = names.iter().filter(|n| !matches!(n.as_str(), ".DS_Store" | "Icon\r" | "desktop.ini" | "Desktop.ini" | "Thumbs.db") && !n.starts_with(".folevi")).count();
    if other == 0 {
        chosen.to_path_buf()
    } else {
        chosen.join(DEVICE_FOLDER)
    }
}

/// For people to read. Windows: the folders as File Explorer shows them, "Documents › Folevi Library",
/// "OneDrive › Notes". Linux: "~/Documents/Folevi Library". Elsewhere the full path.
pub fn display_path(path: &Path, home: &Path, windows: bool) -> String {
    let p = path.to_string_lossy().to_string();
    let h = home.to_string_lossy().to_string();
    if windows {
        let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_string();
        let (pn, hn) = (norm(&p), norm(&h));
        if !hn.is_empty() && pn.len() > hn.len() && pn.is_char_boundary(hn.len()) && pn[..hn.len()].to_lowercase() == hn.to_lowercase() && pn.as_bytes()[hn.len()] == b'\\' {
            let rest: Vec<&str> = pn[hn.len() + 1..].split('\\').filter(|s| !s.is_empty()).collect();
            if !rest.is_empty() {
                return rest.join(" › ");
            }
        }
        return p;
    }
    match path.strip_prefix(home) {
        Ok(rel) if rel.as_os_str().is_empty() => "~".into(),
        Ok(rel) => format!("~/{}", rel.to_string_lossy().trim_end_matches('/')),
        Err(_) => p,
    }
}

/// Whether `a` is `b` or inside it (both with links resolved).
pub fn inside(a: &Path, b: &Path) -> bool {
    a.starts_with(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_paths() {
        assert_eq!(display_path(Path::new(r"C:\Users\Faisal\Documents\Folevi Library"), Path::new(r"C:\Users\Faisal"), true), "Documents › Folevi Library");
        assert_eq!(display_path(Path::new(r"c:\users\faisal\OneDrive\Notes\"), Path::new(r"C:\Users\Faisal"), true), "OneDrive › Notes");
        assert_eq!(display_path(Path::new(r"D:\Notes"), Path::new(r"C:\Users\Faisal"), true), r"D:\Notes");
        assert_eq!(display_path(Path::new(r"C:\Users\FaisalX\Notes"), Path::new(r"C:\Users\Faisal"), true), r"C:\Users\FaisalX\Notes");
        assert_eq!(display_path(Path::new("/home/f/Documents/Folevi Library"), Path::new("/home/f"), false), "~/Documents/Folevi Library");
        assert_eq!(display_path(Path::new("/media/usb/Notes"), Path::new("/home/f"), false), "/media/usb/Notes");
    }

    #[test]
    fn the_library_folder_in_a_chosen_one() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(library_folder_in(d.path()), d.path());
        std::fs::write(d.path().join("desktop.ini"), "x").unwrap();
        assert_eq!(library_folder_in(d.path()), d.path());
        std::fs::write(d.path().join("Taxes.pdf"), "x").unwrap();
        assert_eq!(library_folder_in(d.path()), d.path().join(DEVICE_FOLDER));
        std::fs::write(d.path().join(LIBRARY_FILE), "{}").unwrap();
        assert_eq!(library_folder_in(d.path()), d.path());
    }
}
