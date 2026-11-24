//! Folevi Cloud sign-in (port of Electron's authBridge.ts and Native/Shell/ShellAuth.swift).
//!
//! The page lives on the app's own origin, where a cookie session for the website can't work. So the app signs in
//! the way native apps do (Authorization Code with PKCE, convex/lib/nativeAuth.ts, client "folevi-shell"):
//!   1. sign-in opens the website's /connect page (or /app-google for Google and Apple) in the default browser;
//!      the person signs in there as usual and presses Continue;
//!   2. the browser hands back folevi://auth/callback?code=...&state=... (the deep link handler calls
//!      `handle_callback`);
//!   3. the app trades the code and its PKCE verifier for a session of its own at /api/auth/native/token and keeps
//!      that bearer token sealed in the secret store (`auth.session.<user id>`). It never reaches the page.
//!
//! Afterwards the page's Better Auth client sends every request through `fetch` here: only the website's
//! /api/auth/*, with `Authorization: Bearer`, no cookies, `Origin` set to the website, a rotated `set-auth-token`
//! kept, and the token scrubbed from anything handed back. `convex_token` gets the page its short-lived Convex JWT.
//!
//! Calls take an optional `slot`: the account's user id (its token is `auth.session.<user id>`). Without one they
//! use the single session older builds kept (`auth.session`).
use base64::Engine;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

use crate::secrets::SecretStore;
use crate::shell::{ShellError, ShellResult};

/// Opens a URL in the default browser.
pub type OpenExternal = Arc<dyn Fn(&str) + Send + Sync>;

pub const SHELL_CLIENT_ID: &str = "folevi-shell";
pub const SHELL_REDIRECT_URI: &str = "folevi://auth/callback";
/// The single session older builds kept.
const LEGACY: &str = "auth.session";
const SIGN_IN_TIMEOUT_MS: u64 = 10 * 60_000;
/// The providers the browser can open straight on (the website's /app-google); anything else is /connect.
pub const DIRECT_PROVIDERS: [&str; 2] = ["google", "apple"];
/// Request headers the page may set; everything else (Authorization, Cookie, Origin, Host...) is the app's.
const PAGE_HEADERS: [&str; 5] = ["accept", "accept-language", "content-type", "cache-control", "pragma"];
/// Response headers the page never sees.
const HIDDEN_HEADERS: [&str; 3] = ["set-cookie", "set-cookie2", "set-auth-token"];
const MAX_BODY: usize = 1_000_000;
const MAX_PATH: usize = 4096;
const REFUSED: &str = "Folevi only sends the website's /api/auth requests from here.";
const OFFLINE: &str = "Folevi couldn't reach Folevi Cloud. Check the connection and try again.";

/// JavaScript's encodeURIComponent: everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ).
const URI_COMPONENT: &AsciiSet =
    &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~').remove(b'*').remove(b'\'').remove(b'(').remove(b')');

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub user_id: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
}

struct Pending {
    state: String,
    tx: oneshot::Sender<Option<String>>,
}

/// Where a rotated token goes: nowhere (a token being checked), or a slot (None: the legacy single session).
#[derive(Clone, Copy)]
enum Keep<'a> {
    Nowhere,
    Slot(Option<&'a str>),
}

pub struct Auth {
    /// The website's origin, where /connect and /api/auth live.
    service: url::Url,
    secrets: Arc<SecretStore>,
    open_external: OpenExternal,
    device_name: String,
    client: reqwest::Client,
    pending: parking_lot::Mutex<Option<Pending>>,
    timeout_ms: AtomicU64,
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random(n: usize) -> Vec<u8> {
    let mut v = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut v);
    v
}

/// RFC 7636: a 43-character verifier from 32 random bytes, and its S256 challenge.
pub fn pkce_pair() -> (String, String) {
    let verifier = b64url(&random(32));
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// ^[A-Za-z0-9._~+/=-]{16,1024}$
fn is_token(s: &str) -> bool {
    (16..=1024).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._~+/=-".contains(&b))
}

/// ^[A-Za-z0-9_-]{1,64}$
fn is_user_id(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// The website's origin as a URL ("https://app.folevi.com/").
fn origin_of(url: &url::Url) -> url::Url {
    url::Url::parse(&url.origin().ascii_serialization()).unwrap_or_else(|_| url.clone())
}

fn origin_header(service: &url::Url) -> String {
    service.origin().ascii_serialization()
}

/// Where sign-in starts in the browser (Electron's and the iPhone app's signInStart): /app-google?provider=... for a
/// known provider, otherwise /connect. Both take the same PKCE request and end on folevi://auth/callback.
pub fn sign_in_start(service: &url::Url, provider: Option<&str>, challenge: &str, state: &str) -> url::Url {
    let direct = provider.filter(|p| DIRECT_PROVIDERS.contains(p));
    let mut url = origin_of(service).join(if direct.is_some() { "/app-google" } else { "/connect" }).expect("a path joins");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("client_id", SHELL_CLIENT_ID)
            .append_pair("redirect_uri", SHELL_REDIRECT_URI)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state);
        if let Some(p) = direct {
            q.append_pair("provider", p);
        }
    }
    url
}

/// The page's path as a URL on the website's /api/auth, or None. Plain paths only: no other host, no traversal (the
/// URL parser resolves dot segments, encoded or not, so the prefix check sees the real path), no encoded slashes or
/// backslashes, no control characters.
pub fn auth_url(service: &url::Url, path: &Value) -> Option<url::Url> {
    let path = path.as_str()?;
    if js_len(path) > MAX_PATH || !path.starts_with("/api/auth/") {
        return None;
    }
    if path.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}' || c == '\\') {
        return None;
    }
    let lower = path.to_ascii_lowercase();
    if lower.contains("%2f") || lower.contains("%5c") || lower.contains("%00") {
        return None;
    }
    let base = origin_of(service);
    let mut url = base.join(path).ok()?;
    if url.origin() != base.origin() || !url.path().starts_with("/api/auth/") || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

