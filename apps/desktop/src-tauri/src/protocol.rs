//! app://folevi: the interface built into the app (apps/web build-shell.mjs --platform windows), served from the
//! assets compiled into Folevi (or, in a development run, a folder), with the page policy for the open place's
//! mode, and the local library's attachments at /_files/<sha256>. On Windows WebView2 reaches it as
//! https://app.localhost/. Port of Electron's protocol.ts.
use percent_encoding::percent_decode_str;
use std::borrow::Cow;

/// The policy for the interface's pages: local mode (and the first-launch choice) reaches nothing but the app itself;
/// signed-in mode adds Folevi's website and Convex. Images and embeds from the web stay allowed (the person's own
/// content). Tauri's IPC origins are allowed in both (the bridge's calls).
pub fn shell_csp(mode: &str, service_origin: &str, extra_connect: &[String]) -> String {
    let account = mode == "account";
    let mut connect: Vec<String> = vec!["'self'".into(), "ipc:".into(), "http://ipc.localhost".into()];
    if account {
        connect.extend([service_origin.to_string(), "https://*.convex.cloud".into(), "wss://*.convex.cloud".into(), "https://*.convex.site".into()]);
        connect.extend(extra_connect.iter().cloned());
    }
    connect.dedup();
    [
        "default-src 'self'".to_string(),
        "script-src 'self' 'unsafe-inline'".into(),
        "style-src 'self' 'unsafe-inline'".into(),
        "img-src 'self' data: blob: https:".into(),
        format!("media-src 'self' blob:{}", if account { " https:" } else { "" }),
        "font-src 'self'".into(),
        format!("connect-src {}", connect.join(" ")),
        "frame-src https:".into(),
        "worker-src 'self' blob:".into(),
        "object-src 'none'".into(),
        "base-uri 'self'".into(),
        "form-action 'self'".into(),
    ]
    .join("; ")
}

/// Attachments: shown, played or downloaded, never run.
pub const FILES_CSP: &str = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

/// A request path as safe segments, or None: bad escapes, "." and "..", backslashes, control characters and empty
/// middle segments are refused (no way out of the export, whatever the encoding).
pub fn safe_segments(pathname: &str) -> Option<Vec<String>> {
    let rest = pathname.strip_prefix('/')?;
    let mut raw: Vec<&str> = rest.split('/').collect();
    if raw.len() > 1 && raw.last() == Some(&"") {
        raw.pop();
    }
    if raw.len() == 1 && raw[0].is_empty() {
        return Some(vec![]);
    }
    let mut out = Vec::with_capacity(raw.len());
    for part in raw {
        let seg = percent_decode_str(part).decode_utf8().ok()?.into_owned();
        if seg.is_empty() || seg == "." || seg == ".." || seg.len() > 255 || seg.chars().any(|c| c.is_control() || c == '\\' || c == '/') {
            return None;
        }
        out.push(seg);
    }
    Some(out)
}

/// A Range header against `size`: Some(Ok((start, end))) for a range, Some(Err(())) when it can't be met, None for
/// none (or one this server ignores, as a browser expects).
pub fn parse_range(header: Option<&str>, size: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = header?.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if size == 0 {
        return Some(Err(()));
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return Some(Err(()));
        }
        (size.saturating_sub(n), size - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { size - 1 } else { b.parse::<u64>().ok()?.min(size - 1) };
        (start, end)
    };
    if start > end || start >= size {
        return Some(Err(()));
    }
    Some(Ok((start, end)))
}

/// The content type for a file of the export, by its extension.
pub fn content_type(path: &str) -> Cow<'static, str> {
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    Cow::Borrowed(match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "aff" | "dic" => "text/plain; charset=utf-8",
        "map" => "application/json",
        _ => "application/octet-stream",
    })
}

/// A type an attachment may be served as: inert types only (an HTML or SVG file opened directly stays inert).
pub fn safe_file_type(stored: Option<&str>, asked: Option<&str>) -> String {
    for t in [stored, asked].into_iter().flatten() {
        let t = t.trim().to_ascii_lowercase();
        let ok = (t.starts_with("image/") && t != "image/svg+xml") || t.starts_with("audio/") || t.starts_with("video/") || t == "application/pdf" || t == "text/plain";
        if ok && t.len() < 100 && !t.contains(['\n', '\r', ';']) {
            return t;
        }
    }
    "application/octet-stream".into()
}

/// The export's own page policy (a meta tag) with Tauri's IPC origins added to connect-src, so the bridge's calls
/// go the quick way instead of falling back.
pub fn allow_ipc_in_meta(html: &str) -> String {
    html.replacen("connect-src &#x27;self&#x27;", "connect-src &#x27;self&#x27; ipc: http://ipc.localhost", 1).replacen("connect-src 'self'", "connect-src 'self' ipc: http://ipc.localhost", 1)
}

