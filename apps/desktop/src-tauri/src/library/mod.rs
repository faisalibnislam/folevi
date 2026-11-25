//! The library behind shell-bridge.js's `foleviShell.library` on Windows and Linux (docs/LOCAL_MODE_PLAN.md §3,
//! §4.1, §4.2): where it is (locations.rs), its files (fs.rs, or encrypted.rs around it), change detection
//! (watch.rs), the journal (journal.rs), the passphrase and the key (crypto.rs, keys.rs), moving it, and
//! attachments for app://…/_files. A port of the Electron app's library/service.ts with the iPhone's answers
//! (Native/Shell/LibraryService.swift and FoleviShellPlugin.swift), since the page talks to this shell through
//! the same bridge script.
//!
//! Everything runs one call at a time under one lock (like the iPhone's serial queue), on tokio's blocking
//! threads, so a move or an encryption switch never overlaps the page's calls. The state is library.json in the
//! app's data folder: { v, kind, path, libraryId, chosenFolder?, move?, encryptionJob? }.
pub mod crypto;
pub mod encrypted;
pub mod fs;
pub mod journal;
pub mod keys;
pub mod locations;
pub mod mirror;
pub mod paths;
pub mod watch;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use self::crypto::{create_encryption, is_envelope, key_matches, unlock_master_key, wrap_master_key, Header, DEFAULT_ITERATIONS};
use self::encrypted::EncryptedFs;
use self::fs::{FolderFs, IfMatch, LibraryFs, ReadResult, WriteResult};
use self::journal::FileJournal;
use self::keys::KeyCache;
use self::locations::{device_location, display_path, inside, library_folder_in};
use self::paths::{check_dir, check_path, is_valid_id, FILES_DIR, LIBRARY_FILE};
use self::watch::{WatchHandle, WatchState};
use crate::events::Emit;
use crate::secrets::Sealer;
use crate::shell::{b64, now_ms, opt_str, req_bytes, value, write_atomic, ShellError, ShellResult};

/// Asks the person for a folder (a system dialog, blocking: called from a blocking task). `title`, then the folder
/// it opens in. None when they cancel.
pub type ChooseFolder = Arc<dyn Fn(&str, Option<PathBuf>) -> Option<PathBuf> + Send + Sync>;

pub struct LibraryOptions {
    /// The app's data folder (library.json, the journal, the unlocked key live under it).
    pub user_data: PathBuf,
    /// The person's home folder ("On this PC" is <home>/Documents/Folevi Library).
    pub home: PathBuf,
    pub sealer: Arc<Sealer>,
    pub choose_folder: ChooseFolder,
    /// "libraryChanges" { changes } (and "cloudStatus") go out through this.
    pub emit: Emit,
}

// ---------------------------------------------------------------- errors the page acts on

fn not_set_up() -> ShellError {
    ShellError::new("not_set_up", "No library has been set up on this PC.")
}

fn unreachable_library() -> ShellError {
    ShellError::unavailable("The library can't be reached right now.")
}

fn locked() -> ShellError {
    ShellError::new("locked", "The library is encrypted. Enter its passphrase to open it.")
}

fn not_writable() -> ShellError {
    ShellError::unavailable("Folevi can't write to that folder.").with_path("not_writable")
}

fn unsupported() -> ShellError {
    ShellError::unavailable("That place isn't available on this PC.").with_path("unsupported")
}

fn crypto_err(e: crypto::EnvelopeError) -> ShellError {
    ShellError::new("unreadable", format!("The library's encryption couldn't be read ({e})."))
}

fn is_cloud(kind: &str) -> bool {
    kind == "dropbox" || kind == "gdrive"
}

const KINDS: &[&str] = &["icloud", "folder", "device", "dropbox", "gdrive"];
const ATTACHMENT_SHA_LEN: usize = 64;

fn is_sha(s: &str) -> bool {
    s.len() == ATTACHMENT_SHA_LEN && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `files/<aa>/<sha256>`: an attachment as a plain library names it.
fn is_plain_attachment_path(p: &str) -> bool {
    let parts: Vec<&str> = p.split('/').collect();
    parts.len() == 3 && parts[0] == FILES_DIR && parts[1].len() == 2 && parts[1].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) && is_sha(parts[2])
}

