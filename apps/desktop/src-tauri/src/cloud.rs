//! Dropbox and Google Drive for the library (port of Native/Shell/ShellCloud.swift; docs/LOCAL_MODE.md). The
//! syncing itself is the shared code in the page (packages/cloud-folders, bundled as folevi-cloud.js); this side
//! signs in, keeps the tokens where the page can't read them, and makes the page's requests to the provider with
//! them (`cloudRequest`), only to that provider's own hosts.
//!
//! Sign-in is OAuth 2 with PKCE and no secret, in the browser, ending on a loopback address the app listens on
//! (Electron's way; no in-app browser here): Dropbox at `http://127.0.0.1:41753/` (or 41754, 41755: registered on
//! the Dropbox app), Google at any `http://127.0.0.1:<port>/` (a "Desktop app" OAuth client).
//!
//! The client ids come from the build (or the environment): FOLEVI_DROPBOX_APP_KEY and
//! FOLEVI_GOOGLE_DESKTOP_CLIENT_ID (FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET only if Google asks for one). Without them the
//! provider isn't offered (`available`), and the page doesn't show it.
use base64::Engine;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;

use crate::auth::OpenExternal;
use crate::events::Emit;
use crate::secrets::SecretStore;
use crate::shell::{now_ms, write_atomic, ShellError, ShellResult};

pub const DROPBOX: &str = "dropbox";
pub const DRIVE: &str = "googleDrive";
const DROPBOX_PORTS: [u16; 3] = [41753, 41754, 41755];
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);

fn err(code: &str, message: &str) -> ShellError {
    ShellError::new(code, message)
}

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub dropbox_key: Option<String>,
    pub google_id: Option<String>,
    pub google_secret: Option<String>,
}

impl Config {
    /// From the build (option_env!) or, for a development run, the environment.
    pub fn from_build() -> Self {
        let pick = |built: Option<&'static str>, name: &str| built.map(str::to_string).or_else(|| std::env::var(name).ok()).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Config {
            dropbox_key: pick(option_env!("FOLEVI_DROPBOX_APP_KEY"), "FOLEVI_DROPBOX_APP_KEY"),
            google_id: pick(option_env!("FOLEVI_GOOGLE_DESKTOP_CLIENT_ID"), "FOLEVI_GOOGLE_DESKTOP_CLIENT_ID"),
            google_secret: pick(option_env!("FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET"), "FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET"),
        }
    }

    /// The providers this build can sign in to.
    pub fn available(&self) -> Vec<&'static str> {
        let mut out = vec![];
        if self.dropbox_key.as_deref().is_some_and(|k| (8..=32).contains(&k.len()) && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())) {
            out.push(DROPBOX);
        }
        if self.google_id.as_deref().is_some_and(|i| i.ends_with(".apps.googleusercontent.com")) {
            out.push(DRIVE);
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    /// ms since 1970.
    expires_at: u64,
}

/// cloud.json: which provider, the account line, whether it needs a reconnect, whether the last request was offline.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    provider: Option<String>,
    account: Option<String>,
    #[serde(default)]
    reconnect: bool,
    #[serde(default)]
    offline: bool,
}

/// The hosts the page's requests may reach: with the token, the provider's API; without, Dropbox's longpoll only.
pub fn allowed(provider: &str, url: &url::Url, authorized: bool) -> Result<(), &'static str> {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some_and(|p| p != 443) {
        return Err("invalid");
    }
    let host = url.host_str().unwrap_or("");
    if !authorized {
        return if provider == DROPBOX && host == "notify.dropboxapi.com" { Ok(()) } else { Err("invalid") };
    }
    let ok = match provider {
        DROPBOX => host == "api.dropboxapi.com" || host == "content.dropboxapi.com",
        DRIVE => host == "www.googleapis.com",
        _ => false,
    };
    if ok {
        return Ok(());
    }
    // Another provider's host with this one's token: that provider isn't connected.
    if ["api.dropboxapi.com", "content.dropboxapi.com", "www.googleapis.com"].contains(&host) {
        Err("reconnect")
    } else {
        Err("invalid")
    }
}

