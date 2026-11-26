//! End-to-end encryption on this PC (port of Electron's e2ee.ts and Native/Shell/E2eeKeys.swift,
//! docs/E2EE_DESIGN.md §4.4, §6.2): this PC's device keys.
//!
//! The app owns an X25519 key pair (it receives the account master key, sealed to it as an FLS1 box) and an Ed25519
//! key pair (it signs as this device). Their private halves never leave the app: they are sealed with the app's key
//! (`crate::secrets::Sealer`) in `<dir>/device.bin`; the device id and the public halves are in `<dir>/device.json`.
//! The page can only ask for the public keys, open a sealed box addressed to this device, sign a statement, or
//! forget the keys. The one secret that crosses is what `open` unseals (the account master key).
//!
//! There is no biometric unlock on this platform yet: e2eeSettings answers `{ touchId: false, available: false }`.
//!
//! Nothing here logs a key, a box or what a box holds.
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use parking_lot::Mutex;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::Sha256;
use std::path::PathBuf;
use std::sync::Arc;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::secrets::{restrict, Sealer};
use crate::shell::{b64, now_ms, write_atomic, ShellError, ShellResult};

pub const CONTEXT_PREFIX: &str = "folevi/e2ee/v1/";
/// Device ids are `pc-<ulid>` here (the web's are `web-<ulid>`, the Mac's `mac-<ulid>`, iOS's `ios-<ulid>`).
pub const DEVICE_ID_PREFIX: &str = "pc";
const SEALED_MAGIC: &[u8; 4] = b"FLS1";
const SEALED_VERSION: u8 = 0x01;
const SEALED_HEADER: usize = 49;
const TAG_BYTES: usize = 16;
/// A sealed box the page may hand over: an AMK wrap is about 100 bytes; this leaves room and refuses floods.
const MAX_BOX: usize = 64 * 1024;
const MAX_CONTEXT: usize = 512;
const MAX_STATEMENT: usize = 4096;
pub const STATEMENT_KINDS: [&str; 4] = ["device", "space-grant", "note-grant", "account-key"];
/// Bound into device.bin's seal, so the sealed keys can't pass for any other sealed secret.
const SEAL_AAD: &[u8] = b"folevi/e2ee/device-keys/v1";

const NO_KEYS: &str = "This PC has no encryption keys yet.";
const NOT_A_BOX: &str = "Not a sealed Folevi box.";
const FAILED: &str = "Folevi couldn't use this PC's encryption keys.";
/// A yes from Windows Hello counts this long (the Mac's E2eeKeys.confirmedAt).
const CONFIRMED_FOR_MS: u64 = 30_000;

/// Asking the person (Windows Hello, hello.rs): whether this PC can, and asking with a message.
pub trait Ask {
    fn available(&self) -> bool;
    fn confirm(&self, message: &str) -> bool;
}

/// A PC that can't ask (Linux, or no Windows Hello).
pub struct NoAsk;

impl Ask for NoAsk {
    fn available(&self) -> bool {
        false
    }
    fn confirm(&self, _message: &str) -> bool {
        false
    }
}

fn err(code: &str, message: &str) -> ShellError {
    ShellError::new(code, message)
}

fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
fn from_b64u(text: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(text.trim_end_matches('=')).ok()
}

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A ULID (time, then 80 random bits): 26 Crockford characters.
pub fn ulid(now: u64) -> String {
    let mut time = [0u8; 10];
    let mut t = now;
    for c in time.iter_mut().rev() {
        *c = CROCKFORD[(t % 32) as usize];
        t /= 32;
    }
    let mut rand = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut rand);
    let tail: Vec<u8> = rand.iter().map(|b| CROCKFORD[(*b % 32) as usize]).collect();
    format!("{}{}", String::from_utf8_lossy(&time), String::from_utf8_lossy(&tail))
}

/// The bytes an FST1 signature covers (docs/E2EE_DESIGN.md §4.4).
pub fn statement_message(kind: &str, body: &str) -> Vec<u8> {
    let mut m = format!("folevi/e2ee/v1/statement\n{kind}\n").into_bytes();
    m.extend_from_slice(body.as_bytes());
    m
}