// ---------------------------------------------------------------- the stored state

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Move {
    kind: String,
    path: String,
    #[serde(rename = "chosenFolder", default, skip_serializing_if = "Option::is_none")]
    chosen_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Job {
    direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Stored {
    v: u32,
    kind: String,
    path: String,
    #[serde(rename = "libraryId")]
    library_id: String,
    /// "Choose a folder": the folder the person picked (the library may be a "Folevi Library" folder in it).
    #[serde(rename = "chosenFolder", default, skip_serializing_if = "Option::is_none")]
    chosen_folder: Option<String>,
    /// A move under way: finished by moving again, or on the next start.
    #[serde(rename = "move", default, skip_serializing_if = "Option::is_none")]
    moving: Option<Move>,
    /// Encryption being switched on or off: resumed on the next start (or unlock).
    #[serde(rename = "encryptionJob", default, skip_serializing_if = "Option::is_none")]
    encryption_job: Option<Job>,
}

/// A ULID (time + randomness, Crockford base32) for a new library.
pub fn new_library_id(now: u64) -> String {
    const A: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut t = now;
    let mut time = [0u8; 10];
    for slot in time.iter_mut().rev() {
        *slot = A[(t % 32) as usize];
        t /= 32;
    }
    let r = crypto::random_bytes::<16>();
    let mut out = String::from_utf8(time.to_vec()).unwrap();
    out.extend(r.iter().map(|b| A[(*b % 32) as usize] as char));
    out
}

pub fn encode_manifest(m: &Map<String, Value>) -> Vec<u8> {
    let mut b = serde_json::to_vec_pretty(m).unwrap_or_else(|_| b"{}".to_vec());
    b.push(b'\n');
    b
}

pub fn decode_manifest(bytes: &[u8]) -> Result<Map<String, Value>, ShellError> {
    let bad = |m: &str| ShellError::new("unreadable", m.to_string());
    let Ok(Value::Object(mut m)) = serde_json::from_slice::<Value>(bytes) else { return Err(bad("That isn't a Folevi library.")) };
    if m.get("format").and_then(Value::as_str) != Some("folevi-library") {
        return Err(bad("That isn't a Folevi library."));
    }
    let id_ok = m.get("libraryId").and_then(Value::as_str).is_some_and(is_valid_id);
    if !id_ok || !m.get("createdAt").is_some_and(Value::is_number) || !m.get("minWriterVersion").is_some_and(Value::is_number) {
        return Err(bad("The library file is missing some of its fields."));
    }
    m.entry("v").or_insert(json!(1));
    m.entry("encryption").or_insert(Value::Null);
    Ok(m)
}

fn header_of(m: &Map<String, Value>) -> Option<Header> {
    match m.get("encryption") {
        None | Some(Value::Null) => None,
        Some(v) => serde_json::from_value(v.clone()).ok(),
    }
}

fn library_id_of(m: &Map<String, Value>) -> String {
    m.get("libraryId").and_then(Value::as_str).unwrap_or_default().to_string()
}

fn read_manifest(fs: &FolderFs) -> Option<(Map<String, Value>, String)> {
    match fs.read(LIBRARY_FILE).ok()? {
        ReadResult::NotDownloaded => {
            let _ = fs.start_download(&[LIBRARY_FILE.to_string()]);
            None
        }
        ReadResult::Bytes(b, etag) => decode_manifest(&b).ok().map(|m| (m, etag)),
    }
}

// ---------------------------------------------------------------- the service

struct Inner {
    opened: bool,
    state: Option<Stored>,
    /// A folder library's files as stored (None for Dropbox and Google Drive).
    base: Option<Arc<FolderFs>>,
    enc: Option<Arc<EncryptedFs>>,
    manifest: Option<Map<String, Value>>,
    manifest_etag: Option<String>,
    header: Option<Header>,
    keys: KeyCache,
    journal: Option<FileJournal>,
    watch: Option<WatchHandle>,
    /// Which watcher is the current one (an old one's late scans are ignored).
    watch_gen: u64,
    known: WatchState,
}

struct Core {
    o: LibraryOptions,
    inner: Mutex<Inner>,
    /// PBKDF2 iterations for a new passphrase (600,000; tests use fewer).
    iterations: AtomicU32,
    scan_interval: Duration,
}

pub struct LibraryService {
    core: Arc<Core>,
    /// Set once the configured library has been opened. Every public entry point awaits it, so a call that
    /// arrives while the launch-time open is still running waits for it instead of seeing an unopened library.
    ready: tokio::sync::OnceCell<()>,
}

enum Target {
    Folder { path: PathBuf, chosen: Option<PathBuf> },
}

impl LibraryService {
    pub fn new(o: LibraryOptions) -> Arc<Self> {
        let keys = KeyCache::new(o.user_data.join("library-keys"), o.sealer.clone());
        let inner = Inner {
            opened: false,
            state: None,
            base: None,
            enc: None,
            manifest: None,
            manifest_etag: None,
            header: None,
            keys,
            journal: None,
            watch: None,
            watch_gen: 0,
            known: WatchState::default(),
        };
        Arc::new(Self {
            core: Arc::new(Core { o, inner: Mutex::new(inner), iterations: AtomicU32::new(DEFAULT_ITERATIONS), scan_interval: watch::SCAN_INTERVAL }),
            ready: tokio::sync::OnceCell::new(),
        })
    }

    async fn blocking<T: Send + 'static>(&self, work: impl FnOnce(&Arc<Core>) -> Result<T, ShellError> + Send + 'static) -> Result<T, ShellError> {
        let core = self.core.clone();
        tokio::task::spawn_blocking(move || work(&core)).await.map_err(|_| ShellError::io("The library stopped unexpectedly. Try again."))?
    }

    /// Opens the configured library at launch (and starts nothing else). The app runs this in the background;
    /// calling it again, or making any other call, waits for that one open rather than starting a second.
    pub async fn open(&self) {
        self.ready().await;
    }

    /// Waits until the library is open, opening it if nothing has yet. Opening reports no error of its own: a
    /// library that couldn't be opened answers each call as before (unreachable, locked, not configured).
    async fn ready(&self) {
        self.ready
            .get_or_init(|| async {
                let _ = self
                    .blocking(|core| {
                        let mut i = core.inner.lock();
                        core.ensure_open(&mut i);
                        Ok(())
                    })
                    .await;
            })
            .await;
    }

    /// Whether the launch-time open has finished (tests).
    #[cfg(test)]
    fn is_ready(&self) -> bool {
        self.ready.initialized()
    }

    /// Every library call of shell-bridge.js: libSetup, libInfo, libList, libRead, libWrite, libRemove,
    /// libConflictVersions, libResolveConflicts, libStartDownload, libWatch, libUnwatch, libRescan, libMove,
    /// libUnlock, libSetPassphrase, libChangePassphrase, journalAppend, journalRead, journalTruncate, libSetCloud,
    /// cloudStatus, cloudConnect, cloudCancel, cloudSignOut, cloudRequest, mirror*.
    pub async fn call(&self, method: &str, o: &Value) -> ShellResult {
        self.ready().await;
        let o = o.clone();
        match method {
            "libSetup" | "libMove" => {
                let kind = opt_str(&o, "kind").unwrap_or("").to_string();
                let moving = method == "libMove";
                if kind != "device" && kind != "folder" {
                    return Err(unsupported());
                }
                let chosen = if kind == "folder" {
                    match self.choose_folder().await? {
                        Some(p) => Some(p),
                        None if moving => return self.info_value().await,
                        None => return Ok(value(Value::Null)),
                    }
                } else {
                    None
                };
                self.blocking(move |core| {
                    let mut i = core.inner.lock();
                    core.ensure_open(&mut i);
                    let t = core.target(&kind, chosen)?;
                    if moving {
                        core.move_to(&mut i, &kind, t)
                    } else {
                        core.setup(&mut i, &kind, t)
                    }
                })
                .await
            }
            "libInfo" => self.info_value().await,
            "libSetCloud" => {
                self.locked(move |core, i| {
                    let kind = opt_str(&o, "kind").unwrap_or("");
                    let id = opt_str(&o, "libraryId").unwrap_or("");
                    if !is_cloud(kind) || !is_valid_id(id) {
                        return Err(ShellError::invalid("That isn't a Dropbox or Google Drive library."));
                    }
                    core.detach(i);
                    core.save_state(i, Some(Stored { v: 1, kind: kind.into(), path: String::new(), library_id: id.into(), chosen_folder: None, moving: None, encryption_job: None }));
                    i.journal = None;
                    Ok(core.info(i))
                })
                .await
            }
            "libList" => {
                self.locked(move |core, i| {
                    let dir = opt_str(&o, "dir").unwrap_or("");
                    let entries = match opt_str(&o, "root") {
                        Some(root) => core.files_at(root)?.list(check_dir(dir)?)?,
                        None => core.current(i)?.list(check_dir(dir)?)?,
                    };
                    Ok(json!({ "entries": entries.iter().map(fs::Entry::json).collect::<Vec<_>>() }))
                })
                .await
            }
            "libRead" => {
                self.locked(move |core, i| {
                    let path = check_path(opt_str(&o, "path").unwrap_or(""))?;
                    let r = match opt_str(&o, "root") {
                        Some(root) => core.files_at(root)?.read(path)?,
                        None => core.current(i)?.read(path)?,
                    };
                    Ok(match r {
                        ReadResult::NotDownloaded => json!({ "notDownloaded": true }),
                        ReadResult::Bytes(b, etag) => json!({ "bytes": b64(&b), "etag": etag }),
                    })
                })
                .await
            }
            "libWrite" => {
                self.locked(move |core, i| {
                    let if_match = match opt_str(&o, "mode") {
                        Some("create") => IfMatch::Create,
                        Some("match") => IfMatch::Match(opt_str(&o, "ifMatch").ok_or_else(|| ShellError::invalid("ifMatch must be a string or null."))?.to_string()),
                        _ => IfMatch::Any,
                    };
                    let path = check_path(opt_str(&o, "path").unwrap_or(""))?;
                    let bytes = req_bytes(&o, "bytes").map_err(|_| ShellError::invalid("Bytes are needed."))?;
                    let r = match opt_str(&o, "root") {
                        Some(root) => core.files_at(root)?.write(path, &bytes, &if_match)?,
                        None => core.write(i, path, &bytes, &if_match)?,
                    };
                    Ok(match r {
                        WriteResult::Written(etag) => json!({ "etag": etag }),
                        WriteResult::Mismatch(etag) => json!({ "mismatch": true, "etag": etag }),
                    })
                })
                .await
            }
            "libRemove" => {
                self.locked(move |core, i| {
                    let path = check_path(opt_str(&o, "path").unwrap_or(""))?;
                    if path == LIBRARY_FILE {
                        return Err(ShellError::new("invalid_path", "The library file can't be removed.").with_path(path));
                    }
                    core.current(i)?.remove(path, opt_str(&o, "ifMatch"))?;
                    i.known.note_own_change(path, None);
                    Ok(value(Value::Null))
                })
                .await
            }
            "libConflictVersions" => {
                self.locked(move |core, i| {
                    let path = check_path(opt_str(&o, "path").unwrap_or(""))?;
                    let versions = core.current(i)?.conflict_versions(path)?;
                    Ok(json!({ "versions": versions.iter().map(|(id, b)| json!({ "id": id, "bytes": b64(b) })).collect::<Vec<_>>() }))
                })
                .await
            }
            "libResolveConflicts" => {
                self.locked(move |core, i| {
                    let path = check_path(opt_str(&o, "path").unwrap_or(""))?;
                    let ids = strings(&o, "ids");
                    core.current(i)?.resolve_conflicts(path, &ids)?;
                    Ok(value(Value::Null))
                })
                .await
            }
            "libStartDownload" => {
                self.locked(move |core, i| {
                    let paths = strings(&o, "paths");
                    for p in &paths {
                        check_path(p)?;
                    }
                    core.current(i)?.start_download(&paths)?;
                    Ok(value(Value::Null))
                })
                .await
            }
            // The watcher runs whenever a library is open; the page just listens for "libraryChanges".
            "libWatch" | "libUnwatch" => Ok(value(Value::Null)),
            "libRescan" => {
                self.rescan().await;
                Ok(value(Value::Null))
            }
            "journalAppend" => {
                self.locked(move |core, i| {
                    let record = req_bytes(&o, "record").map_err(|_| ShellError::invalid("Bytes are needed."))?;
                    core.journal(i)?.append(&record)?;
                    Ok(value(Value::Null))
                })
                .await
            }
            "journalRead" => {
                self.locked(move |core, i| {
                    let records = core.journal(i)?.read_all()?;
                    Ok(json!({ "records": records.iter().map(|r| b64(r)).collect::<Vec<_>>() }))
                })
                .await
            }
            "journalTruncate" => {
                self.locked(move |core, i| {
                    let n = o.get("n").and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0);
                    let Some(n) = n else { return Err(ShellError::invalid("truncate takes a whole number.")) };
                    core.journal(i)?.truncate(n as usize)?;
                    Ok(value(Value::Null))
                })
                .await
            }
            "libUnlock" => {
                self.locked(move |core, i| {
                    let p = opt_str(&o, "passphrase").unwrap_or("");
                    Ok(value(core.unlock(i, p)?))
                })
                .await
            }
            "libSetPassphrase" => {
                self.locked(move |core, i| {
                    core.set_passphrase(i, opt_str(&o, "passphrase"))?;
                    Ok(value(Value::Null))
                })
                .await
            }
            "libChangePassphrase" => {
                self.locked(move |core, i| {
                    let ok = core.change_passphrase(i, opt_str(&o, "old").unwrap_or(""), opt_str(&o, "new").unwrap_or(""))?;
                    Ok(value(ok))
                })
                .await
            }
            // Dropbox and Google Drive: this build has no client ids for them, so they aren't offered (the
            // page shows them only when `available` names them), and signing in isn't possible yet.
            "cloudStatus" | "cloudSignOut" => Ok(cloud_status()),
            "cloudCancel" => Ok(value(Value::Null)),
            "cloudConnect" | "cloudRequest" => Err(ShellError::unavailable("Dropbox and Google Drive aren't in this version of Folevi for this PC yet.")),
            "mirrorRead" | "mirrorWrite" | "mirrorDelete" | "mirrorPaths" | "mirrorLoadState" | "mirrorSaveState" => {
                let method = method.to_string();
                self.blocking(move |core| core.mirror(&method, &o)).await
            }
            _ => Err(ShellError::unavailable(format!("{method} isn't a library call Folevi knows."))),
        }
    }

    async fn locked(&self, work: impl FnOnce(&Arc<Core>, &mut Inner) -> ShellResult + Send + 'static) -> ShellResult {
        self.blocking(move |core| {
            let mut i = core.inner.lock();
            core.ensure_open(&mut i);
            work(core, &mut i)
        })
        .await
    }

    async fn choose_folder(&self) -> Result<Option<PathBuf>, ShellError> {
        self.blocking(|core| {
            let start = {
                let i = core.inner.lock();
                i.state.as_ref().and_then(|s| s.chosen_folder.clone()).map(PathBuf::from).unwrap_or_else(|| core.o.home.join("Documents"))
            };
            Ok((core.o.choose_folder)("Choose a folder for your Folevi library", Some(start)))
        })
        .await
    }

    async fn info_value(&self) -> ShellResult {
        self.locked(|core, i| Ok(core.info(i))).await
    }

    /// libInfo's answer.
    pub async fn info(&self) -> Value {
        self.ready().await;
        self.info_value().await.unwrap_or_else(|_| json!({ "configured": false }))
    }

    /// Forgets the library on this PC (its files stay where they are).
    pub async fn forget(&self) -> Result<(), ShellError> {
        self.ready().await;
        self.blocking(|core| {
            let mut i = core.inner.lock();
            core.ensure_open(&mut i);
            let id = i.state.as_ref().map(|s| s.library_id.clone());
            core.detach(&mut i);
            i.journal = None;
            if let Some(id) = id {
                FileJournal::new(core.journal_path(&id)).destroy();
            }
            core.save_state(&mut i, None);
            Ok(())
        })
        .await
    }

    /// A full look at the library folder (waking, the app coming to the front).
    pub async fn rescan(&self) {
        self.ready().await;
        let _ = self
            .blocking(|core| {
                let gen = core.inner.lock().watch_gen;
                Core::scan(core, gen, false);
                Ok(())
            })
            .await;
    }

    /// An attachment by its SHA-256 (files/<sha>), decrypted if the library is: its bytes and the type stored
    /// with it, or None.
    pub async fn attachment(&self, sha256: &str) -> Result<Option<(Vec<u8>, Option<String>)>, ShellError> {
        let sha = sha256.to_ascii_lowercase();
        if !is_sha(&sha) {
            return Ok(None);
        }
        self.ready().await;
        let s2 = sha.clone();
        let place = self.blocking(move |core| Ok(core.locate_attachment(&s2))).await?;
        let Some(place) = place else { return Ok(None) };
        if place.wait_for_arrival && !place.abs.is_file() {
            // A cloud library's file that isn't on this PC yet: the page's provider code fetches it.
            (self.core.o.emit)("cloudWant", json!({ "path": place.rel }));
            for _ in 0..60 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if place.abs.is_file() {
                    break;
                }
            }
        }
        self.blocking(move |_| {
            let Some(key) = place.key else { return Ok(std::fs::read(&place.abs).ok().map(|b| (b, None))) };
            // Attachments are STREAM envelopes: read and authenticated a chunk at a time, the last one first, so
            // a cut-short file never passes as a shorter one.
            use std::io::{Read, Seek, SeekFrom};
            let Ok(mut f) = std::fs::File::open(&place.abs) else { return Ok(None) };
            let Ok(len) = f.metadata().map(|m| m.len() as usize) else { return Ok(None) };
            let read_at = move |pos: usize, n: usize| -> std::io::Result<Vec<u8>> {
                f.seek(SeekFrom::Start(pos as u64))?;
                let mut b = Vec::with_capacity(n);
                (&mut f).take(n as u64).read_to_end(&mut b)?;
                Ok(b)
            };
            let plain = crypto::StreamReader::open(&key, &place.rel, len, read_at).and_then(|mut r| {
                let n = r.layout.plain_length;
                r.range(0, n)
            });
            Ok(plain.ok().map(|b| (b, None)))
        })
        .await
    }

    /// Stops the watcher (quitting).
    pub fn dispose(&self) {
        if let Some(mut i) = self.core.inner.try_lock_for(Duration::from_secs(2)) {
            i.watch = None;
            i.watch_gen += 1;
            if let Some(j) = i.journal.as_mut() {
                j.close();
            }
        }
    }

    #[cfg(test)]
    fn set_iterations(&self, n: u32) {
        self.core.iterations.store(n, Ordering::Relaxed);
    }

    /// Forgets the cached key on this PC (the passphrase is needed again).
    #[cfg(test)]
    fn lock_again(&self) {
        let mut i = self.core.inner.lock();
        if let Some(m) = i.manifest.clone() {
            i.keys.clear(&library_id_of(&m));
            let etag = i.manifest_etag.clone().unwrap_or_default();
            self.core.use_manifest(&mut i, m, etag);
        }
    }
}

