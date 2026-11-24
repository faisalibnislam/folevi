//! A Dropbox or Google Drive library's copy on this PC (the page's provider code keeps it through mirror*):
//! <user data>/Cloud libraries/<provider>, the same layout as the cloud folder, with each file's provider etag
//! beside it (`.<name>.etag`) and the provider's state (cursor, index) in `.state.json`. The same contract as the
//! iPhone's ShellCloud.swift mirror* calls.
use std::path::{Path, PathBuf};

use super::paths::is_valid_library_path;
use crate::shell::{write_atomic, ShellError};

pub fn root(user_data: &Path, provider: &str) -> Result<PathBuf, ShellError> {
    if provider != "dropbox" && provider != "googleDrive" {
        return Err(ShellError::invalid("That isn't a provider Folevi syncs with."));
    }
    let dir = user_data.join("Cloud libraries").join(provider);
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir)
}

/// The provider a cloud library kind uses.
pub fn provider_of(kind: &str) -> Option<&'static str> {
    match kind {
        "dropbox" => Some("dropbox"),
        "gdrive" => Some("googleDrive"),
        _ => None,
    }
}

fn file(user_data: &Path, provider: &str, path: &str) -> Result<PathBuf, ShellError> {
    if !is_valid_library_path(path) || path.starts_with('.') {
        return Err(ShellError::new("invalid_path", "That isn't a valid library path.").with_path(path));
    }
    let mut f = root(user_data, provider)?;
    for part in path.split('/') {
        if cfg!(windows) && part.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')) {
            return Err(ShellError::new("invalid_path", "That name can't be used in a folder on this PC.").with_path(path));
        }
        f.push(part);
    }
    Ok(f)
}

fn etag_file(f: &Path) -> PathBuf {
    let name = f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    f.with_file_name(format!(".{name}.etag"))
}

pub fn read(user_data: &Path, provider: &str, path: &str) -> Result<Option<(Vec<u8>, String)>, ShellError> {
    let f = file(user_data, provider, path)?;
    let Ok(data) = std::fs::read(&f) else { return Ok(None) };
    Ok(Some((data, std::fs::read_to_string(etag_file(&f)).unwrap_or_default())))
}

pub fn write(user_data: &Path, provider: &str, path: &str, data: &[u8], etag: &str) -> Result<(), ShellError> {
    let f = file(user_data, provider, path)?;
    let io = |e: std::io::Error| ShellError::io(format!("Folevi couldn't keep a copy of a file on this PC ({e}).")).with_path(path);
    write_atomic(&f, data).map_err(io)?;
    write_atomic(&etag_file(&f), etag.as_bytes()).map_err(io)
}

pub fn delete(user_data: &Path, provider: &str, path: &str) -> Result<(), ShellError> {
    let f = file(user_data, provider, path)?;
    let _ = std::fs::remove_file(&f);
    let _ = std::fs::remove_file(etag_file(&f));
    Ok(())
}

pub fn paths(user_data: &Path, provider: &str) -> Result<Vec<String>, ShellError> {
    let root = root(user_data, provider)?;
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(items) = std::fs::read_dir(&dir) else { continue };
        for e in items.flatten() {
            let Ok(name) = e.file_name().into_string() else { continue };
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                stack.push(e.path());
            } else if ft.is_file() {
                let Ok(rel) = e.path().strip_prefix(&root).map(Path::to_path_buf) else { continue };
                let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
                if let Some(p) = parts.map(|p| p.join("/")) {
                    if is_valid_library_path(&p) {
                        out.push(p);
                    }
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn load_state(user_data: &Path, provider: &str) -> Result<Option<String>, ShellError> {
    Ok(std::fs::read_to_string(root(user_data, provider)?.join(".state.json")).ok())
}

pub fn save_state(user_data: &Path, provider: &str, state: &str) -> Result<(), ShellError> {
    write_atomic(&root(user_data, provider)?.join(".state.json"), state.as_bytes()).map_err(|e| ShellError::io(format!("Folevi couldn't keep the sync state on this PC ({e}).")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cloud_librarys_copy_round_trips() {
        let d = tempfile::tempdir().unwrap();
        let u = d.path();
        assert_eq!(read(u, "dropbox", "notes/A.fnote").unwrap(), None);
        write(u, "dropbox", "notes/A.fnote", b"a", "rev1").unwrap();
        write(u, "dropbox", "files/ab/abc", b"f", "rev2").unwrap();
        assert_eq!(read(u, "dropbox", "notes/A.fnote").unwrap(), Some((b"a".to_vec(), "rev1".to_string())));
        assert_eq!(paths(u, "dropbox").unwrap(), vec!["files/ab/abc".to_string(), "notes/A.fnote".to_string()]);
        delete(u, "dropbox", "notes/A.fnote").unwrap();
        assert_eq!(paths(u, "dropbox").unwrap(), vec!["files/ab/abc".to_string()]);
        assert_eq!(load_state(u, "googleDrive").unwrap(), None);
        save_state(u, "googleDrive", "{\"cursor\":1}").unwrap();
        assert_eq!(load_state(u, "googleDrive").unwrap().as_deref(), Some("{\"cursor\":1}"));
        assert_eq!(read(u, "box", "x").unwrap_err().code, "invalid_argument");
        assert_eq!(read(u, "dropbox", "../x").unwrap_err().code, "invalid_path");
        assert_eq!(read(u, "dropbox", ".state.json").unwrap_err().code, "invalid_path");
    }
}
