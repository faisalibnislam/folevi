//! The app lock (port of the Mac's MacAppLock.swift; docs/DESKTOP_PARITY.md item 3): Folevi covers its windows when
//! it opens and when you come back to it after `lockAfter` seconds away (or after the computer slept), until you
//! show it's you. On Windows that's Windows Hello (`hello.rs`); on Linux, a passphrase chosen for Folevi's lock.
//!
//! The lock covers what's on screen; it doesn't encrypt anything (the encrypted notes have their own keys). The
//! bridge is the Mac's: `lockGet` answers `{ lock, lockAfter, method }`, `lockSet { lock?, lockAfter? }` changes them.
//!
//! lock.json in the app's data folder: `{ "lock": bool, "lockAfter": seconds }`, and on Linux the passphrase's
//! PBKDF2-SHA256 hash and salt (never the passphrase).
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// "Ask again when you come back": right away, after 1, 5 or 15 minutes, after an hour.
pub const CHOICES: [u64; 5] = [0, 60, 300, 900, 3600];
/// PBKDF2 rounds for the Linux passphrase.
const ROUNDS: u32 = 310_000;
pub const MIN_PASSPHRASE: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Passphrase {
    pub salt: String,
    pub hash: String,
    pub rounds: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    #[serde(default)]
    lock: bool,
    #[serde(default)]
    lock_after: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    passphrase: Option<Passphrase>,
    /// Wrong passphrases in a row, and when the last one was (seconds since 1970): kept here so closing Folevi and
    /// opening it again doesn't start the count over.
    #[serde(default, skip_serializing_if = "is_zero")]
    failed: u32,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    failed_at: u64,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

fn is_zero_u64(n: &u64) -> bool {
    *n == 0
}

/// Wrong passphrases in a row that cost nothing (a slip of the fingers).
const FREE_TRIES: u32 = 4;
/// The longest wait between two tries.
const MAX_WAIT: u64 = 15 * 60;

/// How many seconds the next try waits after `failed` wrong passphrases in a row: none for the first few, then 5
/// seconds, doubling with each further one, 15 minutes at most. Guessing a short passphrase at the keyboard stops
/// being worth it.
pub fn wait_after(failed: u32) -> u64 {
    if failed < FREE_TRIES {
        return 0;
    }
    (5u64 << (failed - FREE_TRIES).min(10)).min(MAX_WAIT)
}

/// "5 seconds", "1 minute", "15 minutes": a wait in words.
pub fn wait_words(seconds: u64) -> String {
    if seconds < 60 {
        return format!("{seconds} second{}", if seconds == 1 { "" } else { "s" });
    }
    let minutes = seconds.div_ceil(60);
    format!("{minutes} minute{}", if minutes == 1 { "" } else { "s" })
}

/// A number of seconds, rounded down to one of [`CHOICES`]; None for anything that isn't a number of seconds.
pub fn valid_after(v: &Value) -> Option<u64> {
    let n = v.as_f64().filter(|n| n.is_finite() && *n >= 0.0)?;
    CHOICES.iter().rev().copied().find(|c| *c as f64 <= n)
}

fn pbkdf2(passphrase: &str, salt: &[u8], rounds: u32) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(passphrase.as_bytes(), salt, rounds, &mut out);
    out
}

pub fn hash_passphrase(passphrase: &str) -> Passphrase {
    let mut salt = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    let b64 = base64::engine::general_purpose::STANDARD;
    Passphrase { salt: b64.encode(salt), hash: b64.encode(pbkdf2(passphrase, &salt, ROUNDS)), rounds: ROUNDS }
}

