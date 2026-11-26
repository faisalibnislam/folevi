//! The library's files on this PC: local-store's `LocalFs` over a folder (docs/LOCAL_MODE_PLAN.md §3.6, §4.2), the
//! same contract as the Electron app's library/fs.ts and the iPhone's LibraryFS.swift.
//!
//! - Paths are checked (relative, forward slashes, no `..`, no control characters) and can't leave the folder,
//!   whatever links it holds.
//! - Etags are made of what both Windows and Linux say about a file: its id (the inode on Linux and macOS, the NTFS
//!   file index on Windows), its size and its modification time in nanoseconds. Opaque to the page; stable while
//!   the file is unchanged.
//! - Every file Folevi writes gets a modification time of its own (`unique_mtime`): now, to the microsecond, and
//!   never the same twice in this process. Linux hands a freed inode number straight to the next new file and
//!   stamps files with the kernel's coarse clock (a few ms), so without it two writes of the same size in one tick
//!   could leave the very etag a stale reader holds, and its compare-and-swap would win (an ABA).
//! - A write goes to `.folevi-tmp/`, is flushed to disk and renamed over the file (Windows refuses a rename over a
//!   file another program has open for a moment, so it's tried again briefly). Create-only (`ifMatch: null`)
//!   links the temp file in place, so it can't replace a file that appeared meanwhile.
//! - The guarantee for a string `ifMatch`: of writers holding one etag, at most one succeeds. Writers in this
//!   process take turns per path; every writer to the folder (other Folevi copies on this or another PC included)
//!   takes `.folevi-tmp/write.lock` (an OS file lock) across the final etag check and the rename, so no other
//!   Folevi write or remove lands in between. A sync app or editor that ignores the lock can still replace the
//!   file in that window of microseconds; nothing on these systems makes a rename conditional. A drive that
//!   can't lock files (some network shares) gets the in-process guarantee only.
//! - Listing skips hidden and temporary files, never follows links, and reports OneDrive's online-only files
//!   (and iCloud's `.name.icloud` placeholders) with `downloaded: false`.
use once_cell::sync::{Lazy, OnceCell};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::paths::{check_dir, check_path, from_placeholder_name, is_valid_library_path, placeholder_name, TMP_DIR};
use crate::shell::ShellError;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub etag: String,
    /// False for online-only files (OneDrive's Files On-Demand) and iCloud placeholders.
    pub downloaded: bool,
    pub has_conflicts: bool,
}

impl Entry {
    pub fn json(&self) -> Value {
        json!({ "path": self.path, "size": self.size, "mtimeMs": self.mtime_ms, "etag": self.etag, "downloaded": self.downloaded, "hasConflicts": self.has_conflicts })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReadResult {
    Bytes(Vec<u8>, String),
    NotDownloaded,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WriteResult {
    Written(String),
    Mismatch(String),
}

/// `ifMatch` as the page passes it: absent (write anyway), null (only if the file doesn't exist yet), or an etag.
#[derive(Debug, Clone, PartialEq)]
pub enum IfMatch {
    Any,
    Create,
    Match(String),
}

/// local-store's `LocalFs`, plus asking for files that aren't on this PC yet.
pub trait LibraryFs: Send + Sync {
    fn list(&self, dir: &str) -> Result<Vec<Entry>, ShellError>;
    fn read(&self, path: &str) -> Result<ReadResult, ShellError>;
    fn write(&self, path: &str, bytes: &[u8], if_match: &IfMatch) -> Result<WriteResult, ShellError>;
    fn remove(&self, path: &str, if_match: Option<&str>) -> Result<(), ShellError>;
    fn conflict_versions(&self, path: &str) -> Result<Vec<(String, Vec<u8>)>, ShellError>;
    fn resolve_conflicts(&self, path: &str, ids: &[String]) -> Result<(), ShellError>;
    fn start_download(&self, paths: &[String]) -> Result<(), ShellError>;
}

/// Names never listed: our temp folder, the system's and the sync apps' own files.
const IGNORED: &[&str] = &[
    TMP_DIR,
    ".DS_Store",
    ".dropbox",
    ".dropbox.attr",
    ".dropbox.cache",
    "Icon\r",
    ".tmp.drivedownload",
    ".tmp.driveupload",
    ".Trash",
    ".Trashes",
    "desktop.ini",
    "Desktop.ini",
    "Thumbs.db",
];

pub fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name)
}

pub fn not_found(path: &str) -> ShellError {
    ShellError::not_found("That file isn't in the library.").with_path(path)
}

pub fn io_error(e: io::Error, path: &str) -> ShellError {
    if e.kind() == io::ErrorKind::NotFound {
        return not_found(path);
    }
    ShellError::io(format!("Folevi couldn't use a file in the library ({e}).")).with_path(path)
}

// ---------------------------------------------------------------- stat and etags

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stat {
    pub id: u128,
    pub size: u64,
    pub mtime_ns: u128,
    pub online_only: bool,
}

fn ns(t: io::Result<SystemTime>) -> u128 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0)
}

