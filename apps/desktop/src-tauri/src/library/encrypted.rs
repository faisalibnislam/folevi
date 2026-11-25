//! Transparent encryption around the library folder (docs/LOCAL_MODE_PLAN.md §3.9): the page reads and writes
//! plain paths and bytes; the folder holds FLV1 envelopes under HMAC names. The same mapping as local-store's
//! EncryptedFs (the reference), the Electron app's encryptedFs.ts and the iPhone's EncryptedFS.swift, with the
//! key held here and never in the page.
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;

use super::crypto::{hmac_name, open_file, seal_file, seal_stream};
use super::fs::{Entry, FolderFs, IfMatch, LibraryFs, ReadResult, WriteResult};
use super::paths::{check_dir, check_path, parse_note_file_name, FILES_DIR, HISTORY_DIR, LIBRARY_FILE, NOTES_DIR, TMP_DIR};
use crate::shell::ShellError;

pub struct EncryptedFs {
    pub inner: Arc<FolderFs>,
    master: [u8; 32],
    /// HMAC name → note id, and attachment HMAC name → sha256.
    note_ids: Mutex<HashMap<String, String>>,
    shas: Mutex<HashMap<String, String>>,
}

fn unreadable(e: impl std::fmt::Display, path: &str) -> ShellError {
    ShellError::new("unreadable", format!("Folevi couldn't decrypt a file in the library ({e}).")).with_path(path)
}

impl EncryptedFs {
    pub fn new(inner: Arc<FolderFs>, master: [u8; 32]) -> Self {
        Self { inner, master, note_ids: Mutex::new(HashMap::new()), shas: Mutex::new(HashMap::new()) }
    }

    fn note_name(&self, id: &str) -> String {
        let name = hmac_name(&self.master, "note", id).expect("32-byte key");
        self.note_ids.lock().insert(name.clone(), id.to_string());
        name
    }

    fn file_name(&self, sha: &str) -> String {
        let name = hmac_name(&self.master, "file", sha).expect("32-byte key");
        self.shas.lock().insert(name.clone(), sha.to_string());
        name
    }

    fn plain(path: &str) -> bool {
        path == LIBRARY_FILE || path.starts_with(&format!("{TMP_DIR}/"))
    }

    /// Logical path → on-disk path (the logical path is checked first: a name can't hide a `..`).
    pub fn physical(&self, path: &str) -> Result<String, ShellError> {
        let parts: Vec<&str> = check_path(path)?.split('/').collect();
        if parts[0] == NOTES_DIR && parts.len() == 2 {
            if let Some(parsed) = parse_note_file_name(parts[1]) {
                if !parsed.placeholder {
                    return Ok(format!("{NOTES_DIR}/{}{}", self.note_name(&parsed.id), &parts[1][parsed.id.len()..]));
                }
            }
        }
        if parts[0] == HISTORY_DIR && parts.len() >= 2 {
            let mut out = vec![HISTORY_DIR.to_string(), self.note_name(parts[1])];
            out.extend(parts[2..].iter().map(|s| s.to_string()));
            return Ok(out.join("/"));
        }
        if parts[0] == FILES_DIR && parts.len() == 3 {
            let name = self.file_name(parts[2]);
            return Ok(format!("{FILES_DIR}/{}/{name}", &name[..2]));
        }
        Ok(path.to_string())
    }

    /// The path a file's key comes from: its canonical on-disk path (a provider's copy uses the original's).
    pub fn key_path(physical: &str) -> String {
        let parts: Vec<&str> = physical.split('/').collect();
        if parts[0] == NOTES_DIR && parts.len() == 2 {
            if let Some(parsed) = parse_note_file_name(parts[1]) {
                return format!("{NOTES_DIR}/{}.fnote", parsed.id);
            }
        }
        if parts[0] == HISTORY_DIR && parts.len() == 3 {
            let file = parts[2];
            if let Some(cut) = file.find([' ', '(']) {
                if cut > 0 && file.ends_with(".fver") {
                    return format!("{}/{}/{}.fver", parts[0], parts[1], &file[..cut]);
                }
            }
        }
        physical.to_string()
    }

