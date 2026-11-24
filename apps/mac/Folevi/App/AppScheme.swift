// app://folevi, the built-in interface's origin (docs/MAC_WEBKIT_PLAN.md §3; Electron's protocol.ts, whose rules
// this keeps): the static export, with
// - the SPA fallback: any path that isn't a file gets index.html, and the client router takes it from there;
// - a Content-Security-Policy header chosen by the view's mode (local: nothing but the app itself; account:
//   Folevi and Convex), which narrows the export's own meta policy (both apply);
// - /_files/<sha256>: a library's attachments, through a pluggable reader (WM1 plugs in the iOS library), with
//   Range for audio and video, nosniff and a sandboxing policy of their own;
// - /_bridge/<id>: bridge calls too big for a message (POST the JSON body, then name the id in the message) and
//   answers too big for a reply (the router keeps them for one GET);
// - /_folevi-offline: the failed-load page.
// The handler itself is a plain request -> response function (`AppScheme.respond`), so SchemeTests drives it
// without a web view.
import CryptoKit
import Foundation
import WebKit

/// One library attachment, by the SHA-256 of its (decrypted) bytes.
struct LibraryFileInfo {
    let size: Int
    /// As stored with it; nil when unknown (the request's ?type= is used then, if it's a safe one).
    let mime: String?
}

/// The library's side of /_files (WM1: the iOS LibraryService, decrypting STREAM chunks). `read` returns bytes
/// `start` to `end`, both inclusive.
protocol LibraryFiles: AnyObject {
    func stat(_ sha256: String) -> LibraryFileInfo?
    func read(_ sha256: String, _ start: Int, _ end: Int) throws -> Data
}

/// Until the library is plugged in: no attachments (every /_files request is a 404).
final class NoLibraryFiles: LibraryFiles {
    func stat(_ sha256: String) -> LibraryFileInfo? { nil }
    func read(_ sha256: String, _ start: Int, _ end: Int) throws -> Data { throw URLError(.fileDoesNotExist) }
}

/// A request as the scheme sees it (WKURLSchemeTask's, or a test's).
struct AppRequest {
    var url: URL
    var method: String = "GET"
    var headers: [String: String] = [:]
    var body: Data? = nil
    /// The mode of the view asking ("unset", "local" or "account").
    var mode: String = "unset"

    func header(_ name: String) -> String? { headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value }
}

struct AppResponse {
    var status: Int
    var headers: [String: String]
    var body: Data

    func header(_ name: String) -> String? { headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value }
}

/// Bodies of bridge calls too big for a message, and answers too big for a reply: each is taken once.
final class BridgeBodies {
    static let shared = BridgeBodies()
    private let lock = NSLock()
    private var calls: [String: Data] = [:]
    private var replies: [String: Data] = [:]
    /// Above this, a call's options or an answer go through app://folevi/_bridge/<id> (mac-bridge.js has the same).
    static let limit = 256 * 1024
    private static let maxBody = 64 * 1024 * 1024
    private static let idPattern = #"^[A-Za-z0-9_-]{8,64}$"#

    static func validId(_ id: String) -> Bool { id.range(of: idPattern, options: .regularExpression) != nil }

    func putCall(_ id: String, _ body: Data) -> Bool {
        guard Self.validId(id), body.count <= Self.maxBody else { return false }
        lock.lock(); defer { lock.unlock() }
        // At most a few waiting at once: a page that never names its body doesn't keep memory for ever.
        if calls.count > 32 { calls.removeAll() }
        calls[id] = body
        return true
    }

    func takeCall(_ id: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return calls.removeValue(forKey: id)
    }

    /// Keeps an answer for one GET; returns its id.
    func putReply(_ body: Data) -> String {
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        lock.lock(); defer { lock.unlock() }
        if replies.count > 32 { replies.removeAll() }
        replies[id] = body
        return id
    }

    func takeReply(_ id: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return replies.removeValue(forKey: id)
    }
}