#[cfg(windows)]
fn file_id(m: &Metadata) -> u128 {
    // Only a fallback (no handle to ask): the creation time in 100 ns units. NTFS "tunnels" a replaced file's creation
    // time to the file that takes its name, so the real file index (windows_index) is used wherever there's a handle.
    use std::os::windows::fs::MetadataExt;
    m.creation_time() as u128
}

/// The file's identity on Windows: its volume's serial number and NTFS file index, which every new file (the temp
/// file a write renames into place included) gets afresh. None if Windows won't say.
#[cfg(windows)]
fn windows_index(f: &fs::File) -> Option<u128> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(f.as_raw_handle() as _, &mut info) };
    (ok != 0).then(|| ((info.dwVolumeSerialNumber as u128) << 64) | ((info.nFileIndexHigh as u128) << 32) | info.nFileIndexLow as u128)
}

/// A handle for asking a file's identity: attributes only, sharing everything, never following a link.
#[cfg(windows)]
fn open_for_stat(path: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_READ_ATTRIBUTES: u32 = 0x80;
    const SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).share_mode(SHARE_ALL).custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(path)
}

#[cfg(unix)]
fn file_id(m: &Metadata) -> u128 {
    use std::os::unix::fs::MetadataExt;
    m.ino() as u128
}

#[cfg(not(any(unix, windows)))]
fn file_id(_m: &Metadata) -> u128 {
    0
}

/// OneDrive's (and other cloud filter drivers') files whose contents are only in the cloud.
#[cfg(windows)]
fn online_only(m: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_OPEN: u32 = 0x0004_0000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
    m.file_attributes() & (OFFLINE | RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS) != 0
}

#[cfg(not(windows))]
fn online_only(_m: &Metadata) -> bool {
    false
}

impl Stat {
    pub fn of_meta(m: &Metadata) -> Stat {
        Stat { id: file_id(m), size: m.len(), mtime_ns: ns(m.modified()), online_only: online_only(m) }
    }

    /// The stat of an open file: on Windows with its real file index (see windows_index).
    pub fn of_file(f: &fs::File, m: &Metadata) -> Stat {
        #[cfg(windows)]
        if let Some(id) = windows_index(f) {
            return Stat { id, ..Stat::of_meta(m) };
        }
        let _ = f;
        Stat::of_meta(m)
    }

    pub fn etag(&self) -> String {
        format!("{}-{}-{}", radix36(self.id), radix36(self.size as u128), radix36(self.mtime_ns))
    }

    pub fn mtime_ms(&self) -> f64 {
        self.mtime_ns as f64 / 1_000_000.0
    }
}

pub fn radix36(mut v: u128) -> String {
    const D: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if v == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while v > 0 {
        out.push(D[(v % 36) as usize]);
        v /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

/// A regular file's stat (not a link, not a folder), or None when there's none.
pub fn stat_file(path: &Path) -> io::Result<Option<Stat>> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_file() => {
            #[cfg(windows)]
            if let Ok(f) = open_for_stat(path) {
                return Ok(Some(Stat::of_file(&f, &m)));
            }
            Ok(Some(Stat::of_meta(&m)))
        }
        Ok(_) => Ok(None),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) if is_not_a_dir(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

fn is_not_a_dir(e: &io::Error) -> bool {
    // ENOTDIR on Unix; ERROR_PATH_NOT_FOUND / ERROR_DIRECTORY on Windows.
    #[cfg(unix)]
    {
        e.raw_os_error() == Some(20)
    }
    #[cfg(windows)]
    {
        matches!(e.raw_os_error(), Some(3) | Some(267))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = e;
        false
    }
}

// ---------------------------------------------------------------- small file helpers shared with the journal

/// fsync on a folder, so a rename in it is on disk too. Best effort (Windows can't open a folder this way).
pub fn fsync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(f) = File::open(dir) {
        let _ = f.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn retryable(e: &io::Error) -> bool {
    // Windows: another program (an antivirus scanner, the search indexer, a sync app) has the file open for a
    // moment: ERROR_ACCESS_DENIED (5) or ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33).
    cfg!(windows) && (e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33)))
}

/// `rename`, tried again briefly while Windows says the target is in use.
pub fn rename_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 0u64;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if retryable(&e) && attempt < 10 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(10 * attempt));
            }
            Err(e) => return Err(e),
        }
    }
}

