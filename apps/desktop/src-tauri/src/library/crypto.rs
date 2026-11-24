//! The encrypted library's FLV1 envelope (docs/LOCAL_MODE_PLAN.md §3.9, §3.10), byte for byte the format every
//! Folevi app reads and writes (packages/local-store/src/crypto/envelope.ts is the reference; the tests check
//! packages/local-store/fixtures/crypto-vectors.json).
//!
//!   passphrase --PBKDF2-SHA256--> wrapping key; AES-256-GCM(wrapping key, AAD "folevi-library-key/v1") seals the master key
//!   master --HKDF-SHA256(salt "folevi/v1", info "file:" + path)--> per-file key; info "names" --> HMAC key; "key-check"
//!   single:  "FLV1" 0x01 nonce(12) | ciphertext | tag, AAD = the 17 header bytes
//!   stream:  "FLV1" 0x02 chunkSize(u32 BE) noncePrefix(8) | chunks: nonce prefix‖u32 BE(i), AAD header‖lastFlag
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;

pub const MODE_SINGLE: u8 = 0x01;
pub const MODE_STREAM: u8 = 0x02;
pub const STREAM_CHUNK: usize = 64 * 1024;
pub const TAG_BYTES: usize = 16;
pub const HEADER_BYTES: usize = 17;
pub const DEFAULT_ITERATIONS: u32 = 600_000;
const MAGIC: &[u8; 4] = b"FLV1";
const HKDF_SALT: &[u8] = b"folevi/v1";
const WRAP_AAD: &[u8] = b"folevi-library-key/v1";
const CROCKFORD: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

#[derive(Debug, Clone, PartialEq)]
pub struct EnvelopeError(pub &'static str);

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for EnvelopeError {}

type R<T> = Result<T, EnvelopeError>;

/// local-store's `EncryptionHeader` (folevi-library.json `encryption`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Header {
    pub alg: String,
    pub kdf: Kdf,
    #[serde(rename = "wrappedKey")]
    pub wrapped_key: String,
    #[serde(rename = "keyCheck")]
    pub key_check: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Kdf {
    pub name: String,
    pub iterations: u32,
    pub salt: String,
}

fn b64(b: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(b)
}

fn unb64(s: &str) -> R<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| EnvelopeError("The library key isn't readable."))
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    rand::thread_rng().fill_bytes(&mut b);
    b
}

fn hkdf(master: &[u8], info: &str, out: &mut [u8]) -> R<()> {
    if master.len() != 32 {
        return Err(EnvelopeError("The master key must be 32 bytes."));
    }
    hkdf::Hkdf::<Sha256>::new(Some(HKDF_SALT), master).expand(info.as_bytes(), out).map_err(|_| EnvelopeError("Key derivation failed."))
}

pub fn file_key(master: &[u8], path_id: &str) -> R<[u8; 32]> {
    let mut k = [0u8; 32];
    hkdf(master, &format!("file:{path_id}"), &mut k)?;
    Ok(k)
}

fn gcm_seal(key: &[u8], nonce: &[u8], plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
    let c = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    c.encrypt(Nonce::from_slice(nonce), Payload { msg: plaintext, aad }).expect("AES-GCM seals")
}

fn gcm_open(key: &[u8], nonce: &[u8], sealed: &[u8], aad: &[u8]) -> R<Vec<u8>> {
    if sealed.len() < TAG_BYTES {
        return Err(EnvelopeError("The file is incomplete."));
    }
    let c = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    c.decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad })
        .map_err(|_| EnvelopeError("The file failed its integrity check (damaged, incomplete, or a different key)."))
}

// ---------------------------------------------------------------- passphrase and master key

pub fn derive_wrapping_key(passphrase: &str, salt: &[u8], iterations: u32) -> R<[u8; 32]> {
    if iterations < 1 {
        return Err(EnvelopeError("Invalid iteration count."));
    }
    let normalized: String = passphrase.nfc().collect();
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(normalized.as_bytes(), salt, iterations, &mut out);
    Ok(out)
}

pub fn key_check(master: &[u8]) -> R<String> {
    let mut k = [0u8; 32];
    hkdf(master, "key-check", &mut k)?;
    Ok(b64(&k[..16]))
}

