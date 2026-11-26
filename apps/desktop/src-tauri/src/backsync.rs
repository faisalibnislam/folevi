//! Background sync for places no window shows (port of the Mac's BackgroundSync.swift; keep the two in step).
//!
//! Each such place (an account, or the library when another place is open) gets a "runner": a hidden window with
//! the page at `/place-sync?place=<id>`, which syncs that place, sends what waits, shows its notifications and says
//! how much still waits (placesDescribe). Runners are woken only when there's a reason and closed once nothing
//! waits, so a PC with many accounts doesn't keep a page open for each:
//! - "background": the place stopped being on screen;
//! - "folder": the library's folder changed;
//! - "notification": the unread count (asked natively, every minute) went up;
//! - "catch up": every 10 minutes, one place at a time, the one synced longest ago.
//!
//! This file is the plan (what to keep, what to wake); lib.rs makes and closes the windows.
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct Plan {
    /// How often a place is caught up when nothing else wakes it.
    pub interval: Duration,
    /// A woken page stays at least this long.
    pub min_awake: Duration,
    /// A page that never said how much waits goes after this.
    pub max_awake: Duration,
    /// A page with work still waiting goes after this.
    pub max_awake_waiting: Duration,
    /// Catch-up wakes at once.
    pub regular_at_once: usize,
}

impl Default for Plan {
    fn default() -> Self {
        let env = |k: &str, d: u64| Duration::from_secs(std::env::var(k).ok().and_then(|v| v.parse::<u64>().ok()).map(|v| v.max(1)).unwrap_or(d));
        Plan {
            interval: env("FOLEVI_BACKGROUND_INTERVAL", 600),
            min_awake: env("FOLEVI_BACKGROUND_MIN_AWAKE", 15),
            max_awake: env("FOLEVI_BACKGROUND_MAX_AWAKE", 120),
            max_awake_waiting: env("FOLEVI_BACKGROUND_MAX_WAITING", 600),
            regular_at_once: 1,
        }
    }
}

/// How often the unread count is asked (three times slower while no Folevi window is in front).
pub fn poll_interval() -> Duration {
    Duration::from_secs(std::env::var("FOLEVI_BACKGROUND_POLL").ok().and_then(|v| v.parse::<u64>().ok()).map(|v| v.max(1)).unwrap_or(60))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Keep,
    Release,
}

/// One awake runner.
#[derive(Debug, Clone)]
pub struct Awake {
    pub since: Instant,
    pub hold_until: Option<Instant>,
    /// What the page last said still waits (None: it hasn't said).
    pub waiting: Option<u64>,
}

impl Plan {
    pub fn verdict(&self, a: &Awake, now: Instant) -> Verdict {
        let up = now.saturating_duration_since(a.since);
        if a.hold_until.is_some_and(|h| now < h) || up < self.min_awake {
            return Verdict::Keep;
        }
        match a.waiting {
            Some(0) => Verdict::Release,
            None if up >= self.max_awake => Verdict::Release,
            Some(_) if up >= self.max_awake_waiting => Verdict::Release,
            _ => Verdict::Keep,
        }
    }
}

/// What the scheduler knows: the places wanted in the background, which are awake, when each last synced, and
/// each account's last unread count.
#[derive(Debug, Default)]
pub struct BackSync {
    pub plan: Plan,
    wanted: Vec<String>,
    pub awake: HashMap<String, Awake>,
    last_synced: HashMap<String, Instant>,
    unread: HashMap<String, u64>,
}

impl BackSync {
    pub fn new(plan: Plan) -> Self {
        Self { plan, ..Default::default() }
    }

    pub fn wanted(&self) -> &[String] {
        &self.wanted
    }

    /// The places that should sync in the background now. Returns (newly wanted: wake them; no longer wanted:
    /// close their runners now).
    pub fn set_wanted(&mut self, want: Vec<String>) -> (Vec<String>, Vec<String>) {
        let added: Vec<String> = want.iter().filter(|p| !self.wanted.contains(p)).cloned().collect();
        let gone: Vec<String> = self.awake.keys().filter(|p| !want.contains(p)).cloned().collect();
        for g in &gone {
            self.awake.remove(g);
        }
        self.last_synced.retain(|p, _| want.contains(p));
        self.unread.retain(|p, _| want.contains(p));
        self.wanted = want;
        (added, gone)
    }