fn remove_file_retry(path: &Path) -> io::Result<()> {
    let mut attempt = 0u64;
    loop {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if retryable(&e) && attempt < 10 => {
                attempt += 1;
                std::thread::sleep(Duration::from_millis(10 * attempt));
            }
            Err(e) => return Err(e),
        }
    }
}

/// A modification time for a file Folevi is about to put in place: now, rounded to the microsecond (NTFS keeps
/// 100 ns, ext4 and APFS 1 ns, so it survives), and always later than the last one this process handed out.
pub fn unique_mtime() -> SystemTime {
    static LAST: Lazy<Mutex<u128>> = Lazy::new(|| Mutex::new(0));
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros()).unwrap_or(0);
    let mut last = LAST.lock();
    *last = now.max(*last + 1);
    UNIX_EPOCH + Duration::from_micros(*last as u64)
}

/// The OS lock on `.folevi-tmp/write.lock` that every Folevi writer to a folder takes across its etag check and
/// rename. None when the folder's drive can't lock (the write then relies on the in-process lock alone).
struct FolderLock(File);

impl FolderLock {
    const NAME: &'static str = "write.lock";

    fn take(root: &Path) -> Option<FolderLock> {
        let dir = root.join(TMP_DIR);
        let _ = fs::create_dir_all(&dir);
        let f = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(dir.join(Self::NAME)).ok()?;
        f.lock().ok()?;
        Some(FolderLock(f))
    }
}

impl Drop for FolderLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

fn random_name() -> String {
    hex::encode(super::crypto::random_bytes::<16>())
}

// ---------------------------------------------------------------- locks shared by every FolderFs in the process

static LOCKS: Lazy<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Runs `work` alone for one absolute path: writers in this process take turns.
fn with_path_lock<T>(key: &Path, work: impl FnOnce() -> T) -> T {
    let lock = LOCKS.lock().entry(key.to_path_buf()).or_insert_with(|| Arc::new(Mutex::new(()))).clone();
    let out = {
        let _held = lock.lock();
        work()
    };
    let mut all = LOCKS.lock();
    if Arc::strong_count(&lock) == 2 {
        all.remove(key);
    }
    out
}

// ---------------------------------------------------------------- the folder

pub struct FolderFs {
    pub root: PathBuf,
    real_root: OnceCell<PathBuf>,
}