pub fn wrap_master_key(master: &[u8], passphrase: &str, iterations: u32, salt: Option<[u8; 16]>, nonce: Option<[u8; 12]>) -> R<Header> {
    let salt = salt.unwrap_or_else(random_bytes::<16>);
    let nonce = nonce.unwrap_or_else(random_bytes::<12>);
    let wrapping = derive_wrapping_key(passphrase, &salt, iterations)?;
    let sealed = gcm_seal(&wrapping, &nonce, master, WRAP_AAD);
    let mut wrapped = nonce.to_vec();
    wrapped.extend_from_slice(&sealed);
    Ok(Header {
        alg: "A256GCM".into(),
        kdf: Kdf { name: "PBKDF2-SHA256".into(), iterations, salt: b64(&salt) },
        wrapped_key: b64(&wrapped),
        key_check: key_check(master)?,
    })
}

/// A new master key and its header.
pub fn create_encryption(passphrase: &str, iterations: u32) -> R<(Header, [u8; 32])> {
    let master = random_bytes::<32>();
    Ok((wrap_master_key(&master, passphrase, iterations, None, None)?, master))
}

/// The master key, or None when the passphrase is wrong.
pub fn unlock_master_key(header: &Header, passphrase: &str) -> R<Option<[u8; 32]>> {
    if header.alg != "A256GCM" || header.kdf.name != "PBKDF2-SHA256" {
        return Err(EnvelopeError("Unsupported library encryption."));
    }
    let wrapped = unb64(&header.wrapped_key)?;
    if wrapped.len() != 12 + 32 + TAG_BYTES {
        return Err(EnvelopeError("The wrapped key is damaged."));
    }
    let wrapping = derive_wrapping_key(passphrase, &unb64(&header.kdf.salt)?, header.kdf.iterations)?;
    let Ok(master) = gcm_open(&wrapping, &wrapped[..12], &wrapped[12..], WRAP_AAD) else { return Ok(None) };
    if key_check(&master)? != header.key_check {
        return Ok(None);
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&master);
    Ok(Some(k))
}

/// Whether a key belongs to a library (its keyCheck), without the passphrase.
pub fn key_matches(header: &Header, master: &[u8]) -> bool {
    master.len() == 32 && key_check(master).map(|c| c == header.key_check).unwrap_or(false)
}

// ---------------------------------------------------------------- names

/// HMAC-SHA256(names key, "<kind>:<id>"), first 130 bits as 26 lowercase Crockford characters.
pub fn hmac_name(master: &[u8], kind: &str, id: &str) -> R<String> {
    let mut names = [0u8; 32];
    hkdf(master, "names", &mut names)?;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&names).expect("any key size");
    mac.update(format!("{kind}:{id}").as_bytes());
    let digest = mac.finalize().into_bytes();
    let mut out = String::with_capacity(26);
    let (mut acc, mut bits, mut i) = (0u32, 0u32, 0usize);
    while out.len() < 26 {
        if bits < 5 {
            acc = (acc << 8) | digest[i] as u32;
            i += 1;
            bits += 8;
        }
        bits -= 5;
        out.push(CROCKFORD[((acc >> bits) & 31) as usize] as char);
        acc &= (1 << bits) - 1;
    }
    Ok(out)
}

// ---------------------------------------------------------------- one-shot envelope

pub fn is_envelope(bytes: &[u8]) -> bool {
    bytes.len() >= 5 && &bytes[..4] == MAGIC
}

pub fn seal_file(master: &[u8], path_id: &str, plaintext: &[u8], nonce: Option<[u8; 12]>) -> R<Vec<u8>> {
    let nonce = nonce.unwrap_or_else(random_bytes::<12>);
    let mut h = MAGIC.to_vec();
    h.push(MODE_SINGLE);
    h.extend_from_slice(&nonce);
    let sealed = gcm_seal(&file_key(master, path_id)?, &nonce, plaintext, &h);
    h.extend_from_slice(&sealed);
    Ok(h)
}

/// Opens a single or stream envelope held in memory.
pub fn open_file(master: &[u8], path_id: &str, envelope: &[u8]) -> R<Vec<u8>> {
    if !is_envelope(envelope) {
        return Err(EnvelopeError("Not an encrypted Folevi file."));
    }
    match envelope[4] {
        MODE_STREAM => open_stream(master, path_id, envelope),
        MODE_SINGLE => {
            if envelope.len() < HEADER_BYTES + TAG_BYTES {
                return Err(EnvelopeError("The file is incomplete."));
            }
            let h = &envelope[..HEADER_BYTES];
            gcm_open(&file_key(master, path_id)?, &h[5..], &envelope[HEADER_BYTES..], h)
        }
        _ => Err(EnvelopeError("Unknown envelope mode.")),
    }
}

// ---------------------------------------------------------------- STREAM envelope

