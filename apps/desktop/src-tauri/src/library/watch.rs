//! Change detection for the library folder (docs/LOCAL_MODE_PLAN.md §3.7): the system's file notifications
//! (ReadDirectoryChangesW on Windows, inotify on Linux, through `notify`) for speed, plus a full listing as a safety
//! net, because notifications can be dropped or coalesced and sync apps write behind their back. The listing runs
//! every 30 seconds while notifications aren't working (none could be set up, or one reported an error), and only
//! every few minutes while they are, so an idle library isn't walked twice a minute; the app also rescans when its
//! window comes to the front. Every listing
//! is compared with the state last reported, so the page gets one batch per burst of changes, each path once,
//! in path order, and never its own writes back (the service notes them). The same batches as the iPhone's
//! LibraryWatcher.swift: [{ path, kind }], kind "changed" (new or a different etag), "removed" or "downloaded"
//! (an online-only file's contents arrived).
use notify::{RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use super::fs::Entry;
use super::paths::TMP_DIR;

pub const SCAN_INTERVAL: Duration = Duration::from_secs(30);
/// How many SCAN_INTERVALs apart the safety-net listings are while notifications are working (5 minutes).
const WATCHED_FACTOR: u32 = 10;
pub const DEBOUNCE: Duration = Duration::from_millis(300);
/// A steady stream of events still gets a scan this often.
const MAX_DELAY: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
struct Known {
    etag: String,
    downloaded: bool,
}

/// What was last reported, path by path.
#[derive(Default)]
pub struct WatchState {
    known: HashMap<String, Known>,
}

impl WatchState {
    /// The first listing: nothing is reported for it.
    pub fn baseline(&mut self, entries: &[Entry]) {
        self.known = entries.iter().map(|e| (e.path.clone(), Known { etag: e.etag.clone(), downloaded: e.downloaded })).collect();
    }

    pub fn clear(&mut self) {
        self.known.clear();
    }

    /// The page wrote or removed this file itself: remember it so it isn't reported back.
    pub fn note_own_change(&mut self, path: &str, etag: Option<&str>) {
        match etag {
            Some(e) => {
                self.known.insert(path.to_string(), Known { etag: e.to_string(), downloaded: true });
            }
            None => {
                self.known.remove(path);
            }
        }
    }

    /// The differences between a full listing and what was last reported: (path, kind), in path order.
    pub fn diff(&mut self, entries: &[Entry]) -> Vec<(String, &'static str)> {
        let mut changes: BTreeMap<String, &'static str> = BTreeMap::new();
        let mut seen = std::collections::HashSet::new();
        for e in entries {
            seen.insert(e.path.as_str());
            match self.known.get(&e.path) {
                Some(k) if !k.downloaded && e.downloaded => {
                    changes.insert(e.path.clone(), "downloaded");
                }
                Some(k) if k.etag != e.etag => {
                    changes.insert(e.path.clone(), "changed");
                }
                Some(_) => {}
                None => {
                    changes.insert(e.path.clone(), "changed");
                }
            }
            self.known.insert(e.path.clone(), Known { etag: e.etag.clone(), downloaded: e.downloaded });
        }
        let gone: Vec<String> = self.known.keys().filter(|p| !seen.contains(p.as_str())).cloned().collect();
        for p in gone {
            self.known.remove(&p);
            changes.insert(p, "removed");
        }
        changes.into_iter().collect()
    }
}

/// A batch as the page reads it: `{ changes: [{ path, kind }] }`.
pub fn batch(changes: &[(String, &'static str)]) -> Value {
    json!({ "changes": changes.iter().map(|(p, k)| json!({ "path": p, "kind": k })).collect::<Vec<_>>() })
}

enum Msg {
    Fs,
    /// The notifications reported an error (dropped events, a watch that broke): listings go back to `interval`.
    FsError,
    Stop,
}

/// How long to wait between safety-net listings: `interval` without working notifications, longer with them.
fn full_interval(interval: Duration, notifications_ok: bool) -> Duration {
    if notifications_ok {
        interval.saturating_mul(WATCHED_FACTOR)
    } else {
        interval
    }
}

/// A running watcher: notifications and the safety-net listing, on a thread of its own. Stops when dropped.
pub struct WatchHandle {
    tx: Sender<Msg>,
    _watcher: Option<notify::RecommendedWatcher>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
    }
}

/// Watches `root`: `scan(true)` once first (the baseline), then `scan(false)` after each burst of changes and every
/// `interval` (ten times that while notifications work). `scan` returns false when this watcher is no longer the
/// library's (it then stops).
pub fn start(root: PathBuf, interval: Duration, scan: impl Fn(bool) -> bool + Send + 'static) -> WatchHandle {
    let (tx, rx) = mpsc::channel::<Msg>();
    let events = tx.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        match res {
            // Our own temporary files say nothing; everything else might.
            Ok(ev) => {
                if ev.paths.is_empty() || ev.paths.iter().any(|p| !p.components().any(|c| c.as_os_str() == TMP_DIR)) {
                    let _ = events.send(Msg::Fs);
                }
            }
            Err(_) => {
                let _ = events.send(Msg::FsError);
            }
        }
    })
    .ok()
    .and_then(|mut w| w.watch(&root, RecursiveMode::Recursive).ok().map(|_| w));
    // Without notifications (a network share, too many inotify watches) the listings still run, every `interval`.
    let mut notifications_ok = watcher.is_some();
    std::thread::Builder::new()
        .name("folevi-library-watch".into())
        .spawn(move || {
            if !scan(true) {
                return;
            }
            let mut next_full = Instant::now() + full_interval(interval, notifications_ok);
            let mut pending: Option<(Instant, Instant)> = None; // (fire at, first event)
            loop {
                let now = Instant::now();
                let wake = pending.map(|(at, _)| at).unwrap_or(next_full).min(next_full);
                match rx.recv_timeout(wake.saturating_duration_since(now)) {
                    Ok(msg @ (Msg::Fs | Msg::FsError)) => {
                        let now = Instant::now();
                        if matches!(msg, Msg::FsError) && notifications_ok {
                            // Something may have been missed: look soon, and keep looking often from now on.
                            notifications_ok = false;
                            next_full = next_full.min(now + interval);
                        }
                        let first = pending.map(|(_, f)| f).unwrap_or(now);
                        pending = Some(((now + DEBOUNCE).min(first + MAX_DELAY), first));
                    }
                    Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return,
                    Err(RecvTimeoutError::Timeout) => {
                        let now = Instant::now();
                        let due = pending.is_some_and(|(at, _)| at <= now) || next_full <= now;
                        if due {
                            pending = None;
                            next_full = now + full_interval(interval, notifications_ok);
                            if !scan(false) {
                                return;
                            }
                        }
                    }
                }
            }
        })
        .ok();
    WatchHandle { tx, _watcher: watcher }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(path: &str, etag: &str, downloaded: bool) -> Entry {
        Entry { path: path.into(), size: 1, mtime_ms: 0.0, etag: etag.into(), downloaded, has_conflicts: false }
    }

    #[test]
    fn diffs_report_each_path_once_and_not_our_own_writes() {
        let mut s = WatchState::default();
        s.baseline(&[e("a", "1", true), e("b", "1", false), e("c/x", "1", true), e("c/y", "1", true)]);
        // Our own write of "a" and remove of "c/x" aren't reported; "b" arriving is "downloaded".
        s.note_own_change("a", Some("2"));
        s.note_own_change("c/x", None);
        let got = s.diff(&[e("a", "2", true), e("b", "1", true), e("d", "1", true)]);
        assert_eq!(got, vec![("b".into(), "downloaded"), ("c/y".into(), "removed"), ("d".into(), "changed")]);
        assert!(s.diff(&[e("a", "2", true), e("b", "1", true), e("d", "1", true)]).is_empty());
        // Someone else's write of "a" is.
        assert_eq!(s.diff(&[e("a", "3", true), e("b", "1", true), e("d", "1", true)]), vec![("a".into(), "changed")]);
        assert_eq!(batch(&[("a".into(), "changed")]), json!({ "changes": [{ "path": "a", "kind": "changed" }] }));
    }

    #[test]
    fn listings_are_rarer_only_while_notifications_work() {
        assert_eq!(full_interval(SCAN_INTERVAL, false), Duration::from_secs(30));
        assert_eq!(full_interval(SCAN_INTERVAL, true), Duration::from_secs(300));
    }

    #[test]
    fn a_burst_of_outside_changes_arrives_in_few_batches() {
        let d = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(d.path()).unwrap();
        let scans = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let baselined = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (s2, b2) = (scans.clone(), baselined.clone());
        let handle = start(root.clone(), Duration::from_secs(3600), move |first| {
            if first {
                b2.store(true, std::sync::atomic::Ordering::SeqCst);
            } else {
                s2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
            true
        });
        while !baselined.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(200));
        for i in 0..30 {
            std::fs::write(root.join(format!("f{i}")), "x").unwrap();
        }
        let until = Instant::now() + Duration::from_secs(5);
        while scans.load(std::sync::atomic::Ordering::SeqCst) == 0 && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(800));
        let n = scans.load(std::sync::atomic::Ordering::SeqCst);
        assert!((1..=4).contains(&n), "{n} scans");
        drop(handle);
    }
}
