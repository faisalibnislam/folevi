// The smaller parts of `foleviShell` on iPhone and iPad (docs/LOCAL_MODE_PLAN.md §4.1): reminders as iOS
// notifications (`notify`, local mode's WP14), subscribed calendars and bookmark previews fetched by the app
// from the sites themselves (`http`, never through Folevi), saving a file the page made (`files.save`), and
// the mode the built-in interface opens in.
import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif
import UniformTypeIdentifiers
import UserNotifications

// MARK: the mode

enum ShellMode {
    private static let key = "folevi.shell.mode"

    /// "unset" on the very first launch, then "local" or "account".
    static var current: String {
        get { Platform.defaults.string(forKey: key).flatMap { ["local", "account"].contains($0) ? $0 : nil } ?? "unset" }
        set { Platform.defaults.set(newValue, forKey: key) }
    }
}

// MARK: reminders

/// Local mode's reminders (lib/local/reminders.ts): scheduled with the system, replaced by id, at most a day late.
/// iOS keeps 64 pending notifications per app: the soonest ones are kept, the page re-schedules after changes.
enum ShellNotify {
    private static let prefix = "folevi.local."
    private static let shownKey = "folevi.local.shown"

    static func schedule(id: String, at: Date, title: String, body: String, path: String) async throws {
        guard id.range(of: #"^[A-Za-z0-9:_-]{1,128}$"#, options: .regularExpression) != nil else { throw LibraryError(.invalidArgument, "Not a reminder id.") }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        // Each id and time shows once: a reminder already shown at this time isn't shown again.
        let stamp = "\(id)@\(Int(at.timeIntervalSince1970))"
        var shown = Platform.defaults.stringArray(forKey: shownKey) ?? []
        if shown.contains(stamp) { return }
        if at.timeIntervalSinceNow < -86_400 { return }
        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(200))
        // With accounts here too, a reminder says it's the library's (several places, docs/MULTI_ACCOUNT_PLAN.md §5.3).
        if !ShellPlaces.state.accounts.isEmpty { content.subtitle = "On this \(Platform.deviceLabel)" }
        content.body = String(body.prefix(500))
        content.sound = .default
        content.threadIdentifier = "local-reminders"
        content.userInfo = ["kind": "local-reminder", "path": path, "place": ShellPlaces.library]
        let trigger: UNNotificationTrigger
        if at.timeIntervalSinceNow <= 1 {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        } else {
            trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: at), repeats: false)
        }
        try await center.add(UNNotificationRequest(identifier: prefix + id, content: content, trigger: trigger))
        shown.append(stamp)
        Platform.defaults.set(Array(shown.suffix(500)), forKey: shownKey)
    }

    /// Every reminder the library scheduled (the library was removed from this device).
    static func cancelAll() {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            center.removePendingNotificationRequests(withIdentifiers: requests.map(\.identifier).filter { $0.hasPrefix(prefix) })
        }
    }

    static func cancel(id: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [prefix + id])
    }
}

// MARK: fetching from other sites

/// Subscribed calendars and bookmark previews, straight from the site (the Electron Mac app's calendarFetch.ts's
/// rules): https only, never Folevi's own hosts or a private address, every redirect checked again, 10 seconds and
/// 5 MB at most, no cookies.
final class ShellHTTP: NSObject, URLSessionTaskDelegate {
    static let shared = ShellHTTP()
    private static let maxBytes = 5 * 1024 * 1024

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.httpShouldSetCookies = false
        c.urlCache = nil
        c.timeoutIntervalForRequest = 10
        c.timeoutIntervalForResource = 10
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    /// Whether Folevi may fetch this address from the device.
    static func allowed(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased(), !host.isEmpty, url.user == nil, url.password == nil else { return false }
        if host == "folevi.com" || host.hasSuffix(".folevi.com") || host.hasSuffix(".convex.cloud") || host.hasSuffix(".convex.site") { return false }
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host.hasSuffix(".internal") { return false }
        return !isPrivate(host)
    }

