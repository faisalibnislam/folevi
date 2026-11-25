//! Several places (port of Electron's places.ts and Native/Shell/ShellPlaces.swift, docs/MULTI_ACCOUNT_PLAN.md
//! §2.2): the library on this PC and any number of Folevi accounts, each with its own session (`auth.session.<user
//! id>`), encryption keys and data. This file keeps the list in places.json (the same format Electron kept): which
//! place the windows show, the accounts (what each account's own page last said of itself, for the switcher) and
//! Quick Add's last place. Nothing here is secret.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::auth::SessionUser;
use crate::shell::write_atomic;

pub const LIBRARY: &str = "library";

/// ^[A-Za-z0-9_-]{1,64}$
fn is_id(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// "acct:<user id>" for an account place.
pub fn account_id(user_id: &str) -> String {
    format!("acct:{user_id}")
}

/// The user id of an account place, or None (the library, nothing, a malformed id).
pub fn user_id_of(place: Option<&str>) -> Option<String> {
    place.and_then(|p| p.strip_prefix("acct:")).filter(|s| is_id(s)).map(str::to_string)
}

/// How a place's pages open: "local", "account" or "unset".
pub type Mode = &'static str;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceWorkspace {
    pub id: String,
    pub name: String,
    pub logo_url: Option<String>,
}

/// An account place, as places.json keeps it and placesList lists it (web's ShellPlace, kind "account").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPlace {
    pub kind: String,
    /// `acct:<user id>`.
    pub id: String,
    pub user_id: String,
    pub profile_id: Option<String>,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub workspaces: Vec<PlaceWorkspace>,
    pub unread: u64,
    pub reminders: u64,
    pub waiting: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Counts {
    pub unread: u64,
    pub reminders: u64,
    pub waiting: u64,
}

/// places.json.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlacesState {
    v: u8,
    /// What the windows show: "library", "acct:<id>", or None (nothing chosen yet; or signing in to a first account).
    current: Option<String>,
    /// The library is one of the places (set up here, and not forgotten).
    library: bool,
    library_counts: Counts,
    accounts: Vec<AccountPlace>,
    /// Quick Add's last place.
    quick_add: Option<String>,
}

impl Default for PlacesState {
    fn default() -> Self {
        Self { v: 1, current: None, library: false, library_counts: Counts::default(), accounts: vec![], quick_add: None }
    }
}

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str).map(|s| s.chars().take(max).collect()).unwrap_or_default()
}

/// A count: a finite number of at least 0, whole, at most a million; anything else is 0.
fn count(v: Option<&Value>) -> u64 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() && n >= 0.0 => n.floor().min(1_000_000.0) as u64,
        _ => 0,
    }
}

/// An https:// (or the app's own) picture, at most 2,000 characters.
fn picture(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .filter(|s| (s.starts_with("https://") || s.starts_with("app://folevi/")) && s.encode_utf16().count() <= 2000)
        .map(str::to_string)
}

fn clean_workspaces(v: Option<&Value>) -> Vec<PlaceWorkspace> {
    let Some(list) = v.and_then(Value::as_array) else { return vec![] };
    list.iter()
        .take(50)
        .filter_map(|w| {
            let id = w.get("id").and_then(Value::as_str).filter(|id| is_id(id))?;
            w.get("name").and_then(Value::as_str)?;
            Some(PlaceWorkspace { id: id.to_string(), name: text(w.get("name"), 120), logo_url: picture(w.get("logoUrl")) })
        })
        .collect()
}

fn clean_account(r: &Value) -> Option<AccountPlace> {
    let user_id = r.get("userId").and_then(Value::as_str).filter(|id| is_id(id))?.to_string();
    Some(AccountPlace {
        kind: "account".into(),
        id: account_id(&user_id),
        user_id,
        profile_id: r.get("profileId").and_then(Value::as_str).filter(|id| is_id(id)).map(str::to_string),
        name: text(r.get("name"), 120),
        email: text(r.get("email"), 254),
        avatar_url: picture(r.get("avatarUrl")),
        workspaces: clean_workspaces(r.get("workspaces")),
        unread: count(r.get("unread")),
        reminders: count(r.get("reminders")),
        waiting: count(r.get("waiting")),
    })
}

