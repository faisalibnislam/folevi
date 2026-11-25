//! Keeping things secret on this PC: the session tokens, the person's Foli AI keys, the library's unlocked key and
//! the encryption device keys are sealed with AES-256-GCM under one random key of the app's. That key lives in the
//! system's credential store (Windows Credential Manager, the Secret Service on Linux), like Electron's
//! safeStorage used Windows' DPAPI. Where there is none (a Linux without a keyring, a test run with
//! FOLEVI_USER_DATA, a development run on a Mac), it's a file only this user can read in the app's data folder.
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use std::path::{Path, PathBuf};

use crate::shell::{write_atomic, ShellError};

const KEYRING_SERVICE: &str = "Folevi";
const KEYRING_USER: &str = "data-key";
const SEAL_MAGIC: &[u8; 4] = b"FSL1";

/// Seals and opens bytes with the app's key (the role Electron's safeStorage had).
pub struct Sealer {
    key: [u8; 32],
}

impl Sealer {
    /// The app's key: from the credential store, made there on first use; or the key file in `dir`.
    pub fn load(dir: &Path, use_keyring: bool) -> Result<Self, ShellError> {
        if use_keyring {
            if let Some(key) = Self::from_keyring() {
                return Ok(Self { key });
            }
            log::warn!("Folevi: no system credential store; keeping the data key in a private file instead.");
        }
        Self::from_file(&dir.join("data.key"))
    }

    fn from_keyring() -> Option<[u8; 32]> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
        match entry.get_secret() {
            Ok(bytes) if bytes.len() == 32 => {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                Some(k)
            }
            Ok(_) => None,
            Err(keyring::Error::NoEntry) => {
                let mut k = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut k);
                entry.set_secret(&k).ok()?;
                // Read back: a store that accepts but doesn't keep it is no store.
                match entry.get_secret() {
                    Ok(b) if b.as_slice() == k.as_slice() => Some(k),
                    _ => None,
                }
            }
            Err(_) => None,
        }
    }

    fn from_file(file: &Path) -> Result<Self, ShellError> {
        if let Ok(bytes) = std::fs::read(file) {
            if bytes.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                return Ok(Self { key: k });
            }
        }
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        write_atomic(file, &k).map_err(|e| ShellError::unavailable(format!("Folevi couldn't keep its data key: {e}")))?;
        restrict(file);
        Ok(Self { key: k })
    }

    /// A sealer with a given key (tests).
    pub fn with_key(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// "FSL1" nonce(12) ciphertext+tag, with `aad` bound in.
    pub fn seal(&self, plain: &[u8], aad: &[u8]) -> Vec<u8> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).expect("32-byte key");
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let ct = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad }).expect("AES-GCM seals");
        let mut out = Vec::with_capacity(16 + ct.len());
        out.extend_from_slice(SEAL_MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        out
    }

    pub fn open(&self, sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>, ShellError> {
        if sealed.len() < 16 + 16 || &sealed[..4] != SEAL_MAGIC {
            return Err(ShellError::io("That sealed data isn't Folevi's."));
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key).expect("32-byte key");
        cipher
            .decrypt(Nonce::from_slice(&sealed[4..16]), Payload { msg: &sealed[16..], aad })
            .map_err(|_| ShellError::io("Folevi couldn't open sealed data (made on another PC, or damaged)."))
    }
}

/// Only this user may read it (Unix permissions; Windows' user profile folder is private already).
pub fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// The names secrets may have (Electron's secrets.ts SECRET_NAMES): the single session older builds kept, each
/// account's session, and the three Foli AI keys.
pub fn is_secret_name(name: &str) -> bool {
    matches!(name, "auth.session" | "ai.openai" | "ai.anthropic" | "ai.google")
        || name.strip_prefix("auth.session.").is_some_and(|id| !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
}

/// The names the page itself may store, ask about and delete (never read): the Foli AI keys.
pub fn is_page_secret(name: &str) -> bool {
    matches!(name, "ai.openai" | "ai.anthropic" | "ai.google")
}

/// Secrets in userData/secrets, one sealed file each.
pub struct SecretStore {
    dir: PathBuf,
    sealer: std::sync::Arc<Sealer>,
}

impl SecretStore {
    pub fn new(dir: PathBuf, sealer: std::sync::Arc<Sealer>) -> Self {
        Self { dir, sealer }
    }

    fn file(&self, name: &str) -> Option<PathBuf> {
        is_secret_name(name).then(|| self.dir.join(format!("{name}.bin")))
    }

    pub fn get(&self, name: &str) -> Option<String> {
        let bytes = std::fs::read(self.file(name)?).ok()?;
        let plain = self.sealer.open(&bytes, name.as_bytes()).ok()?;
        String::from_utf8(plain).ok()
    }

    pub fn has(&self, name: &str) -> bool {
        self.get(name).is_some_and(|v| !v.is_empty())
    }

    pub fn set(&self, name: &str, value: &str) -> Result<(), ShellError> {
        let file = self.file(name).ok_or_else(|| ShellError::invalid("That isn't a secret Folevi keeps."))?;
        if value.is_empty() {
            return self.delete(name);
        }
        if value.len() > 16 * 1024 {
            return Err(ShellError::invalid("That's too long to keep."));
        }
        write_atomic(&file, &self.sealer.seal(value.as_bytes(), name.as_bytes()))?;
        restrict(&file);
        Ok(())
    }

    pub fn delete(&self, name: &str) -> Result<(), ShellError> {
        if let Some(file) = self.file(name) {
            match std::fs::remove_file(file) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seals_and_opens_with_its_aad() {
        let s = Sealer::with_key([7; 32]);
        let sealed = s.seal(b"hello", b"name");
        assert_eq!(&sealed[..4], b"FSL1");
        assert_eq!(s.open(&sealed, b"name").unwrap(), b"hello");
        assert!(s.open(&sealed, b"other").is_err());
        assert!(Sealer::with_key([8; 32]).open(&sealed, b"name").is_err());
    }

    #[test]
    fn names() {
        assert!(is_secret_name("auth.session"));
        assert!(is_secret_name("auth.session.k97abc_12"));
        assert!(!is_secret_name("auth.session."));
        assert!(!is_secret_name("auth.session.../x"));
        assert!(!is_secret_name("anything"));
        assert!(is_page_secret("ai.google"));
        assert!(!is_page_secret("auth.session"));
    }

    #[test]
    fn store_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path().join("secrets"), std::sync::Arc::new(Sealer::with_key([1; 32])));
        assert!(!store.has("ai.openai"));
        store.set("ai.openai", "sk-test").unwrap();
        assert_eq!(store.get("ai.openai").as_deref(), Some("sk-test"));
        store.delete("ai.openai").unwrap();
        assert!(!store.has("ai.openai"));
        assert!(store.set("nope", "x").is_err());
        let key = Sealer::from_file(&dir.path().join("k")).unwrap();
        let again = Sealer::from_file(&dir.path().join("k")).unwrap();
        assert_eq!(key.key, again.key);
    }
}