    pub fn seal(&self, physical: &str, bytes: &[u8]) -> Result<Vec<u8>, ShellError> {
        if Self::plain(physical) {
            return Ok(bytes.to_vec());
        }
        let key_path = Self::key_path(physical);
        let sealed = if physical.starts_with(&format!("{FILES_DIR}/")) {
            seal_stream(&self.master, &key_path, bytes, None, None)
        } else {
            seal_file(&self.master, &key_path, bytes, None)
        };
        sealed.map_err(|e| unreadable(e, physical))
    }

    pub fn open(&self, physical: &str, bytes: &[u8]) -> Result<Vec<u8>, ShellError> {
        if Self::plain(physical) {
            return Ok(bytes.to_vec());
        }
        open_file(&self.master, &Self::key_path(physical), bytes).map_err(|e| unreadable(e, physical))
    }

    /// On-disk path → logical path, learning unknown names by decrypting the file. None if it can't be read.
    pub fn logical(&self, physical: &str) -> Option<String> {
        let parts: Vec<&str> = physical.split('/').collect();
        if parts[0] == NOTES_DIR && parts.len() == 2 {
            let Some(parsed) = parse_note_file_name(parts[1]) else { return Some(physical.to_string()) };
            if parsed.placeholder {
                return Some(physical.to_string());
            }
            let known = self.note_ids.lock().get(&parsed.id).cloned();
            let id = match known {
                Some(id) => id,
                None => {
                    let ReadResult::Bytes(bytes, _) = self.inner.read(physical).ok()? else { return Some(physical.to_string()) };
                    let value: serde_json::Value = serde_json::from_slice(&self.open(physical, &bytes).ok()?).ok()?;
                    let id = value.get("id")?.as_str()?.to_string();
                    if self.note_name(&id) != parsed.id {
                        return None;
                    }
                    id
                }
            };
            return Some(format!("{NOTES_DIR}/{id}{}", &parts[1][parsed.id.len()..]));
        }
        if parts[0] == HISTORY_DIR && parts.len() >= 2 {
            let id = self.note_ids.lock().get(parts[1]).cloned()?;
            let mut out = vec![HISTORY_DIR.to_string(), id];
            out.extend(parts[2..].iter().map(|s| s.to_string()));
            return Some(out.join("/"));
        }
        if parts[0] == FILES_DIR && parts.len() == 3 {
            let known = self.shas.lock().get(parts[2]).cloned();
            let sha = match known {
                Some(s) => s,
                None => {
                    let ReadResult::Bytes(bytes, _) = self.inner.read(physical).ok()? else { return None };
                    let sha = hex::encode(Sha256::digest(self.open(physical, &bytes).ok()?));
                    if self.file_name(&sha) != parts[2] {
                        return None;
                    }
                    sha
                }
            };
            return Some(format!("{FILES_DIR}/{}/{sha}", &sha[..2]));
        }
        Some(physical.to_string())
    }
}

impl LibraryFs for EncryptedFs {
    fn list(&self, dir: &str) -> Result<Vec<Entry>, ShellError> {
        check_dir(dir)?;
        if dir.is_empty() || dir == HISTORY_DIR || dir.starts_with(&format!("{HISTORY_DIR}/")) {
            // History folders are named after notes: learn the note names first.
            for e in self.inner.list(NOTES_DIR)? {
                self.logical(&e.path);
            }
        }
        let entries = self.inner.list(&if dir.is_empty() { String::new() } else { self.physical(dir)? })?;
        Ok(entries.into_iter().filter_map(|e| self.logical(&e.path).map(|path| Entry { path, ..e })).collect())
    }

    fn read(&self, path: &str) -> Result<ReadResult, ShellError> {
        let physical = self.physical(path)?;
        match self.inner.read(&physical)? {
            ReadResult::Bytes(b, etag) => Ok(ReadResult::Bytes(self.open(&physical, &b).map_err(|e| ShellError { data: Some(serde_json::json!({ "path": path })), ..e })?, etag)),
            ReadResult::NotDownloaded => Ok(ReadResult::NotDownloaded),
        }
    }

    fn write(&self, path: &str, bytes: &[u8], if_match: &IfMatch) -> Result<WriteResult, ShellError> {
        let physical = self.physical(path)?;
        let sealed = self.seal(&physical, bytes)?;
        self.inner.write(&physical, &sealed, if_match)
    }

    fn remove(&self, path: &str, if_match: Option<&str>) -> Result<(), ShellError> {
        self.inner.remove(&self.physical(path)?, if_match)
    }

