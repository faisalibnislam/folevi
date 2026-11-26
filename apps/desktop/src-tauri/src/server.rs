//! "Your own server": a Folevi Server as a place (port of Native/Shell/ShellServer.swift: ShellServer, ShellPolicy,
//! ServerReach and LocalServers; docs/SELF_HOSTING_PLAN.md, CONTRACT §6.1). Keep the two in step.
//!
//! - [`look_up`] checks an address the person typed: the address itself, then the server's
//!   `/.well-known/folevi.json`, fetched here (never the page's copy).
//! - [`ShellServer`] is what an account place keeps of its server: where the person added it, its website, Convex and
//!   Convex site addresses, its other names (Folevi Connect) and the one in use.
//! - [`connect_sources`] is what a server place's pages may reach (the page policy, protocol::shell_csp).
//! - [`best_origin`] finds which of a server's names answers (home first), [`local_servers`] the servers on the home
//!   network (Bonjour, `_folevi._tcp`).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

/// The folevi.json format this app speaks.
pub const API_VERSION: i64 = 1;
/// The oldest Folevi Server this app works with.
pub const MIN_SERVER_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerUrls {
    pub app: String,
    pub convex: String,
    pub convex_site: String,
}

/// What an account place keeps of its Folevi Server (places.json `server`, the same fields as the Mac's).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellServer {
    /// The address the person added (an origin).
    pub origin: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub server_id: Option<String>,
    pub urls: ServerUrls,
    #[serde(default)]
    pub hostnames: Vec<String>,
    /// The name in use when it isn't `origin` (ServerReach).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
}

/// Why an address was refused: the page shows `message`, and `code` says which (shell-bridge.js addServerPlace).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    BadAddress,
    Unreachable,
    NotFolevi,
    FoleviCloud,
    ServerOutdated,
    AppOutdated,
    NeedsSetup,
}

impl Problem {
    pub fn code(self) -> &'static str {
        match self {
            Problem::BadAddress => "bad_address",
            Problem::Unreachable => "unreachable",
            Problem::NotFolevi => "not_folevi",
            Problem::FoleviCloud => "folevi_cloud",
            Problem::ServerOutdated => "server_outdated",
            Problem::AppOutdated => "app_outdated",
            Problem::NeedsSetup => "needs_setup",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Problem::BadAddress => "That isn't an address Folevi can use. Use https, or http only for an address on your home network.",
            Problem::Unreachable => "Folevi couldn't reach that server. Check the address and that the server is running.",
            Problem::NotFolevi => "That address isn't a Folevi server.",
            Problem::FoleviCloud => "That's Folevi Cloud. Sign in with Folevi Cloud instead.",
            Problem::ServerOutdated => "This server is too old for this app. Ask the person who runs this server to update it.",
            Problem::AppOutdated => "This server needs a newer Folevi. Update Folevi, then try again.",
            Problem::NeedsSetup => "This server isn't set up yet. Open its address in a browser to finish setting it up.",
        }
    }
}

// ---------------------------------------------------------------- addresses

