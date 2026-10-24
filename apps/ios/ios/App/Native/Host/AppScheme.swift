// capacitor://localhost, the built-in interface's origin, served by the app itself now (docs/NATIVE_APP_PLAN.md N1
// and the release gate R6). The address stays the one Capacitor served, on purpose: a page's storage (IndexedDB,
// localStorage, cookies, the offline outbox with edits not sent yet) belongs to its origin in the web view's data
// store, so keeping the scheme and host keeps everything an upgraded install already has.
//
// What it answers, as Capacitor's WebViewAssetHandler did (so the export behaves exactly as before):
// - a path without an extension ("/", "/documents", "/d/abc"): index.html, and the client router takes it from
//   there (the SPA fallback);
// - a path with one: that file from the bundled export (App/public), or a failed load when it isn't there;
// - Range requests (audio and video seek);
// - "Cache-Control: no-cache" on everything.
// Plus the Mac's /_bridge/<id> (Bridge.swift): bridge calls too big for a message (POST the JSON, then name the id)
// and answers too big for a reply (one GET).
import Foundation
import UniformTypeIdentifiers
import WebKit

final class AppScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "capacitor"
    static let host = "localhost"
    static let origin = "capacitor://localhost"

    /// The export's folder (App/public in the bundle).
    let root: URL
    let bodies: BridgeBodies
    /// The page allowed to use /_bridge from another origin (a development server's page); nil in the bundled app,
    /// where the page is on this origin.
    var bridgeOrigin: String?

    private let work = DispatchQueue(label: "com.folevi.ios.app-scheme", qos: .userInitiated, attributes: .concurrent)
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    init(root: URL, bodies: BridgeBodies = .shared) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
        self.bodies = bodies
    }

    /// The bundled export: App/public (scripts/sync-web.mjs writes it), or nil when the build has none.
    static var bundledRoot: URL? { Bundle.main.url(forResource: "public", withExtension: nil) }

    // MARK: WKURLSchemeHandler

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let method = (task.request.httpMethod ?? "GET").uppercased()
        var body = task.request.httpBody
        if body == nil, method == "POST", let stream = task.request.httpBodyStream { body = Self.drain(stream) }
        let range = task.request.value(forHTTPHeaderField: "Range")
        let id = ObjectIdentifier(task)
        work.async {
            let answer = self.respond(url: url, method: method, body: body, range: range)
            DispatchQueue.main.async {
                guard !self.take(id) else { return }
                switch answer {
                case .failed(let error):
                    task.didFailWithError(error)
                case .response(let status, let headers, let data):
                    guard let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
                        return task.didFailWithError(URLError(.cannotParseResponse))
                    }
                    task.didReceive(http)
                    if !data.isEmpty { task.didReceive(data) }
                    task.didFinish()
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); defer { lock.unlock() }
        stopped.insert(ObjectIdentifier(task))
    }

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
            if out.count > BridgeBodies.maxBody { break }
        }
        return out
    }

    // MARK: the handler (a plain function, HostTests drives it without a web view)

    enum Answer {
        case response(Int, [String: String], Data)
        case failed(Error)

        var status: Int? { if case .response(let s, _, _) = self { return s } else { return nil } }
        var headers: [String: String] { if case .response(_, let h, _) = self { return h } else { return [:] } }
        var body: Data { if case .response(_, _, let d) = self { return d } else { return Data() } }
    }

    func respond(url: URL, method: String, body: Data? = nil, range: String? = nil) -> Answer {
        guard url.scheme?.lowercased() == Self.scheme, url.host?.lowercased() == Self.host, url.port == nil else { return .failed(URLError(.unsupportedURL)) }
        let path = url.path
        if path.hasPrefix("/_bridge/") { return bridge(String(path.dropFirst("/_bridge/".count)), method: method, body: body) }
        guard let file = Self.route(path, root: root) else { return .failed(URLError(.fileDoesNotExist)) }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue else { return .failed(URLError(.fileDoesNotExist)) }
        var headers = ["Content-Type": Self.mimeType(url.pathExtension), "Cache-Control": "no-cache"]
        if let range, let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, let r = Self.parseRange(range, size: size) {
            guard let handle = try? FileHandle(forReadingFrom: file) else { return .failed(URLError(.cannotOpenFile)) }
            defer { try? handle.close() }
            do {
                try handle.seek(toOffset: UInt64(r.start))
                let data = try handle.read(upToCount: r.end - r.start + 1) ?? Data()
                headers["Accept-Ranges"] = "bytes"
                headers["Content-Range"] = "bytes \(r.start)-\(r.end)/\(size)"
                headers["Content-Length"] = String(data.count)
                return .response(206, headers, data)
            } catch {
                return .failed(error)
            }
        }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return .failed(URLError(.cannotOpenFile)) }
        if Self.isMedia(url.pathExtension) { headers["Accept-Ranges"] = "bytes" }
        return .response(200, headers, method == "HEAD" ? Data() : data)
    }

    /// Where a request path is in the export, as Capacitor's router chose: no extension is index.html, anything else
    /// the file itself. Nil for a path that would leave the export (".." segments, a symlink pointing out).
    static func route(_ path: String, root: URL) -> URL? {
        let ext = URL(fileURLWithPath: path).pathExtension
        let relative = ext.isEmpty ? "index.html" : String(path.drop(while: { $0 == "/" }))
        guard !relative.isEmpty, !relative.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }),
              !relative.unicodeScalars.contains(where: { $0.value < 0x20 || $0 == "\\" }) else { return nil }
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/") else { return nil }
        return file
    }

    private func bridge(_ id: String, method: String, body: Data?) -> Answer {
        var cors: [String: String] = [:]
        if let bridgeOrigin, bridgeOrigin != Self.origin {
            cors = ["Access-Control-Allow-Origin": bridgeOrigin, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin"]
        }
        guard BridgeBodies.validId(id) else { return Self.text(400, "Bad id") }
        switch method {
        case "POST":
            guard bodies.putCall(id, body ?? Data()) else { return Self.text(413, "Too big") }
            return .response(200, ["Content-Type": "application/json", "Cache-Control": "no-store"].merging(cors) { $1 }, Data(#"{"ok":true}"#.utf8))
        case "GET":
            guard let reply = bodies.takeReply(id) else { return Self.text(404, "Not found") }
            return .response(200, ["Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"].merging(cors) { $1 }, reply)
        case "OPTIONS":
            return .response(204, cors, Data())
        default:
            return Self.text(405, "Method not allowed")
        }
    }

    private static func text(_ status: Int, _ message: String) -> Answer {
        .response(status, ["Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"], Data(message.utf8))
    }

    /// "bytes=a-b", "bytes=a-" or "bytes=-n" against a size: the bytes to send (both ends included), or nil.
    static func parseRange(_ header: String, size: Int) -> (start: Int, end: Int)? {
        let h = header.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("bytes="), size > 0 else { return nil }
        let spec = h.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        guard spec.count == 2 else { return nil }
        if spec[0].isEmpty {
            guard let n = Int(spec[1]), n > 0 else { return nil }
            return (max(0, size - n), size - 1)
        }
        guard let start = Int(spec[0]), start < size else { return nil }
        let end = spec[1].isEmpty ? size - 1 : min(Int(spec[1]) ?? size - 1, size - 1)
        return start <= end ? (start, end) : nil
    }

    /// As Capacitor: the type for the extension, text/html for none (the SPA fallback), bytes when unknown.
    static func mimeType(_ ext: String) -> String {
        guard !ext.isEmpty else { return "text/html" }
        if let type = UTType(filenameExtension: ext)?.preferredMIMEType { return type }
        switch ext.lowercased() {
        case "js", "mjs": return "text/javascript"
        case "wasm": return "application/wasm"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    static func isMedia(_ ext: String) -> Bool {
        ["m4v", "mov", "mp4", "aac", "ac3", "aiff", "au", "flac", "m4a", "mp3", "wav"].contains(ext.lowercased())
    }
}
