//! Reminders in local mode (Electron's reminders.ts): the page schedules a notification for a time
//! (`foleviShell.notify.schedule`), and this keeps them in a file in the app's data folder, so they still go off
//! after Folevi quits and opens again. Each one is armed with a Tokio timer while the app runs; one whose time
//! passed while Folevi was closed shows when it opens again, if it's less than a day late (as the server's
//! reminders, convex/tasks.ts processReminders). An id and time shows once: the page schedules everything it
//! wants on every launch, and a reminder already shown isn't shown again.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::Duration;

use crate::shell::{now_ms, write_atomic};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reminder {
    pub id: String,
    /// When it goes off (UTC ms).
    pub at: u64,
    pub title: String,
    pub body: String,
    /// Where clicking it opens Folevi ("/d/<note>#block-<id>").
    pub path: String,
}

/// Shows a reminder that went off (a notification).
pub type Show = Arc<dyn Fn(Reminder) + Send + Sync>;

/// The clock reminders go by (UTC ms); the wall clock in the app.
pub type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

/// A reminder more than this late isn't shown.
pub const LATE_MS: u64 = 24 * 60 * 60 * 1000;
/// How long a shown reminder is remembered (so a second launch doesn't show it again).
const SHOWN_KEPT_MS: u64 = 3 * 24 * 60 * 60 * 1000;
pub const MAX_REMINDERS: usize = 2000;
/// The longest a timer waits before it looks at the clock again. Tokio's timers follow a monotonic clock, which
/// may not count the time this PC sleeps; a short step keeps a reminder close to its wall-clock time.
const MAX_WAIT_MS: u64 = 5 * 60 * 1000;
/// Changes are written this long after the first one, together (the page schedules everything at launch).
const SAVE_DELAY_MS: u64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Shown {
    id: String,
    at: u64,
    shown_at: u64,
}

#[derive(Serialize)]
struct FileShape<'a> {
    reminders: Vec<Reminder>,
    shown: &'a [Shown],
}

fn is_control(c: char) -> bool {
    (c as u32) < 0x20 || c as u32 == 0x7f
}

fn valid_id(id: &str) -> bool {
    (1..=120).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
}

/// A reminder from the page, checked and trimmed, or None when it isn't one.
pub fn clean_reminder(input: &Value) -> Option<Reminder> {
    let r = input.as_object()?;
    let id = r.get("id")?.as_str()?;
    if !valid_id(id) {
        return None;
    }
    let at = r.get("at")?.as_f64()?;
    if !at.is_finite() || at < 0.0 {
        return None;
    }
    let text = |v: Option<&Value>, max: usize| -> String {
        match v.and_then(Value::as_str) {
            Some(s) => {
                let replaced: String = s.chars().map(|c| if is_control(c) { ' ' } else { c }).collect();
                replaced.trim().chars().take(max).collect()
            }
            None => String::new(),
        }
    };
    let title = text(r.get("title"), 200);
    if title.is_empty() {
        return None;
    }
    // Only a path inside the app: "/d/...", never another site or a protocol-relative "//host".
    let path = match r.get("path").and_then(Value::as_str) {
        Some(p) if p.starts_with('/') && !p.starts_with("//") && !p.chars().any(is_control) => p.chars().take(500).collect(),
        _ => "/".to_string(),
    };
    Some(Reminder { id: id.to_string(), at: at.floor() as u64, title, body: text(r.get("body"), 400), path })
}

struct Timer {
    seq: u64,
    abort: tokio::task::AbortHandle,
}

#[derive(Default)]
struct State {
    reminders: HashMap<String, Reminder>,
    shown: Vec<Shown>,
    timers: HashMap<String, Timer>,
    seq: u64,
    /// Reminders that went off and are waiting to be shown (outside the lock).
    due: Vec<Reminder>,
    /// A write of the file is on its way.
    save_pending: bool,
    /// load_soon asked for the saved reminders and they aren't loaded yet.
    load_pending: bool,
}

pub struct Reminders {
    file: PathBuf,
    show: Show,
    now: Clock,
    /// The longest a timer sleeps before it looks at the clock again (MAX_WAIT_MS; shorter in tests).
    step: u64,
    me: Weak<Reminders>,
    state: Mutex<State>,
    /// Held while the file is written, so writes land in order.
    writing: Mutex<()>,
}