fn check_context(context: Option<&str>) -> Result<&str, ShellError> {
    match context {
        Some(c) if c.starts_with(CONTEXT_PREFIX)
            && c.encode_utf16().count() > CONTEXT_PREFIX.len()
            && c.encode_utf16().count() <= MAX_CONTEXT
            && !c.chars().any(|ch| (ch as u32) < 0x20) =>
        {
            Ok(c)
        }
        _ => Err(err("invalid_argument", "Not an encryption context.")),
    }
}

/// FLS1 open (§4.4): s = X25519(d, E); k = HKDF-SHA256(s, salt E ‖ R, info "seal/" ‖ context);
/// plaintext = AES-256-GCM-open(k, nonce, body, AAD = header ‖ utf8(context)). Refuses an all-zero s.
pub fn open_sealed_box(secret: &StaticSecret, recipient_pub: &[u8; 32], context: &str, sealed: &[u8]) -> Result<Vec<u8>, ShellError> {
    if sealed.len() < SEALED_HEADER + TAG_BYTES || &sealed[..4] != SEALED_MAGIC || sealed[4] != SEALED_VERSION {
        return Err(err("invalid_argument", NOT_A_BOX));
    }
    let header = &sealed[..SEALED_HEADER];
    let mut eph = [0u8; 32];
    eph.copy_from_slice(&sealed[5..37]);
    let nonce = &sealed[37..SEALED_HEADER];
    let shared = secret.diffie_hellman(&PublicKey::from(eph));
    if !shared.was_contributory() {
        return Err(err("failed", "The key agreement failed."));
    }
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(&eph);
    salt.extend_from_slice(recipient_pub);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes())
        .expand(format!("seal/{context}").as_bytes(), &mut key)
        .map_err(|_| err("failed", "The key agreement failed."))?;
    let cipher = Aes256Gcm::new_from_slice(&key).expect("32-byte key");
    key.fill(0);
    let mut aad = header.to_vec();
    aad.extend_from_slice(context.as_bytes());
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: &sealed[SEALED_HEADER..], aad: &aad })
        .map_err(|_| err("failed", "The sealed box failed its integrity check."))
}

/// FLS1 seal (the app only opens boxes; sealing happens in the page with @folevi/local-store/e2ee). For tests, and
/// with a fixed ephemeral key and nonce for the shared vectors.
#[cfg(test)]
pub fn seal_box(recipient_pub: &[u8; 32], context: &str, plaintext: &[u8], ephemeral: Option<[u8; 32]>, nonce: Option<[u8; 12]>) -> Vec<u8> {
    let eph_secret = match ephemeral {
        Some(e) => StaticSecret::from(e),
        None => StaticSecret::random_from_rng(rand::thread_rng()),
    };
    let eph_pub = PublicKey::from(&eph_secret).to_bytes();
    let shared = eph_secret.diffie_hellman(&PublicKey::from(*recipient_pub));
    let mut salt = eph_pub.to_vec();
    salt.extend_from_slice(recipient_pub);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes()).expand(format!("seal/{context}").as_bytes(), &mut key).expect("32 bytes");
    let nonce = nonce.unwrap_or_else(|| {
        let mut n = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut n);
        n
    });
    let mut out = SEALED_MAGIC.to_vec();
    out.push(SEALED_VERSION);
    out.extend_from_slice(&eph_pub);
    out.extend_from_slice(&nonce);
    let mut aad = out.clone();
    aad.extend_from_slice(context.as_bytes());
    let ct = Aes256Gcm::new_from_slice(&key).expect("32-byte key").encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext, aad: &aad }).expect("AES-GCM seals");
    out.extend_from_slice(&ct);
    out
}

/// The keys in memory once loaded.
struct Loaded {
    device_id: String,
    x: StaticSecret,
    x_pub: [u8; 32],
    ed: SigningKey,
    ed_pub: [u8; 32],
}

