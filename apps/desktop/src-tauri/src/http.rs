//! Fetches from hosts that aren't Folevi's (Electron's calendarFetch.ts, ShellServices.swift's ShellHTTP):
//! subscribed calendars in local mode (`foleviShell.http.calendar`) and bookmark previews
//! (`foleviShell.http.preview`), straight from the site. Never through Folevi: Folevi's own hosts are refused.
//!
//! The same rules as the server's fetch (convex/lib/icsFetch.ts), with the same words: https only (webcal:// is
//! read as https://; a plain http link or redirect is refused, since nothing protects it on the way), the
//! standard port, no user name or password, never a private, loopback or link-local address, written as an IP
//! or reached through DNS, at most MAX_REDIRECTS redirects with every hop checked again, 10 seconds in all and
//! 5 MB at most. The connection goes to the very addresses that were checked (no second DNS answer can move
//! it), without a proxy, cookies or credentials. The address can carry a secret (private calendar links do),
//! so it's never logged.
use futures_util::future::BoxFuture;
use reqwest::header::HeaderMap;
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use url::{Host, Url};

use crate::shell::{opt_str, value, ShellResult};

pub const MAX_CALENDAR_BYTES: usize = 5 * 1024 * 1024;
/// The most of a page a bookmark preview reads (its head has the title and image).
pub const MAX_PREVIEW_BYTES: usize = 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 3;
const MAX_URL: usize = 2000;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; FoleviCalendar/1.0; +https://folevi.com)";

const NOT_A_LINK: &str = "the address isn't a web link it can open.";
const PRIVATE: &str = "addresses on private or local networks can't be used.";

/// httpCalendar: a subscribed calendar (local mode only). `service_host`: Folevi's own host, never fetched.
pub async fn calendar(o: &Value, service_host: &str) -> ShellResult {
    let previous = o.get("previous").cloned().unwrap_or(Value::Null);
    Ok(download_calendar(o.get("url").unwrap_or(&Value::Null), &previous, service_host, &Deps::system()).await)
}

/// httpPreview: a bookmark's page HTML, or null.
pub async fn preview(o: &Value, service_host: &str) -> ShellResult {
    let html = match opt_str(o, "url") {
        Some(url) => fetch_preview(url, service_host, &Deps::system()).await,
        None => None,
    };
    Ok(value(html))
}

// ---- addresses (the same checks as packages/editor-schema publicUrl.ts) ------------------------------------

/// Folevi's own hosts: the app's service, folevi.com and its subdomains, and the backend's.
pub fn is_folevi_host(host: &str, service_host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    let h = h.strip_suffix('.').unwrap_or(&h);
    let service = service_host.to_ascii_lowercase();
    h == service || h == "folevi.com" || h.ends_with(".folevi.com") || h.ends_with(".convex.cloud") || h.ends_with(".convex.site")
}

fn private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224
}

fn private_v6(ip: Ipv6Addr) -> bool {
    let g = ip.segments();
    let v4_at_6 = || Ipv4Addr::new((g[6] >> 8) as u8, (g[6] & 255) as u8, (g[7] >> 8) as u8, (g[7] & 255) as u8);
    if g.iter().all(|&x| x == 0) {
        return true;
    }
    if g[..7].iter().all(|&x| x == 0) && g[7] == 1 {
        return true;
    }
    if (g[0] & 0xfe00) == 0xfc00 || (g[0] & 0xffc0) == 0xfe80 || (g[0] & 0xff00) == 0xff00 {
        return true;
    }
    if g[0] == 0x2001 && g[1] == 0x0db8 {
        return true;
    }
    if g[..5].iter().all(|&x| x == 0) && (g[5] == 0xffff || g[5] == 0) {
        return private_v4(v4_at_6());
    }
    if g[0] == 0x64 && g[1] == 0xff9b && g[2..6].iter().all(|&x| x == 0) {
        return private_v4(v4_at_6());
    }
    false
}

/// Whether an IP address may never be fetched from.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => private_v4(v4),
        IpAddr::V6(v6) => private_v6(v6),
    }
}