    /// A runner was made (or already is): it stays at least `min_awake`, or `hold` when given.
    pub fn woke(&mut self, place: &str, now: Instant, hold: Option<Duration>) {
        let a = self.awake.entry(place.to_string()).or_insert(Awake { since: now, hold_until: None, waiting: None });
        if let Some(h) = hold {
            a.hold_until = Some(now + h);
        }
    }

    /// The page said how much still waits.
    pub fn reported(&mut self, place: &str, waiting: u64) {
        if let Some(a) = self.awake.get_mut(place) {
            a.waiting = Some(waiting);
        }
    }

    /// The runners to close now (each counts as synced).
    pub fn to_release(&mut self, now: Instant) -> Vec<String> {
        let plan = self.plan;
        let out: Vec<String> = self.awake.iter().filter(|(_, a)| plan.verdict(a, now) == Verdict::Release).map(|(p, _)| p.clone()).collect();
        for p in &out {
            self.awake.remove(p);
            self.last_synced.insert(p.clone(), now);
        }
        out
    }

    /// Every runner whose page has nothing waiting, now (low memory). Held ones stay.
    pub fn relieve(&mut self, now: Instant) -> Vec<String> {
        let out: Vec<String> = self.awake.iter().filter(|(_, a)| a.waiting == Some(0) && !a.hold_until.is_some_and(|h| now < h)).map(|(p, _)| p.clone()).collect();
        for p in &out {
            self.awake.remove(p);
            self.last_synced.insert(p.clone(), now);
        }
        out
    }

    /// Catch-up: the places to wake now, oldest first, one at a time, none while one is awake. A place never
    /// synced is due at once.
    pub fn due(&self, now: Instant) -> Vec<String> {
        if self.awake.len() >= self.plan.regular_at_once {
            return vec![];
        }
        let mut due: Vec<(Option<Instant>, &String)> = self
            .wanted
            .iter()
            .filter(|p| !self.awake.contains_key(*p))
            .map(|p| (self.last_synced.get(p).copied(), p))
            .filter(|(last, _)| last.is_none_or(|l| now.saturating_duration_since(l) >= self.plan.interval))
            .collect();
        due.sort_by_key(|(last, _)| *last);
        due.into_iter().take(self.plan.regular_at_once - self.awake.len()).map(|(_, p)| p.clone()).collect()
    }

    /// An account's unread count, asked natively: true when it went up (wake its page to show what came). The first
    /// count isn't new.
    pub fn unread_now(&mut self, place: &str, count: u64) -> bool {
        let before = self.unread.insert(place.to_string(), count);
        before.is_some_and(|b| count > b)
    }

    /// How often the scheduler looks: every 2 seconds while a page is awake, else up to 20.
    pub fn pace(&self) -> Duration {
        if !self.awake.is_empty() {
            Duration::from_secs(2)
        } else {
            (self.plan.interval / 2).clamp(Duration::from_secs(2), Duration::from_secs(20))
        }
    }
}