impl FolderFs {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into(), real_root: OnceCell::new() }
    }

    /// The folder with its links resolved (it must exist).
    pub fn real_root(&self) -> Result<&Path, ShellError> {
        self.real_root
            .get_or_try_init(|| fs::canonicalize(&self.root))
            .map(PathBuf::as_path)
            .map_err(|e| ShellError::io(format!("The library folder isn't there ({e}).")))
    }

    /// The absolute path for a library path, after checking that no link on the way leads out of the folder.
    pub fn abs(&self, path: &str) -> Result<PathBuf, ShellError> {
        check_path(path)?;
        let root = self.real_root()?;
        let mut full = root.to_path_buf();
        for part in path.split('/') {
            if !is_plain_part(part) {
                return Err(ShellError::new("invalid_path", "That name can't be used in a folder on this PC.").with_path(path));
            }
            full.push(part);
        }
        // The deepest folder on the way that exists must resolve inside the library.
        let mut dir = full.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            match fs::canonicalize(&d) {
                Ok(real) => {
                    if !real.starts_with(root) {
                        return Err(ShellError::new("invalid_path", "That path leads out of the library.").with_path(path));
                    }
                    break;
                }
                Err(_) => {
                    if d.as_path() == root || !d.starts_with(root) {
                        break;
                    }
                    dir = d.parent().map(Path::to_path_buf);
                }
            }
        }
        // The file itself must not be a link.
        if let Ok(m) = fs::symlink_metadata(&full) {
            if m.file_type().is_symlink() {
                return Err(ShellError::new("invalid_path", "That's a link, not a file.").with_path(path));
            }
        }
        Ok(full)
    }

    fn placeholder_of(abs: &Path) -> PathBuf {
        let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        abs.with_file_name(placeholder_name(&name))
    }

    fn entry_for(path: String, s: &Stat, placeholder: bool) -> Entry {
        Entry {
            path,
            size: if placeholder { 0 } else { s.size },
            mtime_ms: s.mtime_ms(),
            etag: if placeholder { format!("p{}", s.etag()) } else { s.etag() },
            downloaded: !placeholder && !s.online_only,
            has_conflicts: false,
        }
    }

    /// One entry by path (None when missing): what the locked library's watcher looks at.
    pub fn entry(&self, path: &str) -> Result<Option<Entry>, ShellError> {
        let abs = self.abs(path)?;
        if let Some(s) = stat_file(&abs).map_err(|e| io_error(e, path))? {
            return Ok(Some(Self::entry_for(path.to_string(), &s, false)));
        }
        Ok(stat_file(&Self::placeholder_of(&abs)).ok().flatten().map(|s| Self::entry_for(path.to_string(), &s, true)))
    }

    fn current_etag(abs: &Path) -> String {
        if let Ok(Some(s)) = stat_file(abs) {
            return s.etag();
        }
        match stat_file(&Self::placeholder_of(abs)) {
            Ok(Some(s)) => format!("p{}", s.etag()),
            _ => String::new(),
        }
    }

    fn write_plain(&self, abs: &Path, path: &str, bytes: &[u8], if_match: &IfMatch) -> Result<WriteResult, ShellError> {
        let root = self.real_root()?.to_path_buf();
        let current = Self::current_etag(abs);
        match if_match {
            IfMatch::Create if !current.is_empty() => return Ok(WriteResult::Mismatch(current)),
            IfMatch::Match(e) if &current != e => return Ok(WriteResult::Mismatch(current)),
            _ => {}
        }
        let tmp_dir = root.join(TMP_DIR);
        fs::create_dir_all(&tmp_dir).map_err(|e| io_error(e, path))?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).map_err(|e| io_error(e, path))?;
        }
        // Checked again now that the folders exist: a linked folder made meanwhile can't redirect the write.
        self.abs(path)?;
        let tmp = tmp_dir.join(format!("{}.tmp", random_name()));
        let result = (|| -> Result<WriteResult, ShellError> {
            {
                let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| io_error(e, path))?;
                f.write_all(bytes).map_err(|e| io_error(e, path))?;
                // Best effort: a drive that won't take a time keeps its own (the etag is then only as fine as it).
                let _ = f.set_modified(unique_mtime());
                f.sync_all().map_err(|e| io_error(e, path))?;
            }
            // Held until the result's etag is read, so it's this write's etag and not a later one's.
            let _folder = FolderLock::take(&root);
            match if_match {
                IfMatch::Create => match fs::hard_link(&tmp, abs) {
                    // Create only: link() fails if the name exists, atomically, whoever made it.
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(WriteResult::Mismatch(Self::current_etag(abs))),
                    // A drive without hard links (FAT, exFAT, some network shares): an exclusive create instead.
                    Err(_) => {
                        let mut f = match OpenOptions::new().write(true).create_new(true).open(abs) {
                            Ok(f) => f,
                            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Ok(WriteResult::Mismatch(Self::current_etag(abs))),
                            Err(e) => return Err(io_error(e, path)),
                        };
                        f.write_all(bytes).map_err(|e| io_error(e, path))?;
                        let _ = f.set_modified(unique_mtime());
                        f.sync_all().map_err(|e| io_error(e, path))?;
                    }
                },
                IfMatch::Match(expected) => {
                    let now = Self::current_etag(abs);
                    if &now != expected {
                        return Ok(WriteResult::Mismatch(now));
                    }
                    rename_retry(&tmp, abs).map_err(|e| io_error(e, path))?;
                }
                IfMatch::Any => rename_retry(&tmp, abs).map_err(|e| io_error(e, path))?,
            }
            if let Some(parent) = abs.parent() {
                fsync_dir(parent);
            }
            // A placeholder for the same name is stale now.
            let _ = fs::remove_file(Self::placeholder_of(abs));
            match stat_file(abs).map_err(|e| io_error(e, path))? {
                Some(s) => Ok(WriteResult::Written(s.etag())),
                None => Err(ShellError::io("The file vanished right after it was written.").with_path(path)),
            }
        })();
        let _ = fs::remove_file(&tmp);
        result
    }

    /// Clears `.folevi-tmp/` of files a crash left behind (older than a minute, so a write in flight is safe).
    pub fn clean_temp(&self) -> usize {
        let Ok(root) = self.real_root() else { return 0 };
        let Ok(names) = fs::read_dir(root.join(TMP_DIR)) else { return 0 };
        let mut removed = 0;
        for e in names.flatten() {
            if e.file_name() == FolderLock::NAME {
                continue;
            }
            let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > Duration::from_secs(60));
            if old && fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
        removed
    }

    /// Whether Folevi can write here: a probe file goes in and out of `.folevi-tmp/`.
    pub fn probe_writable(dir: &Path) -> bool {
        let tmp = dir.join(TMP_DIR);
        if fs::create_dir_all(&tmp).is_err() {
            return false;
        }
        let probe = tmp.join(format!("probe-{}", random_name()));
        match OpenOptions::new().write(true).create_new(true).open(&probe) {
            Ok(f) => {
                drop(f);
                fs::remove_file(&probe).is_ok()
            }
            Err(_) => false,
        }
    }
}