fn strings(o: &Value, key: &str) -> Vec<String> {
    o.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
}

fn cloud_status() -> Value {
    json!({ "available": [], "provider": null, "state": "none", "account": null })
}

struct AttachmentPlace {
    abs: PathBuf,
    rel: String,
    key: Option<[u8; 32]>,
    wait_for_arrival: bool,
}

impl Core {
    // ---------------------------------------------------------------- state

    fn state_file(&self) -> PathBuf {
        self.o.user_data.join("library.json")
    }

    fn journal_path(&self, library_id: &str) -> PathBuf {
        self.o.user_data.join("library").join(format!("journal-{library_id}.bin"))
    }

    fn load_state(&self) -> Option<Stored> {
        let s: Stored = serde_json::from_slice(&std::fs::read(self.state_file()).ok()?).ok()?;
        (s.v == 1 && KINDS.contains(&s.kind.as_str()) && is_valid_id(&s.library_id)).then_some(s)
    }

    fn save_state(&self, i: &mut Inner, s: Option<Stored>) {
        match &s {
            Some(st) => {
                let mut b = serde_json::to_vec_pretty(st).unwrap_or_default();
                b.push(b'\n');
                if write_atomic(&self.state_file(), &b).is_ok() {
                    crate::secrets::restrict(&self.state_file());
                }
            }
            None => {
                let _ = std::fs::remove_file(self.state_file());
            }
        }
        i.state = s;
    }