/// Tokio's runtime: the caller's, else Tauri's (setup runs outside one).
fn spawn(f: impl Future<Output = ()> + Send + 'static) -> tokio::task::AbortHandle {
    let handle = tokio::runtime::Handle::try_current().unwrap_or_else(|_| tauri::async_runtime::handle().inner().clone());
    handle.spawn(f).abort_handle()
}

impl Reminders {
    pub fn new(file: PathBuf, show: Show) -> Arc<Self> {
        Self::with_clock(file, show, Arc::new(now_ms))
    }

    /// The same, going by another clock (tests).
    pub fn with_clock(file: PathBuf, show: Show, now: Clock) -> Arc<Self> {
        Self::with_step(file, show, now, MAX_WAIT_MS)
    }

    fn with_step(file: PathBuf, show: Show, now: Clock, step: u64) -> Arc<Self> {
        Arc::new_cyclic(|me| Self { file, show, now, step: step.max(1), me: me.clone(), state: Mutex::new(State::default()), writing: Mutex::new(()) })
    }

    /// Loads the saved reminders and arms them (late ones within a day still show). The app uses load_soon.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn load(self: &Arc<Self>) {
        let mut st = self.state.lock();
        self.load_into(&mut st);
        self.flush(st);
    }

    /// The same on a worker thread (launch), so the window doesn't wait for the file. Any call that comes
    /// before it's done loads them itself first, so nothing scheduled meanwhile is lost or loaded over.
    pub fn load_soon(self: &Arc<Self>) {
        self.state.lock().load_pending = true;
        let me = self.clone();
        spawn(async move {
            let _ = tokio::task::spawn_blocking(move || {
                let st = me.ready();
                me.flush(st);
            })
            .await;
        });
    }

    /// The state, with the saved reminders loaded first if load_soon hasn't got to it yet.
    fn ready(&self) -> parking_lot::MutexGuard<'_, State> {
        let mut st = self.state.lock();
        if st.load_pending {
            self.load_into(&mut st);
        }
        st
    }

    fn load_into(&self, st: &mut State) {
        st.load_pending = false;
        Self::stop_all(st);
        st.reminders.clear();
        let data: Value = std::fs::read(&self.file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        let now = (self.now)();
        st.shown = data
            .get("shown")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|s| serde_json::from_value::<Shown>(s.clone()).ok())
                    .filter(|s| now.saturating_sub(s.shown_at) < SHOWN_KEPT_MS)
                    .collect()
            })
            .unwrap_or_default();
        for raw in data.get("reminders").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
            if let Some(r) = clean_reminder(raw) {
                if st.reminders.len() < MAX_REMINDERS {
                    st.reminders.insert(r.id.clone(), r);
                }
            }
        }
        let all: Vec<Reminder> = st.reminders.values().cloned().collect();
        for r in all {
            self.arm(st, r);
        }
        self.save(st);
    }

    /// notifySchedule's options; false when they aren't a reminder.
    pub fn schedule(self: &Arc<Self>, o: &Value) -> bool {
        let Some(r) = clean_reminder(o) else { return false };
        let mut st = self.ready();
        if !st.reminders.contains_key(&r.id) && st.reminders.len() >= MAX_REMINDERS {
            return false;
        }
        Self::disarm(&mut st, &r.id);
        st.reminders.insert(r.id.clone(), r.clone());
        self.arm(&mut st, r);
        self.save(&mut st);
        self.flush(st);
        true
    }

    pub fn cancel(&self, id: &str) {
        let mut st = self.ready();
        if st.reminders.remove(id).is_some() {
            Self::disarm(&mut st, id);
            self.save(&mut st);
        }
        self.flush(st);
    }

    /// Drops every reminder (leaving local mode).
    pub fn clear(&self) {
        let mut st = self.ready();
        Self::stop_all(&mut st);
        st.reminders.clear();
        self.save(&mut st);
    }

    /// What's waiting, soonest first.
    pub fn pending(&self) -> Vec<Reminder> {
        let st = self.ready();
        let list = Self::sorted(&st);
        self.flush(st);
        list
    }

    /// Stops every timer (the reminders stay saved).
    pub fn stop(&self) {
        Self::stop_all(&mut self.state.lock());
    }

    /// How many timers are armed (tests).
    pub fn armed(&self) -> usize {
        self.state.lock().timers.len()
    }

    fn sorted(st: &State) -> Vec<Reminder> {
        let mut list: Vec<Reminder> = st.reminders.values().cloned().collect();
        list.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        list
    }

    fn stop_all(st: &mut State) {
        for (_, t) in st.timers.drain() {
            t.abort.abort();
        }
    }

    fn disarm(st: &mut State, id: &str) {
        if let Some(t) = st.timers.remove(id) {
            t.abort.abort();
        }
    }

    fn arm(&self, st: &mut State, r: Reminder) {
        // Shown already (the page schedules everything again on each launch): kept out.
        if st.shown.iter().any(|s| s.id == r.id && s.at == r.at) {
            st.reminders.remove(&r.id);
            return;
        }
        let now = (self.now)();
        if r.at <= now {
            if now - r.at <= LATE_MS {
                self.fire(st, r);
            } else {
                st.reminders.remove(&r.id);
            }
            return;
        }
        let wait = (r.at - now).min(self.step);
        st.seq += 1;
        let seq = st.seq;
        let me = self.me.clone();
        let (id, at) = (r.id.clone(), r.at);
        let abort = spawn(async move {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            if let Some(me) = me.upgrade() {
                me.wake(&id, at, seq);
            }
        });
        st.timers.insert(r.id, Timer { seq, abort });
    }

    /// A timer ended: the reminder goes off, or waits some more.
    fn wake(&self, id: &str, at: u64, seq: u64) {
        let mut st = self.state.lock();
        // A timer that was replaced meanwhile does nothing.
        if st.timers.get(id).map(|t| t.seq) != Some(seq) {
            return;
        }
        st.timers.remove(id);
        let Some(current) = st.reminders.get(id).cloned() else { return };
        if current.at != at {
            return;
        }
        let before = st.reminders.len();
        self.arm(&mut st, current);
        if st.reminders.len() != before {
            self.save(&mut st);
        }
        self.flush(st);
    }

    fn fire(&self, st: &mut State, r: Reminder) {
        st.reminders.remove(&r.id);
        st.shown.retain(|s| s.id != r.id);
        st.shown.push(Shown { id: r.id.clone(), at: r.at, shown_at: (self.now)() });
        st.due.push(r);
    }

    /// Shows what went off, on a Tokio task, after the lock is let go.
    fn flush(&self, mut st: parking_lot::MutexGuard<'_, State>) {
        let due = std::mem::take(&mut st.due);
        drop(st);
        for r in due {
            let show = self.show.clone();
            spawn(async move { show(r) });
        }
    }

    /// Saves soon: a burst of changes is written once, off the caller's thread.
    fn save(&self, st: &mut State) {
        if st.save_pending {
            return;
        }
        st.save_pending = true;
        let me = self.me.clone();
        spawn(async move {
            tokio::time::sleep(Duration::from_millis(SAVE_DELAY_MS)).await;
            let _ = tokio::task::spawn_blocking(move || {
                if let Some(me) = me.upgrade() {
                    me.save_now();
                }
            })
            .await;
        });
    }

    /// Writes the file now, atomically (also for the app to call before it quits).
    pub fn save_now(&self) {
        let _writing = self.writing.lock();
        let bytes = {
            let mut st = self.ready();
            st.save_pending = false;
            serde_json::to_vec(&FileShape { reminders: Self::sorted(&st), shown: &st.shown })
        };
        match bytes {
            Ok(bytes) => {
                if let Err(e) = write_atomic(&self.file, &bytes) {
                    log::error!("Folevi couldn't save reminders: {e}");
                }
            }
            Err(e) => log::error!("Folevi couldn't save reminders: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;
    use std::time::Instant;

    thread_local! {
        /// How far this test moved its clock (each test runs on its own thread, with a current-thread runtime
        /// whose tasks, the timers included, run on that thread too).
        static OFFSET: Cell<u64> = const { Cell::new(0) };
    }

    /// The test's clock: real time from a fixed start, plus however far the test moved it.
    fn clock() -> Clock {
        let start = Instant::now();
        Arc::new(move || 1_900_000_000_000 + start.elapsed().as_millis() as u64 + OFFSET.with(Cell::get))
    }

    /// Timers here look at the clock every few milliseconds, so moving it is seen at once.
    const STEP: u64 = 5;

    fn reminders(file: PathBuf, show: Show, now: Clock) -> Arc<Reminders> {
        Reminders::with_step(file, show, now, STEP)
    }

    fn reminder(id: &str, at: u64) -> Value {
        json!({ "id": id, "at": at, "title": "Reminder: Call the plumber", "body": "In House jobs", "path": format!("/d/NOTE#block-{id}") })
    }

    fn recorder() -> (Show, Arc<Mutex<Vec<Reminder>>>) {
        let shown = Arc::new(Mutex::new(Vec::new()));
        let s = shown.clone();
        (Arc::new(move |r| s.lock().push(r)), shown)
    }

    /// Moves the clock and gives every timer that's due time to go off.
    async fn advance(ms: u64) {
        OFFSET.with(|o| o.set(o.get() + ms));
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    fn ids(list: &Mutex<Vec<Reminder>>) -> Vec<String> {
        let mut v: Vec<String> = list.lock().iter().map(|r| r.id.clone()).collect();
        v.sort();
        v
    }

    #[tokio::test]
    async fn goes_off_at_its_time_once() {
        let dir = tempfile::tempdir().unwrap();
        let now = clock();
        let (show, shown) = recorder();
        let r = reminders(dir.path().join("reminders.json"), show, now.clone());
        r.load();
        assert!(r.schedule(&reminder("reminder:a", now() + 60_000)));
        advance(59_000).await;
        assert!(shown.lock().is_empty());
        advance(1_000).await;
        assert_eq!(shown.lock().iter().map(|n| n.path.clone()).collect::<Vec<_>>(), vec!["/d/NOTE#block-reminder:a"]);
        assert!(r.pending().is_empty());
        // The page scheduling it again (it does on every launch) doesn't show it twice.
        let at = shown.lock()[0].at;
        r.schedule(&reminder("reminder:a", at));
        advance(10).await;
        assert_eq!(shown.lock().len(), 1);
        // A new time for the same line is a new reminder.
        r.schedule(&reminder("reminder:a", now() + 1000));
        advance(1000).await;
        assert_eq!(shown.lock().len(), 2);
    }

    #[tokio::test]
    async fn a_new_time_replaces_the_old_one_and_cancel_stops_it() {
        let dir = tempfile::tempdir().unwrap();
        let now = clock();
        let (show, shown) = recorder();
        let r = reminders(dir.path().join("reminders.json"), show, now.clone());
        r.load();
        r.schedule(&reminder("reminder:a", now() + 1000));
        r.schedule(&reminder("reminder:a", now() + 5000));
        r.schedule(&reminder("reminder:b", now() + 2000));
        r.cancel("reminder:b");
        assert_eq!(r.armed(), 1);
        advance(2000).await;
        assert!(shown.lock().is_empty());
        advance(3000).await;
        assert_eq!(ids(&shown), vec!["reminder:a"]);
    }

    #[tokio::test]
    async fn a_call_before_the_background_load_keeps_what_was_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reminders.json");
        let now = clock();
        let first = reminders(path.clone(), Arc::new(|_| {}), now.clone());
        first.load();
        first.schedule(&reminder("reminder:saved", now() + 60_000));
        first.save_now();
        first.stop();

        // The next launch loads in the background; the page schedules one before that load has run (this
        // runtime runs one task at a time, so the load can't have started yet).
        let (show, shown) = recorder();
        let second = reminders(path.clone(), show, now.clone());
        second.load_soon();
        assert!(second.schedule(&reminder("reminder:new", now() + 30_000)));
        let ids_of = |r: &Reminders| r.pending().into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids_of(&second), vec!["reminder:new", "reminder:saved"]);
        // The background load, when it runs, doesn't load over the new one.
        advance(0).await;
        assert_eq!(ids_of(&second), vec!["reminder:new", "reminder:saved"]);
        assert_eq!(second.armed(), 2);
        advance(30_000).await;
        assert_eq!(ids(&shown), vec!["reminder:new"]);
        second.stop();
    }

    #[tokio::test]
    async fn far_off_reminders_wait_in_steps() {
        let dir = tempfile::tempdir().unwrap();
        let now = clock();
        let (show, shown) = recorder();
        let r = reminders(dir.path().join("reminders.json"), show, now.clone());
        r.load();
        let week = 7 * 24 * 3_600_000;
        r.schedule(&reminder("reminder:week", now() + week));
        advance(week - 1000).await;
        assert!(shown.lock().is_empty());
        assert_eq!(r.armed(), 1);
        advance(1000).await;
        assert_eq!(ids(&shown), vec!["reminder:week"]);
        assert_eq!(r.armed(), 0);
    }

    #[tokio::test]
    async fn survive_a_restart_and_late_ones_show_within_a_day() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reminders.json");
        let now = clock();
        let first = reminders(path.clone(), Arc::new(|_| {}), now.clone());
        first.load();
        let t0 = now();
        first.schedule(&reminder("reminder:soon", t0 + 60_000));
        first.schedule(&reminder("reminder:later", t0 + 3 * 3_600_000));
        first.schedule(&reminder("reminder:stale", t0 + 1000));
        first.stop();
        first.save_now();
        // Folevi was closed for two hours: the two that passed meanwhile show when it opens.
        advance(2 * 3_600_000).await;
        let (show, shown) = recorder();
        let second = reminders(path.clone(), show.clone(), now.clone());
        second.load();
        advance(0).await;
        assert_eq!(ids(&shown), vec!["reminder:soon", "reminder:stale"]);
        assert_eq!(second.pending().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["reminder:later"]);
        // A third launch doesn't show them again, even when the page schedules them again.
        second.stop();
        second.save_now();
        let third = reminders(path.clone(), show, now.clone());
        third.load();
        third.schedule(&reminder("reminder:soon", t0 + 60_000));
        advance(0).await;
        assert_eq!(shown.lock().len(), 2);
        // More than a day late: dropped without showing.
        third.schedule(&reminder("reminder:old", now() - LATE_MS - 1));
        advance(0).await;
        assert_eq!(shown.lock().len(), 2);
        assert_eq!(third.pending().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["reminder:later"]);
    }

    #[tokio::test]
    async fn a_damaged_file_starts_empty_and_clear_drops_everything() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("reminders.json");
        std::fs::write(&path, "{not json").unwrap();
        let now = clock();
        let r = reminders(path.clone(), Arc::new(|_| {}), now.clone());
        r.load();
        assert!(r.pending().is_empty());
        r.schedule(&reminder("reminder:a", now() + 1000));
        r.clear();
        assert_eq!(r.armed(), 0);
        r.save_now();
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["reminders"], json!([]));
    }

    #[tokio::test]
    async fn at_most_max_reminders() {
        let dir = tempfile::tempdir().unwrap();
        let now = clock();
        let r = Reminders::with_step(dir.path().join("reminders.json"), Arc::new(|_| {}), now.clone(), 60_000);
        r.load();
        for i in 0..MAX_REMINDERS {
            assert!(r.schedule(&reminder(&format!("r{i}"), now() + 60_000)));
        }
        assert!(!r.schedule(&reminder("one-more", now() + 60_000)));
        // Replacing one that's there is still fine.
        assert!(r.schedule(&reminder("r0", now() + 90_000)));
        assert_eq!(r.pending().len(), MAX_REMINDERS);
    }

    #[test]
    fn only_reminders_that_make_sense_are_kept() {
        assert_eq!(clean_reminder(&Value::Null), None);
        assert_eq!(clean_reminder(&json!({ "id": "bad id!", "at": 1, "title": "x", "body": "", "path": "/" })), None);
        assert_eq!(clean_reminder(&json!({ "id": "a", "at": -1, "title": "x", "body": "", "path": "/" })), None);
        assert_eq!(clean_reminder(&json!({ "id": "a", "at": null, "title": "x", "body": "", "path": "/" })), None);
        assert_eq!(clean_reminder(&json!({ "id": "a", "at": 1, "title": "  ", "body": "", "path": "/" })), None);
        assert_eq!(
            clean_reminder(&json!({ "id": "a", "at": 1.5, "title": "Hi\nthere", "body": 4, "path": "https://evil.example" })),
            Some(Reminder { id: "a".into(), at: 1, title: "Hi there".into(), body: "".into(), path: "/".into() })
        );
        assert_eq!(clean_reminder(&json!({ "id": "a", "at": 1, "title": "x", "body": "", "path": "//evil.example/d" })).unwrap().path, "/");
        let long = clean_reminder(&json!({ "id": "a", "at": 1, "title": "x".repeat(300), "body": "", "path": "/d/N#block-1" })).unwrap();
        assert_eq!(long.title, "x".repeat(200));
        assert_eq!(long.path, "/d/N#block-1");
    }
}