/// The same for an address written out; unparseable counts as private.
pub fn is_private_address(ip: &str) -> bool {
    let host = ip.trim_start_matches('[').trim_end_matches(']');
    let host = host.split('%').next().unwrap_or(host);
    host.parse::<IpAddr>().map(is_private_ip).unwrap_or(true)
}

const INTERNAL_SUFFIXES: [&str; 9] = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".onion"];

/// Why an address can't be fetched (before DNS), in the words the server uses, or None.
pub fn address_problem(raw: &str, service_host: &str) -> Option<&'static str> {
    let Ok(url) = Url::parse(raw) else { return Some(NOT_A_LINK) };
    match url.scheme() {
        "https" => {}
        "http" => return Some("this PC only reads calendars from secure (https) links."),
        _ => return Some(NOT_A_LINK),
    }
    // `port()` is None for https's own port (443).
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Some(NOT_A_LINK);
    }
    match url.host() {
        None => Some(NOT_A_LINK),
        Some(Host::Ipv4(ip)) => private_v4(ip).then_some(PRIVATE),
        Some(Host::Ipv6(ip)) => private_v6(ip).then_some(PRIVATE),
        Some(Host::Domain(d)) => {
            let host = d.to_ascii_lowercase();
            let host = host.strip_suffix('.').unwrap_or(&host);
            if is_folevi_host(host, service_host) {
                return Some("Folevi's own addresses can't be subscribed to.");
            }
            let internal = !host.contains('.')
                || host == "localhost"
                || INTERNAL_SUFFIXES.iter().any(|s| host.ends_with(s))
                || host.chars().all(|c| c.is_ascii_digit() || c == '.');
            internal.then_some(PRIVATE)
        }
    }
}

// ---- what the fetch depends on (swapped in tests) ---------------------------------------------------------

/// A host's addresses (DNS).
pub type Lookup = Arc<dyn Fn(String) -> BoxFuture<'static, Result<Vec<IpAddr>, ()>> + Send + Sync>;

/// One GET, to `url` over exactly `addrs`, without following a redirect.
pub struct Get<'a> {
    pub url: &'a Url,
    pub addrs: &'a [SocketAddr],
    pub headers: Vec<(&'static str, String)>,
    /// The most body bytes wanted: a 2xx body is read up to `max + 1` bytes (so "too long" shows), or skipped
    /// when `whole` and its declared length is already over.
    pub max: usize,
    pub whole: bool,
}

pub struct Fetched {
    pub status: u16,
    pub headers: HeaderMap,
    /// A 2xx answer's body (see `Get::max`); empty for the others.
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FetchError {
    /// No answer at all.
    Unreachable,
    /// The answer broke off.
    Unreadable,
}

pub trait Fetch: Send + Sync {
    fn get<'a>(&'a self, req: Get<'a>) -> BoxFuture<'a, Result<Fetched, FetchError>>;
}

pub struct Deps {
    pub fetch: Arc<dyn Fetch>,
    pub lookup: Lookup,
    pub timeout: Duration,
}

impl Deps {
    /// This PC's resolver and reqwest.
    pub fn system() -> Self {
        Self { fetch: Arc::new(ReqwestFetch), lookup: system_lookup(), timeout: TIMEOUT }
    }
}

pub fn system_lookup() -> Lookup {
    Arc::new(|host: String| {
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                use std::net::ToSocketAddrs;
                (host.as_str(), 443).to_socket_addrs().map(|it| it.map(|a| a.ip()).collect::<Vec<_>>()).map_err(|_| ())
            })
            .await
            .map_err(|_| ())?
        })
    })
}

/// reqwest, pinned to the checked addresses: no redirects, no proxy, no cookies.
pub struct ReqwestFetch;