pub struct DeviceKeys {
    dir: PathBuf,
    sealer: Arc<Sealer>,
    loaded: Mutex<Option<Loaded>>,
    /// When Windows Hello last said yes (ms), for "Ask before unlocking encrypted notes".
    confirmed_at: Mutex<u64>,
    /// Tests: fixed private halves (X25519 scalar, Ed25519 seed) instead of new random ones.
    fixed: Option<([u8; 32], [u8; 32])>,
}

impl DeviceKeys {
    pub fn new(dir: PathBuf, sealer: Arc<Sealer>) -> Self {
        Self { dir, sealer, loaded: Mutex::new(None), confirmed_at: Mutex::new(0), fixed: None }
    }

    /// Tests: keys made from fixed private halves.
    #[cfg(test)]
    fn with_fixed(dir: PathBuf, sealer: Arc<Sealer>, x: [u8; 32], ed: [u8; 32]) -> Self {
        Self { dir, sealer, loaded: Mutex::new(None), confirmed_at: Mutex::new(0), fixed: Some((x, ed)) }
    }

    fn json_file(&self) -> PathBuf {
        self.dir.join("device.json")
    }

    fn bin_file(&self) -> PathBuf {
        self.dir.join("device.bin")
    }

    fn from_raw(device_id: String, mut x_raw: [u8; 32], mut ed_raw: [u8; 32]) -> Loaded {
        let x = StaticSecret::from(x_raw);
        let ed = SigningKey::from_bytes(&ed_raw);
        x_raw.fill(0);
        ed_raw.fill(0);
        Loaded { device_id, x_pub: PublicKey::from(&x).to_bytes(), ed_pub: ed.verifying_key().to_bytes(), x, ed }
    }

    /// The keys on disk, or None when there are none (or they can't be read on this PC any more, or the public
    /// halves on disk aren't the private halves': a swapped file is refused, not trusted).
    fn read(&self) -> Option<Loaded> {
        let meta: Value = serde_json::from_slice(&std::fs::read(self.json_file()).ok()?).ok()?;
        let sealed = std::fs::read(self.bin_file()).ok()?;
        if meta.get("version").and_then(Value::as_u64) != Some(1) {
            return None;
        }
        let device_id = meta.get("deviceId")?.as_str()?.to_string();
        let x_pub = meta.get("x25519Pub")?.as_str()?;
        let ed_pub = meta.get("ed25519Pub")?.as_str()?;
        // Another PC's key, or a damaged file: as good as absent (the page asks to approve this PC again).
        let mut inner = self.sealer.open(&sealed, SEAL_AAD).ok()?;
        if inner.len() != 64 {
            inner.fill(0);
            return None;
        }
        let mut x_raw = [0u8; 32];
        let mut ed_raw = [0u8; 32];
        x_raw.copy_from_slice(&inner[..32]);
        ed_raw.copy_from_slice(&inner[32..]);
        inner.fill(0);
        let keys = Self::from_raw(device_id, x_raw, ed_raw);
        (b64u(&keys.x_pub) == x_pub && b64u(&keys.ed_pub) == ed_pub).then_some(keys)
    }