/// An address as an origin (`scheme://host[:port]`), or None. No scheme means https; http only for an address on
/// the home network ([`is_local_host`]). No path, query, fragment or user.
pub fn normalize_origin(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 300 || raw.chars().any(char::is_whitespace) {
        return None;
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = url::Url::parse(&with_scheme).ok()?;
    let scheme = u.scheme();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    if !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() {
        return None;
    }
    if !(u.path().is_empty() || u.path() == "/") {
        return None;
    }
    // The url crate makes "http://host?" or "#": catch an empty query/fragment typed by hand too.
    let after = &with_scheme[with_scheme.find("://")? + 3..];
    if after.contains(['?', '#', '@']) {
        return None;
    }
    let host = u.host_str()?.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host.is_empty() || !host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b':' || b == b'-') {
        return None;
    }
    if host.starts_with('.') || host.ends_with('.') || host.contains("..") {
        return None;
    }
    if scheme == "http" && !is_local_host(&host) {
        return None;
    }
    let port = match u.port() {
        Some(p) if (scheme == "https" && p == 443) || (scheme == "http" && p == 80) => None,
        Some(0) => return None,
        p => p,
    };
    let host = if host.contains(':') { format!("[{host}]") } else { host };
    Some(match port {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

/// Whether a host is on the home network (http is allowed there): localhost, `.local`, `.localhost`, a name with
/// no dot, private, link-local and Tailscale (100.64/10) addresses. Never looked up in DNS.
pub fn is_local_host(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".local") || h.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = h.parse::<Ipv4Addr>() {
        let [a, b, ..] = ip.octets();
        return a == 10 || a == 127 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && (64..=127).contains(&b));
    }
    if let Ok(ip) = h.parse::<Ipv6Addr>() {
        let first = ip.segments()[0];
        return ip.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80;
    }
    !h.is_empty() && h.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A URL from folevi.json: at most 500 characters, no user, query or fragment, any path, on an origin
/// [`normalize_origin`] accepts.
fn allowed_url(raw: &str) -> bool {
    if raw.len() > 500 {
        return false;
    }
    let Ok(u) = url::Url::parse(raw) else { return false };
    if !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() || raw.contains(['?', '#']) {
        return false;
    }
    normalize_origin(&origin_of(&u)).is_some()
}

fn origin_of(u: &url::Url) -> String {
    let host = u.host_str().unwrap_or("");
    let host = if host.contains(':') && !host.starts_with('[') { format!("[{host}]") } else { host.to_string() };
    match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    }
}

/// -1, 0 or 1. A pre-release counts as its version ("1.6.0-beta.2" == "1.6.0"); a part's digits only ("v2" is 2);
/// missing parts are 0.
pub fn compare_versions(a: &str, b: &str) -> i8 {
    let parts = |v: &str| -> Vec<u64> {
        let base = v.trim().split('-').next().unwrap_or("");
        base.split('.').map(|p| p.chars().filter(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0)).collect()
    };
    let (x, y) = (parts(a), parts(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return if p < q { -1 } else { 1 };
        }
    }
    0
}

fn is_server_id(s: &str) -> bool {
    (1..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Folevi Cloud's website for this run (FOLEVI_URL, else app.folevi.com), set once at launch.
static CLOUD: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Tells the server rules where Folevi Cloud's website is (lib.rs, at launch).
pub fn set_cloud(service: &url::Url) {
    let _ = CLOUD.set(origin_of(service));
}

fn cloud_origin() -> String {
    CLOUD.get().cloned().unwrap_or_else(|| "https://app.folevi.com".into())
}

/// The origin of a URL folevi.json gives, as [`normalize_origin`] writes it.
fn url_origin(raw: &str) -> Option<String> {
    normalize_origin(&origin_of(&url::Url::parse(raw).ok()?))
}

/// Whether an origin is Folevi Cloud's own: the website this build signs in to (`cloud`), any name under
/// folevi.com, or Convex's cloud. A server's folevi.json never names one of these: a server that did would have the
/// app sign in at Folevi Cloud and then talk to the server with what Folevi Cloud issued. (Folevi Connect's names
/// are under folevi.app, which is not Folevi Cloud.)
fn is_folevi_cloud(origin: &str, cloud: &str) -> bool {
    let Some(host) = url::Url::parse(origin).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)) else { return true };
    if normalize_origin(cloud).as_deref() == Some(origin) {
        return true;
    }
    ["folevi.com", "convex.cloud", "convex.site"].iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

// ---------------------------------------------------------------- folevi.json

/// A server's folevi.json, checked: the server, or why it can't be used.
pub fn check(info: &Value, origin: &str, app_version: &str) -> Result<ShellServer, Problem> {
    check_for(info, origin, app_version, &cloud_origin())
}

/// [`check`] with Folevi Cloud's website named. A server's three addresses sit on one origin (CONTRACT §2: the app
/// at `/`, Convex at `/convex`, HTTP actions at `/convex-site`), and neither they nor its other names are Folevi
/// Cloud's.
fn check_for(info: &Value, origin: &str, app_version: &str, cloud: &str) -> Result<ShellServer, Problem> {
    let kind = info.get("kind").and_then(Value::as_str).ok_or(Problem::NotFolevi)?;
    if kind == "folevi-cloud" {
        return Err(Problem::FoleviCloud);
    }
    if kind != "folevi-server" {
        return Err(Problem::NotFolevi);
    }
    let api = info.get("apiVersion").and_then(Value::as_i64).unwrap_or(0);
    if api > API_VERSION {
        return Err(Problem::AppOutdated);
    }
    if api < API_VERSION {
        return Err(Problem::ServerOutdated);
    }
    if info.get("needsSetup") == Some(&Value::Bool(true)) {
        return Err(Problem::NeedsSetup);
    }
    let version = info.get("version").and_then(Value::as_str).unwrap_or("0");
    if compare_versions(version, MIN_SERVER_VERSION) < 0 {
        return Err(Problem::ServerOutdated);
    }
    if let Some(min) = info.get("minAppVersion").and_then(Value::as_str) {
        if compare_versions(app_version, min) < 0 {
            return Err(Problem::AppOutdated);
        }
    }
    let urls = info.get("urls");
    let url = |k: &str| -> Result<String, Problem> {
        let u = urls.and_then(|u| u.get(k)).and_then(Value::as_str).filter(|u| allowed_url(u)).ok_or(Problem::NotFolevi)?;
        Ok(u.strip_suffix('/').unwrap_or(u).to_string())
    };
    let urls = ServerUrls { app: url("app")?, convex: url("convex")?, convex_site: url("convexSite")? };
    let published = url_origin(&urls.app).ok_or(Problem::NotFolevi)?;
    if url_origin(&urls.convex).as_deref() != Some(&published) || url_origin(&urls.convex_site).as_deref() != Some(&published) || is_folevi_cloud(&published, cloud) {
        return Err(Problem::NotFolevi);
    }
    let connect = info.get("connect");
    let hostnames: Vec<String> = connect
        .and_then(|c| c.get("hostnames"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_ascii_lowercase)
        .filter(|h| is_hostname(h) && normalize_origin(&format!("https://{h}")).is_some_and(|o| !is_folevi_cloud(&o, cloud)))
        .take(10)
        .collect();
    let server_id = connect.and_then(|c| c.get("serverId")).and_then(Value::as_str).filter(|s| is_server_id(s)).map(str::to_string);
    let name = info.get("name").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty()).unwrap_or("Folevi Server");
    Ok(ShellServer {
        origin: origin.to_string(),
        name: name.chars().take(120).collect(),
        version: version.chars().take(40).collect(),
        server_id,
        urls,
        hostnames,
        active: None,
    })
}

/// ^[a-z0-9.-]{1,253}(:[0-9]{1,5})?$
fn is_hostname(h: &str) -> bool {
    let (name, port) = match h.rsplit_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (h, None),
    };
    (1..=253).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && port.is_none_or(|p| (1..=5).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
}

fn client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// `<origin>/.well-known/folevi.json`: no redirects, no cookies, at most 64 KB, a JSON object.
async fn fetch_info(origin: &str, timeout: Duration) -> Result<Value, Problem> {
    let res = client(timeout)
        .get(format!("{origin}/.well-known/folevi.json"))
        .header("accept", "application/json")
        .header("cache-control", "no-cache")
        .send()
        .await
        .map_err(|_| Problem::Unreachable)?;
    if res.status().as_u16() != 200 || res.content_length().is_some_and(|n| n > 64 * 1024) {
        return Err(Problem::NotFolevi);
    }
    let bytes = res.bytes().await.map_err(|_| Problem::Unreachable)?;
    if bytes.len() > 64 * 1024 {
        return Err(Problem::NotFolevi);
    }
    serde_json::from_slice::<Value>(&bytes).ok().filter(Value::is_object).ok_or(Problem::NotFolevi)
}

/// placesAddServer: the address the person typed, checked, and its server. When the server's own address is
/// another one than the address typed (a home address typed, its public name published), that address is asked
/// too and must be the same server, so a folevi.json can't hand the app to somebody else's address.
pub async fn look_up(raw: &str, app_version: &str) -> Result<ShellServer, Problem> {
    let origin = normalize_origin(raw).ok_or(Problem::BadAddress)?;
    let info = fetch_info(&origin, Duration::from_secs(10)).await?;
    let server = check(&info, &origin, app_version)?;
    let published = server.published_origin().ok_or(Problem::NotFolevi)?;
    if published != origin {
        let there = fetch_info(&published, Duration::from_secs(10)).await?;
        if !is_itself(&there, &published, &server) {
            return Err(Problem::NotFolevi);
        }
    }
    Ok(server)
}

/// Whether the folevi.json at a server's published address is that server's own: a Folevi server, with its
/// addresses on that same address and the same Folevi Connect id (none on both for a server that isn't linked).
fn is_itself(info: &Value, published: &str, server: &ShellServer) -> bool {
    if info.get("kind").and_then(Value::as_str) != Some("folevi-server") {
        return false;
    }
    let app = info.get("urls").and_then(|u| u.get("app")).and_then(Value::as_str);
    if app.and_then(url_origin).as_deref() != Some(published) {
        return false;
    }
    let id = info.get("connect").and_then(|c| c.get("serverId")).and_then(Value::as_str).filter(|s| is_server_id(s));
    id == server.server_id.as_deref()
}

// ---------------------------------------------------------------- a server's names

impl ShellServer {
    /// Whether two places' servers are one server (None is Folevi Cloud): the same address added, the same
    /// published address, or the same Folevi Connect id.
    pub fn same(a: Option<&ShellServer>, b: Option<&ShellServer>) -> bool {
        match (a, b) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.origin == b.origin
                    || a.published_origin().is_some_and(|o| Some(o) == b.published_origin())
                    || a.server_id.as_ref().is_some_and(|id| Some(id) == b.server_id.as_ref())
            }
            _ => false,
        }
    }

    /// The one origin this server's folevi.json gave its addresses on (its public address, which can be another
    /// than the one the person typed).
    pub fn published_origin(&self) -> Option<String> {
        url_origin(&self.urls.app)
    }

    /// A stored server, cleaned (places.json may hold anything). None when it isn't usable.
    pub fn clean(v: &Value) -> Option<ShellServer> {
        let s: ShellServer = serde_json::from_value(v.clone()).ok()?;
        let origin = normalize_origin(&s.origin).filter(|o| *o == s.origin)?;
        if ![&s.urls.app, &s.urls.convex, &s.urls.convex_site].iter().all(|u| allowed_url(u)) {
            return None;
        }
        let mut s = ShellServer { origin, ..s };
        s.name = s.name.chars().take(120).collect();
        s.version = s.version.chars().take(40).collect();
        s.server_id = s.server_id.filter(|id| is_server_id(id));
        s.hostnames.retain(|h| is_hostname(h) && normalize_origin(&format!("https://{h}")).is_some());
        s.hostnames.truncate(10);
        if s.active.as_ref().is_some_and(|a| !s.candidates().contains(a)) {
            s.active = None;
        }
        Some(s)
    }

    /// The name in use.
    pub fn active_origin(&self) -> &str {
        self.active.as_deref().unwrap_or(&self.origin)
    }

    /// The server's addresses at `origin`: each one on the added origin moves there; any other stays.
    pub fn urls_at(&self, origin: &str) -> ServerUrls {
        let mv = |u: &str| -> String {
            if u == self.origin {
                origin.to_string()
            } else if let Some(rest) = u.strip_prefix(&format!("{}/", self.origin)) {
                format!("{origin}/{rest}")
            } else {
                u.to_string()
            }
        };
        ServerUrls { app: mv(&self.urls.app), convex: mv(&self.urls.convex), convex_site: mv(&self.urls.convex_site) }
    }

    pub fn active_urls(&self) -> ServerUrls {
        self.urls_at(self.active_origin())
    }

    /// The website the session lives on.
    pub fn app_url(&self) -> Option<url::Url> {
        url::Url::parse(&self.active_urls().app).ok()
    }

    /// Every name, in the order they're tried: home names (Connect's `192-168-1-20.<id>.folevi.app`), the added
    /// address, then the rest.
    pub fn candidates(&self) -> Vec<String> {
        let named: Vec<String> = self.hostnames.iter().filter_map(|h| normalize_origin(&format!("https://{h}"))).collect();
        let mut out: Vec<String> = vec![];
        for o in named.iter().filter(|o| is_home_name(o)).chain(std::iter::once(&self.origin)).chain(named.iter()) {
            if !out.contains(o) {
                out.push(o.clone());
            }
        }
        out
    }

    /// What the page is told (placesAddServer's value; placesList's and the page's `server`).
    pub fn json(&self) -> Value {
        let u = self.active_urls();
        json!({
            "origin": self.active_origin(),
            "addedOrigin": self.origin,
            "name": self.name,
            "version": self.version,
            "serverId": self.server_id,
            "urls": { "app": u.app, "convex": u.convex, "convexSite": u.convex_site },
        })
    }
}