    /// A private, loopback or link-local address (written, or what the name resolves to).
    static func isPrivate(_ host: String) -> Bool {
        var hints = addrinfo(ai_flags: 0, ai_family: AF_UNSPEC, ai_socktype: SOCK_STREAM, ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
        var res: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &res) == 0, let first = res else { return false }
        defer { freeaddrinfo(res) }
        var p: UnsafeMutablePointer<addrinfo>? = first
        while let a = p {
            if a.pointee.ai_family == AF_INET, let sa = a.pointee.ai_addr {
                let v = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
                let b0 = v >> 24, b1 = (v >> 16) & 0xff
                if b0 == 10 || b0 == 127 || b0 == 0 || (b0 == 169 && b1 == 254) || (b0 == 172 && (16...31).contains(b1)) || (b0 == 192 && b1 == 168) || (b0 == 100 && (64...127).contains(b1)) { return true }
            } else if a.pointee.ai_family == AF_INET6, let sa = a.pointee.ai_addr {
                let bytes = sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { s in withUnsafeBytes(of: s.pointee.sin6_addr) { Array($0) } }
                if bytes.allSatisfy({ $0 == 0 }) || (bytes[0..<15].allSatisfy { $0 == 0 } && bytes[15] == 1) || bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80) { return true }
            }
            p = a.pointee.ai_next
        }
        return false
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(Self.allowed) == true ? request : nil)
    }

    private func get(_ url: URL, headers: [String: String]) async throws -> (HTTPURLResponse, Data) {
        var req = URLRequest(url: url)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("Folevi (+https://folevi.com)", forHTTPHeaderField: "User-Agent")
        let (bytes, response) = try await session.bytes(for: req)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        var data = Data()
        for try await b in bytes {
            data.append(b)
            if data.count > Self.maxBytes { throw URLError(.dataLengthExceedsMaximum) }
        }
        return (http, data)
    }

    /// convex/lib/icsFetch.ts's Download, in its words.
    func calendar(_ raw: String, etag: String?, lastModified: String?) async -> [String: Any] {
        guard let url = URL(string: raw), Self.allowed(url) else { return ["kind": "error", "message": "Folevi can only subscribe to public https calendar links."] }
        var headers = ["Accept": "text/calendar, text/plain;q=0.8, */*;q=0.5"]
        if let etag { headers["If-None-Match"] = etag }
        if let lastModified { headers["If-Modified-Since"] = lastModified }
        do {
            let (res, data) = try await get(url, headers: headers)
            if res.statusCode == 304 { return ["kind": "notModified"] }
            guard (200..<300).contains(res.statusCode) else { return ["kind": "error", "message": "The calendar's site answered \(res.statusCode)."] }
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return ["kind": "error", "message": "That isn't a calendar."] }
            return ["kind": "ok", "text": text, "etag": res.value(forHTTPHeaderField: "ETag") ?? NSNull(), "lastModified": res.value(forHTTPHeaderField: "Last-Modified") ?? NSNull()]
        } catch let e as URLError where e.code == .dataLengthExceedsMaximum {
            return ["kind": "error", "message": "The calendar is larger than 5 MB."]
        } catch let e as URLError where e.code == .timedOut {
            return ["kind": "error", "message": "The calendar's site took too long to answer."]
        } catch {
            return ["kind": "error", "message": "Folevi couldn't reach the calendar's site."]
        }
    }

    /// A bookmark's page as HTML (for its title and image), or nil.
    func preview(_ raw: String) async -> String? {
        guard let url = URL(string: raw), Self.allowed(url) else { return nil }
        guard let (res, data) = try? await get(url, headers: ["Accept": "text/html,application/xhtml+xml"]), (200..<300).contains(res.statusCode),
              (res.value(forHTTPHeaderField: "Content-Type") ?? "text/html").lowercased().contains("html") else { return nil }
        return String(data: data.prefix(1_000_000), encoding: .utf8) ?? String(data: data.prefix(1_000_000), encoding: .isoLatin1)
    }
}

// MARK: saving a file

#if os(iOS)
// (The Mac's ShellFiles and FolderPicker are in Platform.swift.)

/// Saves a file the page made (an export) where the person picks in the Files app; false when cancelled.
@MainActor
final class ShellFiles: NSObject, UIDocumentPickerDelegate {
    static let shared = ShellFiles()
    private var finish: ((Bool) -> Void)?
    private var temp: URL?

    func save(name: String, bytes: Data, from presenter: UIViewController?) async -> Bool {
        let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports-\(UUID().uuidString)", isDirectory: true)
        let file = dir.appendingPathComponent(clean.isEmpty ? "Folevi export" : String(clean.prefix(120)))
        guard let presenter, (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil, (try? bytes.write(to: file)) != nil else { return false }
        finish?(false)
        temp = dir
        return await withCheckedContinuation { cont in
            finish = { ok in cont.resume(returning: ok) }
            let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    private func done(_ ok: Bool) {
        let f = finish
        finish = nil
        if let temp { try? FileManager.default.removeItem(at: temp) }
        temp = nil
        f?(ok)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(true) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done(false) }
}

/// "Choose a folder": the Files app's folder picker.
@MainActor
final class FolderPicker: NSObject, UIDocumentPickerDelegate {
    static let shared = FolderPicker()
    private var finish: ((URL?) -> Void)?

    func pick(from presenter: UIViewController?) async -> URL? {
        guard let presenter else { return nil }
        finish?(nil)
        return await withCheckedContinuation { cont in
            finish = { url in cont.resume(returning: url) }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            presenter.present(picker, animated: true)
        }
    }

    private func done(_ url: URL?) {
        let f = finish
        finish = nil
        f?(url)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls.first) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done(nil) }
}
#endif