impl Fetch for ReqwestFetch {
    fn get<'a>(&'a self, req: Get<'a>) -> BoxFuture<'a, Result<Fetched, FetchError>> {
        Box::pin(async move {
            let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).no_proxy().connect_timeout(TIMEOUT);
            if let Some(Host::Domain(d)) = req.url.host() {
                builder = builder.resolve_to_addrs(d, req.addrs);
            }
            let client = builder.build().map_err(|_| FetchError::Unreachable)?;
            let mut r = client.get(req.url.clone());
            for (k, v) in &req.headers {
                r = r.header(*k, v);
            }
            let mut res = r.send().await.map_err(|_| FetchError::Unreachable)?;
            let status = res.status().as_u16();
            let headers = res.headers().clone();
            let mut body = Vec::new();
            let declared = res.content_length().unwrap_or(0);
            if res.status().is_success() && !(req.whole && declared > req.max as u64) {
                while let Some(chunk) = res.chunk().await.map_err(|_| FetchError::Unreadable)? {
                    body.extend_from_slice(&chunk);
                    if body.len() > req.max {
                        body.truncate(req.max + 1);
                        break;
                    }
                }
            }
            Ok(Fetched { status, headers, body })
        })
    }
}

// ---- following an address --------------------------------------------------------------------------------

fn https_for_webcal(s: &str) -> String {
    let lower = s.get(..9).map(str::to_ascii_lowercase).unwrap_or_default();
    if lower.starts_with("webcal://") {
        format!("https://{}", &s[9..])
    } else if s.get(..10).is_some_and(|p| p.eq_ignore_ascii_case("webcals://")) {
        format!("https://{}", &s[10..])
    } else {
        s.to_string()
    }
}

/// The host's addresses, none of them private; else why not.
async fn host_addresses(url: &Url, lookup: &Lookup) -> Result<Vec<SocketAddr>, &'static str> {
    let port = url.port_or_known_default().unwrap_or(443);
    let ips = match url.host() {
        Some(Host::Ipv4(ip)) => vec![IpAddr::V4(ip)],
        Some(Host::Ipv6(ip)) => vec![IpAddr::V6(ip)],
        Some(Host::Domain(d)) => {
            let found = lookup(d.to_string()).await.map_err(|_| "the address couldn't be found.")?;
            if found.is_empty() {
                return Err("the address couldn't be found.");
            }
            if found.iter().any(|ip| is_private_ip(*ip)) {
                return Err(PRIVATE);
            }
            found
        }
        None => return Err(NOT_A_LINK),
    };
    Ok(ips.into_iter().map(|ip| SocketAddr::new(ip, port)).collect())
}

enum Answer {
    Body(Fetched),
    NotModified,
}