/// RFC 7636: a 43-character verifier and its S256 challenge.
pub fn pkce() -> (String, String) {
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let mut v = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut v);
    let verifier = b64.encode(v);
    let challenge = b64.encode(sha2::Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// The provider's sign-in page.
pub fn authorize_url(cfg: &Config, provider: &str, redirect: &str, challenge: &str, state: &str) -> Option<url::Url> {
    let mut u;
    match provider {
        DROPBOX => {
            u = url::Url::parse("https://www.dropbox.com/oauth2/authorize").ok()?;
            u.query_pairs_mut()
                .append_pair("client_id", cfg.dropbox_key.as_deref()?)
                .append_pair("response_type", "code")
                .append_pair("token_access_type", "offline")
                .append_pair("redirect_uri", redirect)
                .append_pair("code_challenge", challenge)
                .append_pair("code_challenge_method", "S256")
                .append_pair("state", state);
        }
        DRIVE => {
            u = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").ok()?;
            u.query_pairs_mut()
                .append_pair("client_id", cfg.google_id.as_deref()?)
                .append_pair("response_type", "code")
                .append_pair("scope", "https://www.googleapis.com/auth/drive.file email")
                .append_pair("access_type", "offline")
                .append_pair("prompt", "consent")
                .append_pair("redirect_uri", redirect)
                .append_pair("code_challenge", challenge)
                .append_pair("code_challenge_method", "S256")
                .append_pair("state", state);
        }
        _ => return None,
    }
    Some(u)
}

fn token_url(provider: &str) -> &'static str {
    if provider == DROPBOX {
        "https://api.dropboxapi.com/oauth2/token"
    } else {
        "https://oauth2.googleapis.com/token"
    }
}

/// The code and state from the browser's request to the loopback address (`GET /?code=…&state=…`), or its error.
pub fn parse_redirect(request_line: &str) -> Option<Result<(String, String), String>> {
    let target = request_line.strip_prefix("GET ")?.split(' ').next()?;
    let u = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if u.path() != "/" {
        return None;
    }
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    if let Some(e) = get("error") {
        return Some(Err(e));
    }
    Some(Ok((get("code")?, get("state")?)))
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Folevi</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333}</style><p>You're connected. You can close this tab and go back to Folevi.</p>";
const FAIL_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Folevi</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333}</style><p>Folevi wasn't connected. You can close this tab and try again in Folevi.</p>";

pub struct Cloud {
    dir: PathBuf,
    cfg: Config,
    secrets: Arc<SecretStore>,
    open_external: OpenExternal,
    emit: Emit,
    client: reqwest::Client,
    settings: Mutex<Settings>,
    cancel: Mutex<Option<oneshot::Sender<()>>>,
    refreshing: tokio::sync::Mutex<()>,
}