/// The request the page asked for, cleaned (Electron's cleanInit).
#[derive(Debug, PartialEq)]
pub struct CleanInit {
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// An allowed method, the page's own harmless headers, a text body. `init` holds `method`, `headers`, `body`.
pub fn clean_init(init: &Value) -> Option<CleanInit> {
    let empty = Map::new();
    let i = init.as_object().unwrap_or(&empty);
    let method = i.get("method").and_then(Value::as_str).map(str::to_ascii_uppercase).unwrap_or_else(|| "GET".into());
    if method != "GET" && method != "POST" {
        return None;
    }
    let mut headers: Vec<(String, String)> = vec![];
    if let Some(h) = i.get("headers").and_then(Value::as_object) {
        for (k, v) in h {
            let key = k.to_ascii_lowercase();
            if let Some(v) = v.as_str() {
                if PAGE_HEADERS.contains(&key.as_str()) && js_len(v) <= 1000 && !v.contains(['\r', '\n']) {
                    headers.retain(|(k, _)| *k != key);
                    headers.push((key, v.to_string()));
                }
            }
        }
    }
    let body = match i.get("body") {
        None | Some(Value::Null) => None,
        Some(Value::String(b)) if js_len(b) <= MAX_BODY && method != "GET" => Some(b.clone()),
        Some(_) => return None,
    };
    Some(CleanInit { method, headers, body })
}

/// Removes every form of the session token (signed "raw.signature" and raw, plain and URL-encoded) from text bound
/// for the page.
pub fn scrub(text: &str, tokens: &[Option<&str>]) -> String {
    let mut forms: Vec<String> = vec![];
    for token in tokens.iter().flatten() {
        if token.is_empty() {
            continue;
        }
        let encoded = utf8_percent_encode(token, URI_COMPONENT).to_string();
        let raw = token.split('.').next().unwrap_or("").to_string();
        for form in [token.to_string(), encoded, raw] {
            if form.len() >= 16 && !forms.contains(&form) {
                forms.push(form);
            }
        }
    }
    // Longest first, so a signed token goes whole rather than leaving its signature behind.
    forms.sort_by_key(|f| std::cmp::Reverse(f.len()));
    let mut out = text.to_string();
    for form in forms {
        out = out.replace(&form, "");
    }
    out
}

/// The page's sign-in provider, checked (it may send anything): "google" or "apple", or None.
pub fn clean_provider(provider: Option<&str>) -> Option<&str> {
    provider.filter(|p| DIRECT_PROVIDERS.contains(p))
}

impl Auth {
    pub fn new(service: url::Url, secrets: Arc<SecretStore>, open_external: OpenExternal, device_name: String) -> Arc<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Arc::new(Self {
            service: origin_of(&service),
            secrets,
            open_external,
            device_name: Self::clean_device_name(&device_name),
            client,
            pending: parking_lot::Mutex::new(None),
            timeout_ms: AtomicU64::new(SIGN_IN_TIMEOUT_MS),
        })
    }

    /// The PC's name as the server wants it: the server adds "Folevi app (...)" itself, so a name that already
    /// says it is unwrapped. At most 60 characters, no control characters.
    fn clean_device_name(name: &str) -> String {
        let name = name.trim();
        let inner = name.strip_prefix("Folevi app (").and_then(|n| n.strip_suffix(')')).unwrap_or(name);
        take_chars(&inner.chars().filter(|c| !c.is_control()).collect::<String>(), 60)
    }

    /// How long a sign-in waits for the browser (10 minutes; tests shorten it).
    #[allow(dead_code)]
    pub fn set_sign_in_timeout(&self, d: Duration) {
        self.timeout_ms.store(d.as_millis() as u64, Ordering::Relaxed);
    }

    /// The secret a slot's token is kept as. A slot is a user id; "acct:<user id>" is taken too.
    fn name_of(slot: Option<&str>) -> String {
        match slot.map(|s| s.strip_prefix("acct:").unwrap_or(s)) {
            Some(id) => format!("{LEGACY}.{id}"),
            None => LEGACY.to_string(),
        }
    }

    fn token(&self, slot: Option<&str>) -> Option<String> {
        self.secrets.get(&Self::name_of(slot)).filter(|t| !t.is_empty())
    }

    /// Whether a session token is stored (for logs and tests; never sent to the page).
    #[allow(dead_code)]
    pub fn signed_in(&self, slot: Option<&str>) -> bool {
        self.token(slot).is_some()
    }

    fn url(&self, path: &str) -> url::Url {
        self.service.join(path).expect("a path joins")
    }

    /// A request to the website with the bearer, as native code sends it. A rotated token goes where `keep` says.
    async fn send(
        &self,
        url: url::Url,
        method: &str,
        headers: &[(String, String)],
        body: Option<String>,
        bearer: Option<&str>,
        keep: Keep<'_>,
    ) -> Result<(reqwest::Response, Option<String>), reqwest::Error> {
        let method = if method == "POST" { reqwest::Method::POST } else { reqwest::Method::GET };
        let mut req = self.client.request(method, url);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        req = req.header("origin", origin_header(&self.service));
        if let Some(b) = bearer {
            req = req.header("authorization", format!("Bearer {b}"));
        }
        if let Some(b) = body {
            req = req.body(b);
        }
        let res = req.send().await?;
        // A refreshed session comes back as a new token (Better Auth's bearer plugin): keep it.
        let rotated = res.headers().get("set-auth-token").and_then(|v| v.to_str().ok()).map(str::to_string);
        if let (Some(b), Some(r), Keep::Slot(slot)) = (bearer, rotated.as_deref(), keep) {
            if r != b && is_token(r) {
                if let Err(e) = self.secrets.set(&Self::name_of(slot), r) {
                    log::warn!("Folevi: couldn't keep a refreshed session ({})", e.code);
                }
            }
        }
        Ok((res, rotated))
    }