/// Keeps only what's valid: the file may hold anything.
fn clean_places(raw: &Value) -> PlacesState {
    let mut accounts: Vec<AccountPlace> = vec![];
    for a in raw.get("accounts").and_then(Value::as_array).into_iter().flatten() {
        if let Some(c) = clean_account(a) {
            if !accounts.iter().any(|x| x.user_id == c.user_id) {
                accounts.push(c);
            }
        }
    }
    let library = raw.get("library") == Some(&Value::Bool(true));
    let valid = |p: Option<&Value>| -> Option<String> {
        let p = p?.as_str()?;
        ((p == LIBRARY && library) || accounts.iter().any(|a| a.id == p)).then(|| p.to_string())
    };
    let counts = raw.get("libraryCounts");
    PlacesState {
        v: 1,
        current: valid(raw.get("current")),
        library,
        library_counts: Counts { unread: 0, reminders: count(counts.and_then(|c| c.get("reminders"))), waiting: count(counts.and_then(|c| c.get("waiting"))) },
        quick_add: valid(raw.get("quickAdd")),
        accounts,
    }
}

/// places.json: the open place, whether the library is one of them, Quick Add's place, the accounts (with what
/// their pages last said: name, avatar, unread count, workspaces). Every change is saved at once.
pub struct PlacesStore {
    file: PathBuf,
    state: PlacesState,
    /// Account mode with no account yet (the sign-in screen). Not saved.
    pub pending_account: bool,
}

impl PlacesStore {
    /// Whether the file exists (a PC that ran an older Folevi has none: its mode says where it was).
    pub fn exists(file: &Path) -> bool {
        file.exists()
    }

    /// The places in `file`, cleaned; none when it's missing or unreadable.
    pub fn load(file: PathBuf) -> Self {
        let state = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .map(|v| clean_places(&v))
            .unwrap_or_default();
        Self { file, state, pending_account: false }
    }

    /// Cleans and keeps `next`, and saves it (not saved: it still holds until Folevi quits).
    fn commit(&mut self, next: PlacesState) {
        self.state = clean_places(&serde_json::to_value(&next).unwrap_or(Value::Null));
        match serde_json::to_vec_pretty(&self.state) {
            Ok(bytes) => {
                if let Err(e) = write_atomic(&self.file, &bytes) {
                    log::warn!("Folevi: couldn't save the places ({e})");
                }
            }
            Err(e) => log::warn!("Folevi: couldn't save the places ({e})"),
        }
    }

    pub fn current(&self) -> Option<String> {
        self.state.current.clone()
    }

    pub fn has_library(&self) -> bool {
        self.state.library
    }

    pub fn quick_add(&self) -> Option<String> {
        self.state.quick_add.clone()
    }

    /// The account places' ids ("acct:<user id>"), in the order they were added.
    pub fn account_ids(&self) -> Vec<String> {
        self.state.accounts.iter().map(|a| a.id.clone()).collect()
    }

    /// An account place, as the page lists it.
    pub fn account(&self, id: &str) -> Option<AccountPlace> {
        self.state.accounts.iter().find(|a| a.id == id).cloned()
    }

    /// "local" for the library, "account" for an account (or a first sign-in), "unset" before anything was chosen.
    pub fn mode_of(&self, place: Option<&str>) -> Mode {
        if place == Some(LIBRARY) {
            "local"
        } else if user_id_of(place).is_some() || self.pending_account {
            "account"
        } else {
            "unset"
        }
    }

    /// Whether `id` names a place here.
    pub fn has(&self, id: &str) -> bool {
        (id == LIBRARY && self.state.library) || self.state.accounts.iter().any(|a| a.id == id)
    }

    /// Adds (or refreshes) an account from what the server said of it after signing in; its place id.
    pub fn add_account(&mut self, u: &SessionUser) -> Option<String> {
        let existing = self.state.accounts.iter().find(|x| x.user_id == u.user_id).cloned();
        let mut merged = existing.as_ref().map(|e| serde_json::to_value(e).unwrap_or(Value::Null)).filter(Value::is_object).unwrap_or_else(|| json!({}));
        let o = merged.as_object_mut()?;
        o.insert("userId".into(), json!(u.user_id));
        o.insert("name".into(), json!(u.name));
        o.insert("email".into(), json!(u.email));
        o.insert("avatarUrl".into(), json!(u.avatar_url));
        let next = clean_account(&merged)?;
        let mut s = self.state.clone();
        match existing {
            Some(old) => {
                for x in s.accounts.iter_mut().filter(|x| x.user_id == u.user_id) {
                    *x = AccountPlace { workspaces: old.workspaces.clone(), ..next.clone() };
                }
            }
            None => s.accounts.push(next.clone()),
        }
        self.commit(s);
        self.has(&next.id).then_some(next.id)
    }