    /// Loads library.json and opens the library it names; finishes a move or encryption switch left half done.
    fn ensure_open(self: &Arc<Self>, i: &mut Inner) {
        if i.opened {
            return;
        }
        i.opened = true;
        i.state = self.load_state();
        if i.state.is_none() {
            return;
        }
        if i.state.as_ref().is_some_and(|s| s.moving.is_some()) {
            let _ = self.finish_move(i);
        }
        if i.base.is_none() {
            self.attach(i);
        }
        let _ = self.resume_encryption(i);
    }

    // ---------------------------------------------------------------- keys and the manifest

    fn key(&self, i: &mut Inner) -> Option<[u8; 32]> {
        let header = i.header.clone()?;
        let id = library_id_of(i.manifest.as_ref()?);
        let k = i.keys.get(&id)?;
        key_matches(&header, &k).then_some(k)
    }

    fn use_manifest(&self, i: &mut Inner, m: Map<String, Value>, etag: String) {
        i.header = header_of(&m);
        i.manifest = Some(m);
        i.manifest_etag = Some(etag);
        i.enc = None;
        if i.header.is_some() {
            if let (Some(k), Some(base)) = (self.key(i), i.base.clone()) {
                i.enc = Some(Arc::new(EncryptedFs::new(base, k)));
            }
        }
    }