/// The page's start (`window.__foleviHost.boot({...})`) as the first script of its <head>, after the export's page
/// policy and charset (so the policy covers it). `json` is serde_json output, which never holds "</".
pub fn insert_boot(html: &str, json: &str) -> String {
    let tag = format!("<script>window.__foleviHost&&window.__foleviHost.boot({})</script>", json.replace("</", "<\\/"));
    // After the export's CSP meta tag (build-shell.mjs hoists it right after the charset), else after <head>.
    let at = html
        .find("<meta http-equiv=\"Content-Security-Policy\"")
        .and_then(|i| html[i..].find('>').map(|e| i + e + 1))
        .or_else(|| html.find("<head>").map(|i| i + "<head>".len()));
    match at {
        Some(i) => format!("{}{}{}", &html[..i], tag, &html[i..]),
        None => format!("{tag}{html}"),
    }
}

/// What a path resolves to: a file of the export, an attachment, the SPA's index, or nothing.
#[derive(Debug, PartialEq)]
pub enum Route {
    Asset(String),
    File(String),
    NotFound,
    BadPath,
}

pub fn route(pathname: &str) -> Route {
    let Some(segments) = safe_segments(pathname) else { return Route::BadPath };
    if segments.first().map(String::as_str) == Some("_files") {
        return match segments.as_slice() {
            [_, sha] if sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()) => Route::File(sha.to_ascii_lowercase()),
            _ => Route::NotFound,
        };
    }
    if segments.is_empty() {
        return Route::Asset("index.html".into());
    }
    Route::Asset(segments.join("/"))
}

/// Whether a missing path gets the SPA's index.html (an app page) or stays missing (assets, the website's routes).
pub fn spa_fallback(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or("");
    let has_ext = last.rsplit_once('.').is_some_and(|(_, e)| (1..=8).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric()));
    !(path.starts_with("_next/") || path.starts_with("api/") || has_ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments() {
        assert_eq!(safe_segments("/"), Some(vec![]));
        assert_eq!(safe_segments("/settings/"), Some(vec!["settings".to_string()]));
        assert_eq!(safe_segments("/a%20b/c"), Some(vec!["a b".to_string(), "c".to_string()]));
        assert_eq!(safe_segments("/../etc"), None);
        assert_eq!(safe_segments("/a/%2e%2e/b"), None);
        assert_eq!(safe_segments("/a%5Cb"), None);
        assert_eq!(safe_segments("/a//b"), None);
        assert_eq!(safe_segments("/%ff"), None);
        assert_eq!(safe_segments("relative"), None);
    }

    #[test]
    fn routes() {
        assert_eq!(route("/"), Route::Asset("index.html".into()));
        assert_eq!(route("/_next/static/x.js"), Route::Asset("_next/static/x.js".into()));
        let sha = "a".repeat(64);
        assert_eq!(route(&format!("/_files/{sha}")), Route::File(sha.clone()));
        assert_eq!(route("/_files/nothex"), Route::NotFound);
        assert_eq!(route("/../x"), Route::BadPath);
        assert!(spa_fallback("documents"));
        assert!(spa_fallback("d/01ABC"));
        assert!(!spa_fallback("_next/static/missing.js"));
        assert!(!spa_fallback("api/auth"));
        assert!(!spa_fallback("covers/x.webp"));
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range(Some("bytes=0-9"), 100), Some(Ok((0, 9))));
        assert_eq!(parse_range(Some("bytes=90-"), 100), Some(Ok((90, 99))));
        assert_eq!(parse_range(Some("bytes=-10"), 100), Some(Ok((90, 99))));
        assert_eq!(parse_range(Some("bytes=0-500"), 100), Some(Ok((0, 99))));
        assert_eq!(parse_range(Some("bytes=200-300"), 100), Some(Err(())));
        assert_eq!(parse_range(Some("bytes=0-1,4-5"), 100), None);
        assert_eq!(parse_range(None, 100), None);
    }

    #[test]
    fn policies() {
        let local = shell_csp("local", "https://app.folevi.com", &[]);
        assert!(local.contains("connect-src 'self' ipc: http://ipc.localhost;"));
        assert!(!local.contains("convex"));
        let account = shell_csp("account", "https://app.folevi.com", &[]);
        assert!(account.contains("https://app.folevi.com") && account.contains("wss://*.convex.cloud"));
        assert_eq!(safe_file_type(Some("image/png"), None), "image/png");
        assert_eq!(safe_file_type(Some("text/html"), Some("image/svg+xml")), "application/octet-stream");
        assert_eq!(allow_ipc_in_meta("x connect-src &#x27;self&#x27; y"), "x connect-src &#x27;self&#x27; ipc: http://ipc.localhost y");
        assert_eq!(content_type("a/b.WOFF2"), "font/woff2");
        let html = r#"<html><head><meta charSet="utf-8"/><meta http-equiv="Content-Security-Policy" content="x"/><script src="/a.js"></script></head></html>"#;
        let out = insert_boot(html, r#"{"mode":"local","x":"</script>"}"#);
        assert!(out.contains(r#"content="x"/><script>window.__foleviHost&&window.__foleviHost.boot({"mode":"local","x":"<\/script>"})</script><script src="/a.js">"#));
        assert!(insert_boot("<html><head></head></html>", "{}").starts_with("<html><head><script>"));
    }
}