    /// Who a token's session belongs to (None: no live session, or no answer).
    async fn user_of(&self, bearer: &str) -> Option<SessionUser> {
        let (res, _) = self.send(self.url("/api/auth/get-session"), "GET", &[], None, Some(bearer), Keep::Nowhere).await.ok()?;
        if !res.status().is_success() {
            return None;
        }
        let body: Value = res.json().await.ok()?;
        let u = body.get("user")?;
        let id = u.get("id")?.as_str().filter(|id| is_user_id(id))?;
        let s = |k: &str, max: usize| u.get(k).and_then(Value::as_str).map(|v| take_chars(v, max)).unwrap_or_default();
        let avatar = u.get("image").and_then(Value::as_str).filter(|v| v.starts_with("https://")).map(|v| take_chars(v, 2000));
        Some(SessionUser { user_id: id.to_string(), name: s("name", 120), email: s("email", 254), avatar_url: avatar })
    }

    /// Ends a session on the server, best effort (offline: it expires on its own, and Settings > Devices can end it
    /// from anywhere).
    async fn end_session(&self, bearer: &str) {
        let headers = [("content-type".to_string(), "application/json".to_string())];
        let _ = self.send(self.url("/api/auth/sign-out"), "POST", &headers, Some("{}".into()), Some(bearer), Keep::Nowhere).await;
    }

    /// Ends the sign-in on its way, if any: it answers None.
    fn cancel_pending(&self) {
        if let Some(p) = self.pending.lock().take() {
            let _ = p.tx.send(None);
        }
    }

    /// Whether `url` is the end of a sign-in (folevi://auth/callback?...).
    pub fn is_callback(url: &str) -> bool {
        if url.len() > 2000 {
            return false;
        }
        match url::Url::parse(url) {
            Ok(u) => u.scheme() == "folevi" && u.host_str() == Some("auth") && u.path() == "/callback",
            Err(_) => false,
        }
    }