/// GETs `raw`, checking it and every redirect again; Err says why not (calendarFetch.ts's words).
async fn follow(raw: &str, service_host: &str, deps: &Deps, accept: &str, conditional: &[(&'static str, String)], max: usize, whole: bool) -> Result<Answer, String> {
    let mut current = https_for_webcal(raw.trim());
    for hop in 0..=MAX_REDIRECTS {
        if let Some(problem) = address_problem(&current, service_host) {
            return Err(problem.to_string());
        }
        let target = Url::parse(&current).map_err(|_| NOT_A_LINK.to_string())?;
        let addrs = host_addresses(&target, &deps.lookup).await.map_err(str::to_string)?;
        let mut headers = vec![("accept", accept.to_string()), ("user-agent", USER_AGENT.to_string())];
        // Conditional only on the address it was saved for, not on a redirect's target.
        if hop == 0 {
            headers.extend(conditional.iter().cloned());
        }
        let res = deps.fetch.get(Get { url: &target, addrs: &addrs, headers, max, whole }).await.map_err(|e| match e {
            FetchError::Unreachable => "the address couldn't be reached.".to_string(),
            FetchError::Unreadable => "the address couldn't be read.".to_string(),
        })?;
        if res.status == 304 {
            return Ok(Answer::NotModified);
        }
        if (300..400).contains(&res.status) {
            let location = res.headers.get("location").and_then(|v| v.to_str().ok()).ok_or_else(|| format!("the address returned {}.", res.status))?;
            current = https_for_webcal(target.join(location).map_err(|_| NOT_A_LINK.to_string())?.as_str());
            continue;
        }
        if !(200..300).contains(&res.status) {
            return Err(format!("the address returned {}.", res.status));
        }
        return Ok(Answer::Body(res));
    }
    Err("the address redirected too many times.".to_string())
}

fn header(res: &Fetched, name: &str) -> Option<String> {
    res.headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

fn failed(why: &str) -> Value {
    json!({ "kind": "error", "message": format!("Couldn't load this calendar: {why}") })
}

/// Fetches a calendar's text, conditionally when an ETag or Last-Modified from last time is given; returns
/// the page's CalendarDownload.
pub async fn download_calendar(raw_url: &Value, previous: &Value, service_host: &str, deps: &Deps) -> Value {
    let Some(raw) = raw_url.as_str().filter(|s| s.chars().count() <= MAX_URL) else { return failed(NOT_A_LINK) };
    let etag = previous.get("etag").and_then(Value::as_str).filter(|s| s.chars().count() <= 500);
    let last_modified = previous.get("lastModified").and_then(Value::as_str).filter(|s| s.chars().count() <= 100);
    let mut conditional = Vec::new();
    if let Some(e) = etag {
        conditional.push(("if-none-match", e.to_string()));
    }
    if let Some(l) = last_modified {
        conditional.push(("if-modified-since", l.to_string()));
    }
    let accept = "text/calendar, text/plain;q=0.9, */*;q=0.5";
    let answer = match tokio::time::timeout(deps.timeout, follow(raw, service_host, deps, accept, &conditional, MAX_CALENDAR_BYTES, true)).await {
        Err(_) => return failed("the address took too long to answer."),
        Ok(Err(why)) => return failed(&why),
        Ok(Ok(a)) => a,
    };
    let res = match answer {
        Answer::NotModified => return json!({ "kind": "notModified" }),
        Answer::Body(res) => res,
    };
    let declared: u64 = header(&res, "content-length").and_then(|v| v.trim().parse().ok()).unwrap_or(0);
    if declared > MAX_CALENDAR_BYTES as u64 || res.body.len() > MAX_CALENDAR_BYTES {
        return failed("it's larger than 5 MB.");
    }
    let text = String::from_utf8_lossy(&res.body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let head: String = text.chars().take(4096).collect();
    if !head.to_ascii_uppercase().contains("BEGIN:VCALENDAR") {
        return failed("the address didn't return a calendar.");
    }
    json!({ "kind": "ok", "text": text, "etag": header(&res, "etag"), "lastModified": header(&res, "last-modified") })
}

/// A bookmark's page as HTML (for its title and image), or None: the same address rules, HTML only, at most
/// MAX_PREVIEW_BYTES of it.
pub async fn fetch_preview(raw: &str, service_host: &str, deps: &Deps) -> Option<String> {
    if raw.chars().count() > MAX_URL {
        return None;
    }
    let accept = "text/html,application/xhtml+xml";
    let Ok(Ok(Answer::Body(res))) = tokio::time::timeout(deps.timeout, follow(raw, service_host, deps, accept, &[], MAX_PREVIEW_BYTES, false)).await else {
        return None;
    };
    let kind = header(&res, "content-type").unwrap_or_else(|| "text/html".to_string()).to_ascii_lowercase();
    if !kind.contains("html") {
        return None;
    }
    let body = &res.body[..res.body.len().min(MAX_PREVIEW_BYTES)];
    Some(String::from_utf8_lossy(body).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use reqwest::header::{HeaderName, HeaderValue};
    use std::collections::HashMap;

    const SERVICE: &str = "app.folevi.com";
    const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

    type Reply = Box<dyn Fn() -> Fetched + Send + Sync>;

    /// A fetch answering from a table of URL to answer, recording what was asked.
    #[derive(Default)]
    struct Fake {
        answers: HashMap<String, Reply>,
        calls: Mutex<Vec<(String, Vec<(&'static str, String)>)>>,
    }

    impl Fake {
        fn on(mut self, url: &str, status: u16, headers: &[(&str, &str)], body: &str) -> Self {
            let headers: Vec<(String, String)> = headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
            let body = body.as_bytes().to_vec();
            self.answers.insert(
                url.to_string(),
                Box::new(move || {
                    let mut map = HeaderMap::new();
                    for (k, v) in &headers {
                        map.insert(HeaderName::from_bytes(k.as_bytes()).unwrap(), HeaderValue::from_str(v).unwrap());
                    }
                    Fetched { status, headers: map, body: body.clone() }
                }),
            );
            self
        }
        fn hosts(&self) -> Vec<String> {
            self.calls.lock().iter().map(|(u, _)| Url::parse(u).unwrap().host_str().unwrap().to_string()).collect()
        }
    }

    impl Fetch for Fake {
        fn get<'a>(&'a self, req: Get<'a>) -> BoxFuture<'a, Result<Fetched, FetchError>> {
            Box::pin(async move {
                self.calls.lock().push((req.url.to_string(), req.headers.clone()));
                let mut res = (self.answers.get(req.url.as_str()).ok_or(FetchError::Unreachable)?)();
                if !(200..300).contains(&res.status) {
                    res.body.clear();
                }
                res.body.truncate(req.max + 1);
                Ok(res)
            })
        }
    }

    fn dns(f: impl Fn(&str) -> Result<Vec<IpAddr>, ()> + Send + Sync + 'static) -> Lookup {
        let f = Arc::new(f);
        Arc::new(move |host: String| {
            let f = f.clone();
            Box::pin(async move { f(&host) })
        })
    }

    fn public_dns() -> Lookup {
        dns(|_| Ok(vec!["93.184.216.34".parse().unwrap()]))
    }

    fn deps(fake: Arc<Fake>, lookup: Lookup) -> Deps {
        Deps { fetch: fake, lookup, timeout: TIMEOUT }
    }

    #[test]
    fn folevi_private_and_non_https_addresses_are_refused() {
        assert!(is_folevi_host("folevi.com", SERVICE));
        assert!(is_folevi_host("API.Folevi.com.", SERVICE));
        assert!(is_folevi_host("happy-cat-123.convex.cloud", SERVICE));
        assert!(!is_folevi_host("notfolevi.com", SERVICE));
        assert!(address_problem("https://app.folevi.com/feed.ics", SERVICE).unwrap().contains("Folevi's own"));
        assert_eq!(address_problem("https://calendar.google.com/x.ics", SERVICE), None);
        assert!(address_problem("http://calendar.example.com/x.ics", SERVICE).unwrap().contains("secure (https)"));
        assert!(address_problem("file:///etc/passwd", SERVICE).unwrap().contains("isn't a web link"));
        assert!(address_problem("https://user:pw@example.com/x.ics", SERVICE).unwrap().contains("isn't a web link"));
        assert!(address_problem("https://example.com:8443/x.ics", SERVICE).unwrap().contains("isn't a web link"));
        assert_eq!(address_problem("https://example.com:443/x.ics", SERVICE), None);
        assert!(address_problem("not a url", SERVICE).unwrap().contains("isn't a web link"));
        for private in ["https://localhost/x.ics", "https://nas.local/x.ics", "https://printer/x.ics", "https://10.0.0.5/x.ics", "https://[::1]/x.ics", "https://0x7f.1/x.ics", "https://[fe80::1]/", "https://169.254.169.254/latest"] {
            assert!(address_problem(private, SERVICE).unwrap().contains("private or local"), "{private}");
        }
        assert!(is_private_address("169.254.169.254"));
        assert!(is_private_address("::ffff:192.168.0.1"));
        assert!(is_private_address("[fe80::1%eth0]"));
        assert!(is_private_address("64:ff9b::10.0.0.1"));
        assert!(is_private_address("fd00::1"));
        assert!(is_private_address("100.64.0.1"));
        assert!(is_private_address("not an ip"));
        assert!(!is_private_address("8.8.8.8"));
        assert!(!is_private_address("2606:4700:4700::1111"));
        assert!(!is_private_address("::ffff:8.8.8.8"));
    }

    #[tokio::test]
    async fn fetched_without_cookies_and_conditionally_with_an_etag() {
        let fake = Arc::new(Fake::default().on("https://cal.example.com/team.ics", 200, &[("etag", "\"v2\""), ("last-modified", "Tue, 20 Oct 2026 10:00:00 GMT")], ICS));
        let got = download_calendar(&json!(" webcal://cal.example.com/team.ics "), &json!({ "etag": "\"v1\"" }), SERVICE, &deps(fake.clone(), public_dns())).await;
        assert_eq!(got, json!({ "kind": "ok", "text": ICS, "etag": "\"v2\"", "lastModified": "Tue, 20 Oct 2026 10:00:00 GMT" }));
        let calls = fake.calls.lock();
        assert!(calls[0].1.contains(&("if-none-match", "\"v1\"".to_string())));
        assert!(!calls[0].1.iter().any(|(k, _)| *k == "cookie" || *k == "authorization"));
    }

    #[tokio::test]
    async fn not_modified_and_errors_in_the_servers_words() {
        let fake = Arc::new(
            Fake::default()
                .on("https://a.example.com/x.ics", 304, &[], "")
                .on("https://b.example.com/x.ics", 404, &[], "nope")
                .on("https://c.example.com/x.ics", 200, &[], "<html>hello</html>")
                .on("https://e.example.com/x.ics", 200, &[], &format!("\u{feff}{ICS}")),
        );
        let d = deps(fake, public_dns());
        assert_eq!(download_calendar(&json!("https://a.example.com/x.ics"), &json!({}), SERVICE, &d).await, json!({ "kind": "notModified" }));
        assert_eq!(download_calendar(&json!("https://b.example.com/x.ics"), &json!({}), SERVICE, &d).await, json!({ "kind": "error", "message": "Couldn't load this calendar: the address returned 404." }));
        assert_eq!(download_calendar(&json!("https://c.example.com/x.ics"), &json!({}), SERVICE, &d).await, json!({ "kind": "error", "message": "Couldn't load this calendar: the address didn't return a calendar." }));
        assert_eq!(download_calendar(&json!("https://d.example.com/x.ics"), &json!({}), SERVICE, &d).await, json!({ "kind": "error", "message": "Couldn't load this calendar: the address couldn't be reached." }));
        assert_eq!(download_calendar(&json!("https://e.example.com/x.ics"), &Value::Null, SERVICE, &d).await["text"], json!(ICS));
        assert_eq!(download_calendar(&json!(42), &json!({}), SERVICE, &d).await["kind"], json!("error"));
        assert_eq!(download_calendar(&json!(format!("https://x.example.com/{}", "a".repeat(2001))), &json!({}), SERVICE, &d).await["kind"], json!("error"));
    }

    #[tokio::test]
    async fn every_redirect_is_checked_again() {
        let fake = Arc::new(
            Fake::default()
                .on("https://hop.example.com/x.ics", 302, &[("location", "https://internal.example.com/x.ics")], "")
                .on("https://folevi-hop.example.com/x.ics", 301, &[("location", "https://app.folevi.com/feed")], "")
                .on("https://http-hop.example.com/x.ics", 301, &[("location", "http://plain.example.com/x.ics")], "")
                .on("https://ip-hop.example.com/x.ics", 301, &[("location", "https://127.0.0.1/x.ics")], "")
                .on("https://ok-hop.example.com/x.ics", 307, &[("location", "/real.ics")], "")
                .on("https://ok-hop.example.com/real.ics", 200, &[], ICS)
                .on("https://loop.example.com/x.ics", 302, &[("location", "/x.ics")], "")
                .on("https://nowhere.example.com/x.ics", 302, &[], ""),
        );
        let lookup = dns(|host| Ok(vec![if host == "internal.example.com" { "10.1.2.3" } else { "93.184.216.34" }.parse().unwrap()]));
        let d = deps(fake.clone(), lookup);
        let get = |u: &'static str| {
            let d = &d;
            async move { download_calendar(&json!(u), &json!({}), SERVICE, d).await }
        };
        assert_eq!(get("https://hop.example.com/x.ics").await, json!({ "kind": "error", "message": "Couldn't load this calendar: addresses on private or local networks can't be used." }));
        assert_eq!(get("https://folevi-hop.example.com/x.ics").await, json!({ "kind": "error", "message": "Couldn't load this calendar: Folevi's own addresses can't be subscribed to." }));
        assert!(get("https://http-hop.example.com/x.ics").await["message"].as_str().unwrap().contains("secure (https)"));
        assert!(get("https://ip-hop.example.com/x.ics").await["message"].as_str().unwrap().contains("private or local"));
        let ok = get("https://ok-hop.example.com/x.ics").await;
        assert_eq!((ok["kind"].clone(), ok["text"].clone()), (json!("ok"), json!(ICS)));
        assert_eq!(get("https://loop.example.com/x.ics").await["message"], json!("Couldn't load this calendar: the address redirected too many times."));
        assert_eq!(get("https://nowhere.example.com/x.ics").await["message"], json!("Couldn't load this calendar: the address returned 302."));
        // Nothing private or Folevi's was ever asked.
        let hosts = fake.hosts();
        assert!(!hosts.contains(&"internal.example.com".to_string()));
        assert!(!hosts.contains(&"app.folevi.com".to_string()));
        assert!(!hosts.contains(&"127.0.0.1".to_string()));
        assert!(!hosts.contains(&"plain.example.com".to_string()));
        // The conditional headers go only to the first address.
        let calls = fake.calls.lock();
        assert!(calls.iter().all(|(_, h)| !h.iter().any(|(k, _)| k.starts_with("if-"))));
    }

    #[tokio::test]
    async fn private_dns_answers_are_refused_and_a_missing_host_says_so() {
        let fake = Arc::new(Fake::default());
        let rebind = deps(fake.clone(), dns(|_| Ok(vec!["93.184.216.34".parse().unwrap(), "127.0.0.1".parse().unwrap()])));
        assert!(download_calendar(&json!("https://rebind.example.com/x.ics"), &json!({}), SERVICE, &rebind).await["message"].as_str().unwrap().contains("private or local"));
        let v6 = deps(fake.clone(), dns(|_| Ok(vec!["::ffff:10.0.0.1".parse().unwrap()])));
        assert!(download_calendar(&json!("https://v6.example.com/x.ics"), &json!({}), SERVICE, &v6).await["message"].as_str().unwrap().contains("private or local"));
        let gone = deps(fake.clone(), dns(|_| Err(())));
        assert_eq!(download_calendar(&json!("https://gone.example.com/x.ics"), &json!({}), SERVICE, &gone).await["message"], json!("Couldn't load this calendar: the address couldn't be found."));
        let empty = deps(fake.clone(), dns(|_| Ok(vec![])));
        assert_eq!(download_calendar(&json!("https://empty.example.com/x.ics"), &json!({}), SERVICE, &empty).await["message"], json!("Couldn't load this calendar: the address couldn't be found."));
        assert!(fake.calls.lock().is_empty());
    }

    #[tokio::test]
    async fn more_than_5_mb_is_refused() {
        let big = format!("BEGIN:VCALENDAR\r\n{}", "X".repeat(MAX_CALENDAR_BYTES + 10));
        let declared = (MAX_CALENDAR_BYTES + 1).to_string();
        let fake = Arc::new(Fake::default().on("https://big.example.com/x.ics", 200, &[], &big).on("https://declared.example.com/x.ics", 200, &[("content-length", declared.as_str())], ICS));
        let d = deps(fake, public_dns());
        let refused = json!({ "kind": "error", "message": "Couldn't load this calendar: it's larger than 5 MB." });
        assert_eq!(download_calendar(&json!("https://big.example.com/x.ics"), &json!({}), SERVICE, &d).await, refused);
        assert_eq!(download_calendar(&json!("https://declared.example.com/x.ics"), &json!({}), SERVICE, &d).await, refused);
    }

    #[tokio::test]
    async fn previews_are_html_only_with_the_same_rules() {
        let fake = Arc::new(
            Fake::default()
                .on("https://site.example.com/page", 200, &[("content-type", "text/html; charset=utf-8")], "<title>Hi</title>")
                .on("https://site.example.com/file.pdf", 200, &[("content-type", "application/pdf")], "%PDF")
                .on("https://site.example.com/moved", 301, &[("location", "https://app.folevi.com/x")], "")
                .on("https://site.example.com/big", 200, &[], &"x".repeat(MAX_PREVIEW_BYTES + 100)),
        );
        let d = deps(fake.clone(), public_dns());
        assert_eq!(fetch_preview("https://site.example.com/page", SERVICE, &d).await.as_deref(), Some("<title>Hi</title>"));
        assert_eq!(fetch_preview("https://site.example.com/file.pdf", SERVICE, &d).await, None);
        assert_eq!(fetch_preview("https://site.example.com/moved", SERVICE, &d).await, None);
        assert_eq!(fetch_preview("https://site.example.com/big", SERVICE, &d).await.map(|s| s.len()), Some(MAX_PREVIEW_BYTES));
        assert_eq!(fetch_preview("http://site.example.com/page", SERVICE, &d).await, None);
        assert_eq!(fetch_preview("https://192.168.1.1/", SERVICE, &d).await, None);
        assert_eq!(fetch_preview("https://folevi.com/", SERVICE, &d).await, None);
        // The call's shape: { value: html } or { value: null }.
        assert_eq!(preview(&json!({}), SERVICE).await.unwrap(), json!({ "value": null }));
        assert_eq!(preview(&json!({ "url": "https://localhost/" }), SERVICE).await.unwrap(), json!({ "value": null }));
    }

    #[tokio::test]
    async fn too_slow_is_said_so() {
        struct Slow;
        impl Fetch for Slow {
            fn get<'a>(&'a self, _req: Get<'a>) -> BoxFuture<'a, Result<Fetched, FetchError>> {
                Box::pin(async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    Err(FetchError::Unreachable)
                })
            }
        }
        let d = Deps { fetch: Arc::new(Slow), lookup: public_dns(), timeout: Duration::from_millis(50) };
        assert_eq!(download_calendar(&json!("https://slow.example.com/x.ics"), &json!({}), SERVICE, &d).await["message"], json!("Couldn't load this calendar: the address took too long to answer."));
    }

    /// A tiny HTTP server on this PC: answers each connection with `reply`, keeping each request's text.
    async fn serve(reply: Vec<u8>) -> (u16, Arc<Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let mut got = Vec::new();
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    got.extend_from_slice(&buf[..n]);
                }
                log.lock().push(String::from_utf8_lossy(&got).into_owned());
                let _ = sock.write_all(&reply).await;
                let _ = sock.shutdown().await;
            }
        });
        (port, seen)
    }

    #[tokio::test]
    async fn reqwest_goes_to_the_checked_address_and_reads_at_most_the_limit() {
        // "calendar.test" isn't in any DNS: the request reaches the server only through the pinned address.
        let body = "x".repeat(300_000);
        let (port, seen) = serve(format!("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).into_bytes()).await;
        let url = Url::parse(&format!("http://calendar.test:{port}/x.ics")).unwrap();
        let addrs = [SocketAddr::from(([127, 0, 0, 1], 9))];
        let got = ReqwestFetch.get(Get { url: &url, addrs: &addrs, headers: vec![("accept", "text/calendar".into())], max: 1000, whole: false }).await.ok().unwrap();
        assert_eq!(got.status, 200);
        assert_eq!(got.body.len(), 1001);
        let skipped = ReqwestFetch.get(Get { url: &url, addrs: &addrs, headers: vec![], max: 1000, whole: true }).await.ok().unwrap();
        assert!(skipped.body.is_empty());
        let first = seen.lock()[0].to_ascii_lowercase();
        assert!(first.starts_with("get /x.ics http/1.1"));
        assert!(first.contains("accept: text/calendar"));
        assert!(!first.contains("cookie"));
    }

    #[tokio::test]
    async fn reqwest_never_follows_a_redirect() {
        let (port, seen) = serve(b"HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:9/elsewhere\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_vec()).await;
        let url = Url::parse(&format!("http://calendar.test:{port}/x.ics")).unwrap();
        let addrs = [SocketAddr::from(([127, 0, 0, 1], 9))];
        let got = ReqwestFetch.get(Get { url: &url, addrs: &addrs, headers: vec![], max: 1000, whole: true }).await.ok().unwrap();
        assert_eq!(got.status, 302);
        assert_eq!(got.headers.get("location").unwrap(), "http://127.0.0.1:9/elsewhere");
        assert_eq!(seen.lock().len(), 1);
    }
}