    fn create(&self) -> Result<Loaded, ShellError> {
        let (x_raw, ed_raw) = self.fixed.unwrap_or_else(|| {
            let mut x = [0u8; 32];
            let mut ed = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut x);
            rand::thread_rng().fill_bytes(&mut ed);
            (x, ed)
        });
        let mut secret = [0u8; 64];
        secret[..32].copy_from_slice(&x_raw);
        secret[32..].copy_from_slice(&ed_raw);
        let keys = Self::from_raw(format!("{DEVICE_ID_PREFIX}-{}", ulid(now_ms())), x_raw, ed_raw);
        let sealed = self.sealer.seal(&secret, SEAL_AAD);
        secret.fill(0);
        let meta = json!({ "version": 1, "deviceId": keys.device_id, "x25519Pub": b64u(&keys.x_pub), "ed25519Pub": b64u(&keys.ed_pub), "createdAt": now_ms() });
        self.write(&self.bin_file(), &sealed)?;
        self.write(&self.json_file(), meta.to_string().as_bytes())?;
        Ok(keys)
    }

    fn write(&self, file: &std::path::Path, bytes: &[u8]) -> Result<(), ShellError> {
        std::fs::create_dir_all(&self.dir).map_err(|_| err("failed", FAILED))?;
        restrict_dir(&self.dir);
        write_atomic(file, bytes).map_err(|_| err("failed", FAILED))?;
        restrict(file);
        Ok(())
    }

    /// Runs `f` with the keys: loaded from disk, or (with `make`) made and kept on the first call.
    fn with_keys<T>(&self, make: bool, f: impl FnOnce(&Loaded) -> Result<T, ShellError>) -> Result<T, ShellError> {
        let mut loaded = self.loaded.lock();
        if loaded.is_none() {
            *loaded = match self.read() {
                Some(k) => Some(k),
                None if make => Some(self.create()?),
                None => return Err(err("unavailable", NO_KEYS)),
            };
        }
        f(loaded.as_ref().expect("loaded"))
    }

    /// This PC's device id and public keys; made (and kept) on the first call.
    pub fn device_keys(&self) -> ShellResult {
        self.with_keys(true, |k| Ok(json!({ "deviceId": k.device_id, "x25519Pub": b64(&k.x_pub), "ed25519Pub": b64(&k.ed_pub) })))
    }

    /// Opens an FLS1 sealed box addressed to this PC's X25519 key: `{ bytes }` (base64).
    pub fn open(&self, o: &Value) -> ShellResult {
        let sealed = o
            .get("box")
            .and_then(Value::as_str)
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
            .filter(|b| (SEALED_HEADER + TAG_BYTES..=MAX_BOX).contains(&b.len()))
            .ok_or_else(|| err("invalid_argument", NOT_A_BOX))?;
        if &sealed[..4] != SEALED_MAGIC || sealed[4] != SEALED_VERSION {
            return Err(err("invalid_argument", NOT_A_BOX));
        }
        let context = check_context(o.get("context").and_then(Value::as_str))?;
        self.with_keys(false, |k| {
            let mut plain = open_sealed_box(&k.x, &k.x_pub, context, &sealed)?;
            let out = json!({ "bytes": b64(&plain) });
            plain.fill(0);
            Ok(out)
        })
    }

    /// An FST1 signature (base64url) by this PC's Ed25519 key over a statement's canonical JSON body: `{ value }`.
    pub fn sign(&self, o: &Value) -> ShellResult {
        let kind = o.get("kind").and_then(Value::as_str).filter(|k| STATEMENT_KINDS.contains(k)).ok_or_else(|| err("invalid_argument", "Unknown statement kind."))?;
        let body = o
            .get("body")
            .and_then(Value::as_str)
            .filter(|b| b.encode_utf16().count() <= MAX_STATEMENT)
            .filter(|b| serde_json::from_str::<Value>(b).is_ok_and(|v| v.is_object()))
            .ok_or_else(|| err("invalid_argument", "Not a statement."))?;
        self.with_keys(false, |k| Ok(json!({ "value": b64u(&k.ed.sign(&statement_message(kind, body)).to_bytes()) })))
    }

    fn prefs_file(&self) -> PathBuf {
        self.dir.join("prefs.json")
    }

    /// "Ask before unlocking encrypted notes" (prefs.json `touchId`, Electron's name for it).
    fn ask_on(&self) -> bool {
        std::fs::read(self.prefs_file()).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v.get("touchId").and_then(Value::as_bool)).unwrap_or(false)
    }

    /// `{ touchId, available }`: whether Folevi asks (Windows Hello) before opening encrypted notes.
    pub fn settings_with(&self, ask: &dyn Ask) -> Value {
        let available = ask.available();
        json!({ "touchId": available && self.ask_on(), "available": available })
    }

    #[allow(dead_code)]
    pub fn settings(&self) -> Value {
        self.settings_with(&NoAsk)
    }

    fn set_ask(&self, on: bool, ask: &dyn Ask) -> ShellResult {
        if !ask.available() {
            return Err(err("unavailable", "Windows Hello isn't set up on this PC."));
        }
        if on != self.ask_on() {
            let message = if on { "Ask for Windows Hello before unlocking encrypted notes" } else { "Stop asking for Windows Hello before unlocking encrypted notes" };
            if !ask.confirm(message) {
                return Err(err("cancelled", "Windows Hello didn't confirm it."));
            }
            std::fs::create_dir_all(&self.dir).map_err(|_| err("failed", FAILED))?;
            write_atomic(&self.prefs_file(), json!({ "touchId": on }).to_string().as_bytes()).map_err(|_| err("failed", FAILED))?;
            if on {
                *self.confirmed_at.lock() = now_ms();
            }
        }
        Ok(self.settings_with(ask))
    }

    /// Before the keys open a box: Windows Hello, when it's asked for (a yes counts for 30 seconds).
    fn confirm(&self, ask: &dyn Ask) -> Result<(), ShellError> {
        if !self.ask_on() || !ask.available() || now_ms().saturating_sub(*self.confirmed_at.lock()) < CONFIRMED_FOR_MS {
            return Ok(());
        }
        if !ask.confirm("Unlock your encrypted notes") {
            return Err(err("cancelled", "Windows Hello didn't confirm it."));
        }
        *self.confirmed_at.lock() = now_ms();
        Ok(())
    }

    /// e2eeDeviceKeys, e2eeOpen, e2eeSign, e2eeReset, e2eeSettings, e2eeSetTouchId. Errors are `{ code, message }`
    /// with e2ee.ts's codes: "unavailable", "invalid_argument", "cancelled", "failed".
    #[allow(dead_code)]
    pub fn call(&self, method: &str, o: &Value) -> ShellResult {
        self.call_asking(method, o, &NoAsk)
    }

    /// The same, asking with `ask` (Windows Hello) where Folevi asks.
    pub fn call_asking(&self, method: &str, o: &Value, ask: &dyn Ask) -> ShellResult {
        match method {
            "e2eeDeviceKeys" => self.device_keys(),
            "e2eeOpen" => {
                self.confirm(ask)?;
                self.open(o)
            }
            "e2eeSign" => self.sign(o),
            "e2eeReset" => {
                self.reset();
                Ok(Value::Null)
            }
            "e2eeSettings" => Ok(self.settings_with(ask)),
            "e2eeSetTouchId" => {
                let Some(on) = o.get("on").and_then(Value::as_bool) else { return Err(err("invalid_argument", "touchId is true or false.")) };
                self.set_ask(on, ask)
            }
            _ => Err(err("invalid_argument", &format!("{method} isn't an encryption call."))),
        }
    }

    /// Forgets this PC's device keys (signed out for good, or the device was removed). The next call makes new ones.
    pub fn reset(&self) {
        let mut loaded = self.loaded.lock();
        *loaded = None;
        for f in [self.bin_file(), self.json_file()] {
            match std::fs::remove_file(&f) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => log::warn!("Folevi: couldn't delete an encryption key file ({e})"),
            }
        }
    }
}