/// A Connect home name: its first label is an IPv4 address with dashes.
fn is_home_name(origin: &str) -> bool {
    let Ok(u) = url::Url::parse(origin) else { return false };
    let host = u.host_str().unwrap_or("");
    let first = host.split('.').next().unwrap_or("");
    let parts: Vec<&str> = first.split('-').collect();
    host.contains('.') && parts.len() == 4 && parts.iter().all(|p| (1..=3).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
}

/// What a server place's pages may reach: each name's website, Convex and Convex site, with ws/wss beside each.
pub fn connect_sources(server: &ShellServer) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut add = |s: String| {
        if !out.contains(&s) {
            out.push(s);
        }
    };
    for origin in server.candidates() {
        let u = server.urls_at(&origin);
        for raw in [u.app, u.convex, u.convex_site] {
            let Ok(p) = url::Url::parse(&raw) else { continue };
            let o = origin_of(&p);
            let ws = if p.scheme() == "https" { o.replacen("https://", "wss://", 1) } else { o.replacen("http://", "ws://", 1) };
            add(o);
            add(ws);
        }
    }
    out
}

/// Whether `info` is this server answering (another server on the same name isn't).
fn answers(server: &ShellServer, info: &Value) -> bool {
    if info.get("kind").and_then(Value::as_str) != Some("folevi-server") {
        return false;
    }
    match &server.server_id {
        Some(id) => info.get("connect").and_then(|c| c.get("serverId")).and_then(Value::as_str) == Some(id.as_str()),
        None => true,
    }
}