    fn attach(self: &Arc<Self>, i: &mut Inner) {
        self.detach(i);
        let Some(s) = i.state.clone() else { return };
        if is_cloud(&s.kind) {
            return;
        }
        let fs = Arc::new(FolderFs::new(&s.path));
        i.base = Some(fs.clone());
        let Some((m, etag)) = read_manifest(&fs) else {
            i.manifest = None;
            return;
        };
        let id = library_id_of(&m);
        if id != s.library_id {
            // The folder now holds another library (replaced in File Explorer): adopt it, its journal is its own.
            self.save_state(i, Some(Stored { library_id: id, ..s }));
            i.journal = None;
        }
        self.use_manifest(i, m, etag);
        fs.clean_temp();
        self.start_watching(i);
    }

    fn detach(&self, i: &mut Inner) {
        self.stop_watching(i);
        i.base = None;
        i.enc = None;
        i.manifest = None;
        i.manifest_etag = None;
        i.header = None;
    }

    // ---------------------------------------------------------------- watching

    fn stop_watching(&self, i: &mut Inner) {
        i.watch = None;
        i.watch_gen += 1;
        i.known.clear();
    }

    fn start_watching(self: &Arc<Self>, i: &mut Inner) {
        self.stop_watching(i);
        let Some(base) = i.base.clone() else { return };
        let Ok(root) = base.real_root().map(Path::to_path_buf) else { return };
        // The baseline now, so a rescan right after never reports the whole library as new.
        if let Ok(entries) = self.watch_list(i) {
            i.known.baseline(&entries);
        }
        let gen = i.watch_gen;
        let weak: Weak<Core> = Arc::downgrade(self);
        i.watch = Some(watch::start(root, self.scan_interval, move |first| match weak.upgrade() {
            Some(core) => Core::scan(&core, gen, first),
            None => false,
        }));
    }

    /// What the watcher lists: the page's view, or only the library file while locked (a passphrase change
    /// elsewhere is what matters then).
    fn watch_list(&self, i: &Inner) -> Result<Vec<fs::Entry>, ShellError> {
        let base = i.base.clone().ok_or_else(unreachable_library)?;
        if i.header.is_some() {
            return match &i.enc {
                Some(enc) => enc.list(""),
                None => Ok(base.entry(LIBRARY_FILE)?.into_iter().collect()),
            };
        }
        base.list("")
    }

    /// One listing compared with the last; the batch goes to the page. False when `gen` isn't current.
    fn scan(core: &Arc<Core>, gen: u64, first: bool) -> bool {
        let changes = {
            let mut i = core.inner.lock();
            if i.watch_gen != gen {
                return false;
            }
            if first {
                // start_watching took the baseline already.
                return true;
            }
            let Ok(entries) = core.watch_list(&i) else { return true };
            let changes = i.known.diff(&entries);
            if changes.iter().any(|(p, _)| p == LIBRARY_FILE) {
                // Another device changed the passphrase, or switched encryption on or off.
                if let Some((m, etag)) = i.base.clone().and_then(|b| read_manifest(&b)) {
                    let was_encrypted = i.header.is_some();
                    core.use_manifest(&mut i, m, etag);
                    if was_encrypted != i.header.is_some() {
                        // Names on disk mean something else now: a fresh baseline.
                        if let Ok(entries) = core.watch_list(&i) {
                            i.known.baseline(&entries);
                        }
                    }
                }
            }
            changes
        };
        if !changes.is_empty() {
            (core.o.emit)("libraryChanges", watch::batch(&changes));
        }
        true
    }

    // ---------------------------------------------------------------- info and setup

    fn info(self: &Arc<Self>, i: &mut Inner) -> Value {
        let Some(s) = i.state.clone() else {
            return json!({ "kind": "device", "displayPath": "", "available": false, "encrypted": false, "locked": false, "configured": false });
        };
        // Dropbox and Google Drive: the bridge's provider code says the rest (cloudKit.info).
        if is_cloud(&s.kind) {
            let name = if s.kind == "dropbox" { "Dropbox" } else { "Google Drive" };
            return json!({ "kind": s.kind, "displayPath": name, "available": true, "encrypted": false, "locked": false, "configured": true });
        }
        if i.manifest.is_none() {
            self.attach(i);
        }
        let encrypted = i.header.is_some();
        let path = PathBuf::from(&s.path);
        json!({
            "kind": s.kind,
            "displayPath": display_path(&path, &self.o.home, cfg!(windows)),
            "available": path.is_dir() && i.base.is_some() && i.manifest.is_some(),
            "encrypted": encrypted,
            "locked": encrypted && i.enc.is_none(),
            "configured": true,
        })
    }

    /// Where a kind puts the library (a chosen folder comes from the dialog first).
    fn target(&self, kind: &str, chosen: Option<PathBuf>) -> Result<Target, ShellError> {
        match kind {
            "device" => Ok(Target::Folder { path: device_location(&self.o.home), chosen: None }),
            "folder" => {
                let chosen = chosen.ok_or_else(|| ShellError::invalid("No folder was chosen."))?;
                Ok(Target::Folder { path: library_folder_in(&chosen), chosen: Some(chosen) })
            }
            "icloud" => Err(ShellError::unavailable("iCloud Drive isn't available on this PC.").with_path("unsupported")),
            _ => Err(ShellError::invalid("That isn't a kind of library Folevi knows.")),
        }
    }

    /// Makes sure a folder holds a library: a new library file when there's none. Returns its id.
    fn prepare(&self, path: &Path) -> Result<String, ShellError> {
        std::fs::create_dir_all(path).map_err(|_| not_writable())?;
        if !FolderFs::probe_writable(path) {
            return Err(not_writable());
        }
        let fs = FolderFs::new(path);
        if let Some((m, _)) = read_manifest(&fs) {
            return Ok(library_id_of(&m));
        }
        // A library file there that isn't on this PC yet: wait for it a little rather than start another.
        if matches!(fs.read(LIBRARY_FILE), Ok(ReadResult::NotDownloaded)) {
            for _ in 0..40 {
                std::thread::sleep(Duration::from_millis(250));
                if let Some((m, _)) = read_manifest(&fs) {
                    return Ok(library_id_of(&m));
                }
            }
            return Err(ShellError::new("not_downloaded", "The library in that place is still downloading. Try again in a moment."));
        }
        let now = now_ms();
        let id = new_library_id(now);
        let mut m = Map::new();
        m.insert("format".into(), json!("folevi-library"));
        m.insert("v".into(), json!(1));
        m.insert("libraryId".into(), json!(id));
        m.insert("createdAt".into(), json!(now));
        m.insert("minWriterVersion".into(), json!(1));
        m.insert("encryption".into(), Value::Null);
        if let WriteResult::Mismatch(_) = fs.write(LIBRARY_FILE, &encode_manifest(&m), &IfMatch::Create)? {
            // Another device made it just now.
            return read_manifest(&fs)
                .map(|(m, _)| library_id_of(&m))
                .ok_or_else(|| ShellError::new("unreadable", "The library file in that folder can't be read yet."));
        }
        Ok(id)
    }