    fn conflict_versions(&self, path: &str) -> Result<Vec<(String, Vec<u8>)>, ShellError> {
        let physical = self.physical(path)?;
        self.inner.conflict_versions(&physical)?.into_iter().map(|(id, b)| Ok((id, self.open(&physical, &b)?))).collect()
    }

    fn resolve_conflicts(&self, path: &str, ids: &[String]) -> Result<(), ShellError> {
        self.inner.resolve_conflicts(&self.physical(path)?, ids)
    }

    fn start_download(&self, paths: &[String]) -> Result<(), ShellError> {
        let physical: Result<Vec<String>, ShellError> = paths.iter().map(|p| self.physical(p)).collect();
        self.inner.start_download(&physical?)
    }
}

#[cfg(test)]
mod tests {
    use super::super::crypto::{is_envelope, open_file as raw_open};
    use super::*;

    const DOC: &str = "01J9ZDOC000000000000000001";

    #[test]
    fn plain_names_and_bytes_outside_envelopes_and_hmac_names_inside() {
        let d = tempfile::tempdir().unwrap();
        let base = Arc::new(FolderFs::new(d.path()));
        let key = [5u8; 32];
        let enc = EncryptedFs::new(base.clone(), key);
        let note = format!(r#"{{"id":"{DOC}","words":"secret plans"}}"#);
        let sha = hex::encode(Sha256::digest(b"attachment bytes"));
        enc.write(&format!("notes/{DOC}.fnote"), note.as_bytes(), &IfMatch::Any).unwrap();
        enc.write(&format!("notes/{DOC} (1).fnote"), note.as_bytes(), &IfMatch::Any).unwrap();
        enc.write(&format!("history/{DOC}/v1.fver"), b"version", &IfMatch::Any).unwrap();
        enc.write(&format!("files/{}/{sha}", &sha[..2]), b"attachment bytes", &IfMatch::Any).unwrap();
        enc.write("index/library.findex", b"{}", &IfMatch::Any).unwrap();
        enc.write(LIBRARY_FILE, b"{\"plain\":true}", &IfMatch::Any).unwrap();

        // On disk: HMAC names, envelopes; the library file stays plain.
        let name = hmac_name(&key, "note", DOC).unwrap();
        let on_disk = std::fs::read(d.path().join("notes").join(format!("{name}.fnote"))).unwrap();
        assert!(is_envelope(&on_disk));
        assert!(!String::from_utf8_lossy(&on_disk).contains("secret"));
        assert_eq!(raw_open(&key, &format!("notes/{name}.fnote"), &on_disk).unwrap(), note.as_bytes());
        // A provider's copy is keyed by the original's path.
        let copy = std::fs::read(d.path().join("notes").join(format!("{name} (1).fnote"))).unwrap();
        assert_eq!(raw_open(&key, &format!("notes/{name}.fnote"), &copy).unwrap(), note.as_bytes());
        assert!(d.path().join("history").join(&name).join("v1.fver").exists());
        assert_eq!(std::fs::read(d.path().join(LIBRARY_FILE)).unwrap(), b"{\"plain\":true}");

        // A fresh view (nothing learnt yet) lists and reads logical paths.
        let fresh = EncryptedFs::new(base, key);
        let paths: Vec<String> = fresh.list("").unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(
            paths.iter().cloned().collect::<std::collections::BTreeSet<_>>(),
            [
                format!("files/{}/{sha}", &sha[..2]),
                LIBRARY_FILE.to_string(),
                format!("history/{DOC}/v1.fver"),
                "index/library.findex".to_string(),
                format!("notes/{DOC} (1).fnote"),
                format!("notes/{DOC}.fnote"),
            ]
            .into_iter()
            .collect()
        );
        match fresh.read(&format!("files/{}/{sha}", &sha[..2])).unwrap() {
            ReadResult::Bytes(b, _) => assert_eq!(b, b"attachment bytes"),
            _ => panic!(),
        }
        assert_eq!(fresh.list(&format!("history/{DOC}")).unwrap().len(), 1);
        // The wrong key can't read anything.
        let wrong = EncryptedFs::new(fresh.inner.clone(), [6u8; 32]);
        assert_eq!(wrong.read("index/library.findex").unwrap_err().code, "unreadable");
    }
}