/// Only this user may open the folder (Unix; Windows' user profile folder is private already).
fn restrict_dir(dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    const VECTORS: &str = include_str!("../../../../packages/local-store/fixtures/e2ee-vectors.json");

    fn vectors() -> Value {
        serde_json::from_str(VECTORS).unwrap()
    }

    fn hex32(h: &str) -> [u8; 32] {
        hex::decode(h).unwrap().try_into().unwrap()
    }

    fn sealer(k: u8) -> Arc<Sealer> {
        Arc::new(Sealer::with_key([k; 32]))
    }

    fn from_b64(s: &Value) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.decode(s.as_str().unwrap()).unwrap()
    }

    fn open_args(sealed: &[u8], context: &str) -> Value {
        json!({ "box": b64(sealed), "context": context })
    }

    #[test]
    fn made_on_the_first_call_kept_sealed_and_the_same_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let a = DeviceKeys::new(dir.path().join("e2ee"), sealer(1));
        let first = a.call("e2eeDeviceKeys", &json!({})).unwrap();
        let id = first["deviceId"].as_str().unwrap();
        assert!(id.starts_with("pc-") && id.len() == 29);
        assert!(id[3..].bytes().all(|b| CROCKFORD.contains(&b)));
        assert_eq!(from_b64(&first["x25519Pub"]).len(), 32);
        assert_eq!(from_b64(&first["ed25519Pub"]).len(), 32);
        // The private halves are only in device.bin, sealed; device.json holds the id and the public halves.
        let meta: Value = serde_json::from_slice(&std::fs::read(dir.path().join("e2ee/device.json")).unwrap()).unwrap();
        let mut keys: Vec<&String> = meta.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["createdAt", "deviceId", "ed25519Pub", "version", "x25519Pub"]);
        assert_eq!(&std::fs::read(dir.path().join("e2ee/device.bin")).unwrap()[..4], b"FSL1");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir.path().join("e2ee/device.bin")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // A new process (a restart) reads the same keys.
        let b = DeviceKeys::new(dir.path().join("e2ee"), sealer(1));
        assert_eq!(b.call("e2eeDeviceKeys", &json!({})).unwrap(), first);
    }

    #[test]
    fn keys_another_pc_cant_open_are_replaced_never_trusted() {
        let dir = tempfile::tempdir().unwrap();
        let first = DeviceKeys::new(dir.path().to_path_buf(), sealer(1)).device_keys().unwrap();
        let other = DeviceKeys::new(dir.path().to_path_buf(), sealer(2)).device_keys().unwrap();
        assert_ne!(other["deviceId"], first["deviceId"]);
        assert_ne!(other["x25519Pub"], first["x25519Pub"]);
    }

    #[test]
    fn a_device_json_swapped_for_someone_elses_public_keys_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let first = DeviceKeys::new(dir.path().to_path_buf(), sealer(1)).device_keys().unwrap();
        let file = dir.path().join("device.json");
        let mut meta: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        meta["x25519Pub"] = json!(b64u(&[7u8; 32]));
        std::fs::write(&file, meta.to_string()).unwrap();
        let again = DeviceKeys::new(dir.path().to_path_buf(), sealer(1)).device_keys().unwrap();
        assert_ne!(again["deviceId"], first["deviceId"]);
    }

    #[test]
    fn reset_forgets_them_and_the_next_call_makes_new_ones() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let first = k.device_keys().unwrap();
        assert_eq!(k.call("e2eeReset", &json!({})).unwrap(), Value::Null);
        assert!(!dir.path().join("device.bin").exists());
        assert!(!dir.path().join("device.json").exists());
        // Opening or signing doesn't make keys.
        assert_eq!(k.call("e2eeSign", &json!({ "kind": "device", "body": "{}" })).unwrap_err().code, "unavailable");
        assert_ne!(k.device_keys().unwrap()["deviceId"], first["deviceId"]);
    }

    #[test]
    fn ulid_is_26_crockford_characters_time_first() {
        assert!(ulid(0).starts_with("0000000000"));
        assert_eq!(ulid(0).len(), 26);
        assert!(ulid(1_700_000_000_000) < ulid(1_800_000_000_000));
    }

    #[test]
    fn opens_the_shared_vector_boxes_with_the_recipient_key() {
        let v = vectors();
        let boxes = v["boxes"].as_array().unwrap();
        assert!(!boxes.is_empty());
        for b in boxes {
            let dir = tempfile::tempdir().unwrap();
            let k = DeviceKeys::with_fixed(dir.path().to_path_buf(), sealer(1), hex32(b["recipientSeedHex"].as_str().unwrap()), [9; 32]);
            assert_eq!(hex::encode(from_b64(&k.device_keys().unwrap()["x25519Pub"])), b["recipientPubHex"].as_str().unwrap());
            let sealed = hex::decode(b["boxHex"].as_str().unwrap()).unwrap();
            let context = b["context"].as_str().unwrap();
            let out = k.call("e2eeOpen", &open_args(&sealed, context)).unwrap();
            assert_eq!(hex::encode(from_b64(&out["bytes"])), b["plaintextHex"].as_str().unwrap(), "{}", b["name"]);
            // Sealing with the vector's ephemeral key and nonce gives the same bytes as the web.
            if let (Some(e), Some(n)) = (b["ephemeralSeedHex"].as_str(), b["nonceHex"].as_str()) {
                let again = seal_box(&hex32(b["recipientPubHex"].as_str().unwrap()), context, &hex::decode(b["plaintextHex"].as_str().unwrap()).unwrap(), Some(hex32(e)), Some(hex::decode(n).unwrap().try_into().unwrap()));
                assert_eq!(again, sealed);
            }
        }
    }

    #[test]
    fn a_box_moved_to_another_context_or_changed_doesnt_open() {
        let v = vectors();
        let b = &v["boxes"][0];
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::with_fixed(dir.path().to_path_buf(), sealer(1), hex32(b["recipientSeedHex"].as_str().unwrap()), [9; 32]);
        k.device_keys().unwrap();
        let sealed = hex::decode(b["boxHex"].as_str().unwrap()).unwrap();
        let context = b["context"].as_str().unwrap();
        assert_eq!(k.open(&open_args(&sealed, &format!("{context}x"))).unwrap_err().code, "failed");
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(k.open(&open_args(&bad, context)).unwrap_err().code, "failed");
    }

    #[test]
    fn round_trip_with_a_box_sealed_to_this_pc_and_odd_input_refused() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let keys = k.device_keys().unwrap();
        let x_pub: [u8; 32] = from_b64(&keys["x25519Pub"]).try_into().unwrap();
        let context = format!("folevi/e2ee/v1/amk/device/p1/{}", keys["deviceId"].as_str().unwrap());
        let amk: Vec<u8> = (0..32).collect();
        let sealed = seal_box(&x_pub, &context, &amk, None, None);
        assert_eq!(from_b64(&k.open(&open_args(&sealed, &context)).unwrap()["bytes"]), amk);
        let code = |o: Value| k.open(&o).unwrap_err().code;
        assert_eq!(code(json!({ "box": "not base64!", "context": context })), "invalid_argument");
        assert_eq!(code(json!({ "box": 42, "context": context })), "invalid_argument");
        assert_eq!(code(open_args(&[0u8; 70], &context)), "invalid_argument");
        assert_eq!(code(open_args(&sealed, "amk/device")), "invalid_argument");
        assert_eq!(code(open_args(&sealed, CONTEXT_PREFIX)), "invalid_argument");
        assert_eq!(code(open_args(&sealed, &format!("{context}\n"))), "invalid_argument");
        assert_eq!(code(json!({ "box": b64(&sealed) })), "invalid_argument");
        assert_eq!(code(open_args(&vec![0u8; 70 * 1024], &context)), "invalid_argument");
    }

    #[test]
    fn opening_without_keys_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let sealed = seal_box(&[9; 32], "folevi/e2ee/v1/x", b"hi", None, None);
        assert_eq!(k.open(&open_args(&sealed, "folevi/e2ee/v1/x")).unwrap_err().code, "unavailable");
        assert!(!dir.path().join("device.bin").exists());
    }

    #[test]
    fn a_low_order_ephemeral_key_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let x_pub: [u8; 32] = from_b64(&k.device_keys().unwrap()["x25519Pub"]).try_into().unwrap();
        let context = "folevi/e2ee/v1/amk/device/p1/d1";
        let mut sealed = seal_box(&x_pub, context, &[0u8; 32], None, None);
        sealed[5..37].fill(0);
        assert_eq!(k.open(&open_args(&sealed, context)).unwrap_err().code, "failed");
    }

    #[test]
    fn the_signed_bytes_are_the_webs_its_vector_signatures_verify() {
        let v = vectors();
        let statements = v["statements"].as_array().unwrap();
        assert!(!statements.is_empty());
        for s in statements {
            let pub_key = VerifyingKey::from_bytes(&hex32(s["signerPubHex"].as_str().unwrap())).unwrap();
            let sig = Signature::from_slice(&from_b64u(s["sig"].as_str().unwrap()).unwrap()).unwrap();
            assert!(pub_key.verify(&statement_message(s["kind"].as_str().unwrap(), s["body"].as_str().unwrap()), &sig).is_ok());
        }
    }

    #[test]
    fn signs_a_statement_with_the_device_key_and_refuses_unknown_kinds_and_non_objects() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let ed_pub: [u8; 32] = from_b64(&k.device_keys().unwrap()["ed25519Pub"]).try_into().unwrap();
        let body = json!({ "deviceId": "d1", "profileId": "p1" }).to_string();
        let sig = k.call("e2eeSign", &json!({ "kind": "device", "body": body })).unwrap()["value"].as_str().unwrap().to_string();
        assert!(!sig.contains('=') && !sig.contains('+') && !sig.contains('/'));
        let sig = Signature::from_slice(&from_b64u(&sig).unwrap()).unwrap();
        assert!(VerifyingKey::from_bytes(&ed_pub).unwrap().verify(&statement_message("device", &body), &sig).is_ok());
        let code = |o: Value| k.sign(&o).unwrap_err().code;
        assert_eq!(code(json!({ "kind": "anything", "body": body })), "invalid_argument");
        assert_eq!(code(json!({ "kind": "device", "body": "[1]" })), "invalid_argument");
        assert_eq!(code(json!({ "kind": "device", "body": "x".repeat(5000) })), "invalid_argument");
    }

    #[test]
    fn windows_hello_is_asked_before_encrypted_notes_open() {
        struct Fake {
            yes: std::cell::Cell<bool>,
            asked: std::cell::RefCell<Vec<String>>,
        }
        impl Ask for Fake {
            fn available(&self) -> bool {
                true
            }
            fn confirm(&self, m: &str) -> bool {
                self.asked.borrow_mut().push(m.to_string());
                self.yes.get()
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let hello = Fake { yes: std::cell::Cell::new(false), asked: Default::default() };
        assert_eq!(k.call_asking("e2eeSettings", &json!({}), &hello).unwrap(), json!({ "touchId": false, "available": true }));
        // A no changes nothing.
        assert_eq!(k.call_asking("e2eeSetTouchId", &json!({ "on": true }), &hello).unwrap_err().code, "cancelled");
        assert_eq!(k.call_asking("e2eeSettings", &json!({}), &hello).unwrap()["touchId"], false);
        hello.yes.set(true);
        assert_eq!(k.call_asking("e2eeSetTouchId", &json!({ "on": true }), &hello).unwrap()["touchId"], true);
        assert_eq!(hello.asked.borrow().len(), 2);
        // Kept with the keys (Electron's prefs.json), and read again by a new copy.
        let again = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        assert_eq!(again.call_asking("e2eeSettings", &json!({}), &hello).unwrap()["touchId"], true);
        // Opening a box asks (the yes that turned it on still counts here, so a fresh copy is asked).
        hello.yes.set(false);
        let bad_box = json!({ "box": "", "context": "x" });
        assert_eq!(again.call_asking("e2eeOpen", &bad_box, &hello).unwrap_err().code, "cancelled");
        assert_eq!(hello.asked.borrow().last().unwrap(), "Unlock your encrypted notes");
        hello.yes.set(true);
        assert_eq!(again.call_asking("e2eeOpen", &bad_box, &hello).unwrap_err().code, "invalid_argument");
        let n = hello.asked.borrow().len();
        assert_eq!(again.call_asking("e2eeOpen", &bad_box, &hello).unwrap_err().code, "invalid_argument");
        assert_eq!(hello.asked.borrow().len(), n, "a yes counts for 30 seconds");
        // Without Windows Hello it never asks, and says so.
        assert_eq!(again.call("e2eeSettings", &json!({})).unwrap(), json!({ "touchId": false, "available": false }));
    }

    #[test]
    fn no_biometric_unlock_here() {
        let dir = tempfile::tempdir().unwrap();
        let k = DeviceKeys::new(dir.path().to_path_buf(), sealer(1));
        let off = json!({ "touchId": false, "available": false });
        assert_eq!(k.call("e2eeSettings", &json!({})).unwrap(), off);
        assert_eq!(k.call("e2eeSetTouchId", &json!({ "on": true })).unwrap_err().code, "unavailable");
        assert_eq!(k.call("e2eeSetTouchId", &json!({ "on": "yes" })).unwrap_err().code, "invalid_argument");
        assert_eq!(k.call("e2eeWhatever", &json!({})).unwrap_err().code, "invalid_argument");
    }
}