impl Cloud {
    pub fn new(dir: PathBuf, cfg: Config, secrets: Arc<SecretStore>, open_external: OpenExternal, emit: Emit) -> Arc<Self> {
        let settings = std::fs::read(dir.join("cloud.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(150))
            .build()
            .unwrap_or_default();
        Arc::new(Self { dir, cfg, secrets, open_external, emit, client, settings: Mutex::new(settings), cancel: Mutex::new(None), refreshing: tokio::sync::Mutex::new(()) })
    }

    fn secret_name(provider: &str) -> String {
        format!("cloud.{provider}")
    }

    fn tokens(&self, provider: &str) -> Option<Tokens> {
        self.secrets.get(&Self::secret_name(provider)).and_then(|t| serde_json::from_str(&t).ok())
    }

    fn keep_tokens(&self, provider: &str, t: &Tokens) -> Result<(), ShellError> {
        self.secrets.set(&Self::secret_name(provider), &serde_json::to_string(t).unwrap_or_default())
    }

    fn forget_tokens(&self, provider: &str) {
        let _ = self.secrets.delete(&Self::secret_name(provider));
    }

    fn change(&self, f: impl FnOnce(&mut Settings)) {
        let (before, after) = {
            let mut s = self.settings.lock();
            let before = serde_json::to_value(&*s).unwrap_or_default();
            f(&mut s);
            (before, serde_json::to_value(&*s).unwrap_or_default())
        };
        if before != after {
            let _ = std::fs::create_dir_all(&self.dir);
            let _ = write_atomic(&self.dir.join("cloud.json"), after.to_string().as_bytes());
            (self.emit)("cloudStatus", json!({ "status": self.status() }));
        }
    }

    /// cloudStatus: `{ available, provider, state, account }`.
    pub fn status(&self) -> Value {
        let s = self.settings.lock().clone();
        let connecting = self.cancel.lock().is_some();
        let provider = s.provider.clone().filter(|p| self.tokens(p).is_some() || s.reconnect);
        let state = if connecting {
            "connecting"
        } else if provider.is_none() {
            "none"
        } else if s.reconnect {
            "reconnect"
        } else if s.offline {
            "offline"
        } else {
            "connected"
        };
        json!({ "available": self.cfg.available(), "provider": provider, "state": state, "account": if provider.is_some() { s.account } else { None } })
    }

    /// Listens on the provider's loopback address: the listener and its redirect URI.
    async fn listen(provider: &str) -> Result<(tokio::net::TcpListener, String), ShellError> {
        let ports: Vec<u16> = if provider == DROPBOX { DROPBOX_PORTS.to_vec() } else { vec![0] };
        for p in ports {
            if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
                let port = l.local_addr().map(|a| a.port()).unwrap_or(p);
                return Ok((l, format!("http://127.0.0.1:{port}/")));
            }
        }
        Err(err("unavailable", "Folevi couldn't open the address the sign-in comes back to. Quit other copies of Folevi, then try again."))
    }

    /// Waits for the browser to come back with this sign-in's state: the code.
    async fn wait_for_code(listener: tokio::net::TcpListener, state: &str) -> Result<String, ShellError> {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|_| err("offline", "The sign-in didn't finish."))?;
            let mut buf = vec![0u8; 8192];
            let n = tokio::time::timeout(Duration::from_secs(10), sock.read(&mut buf)).await.ok().and_then(Result::ok).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            let line = head.lines().next().unwrap_or("");
            let answer = parse_redirect(line);
            let ok = matches!(&answer, Some(Ok((_, s))) if s == state);
            let page = if ok { DONE_PAGE } else { FAIL_PAGE };
            let _ = sock.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes()).await;
            match answer {
                Some(Ok((code, s))) if s == state => return Ok(code),
                Some(Err(_)) => return Err(err("cancelled", "The sign-in was cancelled.")),
                // Another tab's request (a favicon, an old sign-in): keep waiting.
                _ => continue,
            }
        }
    }

    /// cloudConnect { provider }: signs in in the browser (also a reconnect), then answers the status.
    pub async fn connect(&self, provider: &str) -> ShellResult {
        if !self.cfg.available().contains(&provider) {
            return Err(err("unavailable", "That service isn't in this version of Folevi."));
        }
        let current = self.settings.lock().provider.clone();
        if current.as_deref().is_some_and(|p| p != provider && self.tokens(p).is_some()) {
            return Err(err("one_connection", "The library already syncs with another service. Disconnect it first."));
        }
        let (listener, redirect) = Self::listen(provider).await?;
        let (verifier, challenge) = pkce();
        let mut st = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut st);
        let state = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(st);
        let start = authorize_url(&self.cfg, provider, &redirect, &challenge, &state).ok_or_else(|| err("unavailable", "That service isn't in this version of Folevi."))?;
        let (tx, rx) = oneshot::channel();
        if let Some(old) = self.cancel.lock().replace(tx) {
            let _ = old.send(());
        }
        (self.emit)("cloudStatus", json!({ "status": self.status() }));
        (self.open_external)(start.as_str());
        let code = tokio::select! {
            c = tokio::time::timeout(SIGN_IN_TIMEOUT, Self::wait_for_code(listener, &state)) => c.map_err(|_| err("cancelled", "The sign-in took too long."))?,
            _ = rx => Err(err("cancelled", "The sign-in was cancelled.")),
        };
        self.cancel.lock().take();
        let code = match code {
            Ok(c) => c,
            Err(e) => {
                (self.emit)("cloudStatus", json!({ "status": self.status() }));
                return Err(e);
            }
        };
        let mut form = vec![("grant_type", "authorization_code".to_string()), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect)];
        form.push(("client_id", if provider == DROPBOX { self.cfg.dropbox_key.clone() } else { self.cfg.google_id.clone() }.unwrap_or_default()));
        if provider == DRIVE {
            if let Some(secret) = &self.cfg.google_secret {
                form.push(("client_secret", secret.clone()));
            }
        }
        let tokens = self.token_request(provider, &form).await?.ok_or_else(|| err("protocol", "The service didn't sign Folevi in."))?;
        self.keep_tokens(provider, &tokens)?;
        let account = self.account_line(provider, &tokens.access_token).await;
        self.change(|s| {
            s.provider = Some(provider.to_string());
            s.account = account;
            s.reconnect = false;
            s.offline = false;
        });
        Ok(self.status())
    }

    /// The token endpoint: new tokens, None on a 400 or 401 (the grant is gone).
    async fn token_request(&self, provider: &str, form: &[(&str, String)]) -> Result<Option<Tokens>, ShellError> {
        let res = self.client.post(token_url(provider)).form(form).send().await.map_err(|_| err("offline", "Folevi couldn't reach the service."))?;
        let status = res.status().as_u16();
        if status == 400 || status == 401 {
            return Ok(None);
        }
        if !(200..300).contains(&status) {
            return Err(err("protocol", &format!("The service answered {status}.")));
        }
        let v: Value = res.json().await.map_err(|_| err("protocol", "The service's answer wasn't readable."))?;
        let access = v.get("access_token").and_then(Value::as_str).ok_or_else(|| err("protocol", "The service sent no token."))?;
        let ttl = v.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
        Ok(Some(Tokens { access_token: access.to_string(), refresh_token: v.get("refresh_token").and_then(Value::as_str).map(str::to_string), expires_at: now_ms() + ttl * 1000 }))
    }

    async fn account_line(&self, provider: &str, token: &str) -> Option<String> {
        let req = if provider == DROPBOX {
            self.client.post("https://api.dropboxapi.com/2/users/get_current_account").bearer_auth(token)
        } else {
            self.client.get("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)").bearer_auth(token)
        };
        let v: Value = req.send().await.ok()?.json().await.ok()?;
        let email = if provider == DROPBOX { v.get("email") } else { v.get("user").and_then(|u| u.get("emailAddress")) };
        email.and_then(Value::as_str).map(|e| e.chars().take(254).collect())
    }

    /// A usable access token: refreshed 60 seconds before it runs out (or now, after a 401). None: reconnect.
    async fn access(&self, provider: &str, force: bool) -> Result<Option<String>, ShellError> {
        let _one = self.refreshing.lock().await;
        let Some(t) = self.tokens(provider) else { return Ok(None) };
        if !force && t.expires_at > now_ms() + 60_000 {
            return Ok(Some(t.access_token));
        }
        let Some(refresh) = t.refresh_token.clone() else {
            if !force {
                return Ok(Some(t.access_token));
            }
            self.forget_tokens(provider);
            self.change(|s| s.reconnect = true);
            return Ok(None);
        };
        let mut form = vec![("grant_type", "refresh_token".to_string()), ("refresh_token", refresh.clone())];
        form.push(("client_id", if provider == DROPBOX { self.cfg.dropbox_key.clone() } else { self.cfg.google_id.clone() }.unwrap_or_default()));
        if provider == DRIVE {
            if let Some(secret) = &self.cfg.google_secret {
                form.push(("client_secret", secret.clone()));
            }
        }
        match self.token_request(provider, &form).await? {
            Some(mut next) => {
                if next.refresh_token.is_none() {
                    next.refresh_token = Some(refresh);
                }
                self.keep_tokens(provider, &next)?;
                Ok(Some(next.access_token))
            }
            None => {
                self.forget_tokens(provider);
                self.change(|s| s.reconnect = true);
                Ok(None)
            }
        }
    }

    /// cloudRequest { provider, url, method, headers, body (base64), authorized }: `{ status, headers, body }`.
    pub async fn request(&self, o: &Value) -> ShellResult {
        let provider = o.get("provider").and_then(Value::as_str).filter(|p| *p == DROPBOX || *p == DRIVE).ok_or_else(|| err("invalid", "Unknown service."))?;
        let url = o.get("url").and_then(Value::as_str).and_then(|u| url::Url::parse(u).ok()).ok_or_else(|| err("invalid", "Not an address."))?;
        let authorized = o.get("authorized") != Some(&Value::Bool(false));
        allowed(provider, &url, authorized).map_err(|code| err(code, if code == "reconnect" { "That service isn't connected." } else { "Folevi doesn't send that request." }))?;
        if authorized && self.settings.lock().provider.as_deref() != Some(provider) {
            return Err(err("reconnect", "That service isn't connected."));
        }
        let method = match o.get("method").and_then(Value::as_str).unwrap_or("GET") {
            m @ ("GET" | "POST" | "PUT" | "PATCH" | "DELETE") => reqwest::Method::from_bytes(m.as_bytes()).unwrap_or(reqwest::Method::GET),
            _ => return Err(err("invalid", "Folevi doesn't send that request.")),
        };
        let body = match o.get("body").and_then(Value::as_str) {
            Some(b) => Some(base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| err("invalid", "The request's body isn't readable."))?),
            None => None,
        };
        let headers: Vec<(String, String)> = o
            .get("headers")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(k, _)| !["authorization", "cookie", "host", "origin", "referer", "proxy-authorization"].contains(&k.to_ascii_lowercase().as_str()))
            .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
            .collect();
        let mut forced = false;
        loop {
            let token = if authorized {
                match self.access(provider, forced).await? {
                    Some(t) => Some(t),
                    None => return Err(err("reconnect", "Sign in to the service again.")),
                }
            } else {
                None
            };
            let mut req = self.client.request(method.clone(), url.clone());
            for (k, v) in &headers {
                req = req.header(k.as_str(), v.as_str());
            }
            if let Some(t) = &token {
                req = req.bearer_auth(t);
            }
            if let Some(b) = &body {
                req = req.body(b.clone());
            }
            let res = match req.send().await {
                Ok(r) => r,
                Err(_) => {
                    self.change(|s| s.offline = true);
                    return Err(err("offline", "Folevi couldn't reach the service."));
                }
            };
            self.change(|s| s.offline = false);
            if res.status().as_u16() == 401 && authorized {
                if !forced {
                    forced = true;
                    continue;
                }
                self.forget_tokens(provider);
                self.change(|s| s.reconnect = true);
            }
            let status = res.status().as_u16();
            let mut out_headers = serde_json::Map::new();
            for (k, v) in res.headers() {
                out_headers.insert(k.as_str().to_ascii_lowercase(), Value::String(String::from_utf8_lossy(v.as_bytes()).into_owned()));
            }
            let bytes = res.bytes().await.map_err(|_| err("offline", "Folevi couldn't reach the service."))?;
            return Ok(json!({ "status": status, "headers": out_headers, "body": base64::engine::general_purpose::STANDARD.encode(&bytes) }));
        }
    }

    /// cloudCancel: ends a sign-in on its way.
    pub fn cancel(&self) {
        if let Some(tx) = self.cancel.lock().take() {
            let _ = tx.send(());
        }
    }

    /// cloudSignOut: the grant is revoked (best effort), the tokens and the choice forgotten.
    pub async fn sign_out(&self) -> ShellResult {
        self.cancel();
        let provider = self.settings.lock().provider.clone();
        if let Some(p) = provider {
            if let Some(t) = self.tokens(&p) {
                let _ = if p == DROPBOX {
                    self.client.post("https://api.dropboxapi.com/2/auth/token/revoke").bearer_auth(&t.access_token).send().await
                } else {
                    self.client.post("https://oauth2.googleapis.com/revoke").form(&[("token", t.refresh_token.clone().unwrap_or(t.access_token.clone()))]).send().await
                };
            }
            self.forget_tokens(&p);
        }
        self.change(|s| *s = Settings::default());
        Ok(self.status())
    }

    /// cloudStatus, cloudConnect, cloudCancel, cloudSignOut, cloudRequest.
    pub async fn call(&self, method: &str, o: &Value) -> ShellResult {
        match method {
            "cloudStatus" => Ok(self.status()),
            "cloudConnect" => self.connect(o.get("provider").and_then(Value::as_str).unwrap_or("")).await,
            "cloudCancel" => {
                self.cancel();
                Ok(Value::Null)
            }
            "cloudSignOut" => self.sign_out().await,
            "cloudRequest" => self.request(o).await,
            _ => Err(err("invalid", "Not a cloud call.")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config { dropbox_key: Some("abcd1234efgh".into()), google_id: Some("123-abc.apps.googleusercontent.com".into()), google_secret: None }
    }

    fn cloud(c: Config) -> (tempfile::TempDir, Arc<Cloud>, Arc<Mutex<Vec<String>>>) {
        let d = tempfile::tempdir().unwrap();
        let sealer = Arc::new(crate::secrets::Sealer::with_key([7u8; 32]));
        let secrets = Arc::new(SecretStore::new(d.path().join("secrets"), sealer));
        let opened = Arc::new(Mutex::new(vec![]));
        let o2 = opened.clone();
        let c = Cloud::new(d.path().to_path_buf(), c, secrets, Arc::new(move |u: &str| o2.lock().push(u.to_string())), Arc::new(|_: &str, _: Value| {}));
        (d, c, opened)
    }

    #[test]
    fn only_services_with_ids_are_offered() {
        assert_eq!(cfg().available(), vec![DROPBOX, DRIVE]);
        assert!(Config { dropbox_key: Some("NOT A KEY".into()), ..cfg() }.available() == vec![DRIVE]);
        assert!(Config::default().available().is_empty());
        let (_d, c, _) = cloud(Config::default());
        assert_eq!(c.status(), json!({ "available": [], "provider": null, "state": "none", "account": null }));
    }

    #[test]
    fn requests_only_reach_the_services_own_hosts() {
        let u = |s: &str| url::Url::parse(s).unwrap();
        assert_eq!(allowed(DROPBOX, &u("https://api.dropboxapi.com/2/files/list_folder"), true), Ok(()));
        assert_eq!(allowed(DROPBOX, &u("https://content.dropboxapi.com/2/files/download"), true), Ok(()));
        assert_eq!(allowed(DRIVE, &u("https://www.googleapis.com/drive/v3/files"), true), Ok(()));
        assert_eq!(allowed(DROPBOX, &u("https://notify.dropboxapi.com/2/files/list_folder/longpoll"), false), Ok(()));
        assert_eq!(allowed(DROPBOX, &u("https://notify.dropboxapi.com/2/x"), true), Err("invalid"));
        assert_eq!(allowed(DRIVE, &u("https://api.dropboxapi.com/2/x"), true), Err("reconnect"));
        assert_eq!(allowed(DROPBOX, &u("https://evil.example/2/x"), true), Err("invalid"));
        assert_eq!(allowed(DROPBOX, &u("http://api.dropboxapi.com/2/x"), true), Err("invalid"));
        assert_eq!(allowed(DROPBOX, &u("https://api.dropboxapi.com:8443/2/x"), true), Err("invalid"));
        assert_eq!(allowed(DROPBOX, &u("https://me@api.dropboxapi.com/2/x"), true), Err("invalid"));
        assert_eq!(allowed(DRIVE, &u("https://www.googleapis.com/x"), false), Err("invalid"));
    }

    #[test]
    fn sign_in_pages_carry_pkce_and_come_back_here() {
        let (verifier, challenge) = pkce();
        assert_eq!(verifier.len(), 43);
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        assert_eq!(challenge, b64.encode(sha2::Sha256::digest(verifier.as_bytes())));
        let d = authorize_url(&cfg(), DROPBOX, "http://127.0.0.1:41753/", &challenge, "st").unwrap();
        let q: std::collections::HashMap<_, _> = d.query_pairs().into_owned().collect();
        assert_eq!(d.host_str(), Some("www.dropbox.com"));
        assert_eq!(q["client_id"], "abcd1234efgh");
        assert_eq!(q["token_access_type"], "offline");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:41753/");
        assert_eq!(q["code_challenge_method"], "S256");
        let g = authorize_url(&cfg(), DRIVE, "http://127.0.0.1:5555/", &challenge, "st").unwrap();
        let q: std::collections::HashMap<_, _> = g.query_pairs().into_owned().collect();
        assert_eq!(q["scope"], "https://www.googleapis.com/auth/drive.file email");
        assert_eq!(q["access_type"], "offline");
        assert!(authorize_url(&Config::default(), DROPBOX, "x", "y", "z").is_none());
    }

    #[test]
    fn the_browser_comes_back_with_a_code() {
        assert_eq!(parse_redirect("GET /?code=abc&state=st HTTP/1.1"), Some(Ok(("abc".into(), "st".into()))));
        assert_eq!(parse_redirect("GET /?error=access_denied&state=st HTTP/1.1"), Some(Err("access_denied".into())));
        assert_eq!(parse_redirect("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_redirect("POST /?code=a&state=b HTTP/1.1"), None);
    }

    #[tokio::test]
    async fn a_sign_in_ends_on_the_loopback_address() {
        let (_d, c, opened) = cloud(Config { dropbox_key: None, ..cfg() });
        let c2 = c.clone();
        let task = tokio::spawn(async move { c2.connect(DRIVE).await });
        // The browser was sent to Google; come back with the wrong state, then cancel.
        let start = loop {
            if let Some(u) = opened.lock().first().cloned() {
                break u;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        };
        assert_eq!(c.status()["state"], "connecting");
        let u = url::Url::parse(&start).unwrap();
        let redirect = u.query_pairs().find(|(k, _)| k == "redirect_uri").unwrap().1.into_owned();
        assert!(redirect.starts_with("http://127.0.0.1:"));
        let port: u16 = redirect.trim_start_matches("http://127.0.0.1:").trim_end_matches('/').parse().unwrap();
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(b"GET /?code=x&state=someone-else HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
        let mut page = String::new();
        s.read_to_string(&mut page).await.unwrap();
        assert!(page.contains("wasn't connected"));
        c.cancel();
        let r = task.await.unwrap();
        assert_eq!(r.unwrap_err().code, "cancelled");
        assert_eq!(c.status()["state"], "none");
        // Dropbox isn't offered without its key; a request with no connection asks for a reconnect.
        assert_eq!(c.connect(DROPBOX).await.unwrap_err().code, "unavailable");
        let r = c.request(&json!({ "provider": DRIVE, "url": "https://www.googleapis.com/drive/v3/files", "method": "GET", "headers": {}, "body": null, "authorized": true })).await;
        assert_eq!(r.unwrap_err().code, "reconnect");
    }
}