    /// Removes an account; when it was the open one, the windows go to the next place (or none). Returns the place
    /// open after.
    pub fn remove_account(&mut self, id: &str) -> Option<String> {
        let mut s = self.state.clone();
        s.accounts.retain(|a| a.id != id);
        if s.current.as_deref() == Some(id) {
            s.current = s.accounts.first().map(|a| a.id.clone()).or_else(|| s.library.then(|| LIBRARY.to_string()));
        }
        if s.quick_add.as_deref() == Some(id) {
            s.quick_add = None;
        }
        self.commit(s);
        self.state.current.clone()
    }

    /// Opens a place (None: none yet). A place that isn't one here changes nothing.
    pub fn set_current(&mut self, place: Option<String>) {
        if place.as_deref().is_some_and(|p| !self.has(p)) {
            return;
        }
        self.pending_account = false;
        let mut s = self.state.clone();
        s.current = place;
        self.commit(s);
    }

    /// The library is a place (set up, or the windows chose it), or is forgotten.
    pub fn set_library(&mut self, on: bool) {
        if self.state.library == on {
            return;
        }
        let mut s = self.state.clone();
        s.library = on;
        if !on {
            if s.current.as_deref() == Some(LIBRARY) {
                s.current = None;
            }
            if s.quick_add.as_deref() == Some(LIBRARY) {
                s.quick_add = None;
            }
        }
        self.commit(s);
    }

    /// Quick Add's place (None: forget it). A place that isn't one here changes nothing.
    pub fn set_quick_add(&mut self, id: Option<String>) {
        if id.as_deref().is_some_and(|p| !self.has(p)) {
            return;
        }
        let mut s = self.state.clone();
        s.quick_add = id;
        self.commit(s);
    }

    /// What an account's own page says of itself (name, avatar, unread count, workspaces); the page is bound to
    /// that account by the app. The library's own words go to `describe_library`.
    pub fn describe(&mut self, place: &str, d: &Value) {
        if place == LIBRARY {
            return self.describe_library(d);
        }
        let Some(a) = self.account(place) else { return };
        let Some(r) = d.as_object() else { return };
        let mut merged = match serde_json::to_value(&a) {
            Ok(Value::Object(m)) => m,
            _ => return,
        };
        let mut put = |k: &str, v: &Value| {
            merged.insert(k.to_string(), v.clone());
        };
        if let Some(v) = r.get("profileId").filter(|v| v.is_string()) {
            put("profileId", v);
        }
        for k in ["name", "email"] {
            if let Some(v) = r.get(k).filter(|v| v.as_str().is_some_and(|s| !s.is_empty())) {
                put(k, v);
            }
        }
        if let Some(v) = r.get("avatarUrl") {
            put("avatarUrl", v);
        }
        if let Some(v) = r.get("workspaces").filter(|v| v.is_array()) {
            put("workspaces", v);
        }
        for k in ["unread", "reminders", "waiting"] {
            if let Some(v) = r.get(k) {
                put(k, v);
            }
        }
        let Some(next) = clean_account(&Value::Object(merged)) else { return };
        if next == a {
            return;
        }
        let mut s = self.state.clone();
        for x in s.accounts.iter_mut().filter(|x| x.id == place) {
            *x = next.clone();
        }
        self.commit(s);
    }

    /// What the library's page says of itself: its reminders and waiting counts (its unread count is always 0).
    pub fn describe_library(&mut self, d: &Value) {
        let Some(r) = d.as_object() else { return };
        let old = self.state.library_counts;
        let next = Counts {
            unread: 0,
            reminders: if r.contains_key("reminders") { count(r.get("reminders")) } else { old.reminders },
            waiting: if r.contains_key("waiting") { count(r.get("waiting")) } else { old.waiting },
        };
        if next == old {
            return;
        }
        let mut s = self.state.clone();
        s.library_counts = next;
        self.commit(s);
    }