    /// First run: "This device only" or "Choose a folder".
    fn setup(self: &Arc<Self>, i: &mut Inner, kind: &str, t: Target) -> ShellResult {
        let Target::Folder { path, chosen } = t;
        let library_id = self.prepare(&path)?;
        self.detach(i);
        let s = Stored {
            v: 1,
            kind: kind.into(),
            path: path.to_string_lossy().into_owned(),
            library_id,
            chosen_folder: chosen.map(|c| c.to_string_lossy().into_owned()),
            moving: None,
            encryption_job: None,
        };
        self.save_state(i, Some(s));
        i.journal = None;
        self.attach(i);
        Ok(self.info(i))
    }

    // ---------------------------------------------------------------- files

    /// The files the page works with: the encrypted view, the plain folder, or nothing while locked.
    fn current(self: &Arc<Self>, i: &mut Inner) -> Result<Arc<dyn LibraryFs>, ShellError> {
        let s = i.state.clone().ok_or_else(not_set_up)?;
        if is_cloud(&s.kind) {
            return Err(ShellError::unavailable("This library syncs through Dropbox or Google Drive."));
        }
        if i.base.is_none() || i.manifest.is_none() {
            self.attach(i);
        }
        let base = i.base.clone().ok_or_else(unreachable_library)?;
        if i.manifest.is_none() {
            return Err(unreachable_library());
        }
        if i.header.is_some() {
            return i.enc.clone().map(|e| e as Arc<dyn LibraryFs>).ok_or_else(locked);
        }
        Ok(base)
    }

    /// A place's files as stored, whatever the library is now (moving a cloud library to this PC).
    fn files_at(&self, root: &str) -> Result<FolderFs, ShellError> {
        if root != "device" {
            return Err(ShellError::unavailable("That place can't be reached right now."));
        }
        let dir = device_location(&self.o.home);
        std::fs::create_dir_all(&dir).map_err(|_| not_writable())?;
        Ok(FolderFs::new(dir))
    }

    fn write(self: &Arc<Self>, i: &mut Inner, path: &str, bytes: &[u8], if_match: &IfMatch) -> Result<WriteResult, ShellError> {
        let fs = self.current(i)?;
        let r = fs.write(path, bytes, if_match)?;
        if let WriteResult::Written(etag) = &r {
            i.known.note_own_change(path, Some(etag));
            if path == LIBRARY_FILE {
                if let Some((m, etag)) = i.base.clone().and_then(|b| read_manifest(&b)) {
                    self.use_manifest(i, m, etag);
                }
            }
        }
        Ok(r)
    }

