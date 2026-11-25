//! The unwrapped library key, cached on this PC so the passphrase is asked for once (docs/LOCAL_MODE_PLAN.md §3.9
//! "Unlocking"): sealed with the app's data key (secrets.rs, kept in the system's credential store) in the app's
//! data folder, never in the library and never sent to the page.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::paths::is_valid_id;
use crate::secrets::Sealer;
use crate::shell::write_atomic;

pub struct KeyCache {
    dir: PathBuf,
    sealer: Arc<Sealer>,
    memory: HashMap<String, [u8; 32]>,
}

fn aad(library_id: &str) -> Vec<u8> {
    format!("folevi-library-key:{library_id}").into_bytes()
}

impl KeyCache {
    pub fn new(dir: PathBuf, sealer: Arc<Sealer>) -> Self {
        Self { dir, sealer, memory: HashMap::new() }
    }

    fn file(&self, library_id: &str) -> Option<PathBuf> {
        is_valid_id(library_id).then(|| self.dir.join(format!("{library_id}.key")))
    }

    pub fn get(&mut self, library_id: &str) -> Option<[u8; 32]> {
        if let Some(k) = self.memory.get(library_id) {
            return Some(*k);
        }
        let sealed = std::fs::read(self.file(library_id)?).ok()?;
        let plain = self.sealer.open(&sealed, &aad(library_id)).ok()?;
        let key: [u8; 32] = plain.as_slice().try_into().ok()?;
        self.memory.insert(library_id.to_string(), key);
        Some(key)
    }

    pub fn set(&mut self, library_id: &str, key: [u8; 32]) {
        self.memory.insert(library_id.to_string(), key);
        let Some(file) = self.file(library_id) else { return };
        if write_atomic(&file, &self.sealer.seal(&key, &aad(library_id))).is_ok() {
            crate::secrets::restrict(&file);
        }
        // Otherwise the key stays in memory only this time.
    }

    pub fn clear(&mut self, library_id: &str) {
        self.memory.remove(library_id);
        if let Some(f) = self.file(library_id) {
            let _ = std::fs::remove_file(f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_survive_a_restart_sealed_and_go_when_cleared() {
        let d = tempfile::tempdir().unwrap();
        let sealer = Arc::new(Sealer::with_key([3; 32]));
        let mut a = KeyCache::new(d.path().to_path_buf(), sealer.clone());
        a.set("LIB1", [9; 32]);
        let on_disk = std::fs::read(d.path().join("LIB1.key")).unwrap();
        assert!(!on_disk.windows(32).any(|w| w == [9u8; 32]));
        let mut b = KeyCache::new(d.path().to_path_buf(), sealer);
        assert_eq!(b.get("LIB1"), Some([9; 32]));
        // Another PC's (another sealer's) file doesn't open.
        let mut other = KeyCache::new(d.path().to_path_buf(), Arc::new(Sealer::with_key([4; 32])));
        assert_eq!(other.get("LIB1"), None);
        b.clear("LIB1");
        assert_eq!(b.get("LIB1"), None);
        assert_eq!(b.get("../x"), None);
    }
}
