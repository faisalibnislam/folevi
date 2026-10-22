// folevi:// links: how widgets, App Intents, Spotlight and Control Center ask the app to open something.
// Everything native goes through these links, so it lands in the page the same way a link from another app
// does (the App plugin's appUrlOpen, read by apps/web/src/lib/deepLink.ts). `parse` accepts exactly what the
// web's parseDeepLink accepts (FoleviTests checks the same cases), so native code never hands the page a
// link it would drop.
import Foundation

enum DeepLink: Equatable {
    case open(path: String)
    case newNote
    case quickAdd

    static func note(_ id: String) -> URL { URL(string: "folevi://d/\(id)")! }

    /// A place's Inbox page: "inbox-" and a hash (packages/editor-schema inboxDocumentId), not a note id.
    private static let inboxId = #"^inbox-[0-9a-z]{1,40}$"#

    /// The link for a note by its id (an Inbox page's too). Nil for anything else.
    static func forNote(_ id: String) -> URL? {
        if id.range(of: #"^[0-9A-Za-z]{26}$"#, options: .regularExpression) != nil || id.range(of: inboxId, options: .regularExpression) != nil { return note(id) }
        return nil
    }
    static let newNoteURL = URL(string: "folevi://new")!
    static let quickAddURL = URL(string: "folevi://quick-add")!
    static let todayURL = URL(string: "folevi://tasks/today")!
    static let tasksURL = URL(string: "folevi://tasks")!

    /// A place in the note: a block ("#block-<id>", what notifications point at), a comment thread
    /// ("#comment-<id>"), or a bare id.
    private static let fragmentPattern = #"^#((block|comment)-)?[0-9A-Za-z]{1,40}$"#

    private static let pages: Set<String> = ["documents", "tasks", "calendar", "inbox", "settings", "foli-ai", "trash", "templates", "help"]

    /// What a folevi:// link opens, or nil when it isn't one Folevi knows.
    static func parse(_ raw: String) -> DeepLink? {
        guard raw.count <= 600, let url = URLComponents(string: raw), url.scheme?.lowercased() == "folevi" else { return nil }
        let segments = ([url.percentEncodedHost ?? ""] + url.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)).filter { !$0.isEmpty }
        var parts: [String] = []
        for segment in segments {
            guard let decoded = segment.removingPercentEncoding, decoded.range(of: #"^[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil else { return nil }
            parts.append(decoded)
        }
        guard let first = parts.first else { return .open(path: "/documents") }
        let rest = Array(parts.dropFirst())
        if first == "new", rest.isEmpty { return .newNote }
        if first == "quick-add", rest.isEmpty { return .quickAdd }
        if first == "d" {
            let raw = rest.first ?? ""
            let id = raw.range(of: inboxId, options: .regularExpression) != nil ? raw : raw.uppercased()
            guard rest.count == 1, id.range(of: #"^[0-9A-Z]{26}$"#, options: .regularExpression) != nil || id.range(of: inboxId, options: .regularExpression) != nil else { return nil }
            let fragment = url.fragment.map { "#\($0)" } ?? ""
            let block = fragment.range(of: fragmentPattern, options: .regularExpression) != nil ? fragment : ""
            return .open(path: "/d/\(id)\(block)")
        }
        if pages.contains(first), rest.count <= 2 { return .open(path: "/" + parts.joined(separator: "/")) }
        return nil
    }

    /// The page path a folevi:// link opens ("/d/ID#block-X"), or nil for one that isn't a page.
    static func path(of url: URL) -> String? {
        if case .open(let path)? = parse(url.absoluteString) { return path }
        return nil
    }

    /// A path inside the app as the server writes it ("/d/ID#block-X", "/tasks/today") as the folevi:// link
    /// that opens it. Nil when it isn't one the page would open.
    static func fromPath(_ path: String) -> URL? {
        // "/d/ID" becomes "folevi://d/ID" (the page's parser reads the first segment from the host).
        guard path.hasPrefix("/"), !path.hasPrefix("//"), let url = URL(string: "folevi:/" + path), parse(url.absoluteString) != nil else { return nil }
        return url
    }

    /// A Folevi page's address (https://app.folevi.com/d/ID) as the folevi:// link that opens it in the app.
    /// Also a universal link (a note or one of the app pages apple-app-site-association claims, on
    /// app.folevi.com only; Handoff of a page from the dev server keeps working for notes).
    static func fromWeb(_ url: URL) -> URL? {
        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count == 2, parts[0] == "d" {
            let link = URL(string: "folevi://d/\(parts[1])\(url.fragment.map { "#\($0)" } ?? "")")
            return link.flatMap { parse($0.absoluteString) != nil ? $0 : nil }
        }
        guard url.scheme == "https", url.host == "app.folevi.com", let first = parts.first, pages.contains(first) else { return nil }
        return fromPath("/" + parts.joined(separator: "/"))
    }
}

/// Links asked for where the page can't be reached right now (an App Intent run before the app's window
/// exists, or in the widget extension): kept in the App Group and opened when the app is next active.
enum PendingLink {
    private static let key = "pendingLink"

    /// Set by the app at launch: opens a link in the page (DeepLinkRouter). Nil in the extensions.
    static var handler: ((URL) -> Void)?

    static func open(_ url: URL) {
        if let handler {
            handler(url)
        } else {
            Folevi.defaults.set(url.absoluteString, forKey: key)
        }
    }

    /// The link waiting to be opened, once.
    static func take() -> URL? {
        guard let raw = Folevi.defaults.string(forKey: key) else { return nil }
        Folevi.defaults.removeObject(forKey: key)
        return URL(string: raw)
    }
}