    fn journal<'a>(&self, i: &'a mut Inner) -> Result<&'a mut FileJournal, ShellError> {
        let s = i.state.as_ref().ok_or_else(not_set_up)?;
        let path = self.journal_path(&s.library_id);
        if i.journal.as_ref().map(|j| &j.path) != Some(&path) {
            i.journal = Some(FileJournal::new(path));
        }
        Ok(i.journal.as_mut().unwrap())
    }

    // ---------------------------------------------------------------- the passphrase

    fn write_manifest(&self, i: &mut Inner, change: impl Fn(&mut Map<String, Value>)) -> Result<(), ShellError> {
        let base = i.base.clone().ok_or_else(unreachable_library)?;
        for _ in 0..5 {
            let (cur, etag) = read_manifest(&base).ok_or_else(|| ShellError::new("unreadable", "The library file can't be read right now."))?;
            let mut next = cur.clone();
            change(&mut next);
            if let WriteResult::Written(new_etag) = base.write(LIBRARY_FILE, &encode_manifest(&next), &IfMatch::Match(etag))? {
                i.known.note_own_change(LIBRARY_FILE, Some(&new_etag));
                self.use_manifest(i, next, new_etag);
                return Ok(());
            }
        }
        Err(ShellError::new("busy", "The library file kept changing. Try again."))
    }

    /// Unlocks an encrypted library. False when the passphrase is wrong.
    fn unlock(self: &Arc<Self>, i: &mut Inner, passphrase: &str) -> Result<bool, ShellError> {
        if passphrase.chars().count() > 1024 {
            return Err(ShellError::invalid("A passphrase is at most 1,024 characters."));
        }
        if i.manifest.is_none() {
            self.attach(i);
        }
        let Some(m) = i.manifest.clone() else {
            return Err(if i.state.is_none() { not_set_up() } else { unreachable_library() });
        };
        let Some(header) = i.header.clone() else { return Ok(true) };
        let Ok(Some(key)) = unlock_master_key(&header, passphrase) else { return Ok(false) };
        i.keys.set(&library_id_of(&m), key);
        let was_locked = i.enc.is_none();
        let etag = i.manifest_etag.clone().unwrap_or_default();
        self.use_manifest(i, m, etag);
        if was_locked {
            self.start_watching(i);
        }
        let _ = self.resume_encryption(i);
        Ok(true)
    }

    /// Turns encryption on (a passphrase), changes the passphrase of an unlocked library, or turns it off (None).
    /// On and off rewrite every file; that resumes after a restart.
    fn set_passphrase(self: &Arc<Self>, i: &mut Inner, passphrase: Option<&str>) -> Result<(), ShellError> {
        if let Some(p) = passphrase {
            let n = p.chars().count();
            if n == 0 || n > 1024 {
                return Err(ShellError::invalid("A passphrase is 1 to 1,024 characters."));
            }
        }
        self.current(i)?;
        self.stop_watching(i);
        let r = self.switch_encryption(i, passphrase);
        // Names on disk changed: a fresh baseline (also after a failure part way).
        if i.base.is_some() {
            self.start_watching(i);
        }
        r
    }

    fn switch_encryption(self: &Arc<Self>, i: &mut Inner, passphrase: Option<&str>) -> Result<(), ShellError> {
        let m = i.manifest.clone().ok_or_else(unreachable_library)?;
        let iterations = self.iterations.load(Ordering::Relaxed);
        let Some(passphrase) = passphrase else {
            if i.header.is_none() {
                return Ok(());
            }
            let s = i.state.clone().ok_or_else(not_set_up)?;
            self.save_state(i, Some(Stored { encryption_job: Some(Job { direction: "decrypt".into() }), ..s }));
            return self.run_encryption_job(i);
        };
        if i.header.is_some() {
            let key = self.key(i).ok_or_else(locked)?;
            let header = wrap_master_key(&key, passphrase, iterations, None, None).map_err(crypto_err)?;
            let hv = serde_json::to_value(&header).unwrap();
            return self.write_manifest(i, |c| {
                c.insert("encryption".into(), hv.clone());
            });
        }
        let (header, master) = create_encryption(passphrase, iterations).map_err(crypto_err)?;
        i.keys.set(&library_id_of(&m), master);
        let s = i.state.clone().ok_or_else(not_set_up)?;
        self.save_state(i, Some(Stored { encryption_job: Some(Job { direction: "encrypt".into() }), ..s }));
        let hv = serde_json::to_value(&header).unwrap();
        self.write_manifest(i, |c| {
            c.insert("encryption".into(), hv.clone());
        })?;
        self.run_encryption_job(i)
    }

    /// Changes the passphrase given the old one. False when the old one is wrong.
    fn change_passphrase(&self, i: &mut Inner, old: &str, new: &str) -> Result<bool, ShellError> {
        let n = new.chars().count();
        if n == 0 || n > 1024 {
            return Err(ShellError::invalid("A passphrase is 1 to 1,024 characters."));
        }
        let (Some(m), Some(header)) = (i.manifest.clone(), i.header.clone()) else { return Ok(false) };
        let Ok(Some(key)) = unlock_master_key(&header, old) else { return Ok(false) };
        let next = wrap_master_key(&key, new, header.kdf.iterations, None, None).map_err(crypto_err)?;
        let hv = serde_json::to_value(&next).unwrap();
        self.write_manifest(i, |c| {
            c.insert("encryption".into(), hv.clone());
        })?;
        i.keys.set(&library_id_of(&m), key);
        if let (Some(m), Some(etag)) = (i.manifest.clone(), i.manifest_etag.clone()) {
            self.use_manifest(i, m, etag);
        }
        Ok(true)
    }

    fn resume_encryption(self: &Arc<Self>, i: &mut Inner) -> Result<(), ShellError> {
        let Some(job) = i.state.as_ref().and_then(|s| s.encryption_job.clone()) else { return Ok(()) };
        if i.base.is_none() || i.manifest.is_none() {
            return Ok(());
        }
        if job.direction == "encrypt" && i.header.is_none() {
            // It stopped before the library file was written: nothing was converted.
            let s = i.state.clone().unwrap();
            self.save_state(i, Some(Stored { encryption_job: None, ..s }));
            return Ok(());
        }
        if self.key(i).is_none() {
            return Ok(()); // after unlock
        }
        self.stop_watching(i);
        let r = self.run_encryption_job(i);
        self.start_watching(i);
        r
    }

    /// Rewrites every file for the job in library.json; safe to run again (each file says what it is).
    fn run_encryption_job(&self, i: &mut Inner) -> Result<(), ShellError> {
        let (Some(plain), Some(job)) = (i.base.clone(), i.state.as_ref().and_then(|s| s.encryption_job.clone())) else { return Ok(()) };
        let key = self.key(i).ok_or_else(locked)?;
        let e = EncryptedFs::new(plain.clone(), key);
        let mut leftover = 0;
        for _ in 0..3 {
            leftover = 0;
            let entries: Vec<fs::Entry> = plain.list("")?.into_iter().filter(|e| e.path != LIBRARY_FILE).collect();
            let waiting: Vec<String> = entries.iter().filter(|e| !e.downloaded).map(|e| e.path.clone()).collect();
            if !waiting.is_empty() {
                let _ = plain.start_download(&waiting);
            }
            for entry in &entries {
                if !entry.downloaded {
                    leftover += 1;
                    continue;
                }
                let Ok(ReadResult::Bytes(bytes, etag)) = plain.read(&entry.path) else {
                    leftover += 1;
                    continue;
                };
                let is_plain = if entry.path.starts_with(&format!("{FILES_DIR}/")) { is_plain_attachment_path(&entry.path) } else { !is_envelope(&bytes) };
                if job.direction == "encrypt" && is_plain {
                    let target = e.physical(&entry.path)?;
                    let sealed = e.seal(&target, &bytes)?;
                    if target == entry.path {
                        if let WriteResult::Mismatch(_) = plain.write(&entry.path, &sealed, &IfMatch::Match(etag))? {
                            leftover += 1;
                        }
                    } else {
                        plain.write(&target, &sealed, &IfMatch::Any)?;
                        if plain.remove(&entry.path, Some(&etag)).is_err() {
                            leftover += 1;
                        }
                    }
                } else if job.direction == "decrypt" && !is_plain {
                    let (Some(logical), Ok(opened)) = (e.logical(&entry.path), e.open(&entry.path, &bytes)) else {
                        leftover += 1;
                        continue;
                    };
                    if logical == entry.path {
                        if let WriteResult::Mismatch(_) = plain.write(&entry.path, &opened, &IfMatch::Match(etag))? {
                            leftover += 1;
                        }
                    } else {
                        plain.write(&logical, &opened, &IfMatch::Any)?;
                        if plain.remove(&entry.path, Some(&etag)).is_err() {
                            leftover += 1;
                        }
                    }
                }
            }
            if leftover == 0 {
                break;
            }
        }
        if leftover > 0 {
            return Err(ShellError::new("not_downloaded", format!("{leftover} files couldn't be rewritten yet. Folevi will finish later.")));
        }
        if job.direction == "decrypt" {
            let id = i.manifest.as_ref().map(library_id_of).unwrap_or_default();
            self.write_manifest(i, |c| {
                c.insert("encryption".into(), Value::Null);
            })?;
            i.keys.clear(&id);
        }
        let s = i.state.clone().ok_or_else(not_set_up)?;
        self.save_state(i, Some(Stored { encryption_job: None, ..s }));
        if let (Some(m), Some(etag)) = (i.manifest.clone(), i.manifest_etag.clone()) {
            self.use_manifest(i, m, etag);
        }
        Ok(())
    }

    // ---------------------------------------------------------------- moving

    /// Copies the library to another place, checks every file arrived, then switches to it. The old folder is
    /// left as it was. Moving again, or restarting, picks up where it stopped (equal files are skipped).
    fn move_to(self: &Arc<Self>, i: &mut Inner, kind: &str, t: Target) -> ShellResult {
        let s = i.state.clone().ok_or_else(not_set_up)?;
        if is_cloud(&s.kind) || i.base.is_none() || i.manifest.is_none() {
            if !is_cloud(&s.kind) {
                self.attach(i);
            }
            if i.base.is_none() || i.manifest.is_none() {
                return Err(unreachable_library());
            }
        }
        let Target::Folder { path, chosen } = t;
        let from_root = i.base.as_ref().unwrap().root.clone();
        let from = std::fs::canonicalize(&from_root).unwrap_or(from_root);
        std::fs::create_dir_all(&path).map_err(|_| not_writable())?;
        let dest = std::fs::canonicalize(&path).map_err(|_| not_writable())?;
        let chosen_s = chosen.map(|c| c.to_string_lossy().into_owned());
        if dest == from {
            let chosen_folder = chosen_s.or(s.chosen_folder.clone());
            self.save_state(i, Some(Stored { kind: kind.into(), chosen_folder, ..s }));
            return Ok(self.info(i));
        }
        if inside(&dest, &from) || inside(&from, &dest) {
            return Err(ShellError::invalid("A library can't move into itself or into a folder that holds it."));
        }
        let mv = Move { kind: kind.into(), path: path.to_string_lossy().into_owned(), chosen_folder: chosen_s };
        self.save_state(i, Some(Stored { moving: Some(mv), ..s }));
        self.finish_move(i)?;
        Ok(self.info(i))
    }

    fn finish_move(self: &Arc<Self>, i: &mut Inner) -> Result<(), ShellError> {
        let Some(s) = i.state.clone() else { return Ok(()) };
        let Some(mv) = s.moving.clone() else { return Ok(()) };
        let src = match i.base.clone() {
            Some(b) => b,
            None => {
                if is_cloud(&s.kind) {
                    return Err(unreachable_library());
                }
                let b = Arc::new(FolderFs::new(&s.path));
                i.base = Some(b.clone());
                b
            }
        };
        let dst_root = PathBuf::from(&mv.path);
        std::fs::create_dir_all(&dst_root).map_err(|_| not_writable())?;
        if !FolderFs::probe_writable(&dst_root) {
            return Err(not_writable());
        }
        let dst = FolderFs::new(&dst_root);
        if let Some((theirs, _)) = read_manifest(&dst) {
            if library_id_of(&theirs) != s.library_id {
                return Err(ShellError::new("target_has_library", "That place already holds another Folevi library."));
            }
        }
        let mut entries = src.list("")?;
        let waiting: Vec<String> = entries.iter().filter(|e| !e.downloaded).map(|e| e.path.clone()).collect();
        if !waiting.is_empty() {
            let _ = src.start_download(&waiting);
            for _ in 0..120 {
                entries = src.list("")?;
                if entries.iter().all(|e| e.downloaded) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            if entries.iter().any(|e| !e.downloaded) {
                return Err(ShellError::new("not_downloaded", "Some files are still downloading. Folevi will finish moving the library later."));
            }
        }
        // The library file goes last: a place with it holds a whole library.
        let ordered = entries.iter().filter(|e| e.path != LIBRARY_FILE).chain(entries.iter().filter(|e| e.path == LIBRARY_FILE));
        for e in ordered {
            let ReadResult::Bytes(bytes, _) = src.read(&e.path)? else {
                return Err(ShellError::new("not_downloaded", "Some files are still downloading."));
            };
            if let Ok(ReadResult::Bytes(there, _)) = dst.read(&e.path) {
                if there == bytes {
                    continue;
                }
            }
            dst.write(&e.path, &bytes, &IfMatch::Any)?;
        }
        // Every file arrived whole.
        let copied: std::collections::HashMap<String, u64> = dst.list("")?.into_iter().map(|e| (e.path, e.size)).collect();
        for e in &entries {
            if copied.get(&e.path) != Some(&e.size) {
                return Err(ShellError::io(format!("{} didn't arrive whole. Moving again will finish it.", e.path)));
            }
        }
        let chosen_folder = mv.chosen_folder.clone().or(if mv.kind == "folder" { s.chosen_folder.clone() } else { None });
        let next = Stored { v: 1, kind: mv.kind, path: mv.path, library_id: s.library_id, chosen_folder, moving: None, encryption_job: s.encryption_job };
        self.save_state(i, Some(next));
        self.attach(i);
        Ok(())
    }

    // ---------------------------------------------------------------- attachments

    /// Where an attachment is kept: None when there's no library, it's locked, or it isn't one.
    fn locate_attachment(&self, sha: &str) -> Option<AttachmentPlace> {
        let mut i = self.inner.lock();
        let s = i.state.clone()?;
        if let Some(provider) = mirror::provider_of(&s.kind) {
            // A cloud library's copy on this PC; a file not here yet is asked of the bridge.
            let rel = format!("{FILES_DIR}/{}/{sha}", &sha[..2]);
            let mut abs = mirror::root(&self.o.user_data, provider).ok()?;
            abs.push(FILES_DIR);
            abs.push(&sha[..2]);
            abs.push(sha);
            return Some(AttachmentPlace { abs, rel, key: None, wait_for_arrival: true });
        }
        let base = i.base.clone()?;
        i.manifest.as_ref()?;
        let key = if i.header.is_some() { Some(self.key(&mut i)?) } else { None };
        let name = match &key {
            Some(k) => crypto::hmac_name(k, "file", sha).ok()?,
            None => sha.to_string(),
        };
        let rel = format!("{FILES_DIR}/{}/{name}", &name[..2]);
        let abs = base.abs(&rel).ok()?;
        Some(AttachmentPlace { abs, rel, key, wait_for_arrival: false })
    }

    // ---------------------------------------------------------------- a cloud library's copy

    fn mirror(&self, method: &str, o: &Value) -> ShellResult {
        let u = &self.o.user_data;
        let p = opt_str(o, "provider").unwrap_or("");
        let path = opt_str(o, "path").unwrap_or("");
        match method {
            "mirrorRead" => Ok(match mirror::read(u, p, path)? {
                Some((data, etag)) => json!({ "data": b64(&data), "etag": etag }),
                None => json!({ "missing": true }),
            }),
            "mirrorWrite" => {
                let data = req_bytes(o, "data").map_err(|_| ShellError::invalid("Bytes are needed."))?;
                mirror::write(u, p, path, &data, opt_str(o, "etag").unwrap_or(""))?;
                Ok(value(Value::Null))
            }
            "mirrorDelete" => {
                mirror::delete(u, p, path)?;
                Ok(value(Value::Null))
            }
            "mirrorPaths" => Ok(json!({ "paths": mirror::paths(u, p)? })),
            "mirrorLoadState" => Ok(json!({ "state": mirror::load_state(u, p)? })),
            "mirrorSaveState" => {
                mirror::save_state(u, p, opt_str(o, "state").unwrap_or("null"))?;
                Ok(value(Value::Null))
            }
            _ => Err(ShellError::unavailable("That isn't a library call Folevi knows.")),
        }
    }
}

#[cfg(test)]
mod tests;
