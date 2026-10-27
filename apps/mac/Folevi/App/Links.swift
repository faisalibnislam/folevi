// Which addresses are Folevi's own and which go to the browser, and what a folevi:// link opens (Electron's
// urls.ts, ported with its rules; RouterTests checks the same cases).
import Foundation

enum Links {
    /// What a folevi:// (folevi-dev:// for a Debug build) link asks for.
    enum DeepLink: Equatable {
        case open(path: String)
        case newNote
        case quickAdd
    }

    /// Where a link the page follows (or opens in a new window) goes.
    enum Target: Equatable {
        /// One of the app's own pages: shown in a window (`path` is its path, search and hash).
        case app(path: String)
        /// Handed to the default browser (or mail app).
        case browser
        /// Nowhere (file:, javascript:, custom schemes).
        case ignore
    }

    /// The product's pages (apps/web/src/lib/app/routes.ts APP_ROUTE_HEADS): a link to one of these on the website
    /// opens in the app; any other website page (sign-in, share links, pricing) opens in the browser.
    static let appRouteHeads: Set<String> = [
        "documents", "notes", "d", "ai", "graph", "tasks", "inbox", "calendar", "review", "changes", "daily", "shared", "templates",
        "starred", "archive", "trash", "drafts", "unsorted", "folders", "tags", "settings", "help", "onboarding", "quick-add",
    ]

    /// Handlers tried before the usual ones for a link that opened the app (WM1: sign-in callbacks).
    @MainActor static var handlers: [(URL) -> Bool] = []

    /// "scheme://host[:port]", or nil.
    static func origin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    static func isAppUrl(_ url: URL) -> Bool { origin(url) == AppScheme.origin }

    static func isServiceUrl(_ url: URL, service: URL = Paths.serviceURL) -> Bool { origin(url) != nil && origin(url) == origin(service) }

    /// Links that are fine to hand to the browser or mail app (never file:, javascript: or custom schemes).
    static func isExternalSafe(_ url: URL) -> Bool { ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") }

    static func target(_ url: URL, service: URL = Paths.serviceURL) -> Target {
        let path = pathOf(url)
        if isAppUrl(url) { return .app(path: path) }
        if isServiceUrl(url, service: service) {
            let head = url.path.split(separator: "/").first.map(String.init) ?? ""
            if appRouteHeads.contains(head) { return .app(path: path) }
        }
        return isExternalSafe(url) ? .browser : .ignore
    }

    private static func pathOf(_ url: URL) -> String {
        var s = url.path(percentEncoded: true)
        if s.isEmpty { s = "/" }
        if let q = url.query(percentEncoded: true) { s += "?" + q }
        if let f = url.fragment(percentEncoded: true) { s += "#" + f }
        return s
    }

    private static let noteId = #"^[0-9A-Z]{26}$"#
    private static let inboxId = #"^inbox-[0-9a-z]{1,40}$"#
    private static let pages: Set<String> = ["documents", "ai", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help"]

    private static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

    /// A folevi:// link as what it opens, or nil when it isn't one Folevi knows: folevi://d/<id> (a note, #block
    /// kept, or an Inbox page), folevi://tasks/today, folevi://new (a new note) and folevi://quick-add. Only these
    /// shapes pass, so a link can't send the app anywhere else.
    static func parseDeepLink(_ raw: String, scheme: String = Paths.urlScheme) -> DeepLink? {
        guard raw.count <= 600, let url = URL(string: raw), url.scheme?.lowercased() == scheme else { return nil }
        // folevi://d/ID puts "d" in the host; folevi:/d/ID and folevi:///d/ID put it in the path.
        let encoded = [url.host(percentEncoded: true) ?? ""] + url.path(percentEncoded: true).split(separator: "/").map(String.init)
        var parts: [String] = []
        for p in encoded where !p.isEmpty {
            guard let d = p.removingPercentEncoding, matches(d, "^[A-Za-z0-9_-]{1,64}$") else { return nil }
            parts.append(d)
        }
        guard let first = parts.first else { return .open(path: "/documents") }
        let rest = Array(parts.dropFirst())
        if first == "new" && rest.isEmpty { return .newNote }
        if first == "quick-add" && rest.isEmpty { return .quickAdd }
        if first == "d" {
            guard rest.count == 1 else { return nil }
            let id = matches(rest[0], inboxId) ? rest[0] : rest[0].uppercased()
            guard matches(id, noteId) || matches(id, inboxId) else { return nil }
            // A block ("#block-<id>"), a comment thread ("#comment-<id>"), or a bare id.
            let hash = url.fragment.map { "#" + $0 } ?? ""
            let block = matches(hash, #"^#((block|comment)-)?[0-9A-Za-z]{1,40}$"#) ? hash : ""
            return .open(path: "/d/\(id)\(block)")
        }
        if pages.contains(first) && rest.count <= 2 { return .open(path: "/" + ([first] + rest).joined(separator: "/")) }
        return nil
    }

    /// A path inside the app ("/d/01…") as an app://folevi URL; anything that isn't a plain path is the start page.
    static func appURL(_ path: String = "/") -> URL {
        let safe = path.hasPrefix("/") && !path.hasPrefix("//") ? path : "/"
        return URL(string: AppScheme.origin + safe) ?? URL(string: AppScheme.origin + "/")!
    }
}
