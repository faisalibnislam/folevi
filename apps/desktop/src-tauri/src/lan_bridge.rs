//! Windows: a home server's plain http and ws traffic, carried by the app ("Your own server", CONTRACT §6.1).
//!
//! On Windows the pages are served from `https://app.localhost`, and WebView2 blocks http and ws from an https page
//! to anything but the computer itself (mixed content). Every other Folevi app reaches a Folevi Server on the home
//! network over plain http (`http://192.168.1.20:8460`, `http://nas.local:8460`), so Windows does too: for each such
//! address the app listens on `127.0.0.1` and relays every request and WebSocket there, with the server's own Host
//! header, so the server sees what it sees from the other apps. The page is given `http://127.0.0.1:<port>` for
//! the server's Convex and Convex site addresses (and the policy allows it); its links and shared addresses keep the
//! server's real name.
//!
//! Each relay goes to one address only (never an open proxy) and is bound to 127.0.0.1. A port is derived from the
//! address, so the page's Convex address stays the same from one launch to the next.
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpListener as StdListener};
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, HOST, UPGRADE};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};

use crate::server::{connect_sources, ShellServer};

type Body = BoxBody<Bytes, hyper::Error>;

/// Upstream `host:port` -> the local port relaying to it.
static RELAYS: Lazy<Mutex<HashMap<String, u16>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Whether this app relays plain http servers: Windows only (Linux's and the Mac's web views allow them).
fn needed() -> bool {
    cfg!(windows)
}

/// Whether `host` is this computer, which WebView2 lets an https page reach over http and ws.
pub fn is_loopback(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost") || h.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// The upstream `host:port` of a plain http address the page can't reach itself, or None.
fn blocked_authority(u: &url::Url) -> Option<String> {
    if u.scheme() != "http" {
        return None;
    }
    let host = u.host_str()?;
    if is_loopback(host) {
        return None;
    }
    let port = u.port_or_known_default()?;
    Some(match u.host()? {
        url::Host::Ipv6(ip) => format!("[{ip}]:{port}"),
        _ => format!("{host}:{port}"),
    })
}

/// `raw` as the page should use it: through a relay when it's a plain http address off this computer (Windows).
fn page_url(raw: &str, relay: &dyn Fn(&str) -> Option<u16>) -> String {
    let Ok(mut u) = url::Url::parse(raw) else { return raw.to_string() };
    let Some(authority) = blocked_authority(&u) else { return raw.to_string() };
    let Some(port) = relay(&authority) else { return raw.to_string() };
    if u.set_host(Some("127.0.0.1")).is_err() || u.set_port(Some(port)).is_err() {
        return raw.to_string();
    }
    let out = u.to_string();
    // url adds a "/" to an origin; keep the page's form.
    if !raw.ends_with('/') && u.path() == "/" && u.query().is_none() {
        out.trim_end_matches('/').to_string()
    } else {
        out
    }
}

/// The server info the page is given (`places.server`): Convex and Convex site through a relay where needed.
pub fn page_json(server: &ShellServer) -> Value {
    page_json_with(server, &|a| needed().then(|| relay_for(a)).flatten())
}

fn page_json_with(server: &ShellServer, relay: &dyn Fn(&str) -> Option<u16>) -> Value {
    let mut v = server.json();
    if let Some(urls) = v.get_mut("urls").and_then(Value::as_object_mut) {
        for key in ["convex", "convexSite"] {
            if let Some(s) = urls.get(key).and_then(Value::as_str).map(str::to_string) {
                urls.insert(key.into(), Value::String(page_url(&s, relay)));
            }
        }
    }
    v
}

/// What the server place's pages may reach: the server's names (server::connect_sources), and the relays in use.
pub fn page_sources(server: &ShellServer) -> Vec<String> {
    page_sources_with(server, &|a| needed().then(|| relay_for(a)).flatten())
}

fn page_sources_with(server: &ShellServer, relay: &dyn Fn(&str) -> Option<u16>) -> Vec<String> {
    let mut out = connect_sources(server);
    let urls = server.active_urls();
    for raw in [urls.convex, urls.convex_site] {
        let Ok(u) = url::Url::parse(&raw) else { continue };
        let Some(port) = blocked_authority(&u).and_then(|a| relay(&a)) else { continue };
        for s in [format!("http://127.0.0.1:{port}"), format!("ws://127.0.0.1:{port}")] {
            if !out.contains(&s) {
                out.push(s);
            }
        }
    }
    out
}

/// The local port relaying to `authority`, started now if it isn't running. None if no port could be had.
fn relay_for(authority: &str) -> Option<u16> {
    let mut relays = RELAYS.lock();
    if let Some(p) = relays.get(authority) {
        return Some(*p);
    }
    let listener = bind(authority)?;
    let port = listener.local_addr().ok()?.port();
    let upstream = Arc::new(authority.to_string());
    tauri::async_runtime::spawn(async move { serve(listener, upstream).await });
    relays.insert(authority.to_string(), port);
    Some(port)
}

/// A port from 41000 to 48999 picked by the address (the same each launch), the next free one, or any.
fn bind(authority: &str) -> Option<StdListener> {
    let hash = authority.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100_0000_01b3));
    let first = 41_000 + (hash % 8_000) as u16;
    let tried = (0..16).map(|i| first + i).chain(std::iter::once(0));
    let listener = tried.into_iter().find_map(|p| StdListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, p))).ok())?;
    listener.set_nonblocking(true).ok()?;
    Some(listener)
}