/// The first name, in [`ShellServer::candidates`] order, where this server answers (all asked at once, 4 s each);
/// None when none does.
pub async fn best_origin(server: &ShellServer) -> Option<String> {
    let names = server.candidates();
    let checks = names.iter().map(|o| async move { fetch_info(o, Duration::from_secs(4)).await.ok().is_some_and(|i| answers(server, &i)) });
    let found = futures_util::future::join_all(checks).await;
    names.into_iter().zip(found).find(|(_, ok)| *ok).map(|(o, _)| o)
}

// ---------------------------------------------------------------- servers on the home network

/// What a server's Bonjour service says, as the page lists it: `{ name, origin, serverId, version }`, or None.
/// `url` from its TXT record when Folevi can use it, else `http://<address>:<port>`.
pub fn local_entry(service_name: &str, txt: &dyn Fn(&str) -> Option<String>, addresses: &[IpAddr], port: u16) -> Option<Value> {
    let origin = txt("url").and_then(|u| normalize_origin(&u)).or_else(|| {
        let ip = addresses.iter().find(|a| a.is_ipv4()).or_else(|| addresses.first())?;
        let host = match ip {
            IpAddr::V4(v4) => v4.to_string(),
            IpAddr::V6(v6) => format!("[{v6}]"),
        };
        normalize_origin(&format!("http://{host}:{port}"))
    })?;
    let name = txt("name").map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| service_name.to_string());
    let id = txt("id").filter(|i| is_server_id(i));
    let version = txt("v").filter(|v| (1..=40).contains(&v.len()) && v.bytes().all(|b| b.is_ascii_alphanumeric() || b"+.-".contains(&b)));
    Some(json!({ "name": name.chars().take(120).collect::<String>(), "origin": origin, "serverId": id, "version": version }))
}