    /// A folevi://auth/callback link (from the deep link handler). Only the sign-in this app started (its state)
    /// goes on: a link someone else crafted signs nobody in.
    pub fn handle_callback(&self, url: &str) {
        if !Self::is_callback(url) {
            return;
        }
        let state = url::Url::parse(url)
            .ok()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "state").map(|(_, v)| v.into_owned()))
            .unwrap_or_default();
        let mut pending = self.pending.lock();
        if !state.is_empty() && pending.as_ref().is_some_and(|p| p.state == state) {
            if let Some(p) = pending.take() {
                let _ = p.tx.send(Some(url.to_string()));
            }
        }
    }

    /// The PKCE sign-in in the browser, ending with a new session's token (or None).
    async fn obtain(&self, provider: Option<&str>) -> Option<String> {
        let (verifier, challenge) = pkce_pair();
        let state = b64url(&random(24));
        let start = sign_in_start(&self.service, clean_provider(provider), &challenge, &state);
        let (tx, rx) = oneshot::channel();
        {
            // A new attempt replaces the one before it.
            let mut pending = self.pending.lock();
            if let Some(old) = pending.take() {
                let _ = old.tx.send(None);
            }
            *pending = Some(Pending { state: state.clone(), tx });
        }
        (self.open_external)(start.as_str());
        let timeout = Duration::from_millis(self.timeout_ms.load(Ordering::Relaxed));
        let callback = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(Some(url))) => url,
            _ => {
                let mut pending = self.pending.lock();
                if pending.as_ref().is_some_and(|p| p.state == state) {
                    *pending = None;
                }
                return None;
            }
        };
        let params: Vec<(String, String)> = url::Url::parse(&callback).ok()?.query_pairs().into_owned().collect();
        let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        let code = get("code")?;
        if get("error").is_some_and(|e| !e.is_empty()) || code.is_empty() || code.len() > 128 {
            return None;
        }
        let body = json!({
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": SHELL_CLIENT_ID,
            "redirect_uri": SHELL_REDIRECT_URI,
            "device_name": self.device_name,
        });
        let res = self
            .client
            .post(self.url("/api/auth/native/token"))
            .header("content-type", "application/json")
            .header("origin", origin_header(&self.service))
            .body(body.to_string())
            .send()
            .await
            .ok()?;
        if res.status().as_u16() != 200 {
            return None;
        }
        let answer: Value = res.json().await.ok()?;
        answer.get("access_token").and_then(Value::as_str).filter(|t| is_token(t)).map(str::to_string)
    }

    /// Signs in in the browser (`provider`: "google" or "apple" go straight there); the new account's user, or
    /// None when it didn't finish. The same person again replaces their old session; other accounts keep theirs.
    pub async fn sign_in_account(&self, provider: Option<&str>) -> Result<Option<SessionUser>, ShellError> {
        let Some(access) = self.obtain(provider).await else { return Ok(None) };
        let Some(user) = self.user_of(&access).await else {
            self.end_session(&access).await;
            return Ok(None);
        };
        let previous = self.token(Some(&user.user_id));
        self.secrets.set(&Self::name_of(Some(&user.user_id)), &access)?;
        if let Some(prev) = previous.filter(|p| *p != access) {
            self.end_session(&prev).await;
        }
        Ok(Some(user))
    }

    /// The single-session sign-in older builds made (`auth.session`): true when it finished. Signing in again ends
    /// the session this PC held before.
    #[allow(dead_code)]
    pub async fn sign_in(&self, provider: Option<&str>) -> Result<bool, ShellError> {
        let Some(access) = self.obtain(provider).await else { return Ok(false) };
        let previous = self.token(None);
        self.secrets.set(LEGACY, &access)?;
        if let Some(prev) = previous.filter(|p| *p != access) {
            self.end_session(&prev).await;
        }
        Ok(true)
    }

    /// The single session an older build kept, moved to its account's slot: that account, or None (none, or ended,
    /// or the server can't say right now: then it's tried again next launch).
    #[allow(dead_code)]
    pub async fn adopt_legacy(&self) -> Option<SessionUser> {
        let legacy = self.token(None)?;
        let user = self.user_of(&legacy).await?;
        if self.token(Some(&user.user_id)).is_none() && self.secrets.set(&Self::name_of(Some(&user.user_id)), &legacy).is_err() {
            return None;
        }
        let _ = self.secrets.delete(LEGACY);
        Some(user)
    }

    /// Ends the slot's session on the server (best effort) and forgets its token, online or not.
    pub async fn sign_out(&self, slot: Option<&str>) {
        self.cancel_pending();
        if let Some(bearer) = self.token(slot) {
            self.end_session(&bearer).await;
        }
        if let Err(e) = self.secrets.delete(&Self::name_of(slot)) {
            log::warn!("Folevi: couldn't delete a session token ({})", e.code);
        }
    }

    /// authFetch `{ path, method, headers, body }`: only the website's /api/auth/*, with the slot's bearer;
    /// `{ status, headers, body }` with the token scrubbed out.
    pub async fn fetch(&self, o: &Value, slot: Option<&str>) -> ShellResult {
        let url = auth_url(&self.service, o.get("path").unwrap_or(&Value::Null));
        let clean = clean_init(o);
        let (Some(url), Some(clean)) = (url, clean) else { return Err(ShellError::invalid(REFUSED)) };
        let bearer = self.token(slot);
        let (res, rotated) = self
            .send(url, &clean.method, &clean.headers, clean.body, bearer.as_deref(), Keep::Slot(slot))
            .await
            .map_err(|_| ShellError::unavailable(OFFLINE))?;
        let status = res.status().as_u16();
        let mut headers = Map::new();
        for (k, v) in res.headers() {
            let key = k.as_str().to_ascii_lowercase();
            if HIDDEN_HEADERS.contains(&key.as_str()) {
                continue;
            }
            let v = String::from_utf8_lossy(v.as_bytes()).into_owned();
            let joined = match headers.get(&key).and_then(Value::as_str) {
                Some(before) => format!("{before}, {v}"),
                None => v,
            };
            headers.insert(key, Value::String(joined));
        }
        let text = res.text().await.map_err(|_| ShellError::unavailable(OFFLINE))?;
        let now = self.token(slot);
        let body = scrub(&text, &[bearer.as_deref(), rotated.as_deref(), now.as_deref()]);
        Ok(json!({ "status": status, "headers": headers, "body": body }))
    }

    /// The slot's short-lived Convex JWT: None when signed out (a session that ended is forgotten).
    pub async fn convex_token(&self, slot: Option<&str>) -> Result<Option<String>, ShellError> {
        let Some(bearer) = self.token(slot) else { return Ok(None) };
        let (res, _) = self
            .send(self.url("/api/auth/convex/token"), "GET", &[], None, Some(&bearer), Keep::Slot(slot))
            .await
            .map_err(|_| ShellError::unavailable(OFFLINE))?;
        match res.status().as_u16() {
            401 => {
                // The session ended (signed out from Settings > Devices, expired): forget it.
                let _ = self.secrets.delete(&Self::name_of(slot));
                return Ok(None);
            }
            403 => return Ok(None),
            s if !(200..300).contains(&s) => return Err(ShellError::unavailable(format!("Folevi couldn't get a sync token ({s})."))),
            _ => {}
        }
        let body: Value = res.json().await.map_err(|_| ShellError::unavailable("Folevi couldn't get a sync token."))?;
        Ok(body.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::Sealer;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    const TOKEN: &str = "Sessiontoken0123456789abcdefABCD";
    const JWT: &str = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.sig";

    #[derive(Debug, Clone)]
    struct Req {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }
    impl Req {
        fn header(&self, k: &str) -> Option<&str> {
            self.headers.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
        }
        fn bearer(&self) -> String {
            self.header("authorization").unwrap_or("").trim_start_matches("Bearer ").to_string()
        }
    }

    struct Resp {
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    }
    fn json_resp(body: Value, status: u16) -> Resp {
        Resp { status, headers: vec![("content-type".into(), "application/json".into())], body: body.to_string() }
    }

    type Responder = Arc<dyn Fn(&Req) -> Resp + Send + Sync>;

    /// A local HTTP/1.1 server (no real network): one request per connection, answered by `respond`.
    struct Mock {
        base: url::Url,
        sent: Arc<parking_lot::Mutex<Vec<Req>>>,
    }

    fn mock(respond: Responder) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let sent = Arc::new(parking_lot::Mutex::new(vec![]));
        let log = sent.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let mut headers = vec![];
                loop {
                    let mut h = String::new();
                    if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                        break;
                    }
                    if let Some((k, v)) = h.trim_end().split_once(':') {
                        headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
                    }
                }
                let len = headers.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse::<usize>().ok()).unwrap_or(0);
                let mut body = vec![0u8; len];
                let _ = reader.read_exact(&mut body);
                let req = Req { method, path, headers, body: String::from_utf8_lossy(&body).into_owned() };
                log.lock().push(req.clone());
                let r = respond(&req);
                let mut out = format!("HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n", r.status, r.body.len());
                for (k, v) in &r.headers {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str("\r\n");
                out.push_str(&r.body);
                let _ = stream.write_all(out.as_bytes());
                let _ = stream.flush();
            }
        });
        Mock { base: url::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap(), sent }
    }

    struct Harness {
        auth: Arc<Auth>,
        mock: Mock,
        opened: Arc<parking_lot::Mutex<Vec<String>>>,
        store: Arc<SecretStore>,
        _dir: tempfile::TempDir,
    }

    impl Harness {
        fn sent(&self) -> Vec<Req> {
            self.mock.sent.lock().clone()
        }
        fn get(&self, name: &str) -> Option<String> {
            self.store.get(name)
        }
        async fn opened(&self, n: usize) -> url::Url {
            for _ in 0..500 {
                if let Some(u) = self.opened.lock().get(n) {
                    return url::Url::parse(u).unwrap();
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            panic!("the browser never opened");
        }
        async fn finish(&self, n: usize, query: &str) {
            let state = state_of(&self.opened(n).await);
            self.auth.handle_callback(&format!("folevi://auth/callback?{query}&state={state}"));
        }
    }

    fn state_of(u: &url::Url) -> String {
        u.query_pairs().find(|(k, _)| k == "state").unwrap().1.into_owned()
    }

    fn harness(token: Option<&str>, respond: Responder) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SecretStore::new(dir.path().join("secrets"), Arc::new(Sealer::with_key([3; 32]))));
        if let Some(t) = token {
            store.set("auth.session", t).unwrap();
        }
        let mock = mock(respond);
        let opened = Arc::new(parking_lot::Mutex::new(vec![]));
        let o = opened.clone();
        let auth = Auth::new(mock.base.clone(), store.clone(), Arc::new(move |u: &str| o.lock().push(u.to_string())), "Studio PC".into());
        Harness { auth, mock, opened, store, _dir: dir }
    }

    fn ok() -> Responder {
        Arc::new(|_| json_resp(json!({}), 200))
    }

    /// The app's command handlers need every call's future to be Send.
    #[allow(dead_code)]
    fn futures_are_send(a: &Auth, v: &Value) {
        fn send<T: Send>(_: T) {}
        send(a.fetch(v, None));
        send(a.convex_token(None));
        send(a.sign_out(None));
        send(a.sign_in_account(None));
        send(a.sign_in(None));
        send(a.adopt_legacy());
    }

    #[test]
    fn the_path_allowlist() {
        let s = url::Url::parse("https://app.folevi.com").unwrap();
        assert_eq!(auth_url(&s, &json!("/api/auth/get-session")).unwrap().as_str(), "https://app.folevi.com/api/auth/get-session");
        assert_eq!(auth_url(&s, &json!("/api/auth/get-session?disableCookieCache=true")).unwrap().query(), Some("disableCookieCache=true"));
        let long = format!("/api/auth/{}", "a".repeat(5000));
        for bad in [
            json!("/api/authx"),
            json!("/api/auth"),
            json!("/api/files/x"),
            json!("/api/auth/../admin"),
            json!("/api/auth/..%2fadmin"),
            json!("/api/auth/%2e%2e/%2e%2e/admin"),
            json!("/api/auth/%2E%2E/x"),
            json!("/api/auth/a%5cb"),
            json!("/api/auth/\\..\\x"),
            json!("/api/auth/a%00"),
            json!("/api/auth/\nx"),
            json!("//evil.example/api/auth/get-session"),
            json!("https://evil.example/api/auth/get-session"),
            json!("https://app.folevi.com/api/auth/get-session"),
            json!("api/auth/get-session"),
            json!(long),
            json!(42),
            Value::Null,
            json!({ "path": "/api/auth/get-session" }),
        ] {
            assert!(auth_url(&s, &bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn clean_init_keeps_a_method_harmless_headers_and_a_text_body() {
        assert_eq!(clean_init(&Value::Null), Some(CleanInit { method: "GET".into(), headers: vec![], body: None }));
        assert_eq!(
            clean_init(&json!({ "method": "post", "headers": { "Content-Type": "application/json", "Cookie": "a=b" }, "body": "{}" })),
            Some(CleanInit { method: "POST".into(), headers: vec![("content-type".into(), "application/json".into())], body: Some("{}".into()) })
        );
        assert_eq!(clean_init(&json!({ "method": "DELETE" })), None);
        assert_eq!(clean_init(&json!({ "headers": { "accept": "a\r\nx-evil: 1" } })), Some(CleanInit { method: "GET".into(), headers: vec![], body: None }));
    }

    #[tokio::test]
    async fn a_refused_path_or_method_never_leaves_the_app() {
        let h = harness(Some(TOKEN), ok());
        for o in [
            json!({ "path": "/api/admin/users", "method": "GET" }),
            json!({ "path": "https://evil.example/api/auth/get-session" }),
            json!({ "path": "/api/auth/get-session", "method": "PUT" }),
            json!({ "path": "/api/auth/get-session", "method": "GET", "body": "x" }),
            json!({ "path": "/api/auth/sign-out", "method": "POST", "body": [1, 2, 3, 4] }),
        ] {
            let e = h.auth.fetch(&o, None).await.unwrap_err();
            assert_eq!(e.code, "invalid_argument");
            assert!(e.message.contains("only sends"));
        }
        assert!(h.sent().is_empty());
    }

    #[tokio::test]
    async fn requests_carry_the_bearer_and_origin_and_nothing_the_page_added() {
        let h = harness(Some(TOKEN), ok());
        h.auth
            .fetch(
                &json!({
                    "path": "/api/auth/two-factor/verify-totp",
                    "method": "POST",
                    "headers": { "authorization": "Bearer someone-elses", "cookie": "folevi.session=x", "origin": "app://folevi", "host": "evil.example", "x-forwarded-for": "1.2.3.4", "content-type": "application/json" },
                    "body": "{\"code\":\"123456\"}",
                }),
                None,
            )
            .await
            .unwrap();
        let sent = h.sent();
        assert_eq!(sent.len(), 1);
        let r = &sent[0];
        assert_eq!(r.method, "POST");
        assert_eq!(r.path, "/api/auth/two-factor/verify-totp");
        assert_eq!(r.header("authorization"), Some(format!("Bearer {TOKEN}").as_str()));
        assert_eq!(r.header("origin"), Some(h.mock.base.origin().ascii_serialization().as_str()));
        assert_eq!(r.header("content-type"), Some("application/json"));
        assert_eq!(r.header("host").unwrap(), h.mock.base.host_str().unwrap().to_string() + ":" + &h.mock.base.port().unwrap().to_string());
        assert!(r.header("cookie").is_none());
        assert!(r.header("x-forwarded-for").is_none());
        assert_eq!(r.body, "{\"code\":\"123456\"}");
    }

    #[tokio::test]
    async fn signed_out_no_authorization_at_all() {
        let h = harness(None, ok());
        h.auth.fetch(&json!({ "path": "/api/auth/get-session", "method": "GET" }), None).await.unwrap();
        let r = &h.sent()[0];
        assert!(r.header("authorization").is_none());
        assert!(r.header("origin").is_some());
    }

    #[tokio::test]
    async fn the_token_is_scrubbed_and_its_headers_dropped() {
        let rotated = "Rotatedtoken0123456789abcdefWXYZ";
        let h = harness(
            Some(TOKEN),
            Arc::new(move |_| Resp {
                status: 200,
                headers: vec![
                    ("content-type".into(), "application/json".into()),
                    ("set-auth-token".into(), rotated.into()),
                    ("set-cookie".into(), format!("folevi.session_token={TOKEN}; HttpOnly")),
                    ("x-request-id".into(), "r1".into()),
                ],
                body: json!({ "session": { "id": "s1", "token": TOKEN, "userId": "u1" }, "user": { "email": "a@example.com" }, "echo": format!("{TOKEN}.signature"), "next": rotated }).to_string(),
            }),
        );
        let res = h.auth.fetch(&json!({ "path": "/api/auth/get-session", "method": "GET" }), None).await.unwrap();
        assert_eq!(res["status"], 200);
        let body = res["body"].as_str().unwrap();
        assert!(!body.contains(TOKEN));
        assert!(!body.contains(rotated));
        let parsed: Value = serde_json::from_str(body).unwrap();
        assert_eq!(parsed["user"]["email"], "a@example.com");
        assert_eq!(parsed["session"]["token"], "");
        let headers = res["headers"].as_object().unwrap();
        assert!(!headers.contains_key("set-auth-token"));
        assert!(!headers.contains_key("set-cookie"));
        assert_eq!(headers["x-request-id"], "r1");
        assert!(!res.to_string().contains(TOKEN));
        // The rotated token is kept for the next request.
        assert_eq!(h.get("auth.session").as_deref(), Some(rotated));
    }

    #[test]
    fn scrub_removes_the_signed_raw_and_url_encoded_forms() {
        let signed = format!("{TOKEN}.c2lnbmF0dXJlK3NpZw==");
        let encoded = utf8_percent_encode(&signed, URI_COMPONENT).to_string();
        assert!(encoded.ends_with("%3D%3D"));
        let text = format!("a {signed} b {TOKEN} c {encoded} d");
        let out = scrub(&text, &[Some(&signed)]);
        assert!(!out.contains(TOKEN));
        assert_eq!(out, "a  b  c  d");
        assert_eq!(scrub("short abc", &[Some("abc")]), "short abc");
    }

    #[tokio::test]
    async fn a_rotated_value_that_isnt_a_token_is_ignored() {
        let h = harness(Some(TOKEN), Arc::new(|_| Resp { status: 200, headers: vec![("set-auth-token".into(), "x y".into())], body: "{}".into() }));
        h.auth.fetch(&json!({ "path": "/api/auth/get-session" }), None).await.unwrap();
        assert_eq!(h.get("auth.session").as_deref(), Some(TOKEN));
    }

    #[tokio::test]
    async fn pkce_in_the_browser_and_the_code_exchanged_for_a_session_the_app_keeps() {
        let issued = "Newsessiontoken0123456789abcdefgh";
        let h = harness(
            None,
            Arc::new(move |r| {
                if r.path == "/api/auth/native/token" {
                    json_resp(json!({ "access_token": issued, "token_type": "Bearer" }), 200)
                } else {
                    json_resp(json!({}), 200)
                }
            }),
        );
        let auth = h.auth.clone();
        let done = tokio::spawn(async move { auth.sign_in(None).await });
        let connect = h.opened(0).await;
        assert_eq!(connect.path(), "/connect");
        assert_eq!(connect.origin(), h.mock.base.origin());
        let q: std::collections::HashMap<String, String> = connect.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], SHELL_CLIENT_ID);
        assert_eq!(q["redirect_uri"], SHELL_REDIRECT_URI);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"].len(), 43);
        assert!(!q.contains_key("provider"));
        let state = q["state"].clone();
        assert!(state.len() >= 32);

        // A link with someone else's state is swallowed and changes nothing.
        h.auth.handle_callback("folevi://auth/callback?code=forged&state=other");
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(h.sent().is_empty());

        h.auth.handle_callback(&format!("folevi://auth/callback?code=thecode&state={state}"));
        assert!(done.await.unwrap().unwrap());
        let sent = h.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].path, "/api/auth/native/token");
        assert!(sent[0].header("cookie").is_none());
        let body: Value = serde_json::from_str(&sent[0].body).unwrap();
        assert_eq!(body["grant_type"], "authorization_code");
        assert_eq!(body["code"], "thecode");
        assert_eq!(body["client_id"], SHELL_CLIENT_ID);
        assert_eq!(body["redirect_uri"], SHELL_REDIRECT_URI);
        assert_eq!(body["device_name"], "Studio PC");
        // The verifier is the one behind the challenge the browser saw.
        assert_eq!(b64url(&Sha256::digest(body["code_verifier"].as_str().unwrap().as_bytes())), q["code_challenge"]);
        assert_eq!(h.get("auth.session").as_deref(), Some(issued));
        assert!(h.auth.signed_in(None));
    }

    #[tokio::test]
    async fn google_and_apple_open_straight_on_their_page() {
        let h = harness(None, ok());
        let auth = h.auth.clone();
        let done = tokio::spawn(async move { auth.sign_in_account(Some("google")).await });
        let u = h.opened(0).await;
        assert_eq!(u.path(), "/app-google");
        assert_eq!(u.query_pairs().find(|(k, _)| k == "provider").unwrap().1, "google");
        h.auth.sign_out(None).await;
        assert_eq!(done.await.unwrap().unwrap(), None);
        // Anything else is /connect.
        let start = sign_in_start(&h.mock.base, clean_provider(Some("github")), "c", "s");
        assert_eq!(start.path(), "/connect");
        assert!(!start.as_str().contains("provider"));
    }

    #[tokio::test]
    async fn a_refusal_a_failed_exchange_or_a_timeout_signs_nobody_in() {
        let refused = harness(None, ok());
        let auth = refused.auth.clone();
        let a = tokio::spawn(async move { auth.sign_in(None).await });
        refused.finish(0, "error=access_denied").await;
        assert!(!a.await.unwrap().unwrap());
        assert!(refused.sent().is_empty());
        assert!(refused.get("auth.session").is_none());

        let failing = harness(None, Arc::new(|_| json_resp(json!({ "error": "invalid_grant" }), 400)));
        let auth = failing.auth.clone();
        let b = tokio::spawn(async move { auth.sign_in(None).await });
        failing.finish(0, "code=c").await;
        assert!(!b.await.unwrap().unwrap());
        assert!(failing.get("auth.session").is_none());

        let slow = harness(None, ok());
        slow.auth.set_sign_in_timeout(Duration::from_millis(20));
        assert!(!slow.auth.sign_in(None).await.unwrap());
        assert!(slow.auth.pending.lock().is_none());
    }

    #[tokio::test]
    async fn a_second_attempt_replaces_the_first() {
        let h = harness(None, Arc::new(|_| json_resp(json!({ "access_token": "Anothertoken0123456789abcdefghij" }), 200)));
        let auth = h.auth.clone();
        let first = tokio::spawn(async move { auth.sign_in(None).await });
        h.opened(0).await;
        let auth = h.auth.clone();
        let second = tokio::spawn(async move { auth.sign_in(None).await });
        assert!(!first.await.unwrap().unwrap());
        h.opened(1).await;
        h.finish(0, "code=c").await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(h.sent().is_empty());
        h.finish(1, "code=c").await;
        assert!(second.await.unwrap().unwrap());
    }

    #[tokio::test]
    async fn signing_in_again_ends_the_session_held_before() {
        let fresh = "Freshsessiontoken0123456789abcdef";
        let h = harness(
            Some(TOKEN),
            Arc::new(move |r| if r.path == "/api/auth/native/token" { json_resp(json!({ "access_token": fresh }), 200) } else { json_resp(json!({ "success": true }), 200) }),
        );
        let auth = h.auth.clone();
        let done = tokio::spawn(async move { auth.sign_in(None).await });
        h.finish(0, "code=c").await;
        assert!(done.await.unwrap().unwrap());
        assert_eq!(h.get("auth.session").as_deref(), Some(fresh));
        let out = h.sent().into_iter().find(|r| r.path == "/api/auth/sign-out").unwrap();
        assert_eq!(out.bearer(), TOKEN);
    }

    #[test]
    fn only_folevi_auth_callback_is_a_sign_in_return() {
        assert!(Auth::is_callback("folevi://auth/callback?code=a&state=b"));
        assert!(!Auth::is_callback("folevi://auth/google?code=a"));
        assert!(!Auth::is_callback("folevi://d/01ABC"));
        assert!(!Auth::is_callback("https://auth/callback"));
        assert!(!Auth::is_callback(&format!("folevi://auth/callback?x={}", "a".repeat(3000))));
    }

    #[test]
    fn pkce_pair_makes_a_verifier_the_server_accepts() {
        let (verifier, challenge) = pkce_pair();
        assert_eq!(verifier.len(), 43);
        assert!(verifier.bytes().all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b)));
        assert_eq!(challenge, b64url(&Sha256::digest(verifier.as_bytes())));
    }

    #[test]
    fn the_device_name_is_the_pcs() {
        assert_eq!(Auth::clean_device_name("Studio PC"), "Studio PC");
        assert_eq!(Auth::clean_device_name("Folevi app (Studio PC)"), "Studio PC");
        assert_eq!(Auth::clean_device_name(&"x".repeat(80)).len(), 60);
    }

    #[tokio::test]
    async fn convex_token_the_jwt_none_when_signed_out_forgotten_when_ended() {
        let ok = harness(Some(TOKEN), Arc::new(|_| json_resp(json!({ "token": JWT }), 200)));
        assert_eq!(ok.auth.convex_token(None).await.unwrap().as_deref(), Some(JWT));
        assert_eq!(ok.sent()[0].path, "/api/auth/convex/token");
        assert_eq!(ok.sent()[0].bearer(), TOKEN);

        let none = harness(None, ok_resp());
        assert_eq!(none.auth.convex_token(None).await.unwrap(), None);
        assert!(none.sent().is_empty());

        let ended = harness(Some(TOKEN), Arc::new(|_| json_resp(json!({ "code": "UNAUTHORIZED" }), 401)));
        assert_eq!(ended.auth.convex_token(None).await.unwrap(), None);
        assert!(ended.get("auth.session").is_none());

        // A server error isn't "signed out": it fails, and the page carries on offline.
        let down = harness(Some(TOKEN), Arc::new(|_| Resp { status: 503, headers: vec![], body: "busy".into() }));
        assert!(down.auth.convex_token(None).await.is_err());
        assert_eq!(down.get("auth.session").as_deref(), Some(TOKEN));
    }

    fn ok_resp() -> Responder {
        ok()
    }

    #[tokio::test]
    async fn sign_out_ends_the_session_then_forgets_it_online_or_not() {
        let h = harness(Some(TOKEN), ok());
        h.auth.sign_out(None).await;
        let sent = h.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].path, "/api/auth/sign-out");
        assert_eq!(sent[0].method, "POST");
        assert_eq!(sent[0].bearer(), TOKEN);
        assert!(sent[0].header("origin").is_some());
        assert!(h.get("auth.session").is_none());

        // Offline: nothing listens on the port.
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(SecretStore::new(dir.path().join("s"), Arc::new(Sealer::with_key([4; 32]))));
        store.set("auth.session.userA", TOKEN).unwrap();
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let offline = Auth::new(url::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap(), store.clone(), Arc::new(|_: &str| {}), "PC".into());
        offline.sign_out(Some("userA")).await;
        assert!(store.get("auth.session.userA").is_none());
    }

    /// A server whose sessions belong to people: get-session answers who a bearer is.
    fn server(people: Vec<(&'static str, &'static str, &'static str)>, issue: Vec<&'static str>) -> Responder {
        let queue = Arc::new(parking_lot::Mutex::new(std::collections::VecDeque::from(issue)));
        Arc::new(move |r: &Req| {
            if r.path == "/api/auth/native/token" {
                return json_resp(json!({ "access_token": queue.lock().pop_front().unwrap_or("x") }), 200);
            }
            let who = people.iter().find(|(t, _, _)| *t == r.bearer());
            match (r.path.as_str(), who) {
                ("/api/auth/get-session", Some((t, id, email))) => {
                    json_resp(json!({ "session": { "token": t }, "user": { "id": id, "email": email, "name": email.split('@').next(), "image": "http://insecure.example/a.png" } }), 200)
                }
                ("/api/auth/get-session", None) => json_resp(Value::Null, 200),
                ("/api/auth/convex/token", Some((_, id, _))) => json_resp(json!({ "token": format!("jwt-for-{id}") }), 200),
                ("/api/auth/convex/token", None) => json_resp(json!({}), 401),
                _ => json_resp(json!({ "success": true }), 200),
            }
        })
    }

    #[tokio::test]
    async fn each_account_keeps_its_own_session() {
        let ana1 = "Anasessiontoken0123456789abcdefA";
        let ben1 = "Bensessiontoken0123456789abcdefB";
        let ana2 = "Anasessiontoken0123456789abcde2A";
        let people = vec![(ana1, "userAna", "ana@example.com"), (ben1, "userBen", "ben@example.com"), (ana2, "userAna", "ana@example.com")];
        let h = harness(None, server(people, vec![ana1, ben1, ana2]));

        let auth = h.auth.clone();
        let p = tokio::spawn(async move { auth.sign_in_account(None).await });
        h.finish(0, "code=c0").await;
        let ana = p.await.unwrap().unwrap().unwrap();
        assert_eq!(ana, SessionUser { user_id: "userAna".into(), name: "ana".into(), email: "ana@example.com".into(), avatar_url: None });
        assert_eq!(serde_json::to_value(&ana).unwrap(), json!({ "userId": "userAna", "name": "ana", "email": "ana@example.com", "avatarUrl": null }));

        let auth = h.auth.clone();
        let p = tokio::spawn(async move { auth.sign_in_account(None).await });
        h.finish(1, "code=c1").await;
        assert_eq!(p.await.unwrap().unwrap().unwrap().user_id, "userBen");
        assert_eq!(h.get("auth.session.userAna").as_deref(), Some(ana1));
        assert_eq!(h.get("auth.session.userBen").as_deref(), Some(ben1));
        assert!(h.get("auth.session").is_none());

        // Requests go with the named account's bearer ("acct:<id>" works too).
        assert_eq!(h.auth.convex_token(Some("userBen")).await.unwrap().as_deref(), Some("jwt-for-userBen"));
        assert_eq!(h.auth.convex_token(Some("acct:userAna")).await.unwrap().as_deref(), Some("jwt-for-userAna"));
        assert_eq!(h.auth.convex_token(Some("userNobody")).await.unwrap(), None);

        // Ana again: her old session ends, Ben's stays.
        h.mock.sent.lock().clear();
        let auth = h.auth.clone();
        let p = tokio::spawn(async move { auth.sign_in_account(None).await });
        h.finish(2, "code=c2").await;
        assert_eq!(p.await.unwrap().unwrap().unwrap().user_id, "userAna");
        assert_eq!(h.get("auth.session.userAna").as_deref(), Some(ana2));
        assert_eq!(h.get("auth.session.userBen").as_deref(), Some(ben1));
        let outs: Vec<String> = h.sent().iter().filter(|r| r.path == "/api/auth/sign-out").map(Req::bearer).collect();
        assert_eq!(outs, vec![ana1.to_string()]);

        // Signing out of Ben leaves Ana.
        h.auth.sign_out(Some("userBen")).await;
        assert!(h.get("auth.session.userBen").is_none());
        assert!(h.auth.signed_in(Some("userAna")));
    }

    #[tokio::test]
    async fn a_session_with_no_user_is_ended_and_signs_nobody_in() {
        let fresh = "Freshsessiontoken0123456789abcdef";
        let h = harness(None, server(vec![], vec![fresh]));
        let auth = h.auth.clone();
        let p = tokio::spawn(async move { auth.sign_in_account(None).await });
        h.finish(0, "code=c").await;
        assert_eq!(p.await.unwrap().unwrap(), None);
        assert!(h.sent().iter().any(|r| r.path == "/api/auth/sign-out" && r.bearer() == fresh));
    }

    #[tokio::test]
    async fn an_older_builds_single_session_moves_to_its_accounts_slot() {
        let h = harness(Some(TOKEN), server(vec![(TOKEN, "userOld", "old@example.com")], vec![]));
        assert_eq!(h.auth.adopt_legacy().await.unwrap().user_id, "userOld");
        assert!(h.get("auth.session").is_none());
        assert_eq!(h.get("auth.session.userOld").as_deref(), Some(TOKEN));
        let ended = harness(Some(TOKEN), server(vec![], vec![]));
        assert_eq!(ended.auth.adopt_legacy().await, None);
        assert_eq!(ended.get("auth.session").as_deref(), Some(TOKEN));
    }
}