/// When a Convex JWT runs out (its `exp`, a minute early), or five minutes from now when it says nothing.
pub fn token_good_until(jwt: &str, now_secs: u64) -> u64 {
    use base64::Engine;
    let exp = jwt
        .split('.')
        .nth(1)
        .and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.get("exp").and_then(serde_json::Value::as_u64));
    match exp {
        Some(e) => e.saturating_sub(60),
        None => now_secs + 300,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> Plan {
        Plan {
            interval: Duration::from_secs(600),
            min_awake: Duration::from_secs(15),
            max_awake: Duration::from_secs(120),
            max_awake_waiting: Duration::from_secs(600),
            regular_at_once: 1,
        }
    }

    fn awake(since: Instant, waiting: Option<u64>) -> Awake {
        Awake { since, hold_until: None, waiting }
    }

    #[test]
    fn a_page_stays_its_minimum_then_goes_once_nothing_waits() {
        let t = Instant::now();
        let p = plan();
        assert_eq!(p.verdict(&awake(t, Some(0)), t + Duration::from_secs(5)), Verdict::Keep);
        assert_eq!(p.verdict(&awake(t, Some(0)), t + Duration::from_secs(15)), Verdict::Release);
    }

    #[test]
    fn a_page_that_said_nothing_goes_at_the_maximum() {
        let t = Instant::now();
        let p = plan();
        assert_eq!(p.verdict(&awake(t, None), t + Duration::from_secs(60)), Verdict::Keep);
        assert_eq!(p.verdict(&awake(t, None), t + Duration::from_secs(120)), Verdict::Release);
    }

    #[test]
    fn work_still_waiting_keeps_the_page_longer() {
        let t = Instant::now();
        let p = plan();
        assert_eq!(p.verdict(&awake(t, Some(3)), t + Duration::from_secs(300)), Verdict::Keep);
        assert_eq!(p.verdict(&awake(t, Some(3)), t + Duration::from_secs(600)), Verdict::Release);
    }

    #[test]
    fn a_hold_keeps_the_page() {
        let t = Instant::now();
        let a = Awake { since: t, hold_until: Some(t + Duration::from_secs(60)), waiting: Some(0) };
        assert_eq!(plan().verdict(&a, t + Duration::from_secs(30)), Verdict::Keep);
        assert_eq!(plan().verdict(&a, t + Duration::from_secs(61)), Verdict::Release);
    }

    #[test]
    fn catch_up_is_one_place_at_a_time_oldest_first() {
        let t = Instant::now();
        let mut b = BackSync::new(plan());
        let (added, gone) = b.set_wanted(vec!["acct:a".into(), "acct:b".into(), "library".into()]);
        assert_eq!(added.len(), 3);
        assert!(gone.is_empty());
        // Never synced: due at once, one at a time.
        assert_eq!(b.due(t).len(), 1);
        for p in ["acct:a", "acct:b", "library"] {
            b.woke(p, t, None);
            b.reported(p, 0);
        }
        assert!(b.due(t).is_empty(), "nothing while one is awake");
        let later = t + Duration::from_secs(20);
        let mut released = b.to_release(later);
        released.sort();
        assert_eq!(released, vec!["acct:a", "acct:b", "library"]);
        assert!(b.due(later + Duration::from_secs(10)).is_empty(), "synced just now");
        // acct:b synced earlier than the others.
        b.woke("acct:b", t, None);
        b.reported("acct:b", 0);
        b.to_release(t + Duration::from_secs(15));
        assert_eq!(b.due(t + Duration::from_secs(700)), vec!["acct:b".to_string()]);
        // No longer wanted: its runner goes now.
        b.woke("acct:a", t, None);
        let (_, gone) = b.set_wanted(vec!["acct:b".into()]);
        assert_eq!(gone, vec!["acct:a".to_string()]);
    }

    #[test]
    fn only_a_higher_count_is_new() {
        let mut b = BackSync::new(plan());
        assert!(!b.unread_now("acct:a", 3), "the first count isn't new");
        assert!(!b.unread_now("acct:a", 3));
        assert!(b.unread_now("acct:a", 4));
        assert!(!b.unread_now("acct:a", 1));
    }

    #[test]
    fn low_memory_closes_idle_pages_only() {
        let t = Instant::now();
        let mut b = BackSync::new(plan());
        b.set_wanted(vec!["acct:a".into(), "acct:b".into()]);
        b.woke("acct:a", t, None);
        b.reported("acct:a", 0);
        b.woke("acct:b", t, None);
        b.reported("acct:b", 2);
        assert_eq!(b.relieve(t), vec!["acct:a".to_string()]);
    }

    #[test]
    fn token_expiry() {
        use base64::Engine;
        let e = |v: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v);
        let jwt = format!("{}.{}.sig", e("{}"), e(r#"{"exp":1000}"#));
        assert_eq!(token_good_until(&jwt, 10), 940);
        assert_eq!(token_good_until("not a jwt", 10), 310);
    }
}