/// placesLocalServers: Folevi servers on the home network (`_folevi._tcp`), looked for for `wait`.
pub async fn local_servers(wait: Duration) -> Vec<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return vec![] };
        let Ok(rx) = daemon.browse("_folevi._tcp.local.") else { return vec![] };
        let until = std::time::Instant::now() + wait;
        let mut out: Vec<Value> = vec![];
        while let Some(left) = until.checked_duration_since(std::time::Instant::now()) {
            let Ok(event) = rx.recv_timeout(left) else { break };
            if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
                let instance = info.get_fullname().strip_suffix(&format!(".{}", info.get_type())).unwrap_or(info.get_fullname()).to_string();
                let txt = |k: &str| info.get_property_val_str(k).map(str::to_string);
                let addresses: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
                if let Some(e) = local_entry(&instance, &txt, &addresses, info.get_port()) {
                    if !out.iter().any(|x| x["origin"] == e["origin"]) {
                        out.push(e);
                    }
                }
            }
        }
        let _ = daemon.shutdown();
        out
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> Value {
        json!({
            "kind": "folevi-server", "apiVersion": 1, "version": "1.0.0", "minAppVersion": "1.6.0", "name": "Home NAS",
            "urls": { "app": "https://nas.example.com", "convex": "https://nas.example.com/convex", "convexSite": "https://nas.example.com/convex-site" },
            "connect": { "serverId": "abcde12345", "hostnames": ["abcde12345.folevi.app", "192-168-1-20.abcde12345.folevi.app:8443"] },
        })
    }

    #[test]
    fn addresses_folevi_accepts() {
        let n = |s: &str| normalize_origin(s);
        assert_eq!(n("NAS.example.com").as_deref(), Some("https://nas.example.com"));
        assert_eq!(n("https://nas.example.com:443/").as_deref(), Some("https://nas.example.com"));
        assert_eq!(n("https://nas.example.com:8443").as_deref(), Some("https://nas.example.com:8443"));
        for ok in ["http://192.168.1.20:8460", "http://10.0.0.2", "http://172.20.1.1", "http://100.101.1.1", "http://nas.local", "http://nas", "http://[fd12:3456::1]:8460", "http://localhost:8460"] {
            assert!(n(ok).is_some(), "{ok}");
        }
        assert_eq!(n("http://[fd12:3456::1]:8460").as_deref(), Some("http://[fd12:3456::1]:8460"));
        assert_eq!(n("http://nas.local:80").as_deref(), Some("http://nas.local"));
        for bad in [
            "http://nas.example.com", "http://8.8.8.8", "http://172.32.0.1", "http://[2001:db8::1]", "ftp://nas.local", "https://nas.example.com/app",
            "https://nas.example.com?x=1", "https://nas.example.com#x", "https://me@nas.example.com", "nas example.com", "https://", "javascript:alert(1)",
            "https://nas..example.com", "",
        ] {
            assert!(n(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn home_addresses() {
        for yes in ["localhost", "nas.local", "a.localhost", "10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.0.1", "169.254.1.1", "100.64.0.1", "100.127.1.1", "::1", "fd00::1", "fe80::1", "nas"] {
            assert!(is_local_host(yes), "{yes}");
        }
        for no in ["172.15.0.1", "172.32.0.1", "100.128.0.1", "192.169.0.1", "1.2.3", "8.8.8.8", "2001:db8::1", "example.com"] {
            assert!(!is_local_host(no), "{no}");
        }
    }

    #[test]
    fn version_comparison() {
        assert_eq!(compare_versions("1.6", "1.6.0"), 0);
        assert_eq!(compare_versions("1.10", "1.9.9"), 1);
        assert_eq!(compare_versions("v2.0.0", "1.99"), 1);
        assert_eq!(compare_versions("1.6.0-beta.2", "1.6.0"), 0);
        assert_eq!(compare_versions("", "0.0.1"), -1);
    }

    #[test]
    fn what_is_refused_and_why() {
        let o = "https://nas.example.com";
        let with = |f: &dyn Fn(&mut Value)| {
            let mut i = info();
            f(&mut i);
            check(&i, o, "1.6.78").map(|_| ()).map_err(Problem::code)
        };
        assert_eq!(with(&|_| {}), Ok(()));
        assert_eq!(with(&|i| i["kind"] = json!(5)), Err("not_folevi"));
        assert_eq!(with(&|i| i["kind"] = json!("folevi-cloud")), Err("folevi_cloud"));
        assert_eq!(with(&|i| i["kind"] = json!("other")), Err("not_folevi"));
        assert_eq!(with(&|i| i["apiVersion"] = json!(2)), Err("app_outdated"));
        assert_eq!(with(&|i| { i.as_object_mut().unwrap().remove("apiVersion"); }), Err("server_outdated"));
        assert_eq!(with(&|i| i["needsSetup"] = json!(true)), Err("needs_setup"));
        assert_eq!(with(&|i| i["version"] = json!("0.9.0")), Err("server_outdated"));
        assert_eq!(with(&|i| i["minAppVersion"] = json!("1.7.0")), Err("app_outdated"));
        assert_eq!(with(&|i| i["urls"]["app"] = json!("http://nas.example.com")), Err("not_folevi"));
        assert_eq!(with(&|i| { i["urls"].as_object_mut().unwrap().remove("convex"); }), Err("not_folevi"));
        assert_eq!(check(&info(), o, "1.5.0").unwrap_err().message(), "This server needs a newer Folevi. Update Folevi, then try again.");
        let s = check(&info(), o, "1.6.78").unwrap();
        assert_eq!(s.name, "Home NAS");
        assert_eq!(s.server_id.as_deref(), Some("abcde12345"));
    }

    /// What a server could publish to have the app sign in at Folevi Cloud and then talk to the server with what
    /// Folevi Cloud issued.
    fn attack() -> Value {
        json!({ "app": "https://app.folevi.com", "convex": "https://evil.example/convex", "convexSite": "https://evil.example/convex-site" })
    }

    fn on(origin: &str) -> Value {
        json!({ "app": origin, "convex": format!("{origin}/convex"), "convexSite": format!("{origin}/convex-site") })
    }

    #[test]
    fn a_servers_addresses_are_one_origin_and_never_folevi_clouds() {
        let refused = |urls: Value, typed: &str| {
            let mut i = info();
            i["urls"] = urls;
            check_for(&i, typed, "1.6.78", "https://app.folevi.com").map(|_| ()).map_err(Problem::code)
        };
        assert_eq!(refused(attack(), "https://evil.example"), Err("not_folevi"));
        assert_eq!(refused(json!({ "app": "https://evil.example", "convex": "https://other.example/convex", "convexSite": "https://evil.example/convex-site" }), "https://evil.example"), Err("not_folevi"));
        assert_eq!(refused(json!({ "app": "https://evil.example", "convex": "https://evil.example/convex", "convexSite": "https://evil.example:8443/convex-site" }), "https://evil.example"), Err("not_folevi"));
        for host in ["app.folevi.com", "folevi.com", "x.folevi.com", "happy-otter-123.convex.cloud", "happy-otter-123.convex.site"] {
            assert_eq!(refused(on(&format!("https://{host}")), "https://evil.example"), Err("not_folevi"), "{host}");
        }
        // This build's own website, whatever it is called (FOLEVI_URL).
        let mut dev = info();
        dev["urls"] = on("https://dev.example");
        assert_eq!(check_for(&dev, "https://evil.example", "1.6.78", "https://dev.example").unwrap_err(), Problem::NotFolevi);
        assert!(check_for(&dev, "https://dev.example", "1.6.78", "https://app.folevi.com").is_ok());
        // A genuine server: one origin, its own (a Folevi Connect name is under folevi.app, not Folevi Cloud).
        assert_eq!(refused(on("https://nas.example.com"), "https://nas.example.com"), Ok(()));
        assert_eq!(refused(on("https://abcde12345.folevi.app"), "http://192.168.1.20:8460"), Ok(()));
        assert_eq!(refused(on("http://192.168.1.20:8460"), "http://192.168.1.20:8460"), Ok(()));
        // Folevi Cloud's names are left out of a server's other names too.
        let mut i = info();
        i["connect"]["hostnames"] = json!(["abcde12345.folevi.app", "app.folevi.com", "x.convex.cloud"]);
        let s = check_for(&i, "https://nas.example.com", "1.6.78", "https://app.folevi.com").unwrap();
        assert_eq!(s.hostnames, vec!["abcde12345.folevi.app"]);
        assert_eq!(s.published_origin().as_deref(), Some("https://nas.example.com"));
    }

    #[test]
    fn a_server_published_at_another_address_must_be_itself_there() {
        let name = "https://abcde12345.folevi.app";
        let mut genuine = info();
        genuine["urls"] = on(name);
        let s = check_for(&genuine, "http://192.168.1.20:8460", "1.6.78", "https://app.folevi.com").unwrap();
        assert_eq!(s.published_origin().as_deref(), Some(name));
        assert!(is_itself(&genuine, name, &s));
        let mut other = genuine.clone();
        other["connect"]["serverId"] = json!("zzzzz99999");
        assert!(!is_itself(&other, name, &s), "another server's Folevi Connect id");
        let mut cloud = genuine.clone();
        cloud["kind"] = json!("folevi-cloud");
        assert!(!is_itself(&cloud, name, &s), "Folevi Cloud");
        let mut elsewhere = genuine.clone();
        elsewhere["urls"] = on("https://evil.example");
        assert!(!is_itself(&elsewhere, name, &s), "a server that gives other addresses");
        assert!(!is_itself(&json!({ "hello": "world" }), name, &s));
        // A server that isn't linked has no id on either side.
        let mut plain = genuine.clone();
        plain.as_object_mut().unwrap().remove("connect");
        let p = check_for(&plain, "http://192.168.1.20:8460", "1.6.78", "https://app.folevi.com").unwrap();
        assert!(is_itself(&plain, name, &p));
        assert!(!is_itself(&genuine, name, &p), "an id where there was none");
    }

    #[test]
    fn the_order_names_are_tried_in() {
        let mut i = info();
        i["connect"]["hostnames"].as_array_mut().unwrap().extend([json!("bad name"), json!("UPPER.example.com")]);
        let s = check(&i, "https://nas.example.com", "1.6.78").unwrap();
        assert_eq!(s.candidates(), vec!["https://192-168-1-20.abcde12345.folevi.app:8443", "https://nas.example.com", "https://abcde12345.folevi.app", "https://upper.example.com"]);
        let at = s.urls_at("https://abcde12345.folevi.app");
        assert_eq!(at.convex, "https://abcde12345.folevi.app/convex");
        let mut i = info();
        i["connect"]["serverId"] = json!("Not An Id");
        assert_eq!(check(&i, "https://nas.example.com", "1.6.78").unwrap().server_id, None);
    }

    #[test]
    fn a_server_place_reaches_its_own_names_only() {
        let s = check(&info(), "https://nas.example.com", "1.6.78").unwrap();
        let c = connect_sources(&s);
        assert!(c.contains(&"https://nas.example.com".to_string()) && c.contains(&"wss://nas.example.com".to_string()));
        assert!(c.contains(&"wss://abcde12345.folevi.app".to_string()));
        assert!(!c.iter().any(|x| x.contains("convex.cloud")));
        let mut lan = info();
        lan["urls"] = json!({ "app": "http://192.168.1.20:8460", "convex": "http://192.168.1.20:8460/convex", "convexSite": "http://192.168.1.20:8460/convex-site" });
        lan.as_object_mut().unwrap().remove("connect");
        let s = check(&lan, "http://192.168.1.20:8460", "1.6.78").unwrap();
        assert_eq!(connect_sources(&s), vec!["http://192.168.1.20:8460", "ws://192.168.1.20:8460"]);
    }

    #[test]
    fn a_stored_server_round_trips_and_junk_is_dropped() {
        let mut s = check(&info(), "https://nas.example.com", "1.6.78").unwrap();
        s.active = Some("https://abcde12345.folevi.app".into());
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(ShellServer::clean(&v), Some(s.clone()));
        assert_eq!(s.json()["origin"], "https://abcde12345.folevi.app");
        assert_eq!(s.json()["addedOrigin"], "https://nas.example.com");
        let mut bad = v.clone();
        bad["active"] = json!("https://evil.example.com");
        assert_eq!(ShellServer::clean(&bad).unwrap().active, None);
        let mut bad = v;
        bad["urls"]["app"] = json!("javascript:alert(1)");
        assert_eq!(ShellServer::clean(&bad), None);
    }

    /// Against a running Folevi Server: FOLEVI_LIVE_SERVER=http://localhost:8460 cargo test live -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_look_up() {
        let origin = std::env::var("FOLEVI_LIVE_SERVER").expect("FOLEVI_LIVE_SERVER");
        let s = look_up(&origin, "1.6.78").await.expect("the server");
        assert_eq!(s.origin, normalize_origin(&origin).unwrap());
        assert!(!connect_sources(&s).is_empty());
        assert_eq!(look_up(&origin, "1.5.0").await.unwrap_err(), Problem::AppOutdated);
        assert_eq!(look_up("http://localhost:1", "1.6.78").await.unwrap_err(), Problem::Unreachable);
        assert_eq!(look_up("http://8.8.8.8", "1.6.78").await.unwrap_err(), Problem::BadAddress);
        assert_eq!(best_origin(&s).await.as_deref(), Some(s.origin.as_str()));
        println!("live: {}", s.json());
    }

    #[test]
    fn what_bonjour_advertises_becomes_an_entry() {
        let txt = |k: &str| match k {
            "url" => Some("https://nas.example.com".into()),
            "name" => Some("  Home NAS ".into()),
            "id" => Some("abcde12345".into()),
            "v" => Some("1.0.0".into()),
            _ => None,
        };
        let e = local_entry("nas", &txt, &[], 8460).unwrap();
        assert_eq!(e, json!({ "name": "Home NAS", "origin": "https://nas.example.com", "serverId": "abcde12345", "version": "1.0.0" }));
        let junk = |k: &str| match k {
            "url" => Some("ftp://x".into()),
            "id" => Some("NOPE!".into()),
            "v" => Some("1 0".into()),
            _ => None,
        };
        let e = local_entry("Folevi on nas", &junk, &["192.168.1.20".parse().unwrap()], 8460).unwrap();
        assert_eq!(e, json!({ "name": "Folevi on nas", "origin": "http://192.168.1.20:8460", "serverId": null, "version": null }));
        assert!(local_entry("x", &|_| None, &["8.8.8.8".parse().unwrap()], 80).is_none());
    }
}