/// One part of a library path that names exactly one entry in a folder on this PC.
fn is_plain_part(part: &str) -> bool {
    let mut c = Path::new(part).components();
    let one = matches!((c.next(), c.next()), (Some(std::path::Component::Normal(n)), None) if n == std::ffi::OsStr::new(part));
    if !one {
        return false;
    }
    if cfg!(windows) {
        // Windows reads these as drives, streams or wildcards, and drops a trailing dot or space.
        if part.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')) || part.ends_with('.') || part.ends_with(' ') {
            return false;
        }
    }
    true
}

impl LibraryFs for FolderFs {
    fn list(&self, dir: &str) -> Result<Vec<Entry>, ShellError> {
        check_dir(dir)?;
        let root = self.real_root()?.to_path_buf();
        let start = if dir.is_empty() { root.clone() } else { self.abs(dir)? };
        struct Found {
            path: String,
            abs: PathBuf,
            placeholder: bool,
        }
        let mut files: Vec<Found> = Vec::new();
        let mut stack = vec![start];
        while let Some(abs_dir) = stack.pop() {
            let names = match fs::read_dir(&abs_dir) {
                Ok(n) => n,
                Err(e) if e.kind() == io::ErrorKind::NotFound || is_not_a_dir(&e) => continue,
                Err(e) => {
                    if abs_dir == root {
                        return Err(io_error(e, dir));
                    }
                    continue;
                }
            };
            for item in names.flatten() {
                let Ok(name) = item.file_name().into_string() else { continue };
                if is_ignored(&name) {
                    continue;
                }
                let real = from_placeholder_name(&name).map(str::to_string);
                if name.starts_with('.') && real.is_none() {
                    continue;
                }
                let abs = item.path();
                let Ok(m) = fs::symlink_metadata(&abs) else { continue };
                let ft = m.file_type();
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    if real.is_none() {
                        stack.push(abs);
                    }
                    continue;
                }
                if !ft.is_file() {
                    continue;
                }
                let shown = match &real {
                    Some(r) => abs_dir.join(r),
                    None => abs.clone(),
                };
                let Ok(rel) = shown.strip_prefix(&root) else { continue };
                let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
                let Some(parts) = parts else { continue };
                let path = parts.join("/");
                if !is_valid_library_path(&path) {
                    continue;
                }
                files.push(Found { path, abs, placeholder: real.is_some() });
            }
        }
        // A placeholder and its downloaded file both present: the file wins.
        let mut by_path: HashMap<String, Found> = HashMap::new();
        for f in files {
            let keep = by_path.get(&f.path).map(|old| old.placeholder && !f.placeholder).unwrap_or(true);
            if keep {
                by_path.insert(f.path.clone(), f);
            }
        }
        let mut out: Vec<Entry> = Vec::with_capacity(by_path.len());
        for (_, f) in by_path {
            if let Ok(Some(s)) = stat_file(&f.abs) {
                out.push(Self::entry_for(f.path, &s, f.placeholder));
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn read(&self, path: &str) -> Result<ReadResult, ShellError> {
        let abs = self.abs(path)?;
        for _ in 0..3 {
            let mut f = match File::open(&abs) {
                Ok(f) => f,
                Err(e) if e.kind() == io::ErrorKind::NotFound || is_not_a_dir(&e) => {
                    if stat_file(&Self::placeholder_of(&abs)).ok().flatten().is_some() {
                        return Ok(ReadResult::NotDownloaded);
                    }
                    return Err(not_found(path));
                }
                Err(e) => return Err(io_error(e, path)),
            };
            let before = f.metadata().map_err(|e| io_error(e, path))?;
            if !before.is_file() {
                return Err(not_found(path));
            }
            let mut bytes = Vec::with_capacity(before.len() as usize);
            f.read_to_end(&mut bytes).map_err(|e| io_error(e, path))?;
            let after = f.metadata().map_err(|e| io_error(e, path))?;
            // An open file stays one file, so a rename can't tear the read; another program rewriting it in
            // place could, and shows as a changed size or time.
            let (b, a) = (Stat::of_file(&f, &before), Stat::of_file(&f, &after));
            if b.size == a.size && b.mtime_ns == a.mtime_ns && bytes.len() as u64 == a.size {
                return Ok(ReadResult::Bytes(bytes, a.etag()));
            }
        }
        Err(ShellError::new("unreadable", "The file kept changing while Folevi read it.").with_path(path))
    }

    fn write(&self, path: &str, bytes: &[u8], if_match: &IfMatch) -> Result<WriteResult, ShellError> {
        let abs = self.abs(path)?;
        with_path_lock(&abs.clone(), || self.write_plain(&abs, path, bytes, if_match))
    }

    fn remove(&self, path: &str, if_match: Option<&str>) -> Result<(), ShellError> {
        let abs = self.abs(path)?;
        let root = self.real_root()?.to_path_buf();
        with_path_lock(&abs.clone(), || {
            let _folder = FolderLock::take(&root);
            let current = Self::current_etag(&abs);
            if current.is_empty() {
                return Ok(());
            }
            if let Some(expected) = if_match {
                if current != expected {
                    return Err(ShellError::new("mismatch", "The file changed since it was read.").with_path(path));
                }
            }
            let target = if current.starts_with('p') { Self::placeholder_of(&abs) } else { abs.clone() };
            match remove_file_retry(&target) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(io_error(e, path)),
            }
            if let Some(parent) = abs.parent() {
                fsync_dir(parent);
            }
            // Empty folders a remove leaves behind (history/<id>/, files/<aa>/) go too; the top-level ones stay.
            let mut dir = abs.parent().map(Path::to_path_buf);
            while let Some(d) = dir {
                let depth = d.strip_prefix(&root).map(|r| r.components().count()).unwrap_or(0);
                if depth < 2 || fs::remove_dir(&d).is_err() {
                    break;
                }
                dir = d.parent().map(Path::to_path_buf);
            }
            Ok(())
        })
    }

    fn conflict_versions(&self, path: &str) -> Result<Vec<(String, Vec<u8>)>, ShellError> {
        // Plain folders keep no conflict versions: sync apps make conflicted copies, which the page merges.
        self.abs(path)?;
        Ok(Vec::new())
    }

    fn resolve_conflicts(&self, path: &str, _ids: &[String]) -> Result<(), ShellError> {
        self.abs(path)?;
        Ok(())
    }

    /// Online-only files (OneDrive and other cloud drives on Windows) are brought down by reading them on a
    /// thread of their own; the next scan reports them as "downloaded".
    fn start_download(&self, paths: &[String]) -> Result<(), ShellError> {
        let mut wanted = Vec::new();
        for p in paths {
            let abs = self.abs(p)?;
            if stat_file(&abs).ok().flatten().is_some_and(|s| s.online_only) {
                wanted.push(abs);
            }
        }
        if !wanted.is_empty() {
            std::thread::spawn(move || {
                for abs in wanted {
                    if let Ok(mut f) = File::open(&abs) {
                        let _ = io::copy(&mut f, &mut io::sink());
                    }
                }
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> (tempfile::TempDir, FolderFs) {
        let d = tempfile::tempdir().unwrap();
        let fs = FolderFs::new(d.path());
        (d, fs)
    }

    fn etag_of(r: WriteResult) -> String {
        match r {
            WriteResult::Written(e) => e,
            WriteResult::Mismatch(e) => panic!("mismatch {e}"),
        }
    }

    fn bytes(r: ReadResult) -> (Vec<u8>, String) {
        match r {
            ReadResult::Bytes(b, e) => (b, e),
            ReadResult::NotDownloaded => panic!("not downloaded"),
        }
    }

    #[test]
    fn write_read_list_and_etags() {
        let (_d, fs) = tmp();
        let e1 = etag_of(fs.write("notes/A.fnote", b"one", &IfMatch::Any).unwrap());
        let (b, e) = bytes(fs.read("notes/A.fnote").unwrap());
        assert_eq!((b.as_slice(), e.as_str()), (&b"one"[..], e1.as_str()));
        let list = fs.list("").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].path.as_str(), list[0].etag.as_str(), list[0].size, list[0].downloaded), ("notes/A.fnote", e1.as_str(), 3, true));
        // A new write is a new etag.
        let e2 = etag_of(fs.write("notes/A.fnote", b"two", &IfMatch::Any).unwrap());
        assert_ne!(e1, e2);
        assert_eq!(fs.list("notes").unwrap()[0].etag, e2);
        assert_eq!(fs.list("nothing-here").unwrap(), vec![]);
        assert_eq!(fs.read("notes/B.fnote").unwrap_err().code, "not_found");
    }

    #[test]
    fn create_and_match_semantics() {
        let (_d, fs) = tmp();
        let e1 = etag_of(fs.write("x/a", b"1", &IfMatch::Create).unwrap());
        // Create-only over an existing file: a mismatch with its etag.
        assert_eq!(fs.write("x/a", b"2", &IfMatch::Create).unwrap(), WriteResult::Mismatch(e1.clone()));
        // A stale etag: a mismatch with the current one, and nothing written.
        assert_eq!(fs.write("x/a", b"3", &IfMatch::Match("stale".into())).unwrap(), WriteResult::Mismatch(e1.clone()));
        assert_eq!(bytes(fs.read("x/a").unwrap()).0, b"1");
        let e2 = etag_of(fs.write("x/a", b"22", &IfMatch::Match(e1.clone())).unwrap());
        assert_ne!(e1, e2);
        // Matching a file that isn't there: the current etag is "".
        assert_eq!(fs.write("x/b", b"1", &IfMatch::Match("e".into())).unwrap(), WriteResult::Mismatch(String::new()));
        // Removes: a stale etag is refused; a missing file is fine.
        assert_eq!(fs.remove("x/a", Some(&e1)).unwrap_err().code, "mismatch");
        fs.remove("x/a", Some(&e2)).unwrap();
        fs.remove("x/a", None).unwrap();
        assert_eq!(fs.read("x/a").unwrap_err().code, "not_found");
    }

    #[test]
    fn of_many_writers_holding_one_etag_exactly_one_wins() {
        let (_d, fs) = tmp();
        let start = etag_of(fs.write("notes/A.fnote", b"0", &IfMatch::Any).unwrap());
        let fs = Arc::new(fs);
        let handles: Vec<_> = (0..12)
            .map(|i| {
                let (fs, start) = (fs.clone(), start.clone());
                std::thread::spawn(move || matches!(fs.write("notes/A.fnote", format!("w{i}").as_bytes(), &IfMatch::Match(start)).unwrap(), WriteResult::Written(_)))
            })
            .collect();
        let wins = handles.into_iter().map(|h| h.join().unwrap()).filter(|w| *w).count();
        assert_eq!(wins, 1);
        // And of many creators, one.
        let creators: Vec<_> = (0..12)
            .map(|i| {
                let fs = fs.clone();
                std::thread::spawn(move || matches!(fs.write("notes/new.fnote", format!("c{i}").as_bytes(), &IfMatch::Create).unwrap(), WriteResult::Written(_)))
            })
            .collect();
        assert_eq!(creators.into_iter().map(|h| h.join().unwrap()).filter(|w| *w).count(), 1);
    }

    #[test]
    fn the_folder_lock_shuts_out_every_other_handle() {
        // Another Folevi (another process) opens the lock file on its own handle: it must be refused while one
        // writer holds it, and get it once that writer is done.
        let d = tempfile::tempdir().unwrap();
        let held = FolderLock::take(d.path()).expect("the temp folder's drive can lock");
        let other = File::options().read(true).write(true).open(d.path().join(TMP_DIR).join(FolderLock::NAME)).unwrap();
        assert!(matches!(other.try_lock(), Err(fs::TryLockError::WouldBlock)));
        drop(held);
        other.try_lock().unwrap();
        // clean_temp never takes the lock file away, however old.
        other.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
        assert_eq!(FolderFs::new(d.path()).clean_temp(), 0);
    }

    #[test]
    fn quick_same_size_rewrites_never_repeat_an_etag() {
        // Linux reuses a freed inode at once and its file times are coarse: without unique_mtime, rewriting a
        // file with the same size in one clock tick could bring back an etag a stale reader still holds.
        let (_d, fs) = tmp();
        let mut seen = std::collections::HashSet::new();
        for i in 0..300u32 {
            let e = etag_of(fs.write("f", format!("{:03}", i % 1000).as_bytes(), &IfMatch::Any).unwrap());
            assert!(seen.insert(e.clone()), "etag {e} came back on write {i}");
        }
    }

    #[test]
    fn two_folder_fs_on_one_folder_never_lose_increments() {
        let d = tempfile::tempdir().unwrap();
        let a = Arc::new(FolderFs::new(d.path()));
        let b = Arc::new(FolderFs::new(d.path()));
        a.write("n", b"0", &IfMatch::Any).unwrap();
        let worker = |fs: Arc<FolderFs>| {
            std::thread::spawn(move || {
                for _ in 0..20 {
                    loop {
                        let (v, e) = bytes(fs.read("n").unwrap());
                        let n: u32 = String::from_utf8(v).unwrap().parse().unwrap();
                        if matches!(fs.write("n", (n + 1).to_string().as_bytes(), &IfMatch::Match(e)).unwrap(), WriteResult::Written(_)) {
                            break;
                        }
                    }
                }
            })
        };
        let (x, y) = (worker(a.clone()), worker(b));
        x.join().unwrap();
        y.join().unwrap();
        assert_eq!(bytes(a.read("n").unwrap()).0, b"40");
    }

    #[test]
    fn a_reader_never_sees_a_torn_file() {
        let (_d, fs) = tmp();
        let fs = Arc::new(fs);
        let big = |c: u8| vec![c; 256 * 1024];
        fs.write("f", &big(b'a'), &IfMatch::Any).unwrap();
        let w = {
            let fs = fs.clone();
            std::thread::spawn(move || {
                for i in 0..30u8 {
                    fs.write("f", &big(b'a' + (i % 26)), &IfMatch::Any).unwrap();
                }
            })
        };
        for _ in 0..60 {
            let (b, _) = bytes(fs.read("f").unwrap());
            assert_eq!(b.len(), 256 * 1024);
            assert!(b.iter().all(|&c| c == b[0]));
        }
        w.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_cant_lead_a_read_or_write_out_of_the_library() {
        let (d, fs) = tmp();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"s").unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("out")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret"), d.path().join("link")).unwrap();
        assert_eq!(fs.read("out/secret").unwrap_err().code, "invalid_path");
        assert_eq!(fs.write("out/new", b"x", &IfMatch::Any).unwrap_err().code, "invalid_path");
        assert_eq!(fs.read("link").unwrap_err().code, "invalid_path");
        assert!(!outside.path().join("new").exists());
        // Links aren't listed.
        assert_eq!(fs.list("").unwrap(), vec![]);
    }

    #[test]
    fn bad_paths_are_refused() {
        let (_d, fs) = tmp();
        for p in ["", "../x", "/abs", "a//b", "a\\b", "a/./b"] {
            assert_eq!(fs.write(p, b"x", &IfMatch::Any).unwrap_err().code, "invalid_path", "{p:?}");
        }
        assert_eq!(fs.list("../").unwrap_err().code, "invalid_path");
    }

    #[test]
    fn skips_hidden_temporary_and_provider_files_and_shows_placeholders() {
        let (d, fs) = tmp();
        let r = d.path();
        std::fs::create_dir_all(r.join("notes")).unwrap();
        std::fs::create_dir_all(r.join(".folevi-tmp")).unwrap();
        std::fs::create_dir_all(r.join(".dropbox.cache")).unwrap();
        std::fs::write(r.join("notes/A.fnote"), "a").unwrap();
        std::fs::write(r.join("notes/.B.fnote.icloud"), "plist").unwrap();
        std::fs::write(r.join("notes/.DS_Store"), "x").unwrap();
        std::fs::write(r.join("notes/.hidden"), "x").unwrap();
        std::fs::write(r.join("notes/desktop.ini"), "x").unwrap();
        std::fs::write(r.join(".folevi-tmp/t.tmp"), "x").unwrap();
        std::fs::write(r.join(".dropbox.cache/c"), "x").unwrap();
        let got: Vec<(String, bool)> = fs.list("").unwrap().into_iter().map(|e| (e.path, e.downloaded)).collect();
        assert_eq!(got, vec![("notes/A.fnote".to_string(), true), ("notes/B.fnote".to_string(), false)]);
        assert_eq!(fs.read("notes/B.fnote").unwrap(), ReadResult::NotDownloaded);
        // Writing the real file replaces the placeholder.
        fs.write("notes/B.fnote", b"b", &IfMatch::Any).unwrap();
        assert!(!r.join("notes/.B.fnote.icloud").exists());
        assert_eq!(fs.list("notes").unwrap().iter().map(|e| e.downloaded).collect::<Vec<_>>(), vec![true, true]);
    }

    #[test]
    fn a_remove_takes_empty_subfolders_never_top_level_ones() {
        let (d, fs) = tmp();
        fs.write("history/X/a.fver", b"a", &IfMatch::Any).unwrap();
        fs.write("files/ab/abcdef0123456789", b"f", &IfMatch::Any).unwrap();
        fs.remove("history/X/a.fver", None).unwrap();
        fs.remove("files/ab/abcdef0123456789", None).unwrap();
        assert!(!d.path().join("history/X").exists());
        assert!(d.path().join("history").exists());
        assert!(!d.path().join("files/ab").exists());
    }

    #[test]
    fn temp_files_a_crash_left_are_cleaned_but_not_a_write_in_flight() {
        let (d, fs) = tmp();
        let t = d.path().join(".folevi-tmp");
        std::fs::create_dir_all(&t).unwrap();
        std::fs::write(t.join("old.tmp"), "x").unwrap();
        std::fs::write(t.join("new.tmp"), "x").unwrap();
        let old = std::fs::File::options().write(true).open(t.join("old.tmp")).unwrap();
        old.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
        drop(old);
        assert_eq!(fs.clean_temp(), 1);
        let left: Vec<String> = std::fs::read_dir(&t).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        assert_eq!(left, vec!["new.tmp".to_string()]);
    }

    #[test]
    fn radix36_and_probe() {
        assert_eq!(radix36(0), "0");
        assert_eq!(radix36(35), "z");
        assert_eq!(radix36(36), "10");
        let d = tempfile::tempdir().unwrap();
        assert!(FolderFs::probe_writable(&d.path().join("new")));
    }
}