    /// Every account's unread count but `except`'s (the badge: the open place's page shows its own).
    pub fn unread_except(&self, except: Option<&str>) -> u64 {
        self.state.accounts.iter().filter(|a| Some(a.id.as_str()) != except).map(|a| a.unread).sum()
    }

    /// placesList's `places` array (web's ShellPlace[]): the library first when it's one (its kind and display
    /// path from libInfo's answer: `configured`, `kind`, `displayPath`), then each account.
    pub fn list(&self, library_info: &Value) -> Value {
        let mut out: Vec<Value> = vec![];
        if self.state.library {
            let configured = library_info.get("configured") == Some(&Value::Bool(true));
            let kind = if configured { library_info.get("kind").filter(|k| k.is_string()).cloned().unwrap_or(Value::Null) } else { Value::Null };
            let display = library_info.get("displayPath").and_then(Value::as_str).unwrap_or("");
            let c = self.state.library_counts;
            out.push(json!({
                "kind": "library",
                "id": LIBRARY,
                "configured": configured,
                "syncs": kind,
                "displayPath": display,
                "unread": c.unread,
                "reminders": c.reminders,
                "waiting": c.waiting,
            }));
        }
        for a in &self.state.accounts {
            out.push(serde_json::to_value(a).unwrap_or_else(|_| Value::Object(Map::new())));
        }
        Value::Array(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(id: &str, name: &str, email: &str, avatar: Option<&str>) -> SessionUser {
        SessionUser { user_id: id.into(), name: name.into(), email: email.into(), avatar_url: avatar.map(str::to_string) }
    }

    fn temp() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("places.json");
        (d, f)
    }

    #[test]
    fn the_library_and_accounts_kept_across_launches() {
        let (_d, f) = temp();
        assert!(!PlacesStore::exists(&f));
        let mut p = PlacesStore::load(f.clone());
        p.set_library(true);
        let ana = p.add_account(&user("userAna", "Ana", "ana@example.com", None)).unwrap();
        p.add_account(&user("userBen", "Ben", "ben@example.com", Some("https://example.com/b.png")));
        p.set_current(Some(ana.clone()));
        p.set_quick_add(Some(LIBRARY.into()));
        assert!(PlacesStore::exists(&f));
        let again = PlacesStore::load(f.clone());
        assert_eq!(again.current().as_deref(), Some("acct:userAna"));
        assert_eq!(again.account_ids(), vec!["acct:userAna", "acct:userBen"]);
        assert_eq!(again.account("acct:userBen").unwrap().avatar_url.as_deref(), Some("https://example.com/b.png"));
        assert_eq!(again.quick_add().as_deref(), Some(LIBRARY));
        assert!(again.has_library());
        assert_eq!(again.mode_of(Some(LIBRARY)), "local");
        assert_eq!(again.mode_of(Some("acct:userBen")), "account");
        assert_eq!(again.mode_of(None), "unset");
        let saved: Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
        assert_eq!(saved["v"], 1);
        assert!(saved.get("token").is_none());
        assert_eq!(saved["accounts"][0]["kind"], "account");
    }

    #[test]
    fn pending_account_is_account_mode_until_a_place_opens() {
        let (_d, f) = temp();
        let mut p = PlacesStore::load(f);
        p.pending_account = true;
        assert_eq!(p.mode_of(None), "account");
        p.set_current(None);
        assert!(!p.pending_account);
        assert_eq!(p.mode_of(None), "unset");
    }

    #[test]
    fn what_a_page_says_of_its_account_updates_it_and_junk_is_dropped() {
        let (_d, f) = temp();
        let mut p = PlacesStore::load(f.clone());
        let a = p.add_account(&user("userAna", "Ana", "ana@example.com", None)).unwrap();
        p.describe(
            &a,
            &json!({ "profileId": "prof_1", "name": "Ana Lima", "workspaces": [{ "id": "w1", "name": "Acme", "logoUrl": "javascript:alert(1)" }, { "bad": true }], "unread": 4, "waiting": 2.7 }),
        );
        let now = p.account(&a).unwrap();
        assert_eq!(now.profile_id.as_deref(), Some("prof_1"));
        assert_eq!(now.name, "Ana Lima");
        assert_eq!(now.email, "ana@example.com");
        assert_eq!((now.unread, now.waiting, now.reminders), (4, 2, 0));
        assert_eq!(now.workspaces, vec![PlaceWorkspace { id: "w1".into(), name: "Acme".into(), logo_url: None }]);
        assert_eq!(p.unread_except(None), 4);
        assert_eq!(p.unread_except(Some(&a)), 0);
        p.describe("acct:nobody", &json!({ "unread": 9 }));
        assert_eq!(p.unread_except(None), 4);
        // Signing in again refreshes the name but keeps what the page said.
        p.add_account(&user("userAna", "Ana L", "ana@example.com", None));
        let again = PlacesStore::load(f).account(&a).unwrap();
        assert_eq!(again.name, "Ana L");
        assert_eq!(again.workspaces.len(), 1);
        assert_eq!(again.unread, 4);
    }

    #[test]
    fn a_damaged_file_is_cleaned_on_load() {
        let (_d, f) = temp();
        std::fs::write(&f, r#"{ "current": "acct:ghost", "accounts": [{ "userId": "bad id" }, { "userId": "ok1", "unread": -3, "avatarUrl": "http://x" }, { "userId": "ok1" }], "library": "yes", "quickAdd": "library", "libraryCounts": { "unread": 5, "reminders": 2 } }"#).unwrap();
        let p = PlacesStore::load(f.clone());
        assert_eq!(p.current(), None);
        assert!(!p.has_library());
        assert_eq!(p.quick_add(), None);
        assert_eq!(p.account_ids(), vec!["acct:ok1"]);
        let a = p.account("acct:ok1").unwrap();
        assert_eq!((a.unread, a.avatar_url), (0, None));
        std::fs::write(&f, "not json").unwrap();
        assert!(PlacesStore::load(f).account_ids().is_empty());
        assert_eq!(user_id_of(Some("acct:abc")).as_deref(), Some("abc"));
        assert_eq!(user_id_of(Some(LIBRARY)), None);
        assert_eq!(user_id_of(Some("acct:bad id")), None);
    }

    #[test]
    fn removing_the_open_account_opens_the_next_place_and_forgetting_the_library_leaves_the_accounts() {
        let (_d, f) = temp();
        let mut p = PlacesStore::load(f);
        p.set_library(true);
        let a = p.add_account(&user("userAna", "Ana", "a@example.com", None)).unwrap();
        let b = p.add_account(&user("userBen", "Ben", "b@example.com", None)).unwrap();
        p.set_current(Some(a.clone()));
        p.set_quick_add(Some(a.clone()));
        assert_eq!(p.remove_account(&a), Some(b.clone()));
        assert_eq!(p.quick_add(), None);
        assert_eq!(p.current(), Some(b.clone()));
        assert_eq!(p.remove_account(&b).as_deref(), Some(LIBRARY));
        p.set_current(Some(LIBRARY.into()));
        p.set_current(Some("acct:ghost".into()));
        assert_eq!(p.current().as_deref(), Some(LIBRARY));
        p.set_library(false);
        assert_eq!(p.current(), None);
        assert_eq!(p.list(&json!({ "configured": false })), json!([]));
    }

    #[test]
    fn the_list_the_page_reads() {
        let (_d, f) = temp();
        let mut p = PlacesStore::load(f);
        p.set_library(true);
        p.describe_library(&json!({ "reminders": 3, "unread": 7 }));
        let a = p.add_account(&user("userAna", "Ana", "a@example.com", None)).unwrap();
        p.describe(&a, &json!({ "workspaces": [{ "id": "w1", "name": "Acme", "logoUrl": "https://x.example/l.png" }] }));
        let list = p.list(&json!({ "configured": true, "kind": "folder", "displayPath": "~/Documents/Folevi Library" }));
        assert_eq!(
            list,
            json!([
                { "kind": "library", "id": "library", "configured": true, "syncs": "folder", "displayPath": "~/Documents/Folevi Library", "unread": 0, "reminders": 3, "waiting": 0 },
                { "kind": "account", "id": "acct:userAna", "userId": "userAna", "profileId": null, "name": "Ana", "email": "a@example.com", "avatarUrl": null,
                  "workspaces": [{ "id": "w1", "name": "Acme", "logoUrl": "https://x.example/l.png" }], "unread": 0, "reminders": 0, "waiting": 0 },
            ])
        );
        // An unconfigured library syncs with nothing.
        assert_eq!(p.list(&json!({ "configured": false, "kind": "folder" }))[0]["syncs"], Value::Null);
    }
}
