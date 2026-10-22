// folevi-file://lib/<sha256>?type=<mime>: a local library's attachments for the page (docs/LOCAL_MODE_PLAN.md §4.3,
// `library.fileUrl`), the iOS twin of the Mac's app://folevi/_files/<sha>. Images, audio and video load from it
// (Range requests answered with 206, so media seeks), and the page may fetch() the bytes (CORS for the app's
// own origin). An encrypted library's files are decrypted a STREAM chunk at a time. Only these addresses are
// answered; everything else is a 404. Types the page could run (HTML, SVG, XML) go out as plain bytes.
import Foundation
import WebKit

final class LibraryFileHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "folevi-file"
    private let work = DispatchQueue(label: "com.folevi.library-files", qos: .userInitiated, attributes: .concurrent)
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()
    /// The page's origin, for CORS ("capacitor://localhost", or the dev server's).
    var origin = "capacitor://localhost"

    private static let allowedTypes = ["image/", "audio/", "video/", "application/pdf", "text/plain", "application/octet-stream", "application/zip", "text/csv", "application/json"]

    private func isStopped(_ task: WKURLSchemeTask) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped.contains(ObjectIdentifier(task))
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "lib", let sha = url.pathComponents.dropFirst().first, url.pathComponents.count == 2 else { return fail(task, 404) }
        let rawType = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "type" }?.value ?? "application/octet-stream"
        let type = Self.allowedTypes.contains { rawType.hasPrefix($0) } && !rawType.contains("svg") ? rawType : "application/octet-stream"
        let range = task.request.value(forHTTPHeaderField: "Range")
        let service = LibraryService.shared
        service.queue.async {
            let place = service.locateAttachment(sha: sha.lowercased())
            self.work.async {
                guard let place, let file = LibraryService.openAttachment(place) else { return self.fail(task, 404) }
                var start = 0
                var end = file.size - 1
                var partial = false
                if let range, let r = Self.parse(range, size: file.size) {
                    (start, end) = r
                    partial = true
                } else if range != nil {
                    return self.fail(task, 416, extra: ["Content-Range": "bytes */\(file.size)"])
                }
                let length = max(0, end - start + 1)
                var headers = self.headers(type)
                headers["Content-Length"] = String(length)
                headers["Accept-Ranges"] = "bytes"
                if partial { headers["Content-Range"] = "bytes \(start)-\(end)/\(file.size)" }
                guard let response = HTTPURLResponse(url: url, statusCode: partial ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: headers) else { return self.fail(task, 500) }
                DispatchQueue.main.async {
                    guard !self.isStopped(task) else { return }
                    task.didReceive(response)
                }
                // In pieces, so a large video doesn't sit in memory whole.
                var pos = start
                let piece = 256 * 1024
                while pos <= end && length > 0 {
                    if self.isStopped(task) { return }
                    let upTo = min(end + 1, pos + piece)
                    guard let data = try? file.read(pos, upTo - pos) else {
                        DispatchQueue.main.async { if !self.isStopped(task) { task.didFailWithError(URLError(.cannotDecodeContentData)) } }
                        return
                    }
                    DispatchQueue.main.async { if !self.isStopped(task) { task.didReceive(data) } }
                    pos = upTo
                }
                DispatchQueue.main.async {
                    guard !self.isStopped(task) else { return }
                    task.didFinish()
                    self.forget(task)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(task))
        lock.unlock()
    }

    private func forget(_ task: WKURLSchemeTask) {
        lock.lock()
        stopped.remove(ObjectIdentifier(task))
        lock.unlock()
    }

    private func headers(_ type: String) -> [String: String] {
        [
            "Content-Type": type,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        ]
    }

    private func fail(_ task: WKURLSchemeTask, _ status: Int, extra: [String: String] = [:]) {
        DispatchQueue.main.async {
            guard !self.isStopped(task), let url = task.request.url else { return }
            var h = self.headers("text/plain")
            h.merge(extra) { _, b in b }
            h["Content-Length"] = "0"
            if let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: h) { task.didReceive(r) }
            task.didReceive(Data())
            task.didFinish()
            self.forget(task)
        }
    }

    /// "bytes=a-b", "bytes=a-" or "bytes=-n" within `size`; nil when it can't be satisfied.
    static func parse(_ header: String, size: Int) -> (Int, Int)? {
        guard size > 0, header.hasPrefix("bytes="), !header.contains(",") else { return nil }
        let spec = header.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard spec.count == 2 else { return nil }
        if spec[0].isEmpty {
            guard let n = Int(spec[1]), n > 0 else { return nil }
            return (max(0, size - n), size - 1)
        }
        guard let a = Int(spec[0]), a < size else { return nil }
        let b = spec[1].isEmpty ? size - 1 : min(size - 1, Int(spec[1]) ?? -1)
        return b >= a ? (a, b) : nil
    }
}