fn chunk_nonce(prefix: &[u8], index: u32) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[..8].copy_from_slice(prefix);
    n[8..].copy_from_slice(&index.to_be_bytes());
    n
}

fn chunk_aad(h: &[u8], last: bool) -> Vec<u8> {
    let mut a = h.to_vec();
    a.push(last as u8);
    a
}

pub fn seal_stream(master: &[u8], path_id: &str, plaintext: &[u8], nonce_prefix: Option<[u8; 8]>, chunk_size: Option<usize>) -> R<Vec<u8>> {
    let chunk_size = chunk_size.unwrap_or(STREAM_CHUNK);
    if chunk_size < 1 || chunk_size > u32::MAX as usize {
        return Err(EnvelopeError("Invalid chunk size."));
    }
    let prefix = nonce_prefix.unwrap_or_else(random_bytes::<8>);
    let count = plaintext.len().div_ceil(chunk_size).max(1);
    if count > u32::MAX as usize {
        return Err(EnvelopeError("The file is too large."));
    }
    let mut h = MAGIC.to_vec();
    h.push(MODE_STREAM);
    h.extend_from_slice(&(chunk_size as u32).to_be_bytes());
    h.extend_from_slice(&prefix);
    let key = file_key(master, path_id)?;
    let mut out = Vec::with_capacity(HEADER_BYTES + plaintext.len() + count * TAG_BYTES);
    out.extend_from_slice(&h);
    for i in 0..count {
        let chunk = &plaintext[(i * chunk_size).min(plaintext.len())..((i + 1) * chunk_size).min(plaintext.len())];
        out.extend_from_slice(&gcm_seal(&key, &chunk_nonce(&prefix, i as u32), chunk, &chunk_aad(&h, i == count - 1)));
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct StreamLayout {
    pub header: [u8; HEADER_BYTES],
    pub chunk_size: usize,
    pub count: usize,
    pub plain_length: usize,
    pub envelope_length: usize,
}

/// A stream envelope's shape from its 17 header bytes and its total length (nothing else is read).
pub fn stream_layout(header: &[u8], envelope_length: usize) -> R<StreamLayout> {
    if header.len() < HEADER_BYTES || !is_envelope(header) || header[4] != MODE_STREAM {
        return Err(EnvelopeError("Not an encrypted Folevi stream."));
    }
    if envelope_length < HEADER_BYTES + TAG_BYTES {
        return Err(EnvelopeError("The file is incomplete."));
    }
    let mut h = [0u8; HEADER_BYTES];
    h.copy_from_slice(&header[..HEADER_BYTES]);
    let chunk_size = u32::from_be_bytes([h[5], h[6], h[7], h[8]]) as usize;
    if chunk_size < 1 {
        return Err(EnvelopeError("Invalid chunk size."));
    }
    let body = envelope_length - HEADER_BYTES;
    let full = chunk_size + TAG_BYTES;
    let count = body.div_ceil(full).max(1);
    let last_length = body - (count - 1) * full;
    if last_length < TAG_BYTES {
        return Err(EnvelopeError("The file is incomplete."));
    }
    Ok(StreamLayout { header: h, chunk_size, count, plain_length: (count - 1) * chunk_size + last_length - TAG_BYTES, envelope_length })
}

/// A stream envelope opened for range reads: chunks are read, authenticated and decrypted only as needed.
/// `read_at(position, length)` reads the envelope's bytes (fewer only at the end).
pub struct StreamReader<F: FnMut(usize, usize) -> std::io::Result<Vec<u8>>> {
    pub layout: StreamLayout,
    key: [u8; 32],
    read_at: F,
    final_checked: bool,
}

impl<F: FnMut(usize, usize) -> std::io::Result<Vec<u8>>> StreamReader<F> {
    pub fn open(master: &[u8], path_id: &str, envelope_length: usize, mut read_at: F) -> R<Self> {
        let header = read_at(0, HEADER_BYTES).map_err(|_| EnvelopeError("The file can't be read."))?;
        let layout = stream_layout(&header, envelope_length)?;
        Ok(Self { layout, key: file_key(master, path_id)?, read_at, final_checked: false })
    }

    /// Decrypts chunk i (authenticated).
    pub fn chunk(&mut self, i: usize) -> R<Vec<u8>> {
        let l = &self.layout;
        if i >= l.count {
            return Err(EnvelopeError("Range out of bounds."));
        }
        let full = l.chunk_size + TAG_BYTES;
        let start = HEADER_BYTES + i * full;
        let length = full.min(l.envelope_length - start);
        let sealed = (self.read_at)(start, length).map_err(|_| EnvelopeError("The file can't be read."))?;
        if sealed.len() != length {
            return Err(EnvelopeError("The file is incomplete."));
        }
        let l = &self.layout;
        gcm_open(&self.key, &chunk_nonce(&l.header[9..17], i as u32), &sealed, &chunk_aad(&l.header, i == l.count - 1))
    }

    /// The final chunk must carry the last flag, so a cut-short file never reads as a shorter valid one.
    pub fn check_final(&mut self) -> R<()> {
        if !self.final_checked {
            self.chunk(self.layout.count - 1)?;
            self.final_checked = true;
        }
        Ok(())
    }

    /// Plaintext bytes [start, end).
    pub fn range(&mut self, start: usize, end: usize) -> R<Vec<u8>> {
        if end < start || end > self.layout.plain_length {
            return Err(EnvelopeError("Range out of bounds."));
        }
        self.check_final()?;
        if end == start {
            return Ok(Vec::new());
        }
        let cs = self.layout.chunk_size;
        let (first, last) = (start / cs, (end - 1) / cs);
        let mut joined = Vec::with_capacity((last - first + 1) * cs);
        for i in first..=last {
            joined.extend_from_slice(&self.chunk(i)?);
        }
        let offset = start - first * cs;
        Ok(joined[offset..offset + (end - start)].to_vec())
    }
}

#[cfg(test)]
pub fn stream_plain_length(envelope: &[u8]) -> R<usize> {
    Ok(stream_layout(&envelope[..HEADER_BYTES.min(envelope.len())], envelope.len())?.plain_length)
}

/// Decrypts a whole stream envelope held in memory.
pub fn open_stream(master: &[u8], path_id: &str, envelope: &[u8]) -> R<Vec<u8>> {
    let l = stream_layout(&envelope[..HEADER_BYTES.min(envelope.len())], envelope.len())?;
    let key = file_key(master, path_id)?;
    let full = l.chunk_size + TAG_BYTES;
    let mut out = Vec::with_capacity(l.plain_length);
    for i in 0..l.count {
        let start = HEADER_BYTES + i * full;
        let sealed = &envelope[start..(start + full).min(envelope.len())];
        out.extend_from_slice(&gcm_open(&key, &chunk_nonce(&l.header[9..17], i as u32), sealed, &chunk_aad(&l.header, i == l.count - 1))?);
    }
    Ok(out)
}

/// Decrypts bytes [start, end) of an in-memory stream envelope.
#[cfg(test)]
pub fn open_stream_range(master: &[u8], path_id: &str, envelope: &[u8], start: usize, end: usize) -> R<Vec<u8>> {
    let mut r = StreamReader::open(master, path_id, envelope.len(), |p, n| Ok(envelope[p.min(envelope.len())..(p + n).min(envelope.len())].to_vec()))?;
    r.range(start, end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use sha2::Digest;

    fn vectors() -> Value {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/local-store/fixtures/crypto-vectors.json");
        serde_json::from_slice(&std::fs::read(p).expect("crypto-vectors.json")).unwrap()
    }
    fn hx(v: &Value) -> Vec<u8> {
        hex::decode(v.as_str().unwrap()).unwrap()
    }
    fn s(v: &Value) -> &str {
        v.as_str().unwrap()
    }
    fn pattern(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn pbkdf2_wrapping_keys() {
        for k in vectors()["kdf"].as_array().unwrap() {
            let it = k["iterations"].as_u64().unwrap() as u32;
            // The 600,000-round vector takes a while unoptimized; the 1,000-round ones cover the same code.
            if it > 1000 && cfg!(debug_assertions) {
                continue;
            }
            assert_eq!(hex::encode(derive_wrapping_key(s(&k["passphrase"]), &hx(&k["saltHex"]), it).unwrap()), s(&k["wrappingKeyHex"]));
        }
    }

    #[test]
    fn wrapping_gives_the_same_header_and_unlocks() {
        for w in vectors()["wrap"].as_array().unwrap() {
            let master = hx(&w["masterKeyHex"]);
            let salt: [u8; 16] = hx(&w["saltHex"]).try_into().unwrap();
            let nonce: [u8; 12] = hx(&w["nonceHex"]).try_into().unwrap();
            let header = wrap_master_key(&master, s(&w["passphrase"]), w["iterations"].as_u64().unwrap() as u32, Some(salt), Some(nonce)).unwrap();
            let want: Header = serde_json::from_value(w["header"].clone()).unwrap();
            assert_eq!(header, want);
            assert_eq!(serde_json::to_value(&header).unwrap(), w["header"]);
            assert_eq!(unlock_master_key(&want, s(&w["passphrase"])).unwrap().map(hex::encode), Some(hex::encode(&master)));
            assert_eq!(unlock_master_key(&want, "wrong").unwrap(), None);
            assert!(key_matches(&want, &master));
        }
    }

    #[test]
    fn file_keys_and_names() {
        let v = vectors();
        for f in v["fileKeys"].as_array().unwrap() {
            assert_eq!(hex::encode(file_key(&hx(&f["masterKeyHex"]), s(&f["pathId"])).unwrap()), s(&f["keyHex"]));
        }
        for n in v["names"].as_array().unwrap() {
            assert_eq!(hmac_name(&hx(&n["masterKeyHex"]), s(&n["kind"]), s(&n["id"])).unwrap(), s(&n["name"]));
        }
    }

    #[test]
    fn single_shot_envelopes() {
        for e in vectors()["single"].as_array().unwrap() {
            let m = hx(&e["masterKeyHex"]);
            let nonce: [u8; 12] = hx(&e["nonceHex"]).try_into().unwrap();
            let env = seal_file(&m, s(&e["pathId"]), s(&e["plaintextUtf8"]).as_bytes(), Some(nonce)).unwrap();
            assert_eq!(hex::encode(&env), s(&e["envelopeHex"]));
            assert_eq!(open_file(&m, s(&e["pathId"]), &hx(&e["envelopeHex"])).unwrap(), s(&e["plaintextUtf8"]).as_bytes());
        }
    }

    #[test]
    fn stream_envelopes_whole_and_by_range() {
        for e in vectors()["stream"].as_array().unwrap() {
            let m = hx(&e["masterKeyHex"]);
            let n = e["plaintextLength"].as_u64().unwrap() as usize;
            let plain = pattern(n);
            let prefix: [u8; 8] = hx(&e["noncePrefixHex"]).try_into().unwrap();
            let env = seal_stream(&m, s(&e["pathId"]), &plain, Some(prefix), Some(e["chunkSize"].as_u64().unwrap() as usize)).unwrap();
            assert_eq!(env.len() as u64, e["envelopeLength"].as_u64().unwrap());
            assert_eq!(hex::encode(sha2::Sha256::digest(&env)), s(&e["envelopeSha256"]));
            if let Some(h) = e.get("envelopeHex").and_then(Value::as_str) {
                assert_eq!(hex::encode(&env), h);
            }
            assert_eq!(stream_plain_length(&env).unwrap(), n);
            assert_eq!(open_stream(&m, s(&e["pathId"]), &env).unwrap(), plain);
            assert_eq!(open_file(&m, s(&e["pathId"]), &env).unwrap(), plain);
            for (a, b) in [(0, 0), (0, n.min(1)), (n / 3, 2 * n / 3), (n.saturating_sub(5), n)] {
                assert_eq!(open_stream_range(&m, s(&e["pathId"]), &env, a, b).unwrap(), plain[a..b]);
            }
        }
    }

    #[test]
    fn every_reject_vector_is_refused() {
        let v = vectors();
        let master = hx(&v["wrap"][0]["masterKeyHex"]);
        for r in v["rejects"].as_array().unwrap() {
            assert!(open_file(&master, s(&r["pathId"]), &hx(&r["envelopeHex"])).is_err(), "{}", s(&r["name"]));
        }
    }

    #[test]
    fn a_cut_short_stream_never_reads_as_a_shorter_valid_one() {
        let master = [7u8; 32];
        let plain = pattern(3 * 1000 + 7);
        let env = seal_stream(&master, "files/ab/x", &plain, None, Some(1000)).unwrap();
        let cut = &env[..env.len() - 1016];
        assert!(open_stream_range(&master, "files/ab/x", cut, 0, 10).is_err());
        assert!(open_file(&master, "files/ab/x", cut).is_err());
        assert_eq!(open_stream_range(&master, "files/ab/x", &env, 990, 2010).unwrap(), plain[990..2010]);
        // A different path's key doesn't open it.
        assert!(open_file(&master, "files/ab/y", &env).is_err());
    }

    #[test]
    fn create_and_unlock_round_trip_with_unicode() {
        let (header, master) = create_encryption("pässwörd", 1000).unwrap();
        // Decomposed input normalizes to the same key.
        assert_eq!(unlock_master_key(&header, "pa\u{308}sswo\u{308}rd").unwrap(), Some(master));
        assert_eq!(unlock_master_key(&header, "password").unwrap(), None);
    }
}