async fn serve(listener: StdListener, upstream: Arc<String>) {
    let Ok(listener) = TcpListener::from_std(listener) else { return };
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let upstream = upstream.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req| forward(req, upstream.clone()));
            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).with_upgrades().await;
        });
    }
}

fn bad_gateway() -> Response<Body> {
    let mut r = Response::new(Full::new(Bytes::from_static(b"Folevi couldn't reach the server.")).map_err(|never| match never {}).boxed());
    *r.status_mut() = StatusCode::BAD_GATEWAY;
    r
}

/// One request (or WebSocket) on to the server, with the server's Host.
async fn forward(mut req: Request<Incoming>, upstream: Arc<String>) -> Result<Response<Body>, hyper::Error> {
    let path = req.uri().path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| "/".into());
    let Ok(uri) = path.parse() else { return Ok(bad_gateway()) };
    *req.uri_mut() = uri;
    let Ok(host) = HeaderValue::from_str(&upstream) else { return Ok(bad_gateway()) };
    req.headers_mut().insert(HOST, host);

    let Ok(stream) = TcpStream::connect(upstream.as_str()).await else { return Ok(bad_gateway()) };
    let Ok((mut sender, conn)) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await else { return Ok(bad_gateway()) };
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });

    if !req.headers().contains_key(UPGRADE) {
        return Ok(match sender.send_request(req).await {
            Ok(res) => res.map(BodyExt::boxed),
            Err(_) => bad_gateway(),
        });
    }

    // A WebSocket: once the server agrees, the two connections are joined until either side closes.
    let page_side = hyper::upgrade::on(&mut req);
    let mut res = match sender.send_request(req).await {
        Ok(res) => res,
        Err(_) => return Ok(bad_gateway()),
    };
    if res.status() != StatusCode::SWITCHING_PROTOCOLS {
        return Ok(res.map(BodyExt::boxed));
    }
    let server_side = hyper::upgrade::on(&mut res);
    tokio::spawn(async move {
        if let (Ok(a), Ok(b)) = (page_side.await, server_side.await) {
            let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(a), &mut TokioIo::new(b)).await;
        }
    });
    let (parts, _) = res.into_parts();
    Ok(Response::from_parts(parts, Empty::new().map_err(|never| match never {}).boxed()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::ServerUrls;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn server(origin: &str) -> ShellServer {
        ShellServer {
            origin: origin.into(),
            name: "Home".into(),
            version: "1.0.0".into(),
            server_id: None,
            urls: ServerUrls { app: origin.into(), convex: format!("{origin}/convex"), convex_site: format!("{origin}/convex-site") },
            hostnames: vec![],
            active: None,
        }
    }

    #[test]
    fn what_is_relayed() {
        assert!(is_loopback("localhost") && is_loopback("127.0.0.1") && is_loopback("[::1]") && is_loopback("app.localhost"));
        assert!(!is_loopback("192.168.1.20") && !is_loopback("nas.local"));
        let p = |s: &str| url::Url::parse(s).unwrap();
        assert_eq!(blocked_authority(&p("http://192.168.1.20:8460/convex")).as_deref(), Some("192.168.1.20:8460"));
        assert_eq!(blocked_authority(&p("http://nas.local/")).as_deref(), Some("nas.local:80"));
        assert_eq!(blocked_authority(&p("http://[fd00::5]:8460")).as_deref(), Some("[fd00::5]:8460"));
        assert_eq!(blocked_authority(&p("http://localhost:8460")), None);
        assert_eq!(blocked_authority(&p("https://notes.example.com")), None);
    }

    #[test]
    fn the_page_gets_the_relay_for_convex_only() {
        let relay = |a: &str| (a == "192.168.1.20:8460").then_some(41234);
        let v = page_json_with(&server("http://192.168.1.20:8460"), &relay);
        assert_eq!(v["urls"]["convex"], "http://127.0.0.1:41234/convex");
        assert_eq!(v["urls"]["convexSite"], "http://127.0.0.1:41234/convex-site");
        // Links and shared addresses keep the server's name.
        assert_eq!(v["urls"]["app"], "http://192.168.1.20:8460");
        assert_eq!(v["origin"], "http://192.168.1.20:8460");
        let sources = page_sources_with(&server("http://192.168.1.20:8460"), &relay);
        assert!(sources.contains(&"http://127.0.0.1:41234".to_string()) && sources.contains(&"ws://127.0.0.1:41234".to_string()));
        // https and this computer's own addresses are left alone.
        for origin in ["https://notes.example.com", "http://localhost:8460"] {
            let v = page_json_with(&server(origin), &|_| Some(1));
            assert_eq!(v["urls"]["convex"], format!("{origin}/convex"));
        }
        // An origin stays an origin.
        assert_eq!(page_url("http://192.168.1.20:8460", &relay), "http://127.0.0.1:41234");
    }

    #[test]
    fn the_port_is_the_same_each_time() {
        let a = bind("192.168.1.77:8460").unwrap().local_addr().unwrap().port();
        let b = bind("192.168.1.77:8460").unwrap().local_addr().unwrap().port();
        assert_eq!(a, b);
        assert!((41_000..49_016).contains(&a));
    }

    /// A stand-in server: answers each request with the Host it saw, and echoes a WebSocket's bytes back.
    async fn fake_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    loop {
                        let mut buf = vec![0u8; 4096];
                        let n = s.read(&mut buf).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        let head = String::from_utf8_lossy(&buf[..n]).to_string();
                        let host = head.lines().find_map(|l| l.strip_prefix("host: ").or_else(|| l.strip_prefix("Host: "))).unwrap_or("").to_string();
                        if head.to_ascii_lowercase().contains("upgrade: websocket") {
                            s.write_all(b"HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\n\r\n").await.unwrap();
                            let mut b = [0u8; 64];
                            while let Ok(n) = s.read(&mut b).await {
                                if n == 0 || s.write_all(&b[..n]).await.is_err() {
                                    return;
                                }
                            }
                            return;
                        }
                        let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                        let body = format!("{host} {path}");
                        let res = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}", body.len());
                        s.write_all(res.as_bytes()).await.unwrap();
                    }
                });
            }
        });
        port
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn requests_and_websockets_reach_the_server_with_its_host() {
        let upstream = format!("127.0.0.1:{}", fake_server().await);
        let listener = bind(&format!("test-{upstream}")).unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, Arc::new(upstream.clone())));

        // Two requests on one connection: each reaches the server with its own Host, not the relay's.
        let client = reqwest::Client::new();
        for path in ["/convex/api/query?x=1", "/convex-site/files"] {
            let body = client.get(format!("http://127.0.0.1:{port}{path}")).send().await.unwrap().text().await.unwrap();
            assert_eq!(body, format!("{upstream} {path}"));
        }

        // A WebSocket upgrade, then bytes both ways.
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET /convex/api/sync HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").as_bytes()).await.unwrap(); // gitleaks:allow (the WebSocket spec's sample key)
        let mut head = vec![0u8; 1024];
        let n = s.read(&mut head).await.unwrap();
        assert!(String::from_utf8_lossy(&head[..n]).starts_with("HTTP/1.1 101"));
        s.write_all(b"ping").await.unwrap();
        let mut echo = [0u8; 4];
        s.read_exact(&mut echo).await.unwrap();
        assert_eq!(&echo, b"ping");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_server_that_is_off_is_a_502() {
        let dead = StdListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let listener = bind("test-dead").unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, Arc::new(format!("127.0.0.1:{dead}"))));
        let res = reqwest::get(format!("http://127.0.0.1:{port}/convex")).await.unwrap();
        assert_eq!(res.status(), 502);
    }
}