final class AppScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    static let host = "folevi"
    static let origin = "app://folevi"
    static let offlinePath = "/_folevi-offline"

    /// The export's folder.
    let root: URL
    /// The mode of the view a request comes from (its place's, WindowManager knows).
    var modeOf: (WKWebView) -> String = { _ in "unset" }
    var files: LibraryFiles = NoLibraryFiles()
    let serviceOrigin: String
    let extraConnect: [String]
    let bodies: BridgeBodies

    private let work = DispatchQueue(label: "com.folevi.mac.app-scheme", qos: .userInitiated, attributes: .concurrent)
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    init(root: URL, serviceOrigin: String, extraConnect: [String] = [], bodies: BridgeBodies = .shared) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        self.serviceOrigin = serviceOrigin
        self.extraConnect = extraConnect
        self.bodies = bodies
    }

    // MARK: WKURLSchemeHandler

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        var request = AppRequest(url: url, method: task.request.httpMethod ?? "GET", headers: task.request.allHTTPHeaderFields ?? [:], body: task.request.httpBody, mode: modeOf(webView))
        if request.body == nil, let stream = task.request.httpBodyStream { request.body = Self.drain(stream) }
        let id = ObjectIdentifier(task)
        work.async {
            let response = self.respond(request)
            DispatchQueue.main.async {
                guard !self.take(id) else { return }
                guard let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: response.headers) else {
                    return task.didFailWithError(URLError(.cannotParseResponse))
                }
                task.didReceive(http)
                if !response.body.isEmpty { task.didReceive(response.body) }
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); defer { lock.unlock() }
        stopped.insert(ObjectIdentifier(task))
    }

    /// Whether the task was stopped (and forgets it either way).
    private func take(_ id: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped.remove(id) != nil
    }

    private static func drain(_ stream: InputStream) -> Data {
        stream.open(); defer { stream.close() }
        var out = Data()
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buf, maxLength: buf.count)
            if n <= 0 { break }
            out.append(buf, count: n)
            if out.count > 64 * 1024 * 1024 { break }
        }
        return out
    }

    // MARK: the handler

    func respond(_ r: AppRequest) -> AppResponse {
        guard r.url.scheme == Self.scheme, r.url.host == Self.host, r.url.port == nil else { return Self.text(404, "Not found") }
        let path = r.url.path(percentEncoded: true)
        guard let segments = Self.safeSegments(path.isEmpty ? "/" : path) else { return Self.text(400, "Bad path") }

        if segments.first == "_bridge" {
            guard segments.count == 2 else { return Self.text(404, "Not found") }
            return bridge(segments[1], r)
        }
        guard r.method == "GET" || r.method == "HEAD" else { return Self.text(405, "Method not allowed", ["Allow": "GET, HEAD"]) }
        if segments.first == "_files" {
            guard segments.count == 2 else { return Self.text(404, "Not found") }
            return libraryFile(segments[1], r)
        }
        if path == Self.offlinePath {
            return AppResponse(status: 200, headers: ["Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"],
                               body: r.method == "HEAD" ? Data() : Data(Self.offlinePage.utf8))
        }
        if !segments.isEmpty, let file = serveStatic(segments, r) { return file }
        // Missing assets stay missing (index.html in place of a script would only confuse), and the website's
        // server routes don't exist here.
        let last = segments.last ?? ""
        if segments.first == "_next" || segments.first == "api" || last.range(of: #"\.[A-Za-z0-9]{1,8}$"#, options: .regularExpression) != nil { return Self.text(404, "Not found") }
        // The SPA fallback: index.html for "/" and every app path.
        return serveStatic(["index.html"], r) ?? Self.text(503, "The interface built into Folevi is missing. Reinstall Folevi.")
    }

    private func bridge(_ id: String, _ r: AppRequest) -> AppResponse {
        guard BridgeBodies.validId(id) else { return Self.text(400, "Bad id") }
        switch r.method {
        case "POST":
            return bodies.putCall(id, r.body ?? Data()) ? AppResponse(status: 200, headers: ["Content-Type": "application/json", "Cache-Control": "no-store"], body: Data(#"{"ok":true}"#.utf8)) : Self.text(413, "Too big")
        case "GET":
            guard let body = bodies.takeReply(id) else { return Self.text(404, "Not found") }
            return AppResponse(status: 200, headers: ["Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"], body: body)
        default:
            return Self.text(405, "Method not allowed", ["Allow": "GET, POST"])
        }
    }

    private func serveStatic(_ segments: [String], _ r: AppRequest) -> AppResponse? {
        var file = root
        for s in segments { file.appendPathComponent(s) }
        // The segments can't climb out, but a symlink inside the export could: checked for real.
        let real = file.resolvingSymlinksInPath()
        guard real.path == root.path || real.path.hasPrefix(root.path + "/") else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: real.path, isDirectory: &isDir), !isDir.boolValue, let data = try? Data(contentsOf: real, options: .mappedIfSafe) else { return nil }
        let type = Self.types[real.pathExtension.lowercased()] ?? "application/octet-stream"
        var headers = ["Content-Type": type]
        if type.hasPrefix("text/html") {
            headers["Content-Security-Policy"] = Self.csp(mode: r.mode, serviceOrigin: serviceOrigin, extraConnect: extraConnect)
            headers["Cache-Control"] = "no-cache"
        } else if segments.count > 1, segments[0] == "_next", segments[1] == "static" {
            // Next's hashed assets never change under the same name.
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        } else {
            headers["Cache-Control"] = "no-cache"
        }
        return Self.bytes(data, r, headers)
    }

    private func libraryFile(_ sha: String, _ r: AppRequest) -> AppResponse {
        guard sha.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return Self.text(400, "Bad file name") }
        guard let info = files.stat(sha) else { return Self.text(404, "Not found") }
        let asked = URLComponents(url: r.url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "type" }?.value
        var headers = [
            "Content-Type": Self.safeFileType(info.mime, asked),
            "Content-Security-Policy": Self.filesCsp,
            "Cross-Origin-Resource-Policy": "same-origin",
            "Cache-Control": "private, max-age=31536000, immutable",
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
        ]
        let size = info.size
        let range = Self.parseRange(r.header("Range"), size: size)
        if case .unsatisfiable = range {
            headers["Content-Range"] = "bytes */\(size)"
            return AppResponse(status: 416, headers: headers, body: Data())
        }
        var start = 0, end = size - 1, partial = false
        if case .bytes(let a, let b) = range { start = a; end = b; partial = true }
        headers["Content-Length"] = String(max(0, end - start + 1))
        if partial { headers["Content-Range"] = "bytes \(start)-\(end)/\(size)" }
        var body = Data()
        if r.method != "HEAD", size > 0 {
            guard let read = try? files.read(sha, start, end) else { return Self.text(500, "Folevi couldn't read that file.") }
            body = read
        }
        return AppResponse(status: partial ? 206 : 200, headers: headers, body: body)
    }

    // MARK: pieces (protocol.ts, ported; SchemeTests checks them)

    /// A request path as a list of safe segments, or nil: undecodable escapes, "." or ".." segments, backslashes,
    /// NUL or control characters, and empty segments in the middle are all refused.
    static func safeSegments(_ pathname: String) -> [String]? {
        guard pathname.hasPrefix("/") else { return nil }
        var raw = pathname.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if raw.count > 1, raw.last == "" { raw.removeLast() }
        if raw.count == 1, raw[0] == "" { return [] }
        var out: [String] = []
        for part in raw {
            guard let seg = part.removingPercentEncoding, !seg.isEmpty, seg != ".", seg != "..", seg.count <= 255 else { return nil }
            if seg.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f || $0 == "\\" || $0 == "/" }) { return nil }
            out.append(seg)
        }
        return out
    }

    enum Range: Equatable { case whole, bytes(Int, Int), unsatisfiable }

    /// A Range header against a size: the bytes to send (inclusive), unsatisfiable, or the whole thing (no header,
    /// or one we don't serve, like several ranges).
    static func parseRange(_ header: String?, size: Int) -> Range {
        guard let header = header?.trimmingCharacters(in: .whitespaces), !header.isEmpty,
              let m = header.range(of: #"^bytes=(\d*)-(\d*)$"#, options: .regularExpression), m.lowerBound == header.startIndex else { return .whole }
        let spec = header.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        guard spec.count == 2, !(spec[0].isEmpty && spec[1].isEmpty) else { return .whole }
        if spec[0].isEmpty {
            guard let n = Int(spec[1]), n > 0, size > 0 else { return .unsatisfiable }
            return .bytes(max(0, size - n), size - 1)
        }
        guard let start = Int(spec[0]) else { return .whole }
        let end = spec[1].isEmpty ? size - 1 : min(Int(spec[1]) ?? Int.max, size - 1)
        if start >= size || start > end { return .unsatisfiable }
        return .bytes(start, end)
    }

    private static let safeTypes = #"^(image/(png|jpeg|gif|webp|avif|heic|heif|bmp|tiff)|audio/[a-z0-9.+-]+|video/[a-z0-9.+-]+|application/pdf|text/plain|text/csv|text/markdown|application/json)$"#

    /// The first candidate that's safe to serve as itself; anything else (HTML, SVG, scripts) goes out as bytes.
    static func safeFileType(_ candidates: String?...) -> String {
        for c in candidates {
            let type = (c ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
            if type.range(of: safeTypes, options: .regularExpression) != nil { return type }
        }
        return "application/octet-stream"
    }

    /// Attachments: shown, played or downloaded, never run.
    static let filesCsp = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"

    /// The header policy for the interface's pages (protocol.ts shellCsp): local mode and the first-launch choice
    /// reach nothing but app://folevi itself; signed-in mode adds Folevi's website and Convex.
    static func csp(mode: String, serviceOrigin: String, extraConnect: [String] = []) -> String {
        let account = mode == "account"
        var connect = ["'self'"]
        if account { connect += [serviceOrigin, "https://*.convex.cloud", "wss://*.convex.cloud", "https://*.convex.site"] + extraConnect }
        var seen = Set<String>()
        connect = connect.filter { seen.insert($0).inserted }
        return [
            "default-src 'self'",
            // Next's inline bootstrap scripts carry no nonce in a static export.
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob:\(account ? " https:" : "")",
            "font-src 'self'",
            "connect-src \(connect.joined(separator: " "))",
            "frame-src https:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].joined(separator: "; ")
    }

    static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json", "txt": "text/plain; charset=utf-8", "map": "application/json",
        "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "avif": "image/avif", "svg": "image/svg+xml", "ico": "image/x-icon",
        "mp3": "audio/mpeg", "mp4": "video/mp4", "webm": "video/webm", "wasm": "application/wasm", "pdf": "application/pdf",
    ]

    static func text(_ status: Int, _ body: String, _ extra: [String: String] = [:]) -> AppResponse {
        var h = ["Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff"]
        h.merge(extra) { _, b in b }
        return AppResponse(status: status, headers: h, body: Data(body.utf8))
    }

    private static func bytes(_ data: Data, _ r: AppRequest, _ headers: [String: String]) -> AppResponse {
        var h = headers
        h["Accept-Ranges"] = "bytes"
        h["X-Content-Type-Options"] = "nosniff"
        let head = r.method == "HEAD"
        switch parseRange(r.header("Range"), size: data.count) {
        case .unsatisfiable:
            h["Content-Range"] = "bytes */\(data.count)"
            return AppResponse(status: 416, headers: h, body: Data())
        case .bytes(let a, let b):
            let part = data.subdata(in: a..<(b + 1))
            h["Content-Range"] = "bytes \(a)-\(b)/\(data.count)"
            h["Content-Length"] = String(part.count)
            return AppResponse(status: 206, headers: h, body: head ? Data() : part)
        case .whole:
            h["Content-Length"] = String(data.count)
            return AppResponse(status: 200, headers: h, body: head ? Data() : data)
        }
    }

    /// The page shown when a load fails (Electron's assets/offline.html, with the address to try again).
    static let offlinePage = """
    <!doctype html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <title>Folevi</title>
    <style>
      :root { color-scheme: light dark; --bg: #fff; --ink: #18181b; --muted: #56565e; --btn: #1f1f22; --btn-ink: #fff; }
      @media (prefers-color-scheme: dark) { :root { --bg: #101011; --ink: #f2f2f3; --muted: #a6a6ae; --btn: #f2f2f3; --btn-ink: #101011; } }
      html, body { height: 100%; margin: 0; }
      body { background: var(--bg); color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; display: grid; place-items: center; }
      main { max-width: 360px; padding: 24px; text-align: center; }
      h1 { font-size: 17px; font-weight: 600; margin: 0 0 6px; }
      p { color: var(--muted); margin: 0 0 18px; }
      button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 8px 16px; background: var(--btn); color: var(--btn-ink); cursor: pointer; }
    </style>
    </head>
    <body>
    <main>
      <h1>Folevi can't open this page</h1>
      <p>Check your internet connection. Notes you wrote on this Mac are safe and sync when Folevi is back online.</p>
      <button type="button" id="retry">Try again</button>
    </main>
    <script>
      const target = new URLSearchParams(location.search).get("url") || "";
      const go = () => { if (/^app:\\/\\/folevi\\//.test(target)) location.href = target; else location.href = "app://folevi/"; };
      document.getElementById("retry").addEventListener("click", go);
      addEventListener("online", go);
    </script>
    </body>
    </html>
    """
}