pub fn passphrase_matches(p: &Passphrase, attempt: &str) -> bool {
    let b64 = base64::engine::general_purpose::STANDARD;
    let (Ok(salt), Ok(want)) = (b64.decode(&p.salt), b64.decode(&p.hash)) else { return false };
    if want.len() != 32 || p.rounds == 0 {
        return false;
    }
    let got = pbkdf2(attempt, &salt, p.rounds);
    // Constant time: every byte is compared.
    got.iter().zip(want.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

pub struct AppLock {
    file: PathBuf,
    /// "windowsHello", "passphrase", or "none" (no Windows Hello on this PC).
    method: Mutex<&'static str>,
    stored: Mutex<Stored>,
    covered: Mutex<bool>,
    away_since: Mutex<Option<Instant>>,
}

impl AppLock {
    pub fn load(file: PathBuf, method: &'static str) -> Self {
        let stored = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Stored>(&b).ok()).unwrap_or_default();
        let stored = Stored { lock_after: valid_after(&json!(stored.lock_after)).unwrap_or(0), ..stored };
        Self { file, method: Mutex::new(method), stored: Mutex::new(stored), covered: Mutex::new(false), away_since: Mutex::new(None) }
    }

    pub fn method(&self) -> &'static str {
        *self.method.lock()
    }

    /// Windows Hello can come and go (set up or removed in Settings): checked again when it matters.
    pub fn set_method(&self, method: &'static str) {
        *self.method.lock() = method;
        if method == "none" {
            // Never shut out: a lock nobody can open is dropped.
            *self.covered.lock() = false;
        }
    }

    /// Whether the lock is on and can be opened (a passphrase lock needs its passphrase).
    pub fn on(&self) -> bool {
        let s = self.stored.lock();
        let m = self.method();
        s.lock && m != "none" && (m != "passphrase" || s.passphrase.is_some())
    }

    /// lockGet.
    pub fn settings(&self) -> Value {
        json!({ "lock": self.on(), "lockAfter": self.stored.lock().lock_after, "method": self.method() })
    }

    /// The passphrase's hash as kept (the tests read it; the app checks through `try_passphrase`).
    #[cfg(test)]
    pub fn passphrase(&self) -> Option<Passphrase> {
        self.stored.lock().passphrase.clone()
    }

    /// Checks the lock's passphrase, counting wrong ones in a row: Ok(whether it's right), or Err(seconds to wait)
    /// when it's too soon after too many wrong ones (nothing is checked then). `now`: seconds since 1970.
    pub fn try_passphrase(&self, attempt: &str, now: u64) -> Result<bool, u64> {
        let old = self.stored.lock().clone();
        let wait = wait_after(old.failed);
        // (A clock set back doesn't make the wait longer than it is.)
        let left = old.failed_at.saturating_add(wait).saturating_sub(now).min(wait);
        if left > 0 {
            return Err(left);
        }
        let ok = old.passphrase.as_ref().is_some_and(|p| passphrase_matches(p, attempt));
        if ok {
            if old.failed != 0 || old.failed_at != 0 {
                let _ = self.save(Stored { failed: 0, failed_at: 0, ..old });
            }
        } else {
            let _ = self.save(Stored { failed: old.failed.saturating_add(1), failed_at: now, ..old });
        }
        Ok(ok)
    }

    fn save(&self, s: Stored) -> std::io::Result<()> {
        let bytes = serde_json::to_vec_pretty(&s).unwrap_or_default();
        crate::shell::write_atomic(&self.file, &bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.file, std::fs::Permissions::from_mode(0o600));
        }
        *self.stored.lock() = s;
        Ok(())
    }

    pub fn set_after(&self, after: u64) -> std::io::Result<()> {
        let s = Stored { lock_after: after, ..self.stored.lock().clone() };
        self.save(s)
    }

    /// Turns the lock on or off (after the person confirmed it). On with a passphrase keeps its hash; off forgets it.
    pub fn set_lock(&self, on: bool, passphrase: Option<Passphrase>) -> std::io::Result<()> {
        let old = self.stored.lock().clone();
        let s = Stored { lock: on, passphrase: if on { passphrase.or(old.passphrase.clone()) } else { None }, failed: 0, failed_at: 0, ..old };
        self.save(s)
    }

    pub fn covered(&self) -> bool {
        *self.covered.lock()
    }

    /// Covers the windows when the lock is on. True when it did (it wasn't covered already).
    pub fn cover(&self) -> bool {
        if !self.on() {
            return false;
        }
        let mut c = self.covered.lock();
        let was = *c;
        *c = true;
        !was
    }

    pub fn uncover(&self) {
        *self.covered.lock() = false;
        *self.away_since.lock() = None;
    }

    /// No Folevi window is in front any more: the away clock starts (once).
    pub fn away(&self, now: Instant) {
        let mut a = self.away_since.lock();
        if a.is_none() {
            *a = Some(now);
        }
    }

    /// A Folevi window is in front again: whether to cover now (away for `lockAfter` or longer).
    pub fn back(&self, now: Instant) -> bool {
        let since = self.away_since.lock().take();
        match since {
            Some(t) if now.saturating_duration_since(t) >= Duration::from_secs(self.stored.lock().lock_after) => self.cover(),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(method: &'static str) -> (tempfile::TempDir, AppLock) {
        let d = tempfile::tempdir().unwrap();
        let l = AppLock::load(d.path().join("lock.json"), method);
        (d, l)
    }

    #[test]
    fn the_lock_is_off_until_turned_on() {
        let (d, l) = temp("windowsHello");
        assert_eq!(l.settings(), json!({ "lock": false, "lockAfter": 0, "method": "windowsHello" }));
        assert!(!l.cover());
        l.set_lock(true, None).unwrap();
        l.set_after(300).unwrap();
        let again = AppLock::load(d.path().join("lock.json"), "windowsHello");
        assert_eq!(again.settings(), json!({ "lock": true, "lockAfter": 300, "method": "windowsHello" }));
        // A PC whose Windows Hello went away: the lock reads off and never covers.
        again.set_method("none");
        assert_eq!(again.settings()["lock"], false);
        assert!(!again.cover());
    }

    #[test]
    fn odd_values_are_refused_or_rounded_down() {
        assert_eq!(valid_after(&json!(0)), Some(0));
        assert_eq!(valid_after(&json!(59)), Some(0));
        assert_eq!(valid_after(&json!(61.5)), Some(60));
        assert_eq!(valid_after(&json!(1000)), Some(900));
        assert_eq!(valid_after(&json!(99999)), Some(3600));
        assert_eq!(valid_after(&json!(-1)), None);
        assert_eq!(valid_after(&json!("soon")), None);
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("lock.json"), r#"{"lock":true,"lockAfter":123}"#).unwrap();
        assert_eq!(AppLock::load(d.path().join("lock.json"), "windowsHello").settings()["lockAfter"], 60);
    }

    #[test]
    fn it_covers_after_being_away_long_enough() {
        let (_d, l) = temp("windowsHello");
        l.set_lock(true, None).unwrap();
        l.set_after(60).unwrap();
        let t = Instant::now();
        l.away(t);
        assert!(!l.back(t + Duration::from_secs(30)));
        assert!(!l.covered());
        l.away(t);
        l.away(t + Duration::from_secs(50)); // the clock started at the first
        assert!(l.back(t + Duration::from_secs(61)));
        assert!(l.covered());
        assert!(!l.cover(), "already covered");
        l.uncover();
        assert!(!l.covered());
        // Right away: any time away.
        l.set_after(0).unwrap();
        l.away(t);
        assert!(l.back(t));
    }

    #[test]
    fn wrong_passphrases_in_a_row_make_the_next_one_wait() {
        assert_eq!([0, 1, 2, 3].map(wait_after), [0, 0, 0, 0], "a few slips cost nothing");
        assert_eq!([4, 5, 6, 7].map(wait_after), [5, 10, 20, 40]);
        assert_eq!(wait_after(12), 900);
        assert_eq!(wait_after(u32::MAX), 900, "15 minutes at most");
        assert_eq!(wait_words(1), "1 second");
        assert_eq!(wait_words(40), "40 seconds");
        assert_eq!(wait_words(60), "1 minute");
        assert_eq!(wait_words(900), "15 minutes");

        let (d, l) = temp("passphrase");
        l.set_lock(true, Some(hash_passphrase("correct horse"))).unwrap();
        let t = 1_800_000_000u64;
        for i in 0..4 {
            assert_eq!(l.try_passphrase("guess", t + i), Ok(false));
        }
        // The fifth try is too soon: nothing is checked, not even the right passphrase.
        assert_eq!(l.try_passphrase("correct horse", t + 4), Err(4));
        assert_eq!(l.try_passphrase("guess", t + 7), Err(1));
        // Closing Folevi and opening it again doesn't start over.
        let again = AppLock::load(d.path().join("lock.json"), "passphrase");
        assert_eq!(again.try_passphrase("correct horse", t + 5), Err(3));
        // After the wait a wrong one doubles it, and a clock set back doesn't make it longer than it is.
        assert_eq!(again.try_passphrase("guess", t + 8), Ok(false));
        assert_eq!(again.try_passphrase("guess", t + 9), Err(9));
        assert_eq!(again.try_passphrase("guess", t - 1000), Err(10));
        // The right one, once the wait is over, clears the count.
        assert_eq!(again.try_passphrase("correct horse", t + 18), Ok(true));
        assert_eq!(again.try_passphrase("guess", t + 19), Ok(false));
        assert_eq!(again.try_passphrase("correct horse", t + 19), Ok(true));
        let saved = std::fs::read_to_string(d.path().join("lock.json")).unwrap();
        assert!(!saved.contains("failed"), "nothing kept once it's right: {saved}");
    }

    #[test]
    fn a_passphrase_lock_keeps_only_a_hash() {
        let (d, l) = temp("passphrase");
        l.set_lock(true, None).unwrap();
        assert!(!l.on(), "no passphrase, no lock");
        let p = hash_passphrase("correct horse");
        l.set_lock(true, Some(p.clone())).unwrap();
        assert!(l.on());
        let file = std::fs::read_to_string(d.path().join("lock.json")).unwrap();
        assert!(!file.contains("correct horse"));
        assert!(passphrase_matches(&l.passphrase().unwrap(), "correct horse"));
        assert!(!passphrase_matches(&l.passphrase().unwrap(), "correct hors"));
        l.set_lock(false, None).unwrap();
        assert_eq!(l.passphrase(), None);
        assert!(!passphrase_matches(&Passphrase { salt: "x".into(), hash: "y".into(), rounds: 1 }, ""));
    }
}
