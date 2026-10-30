// Where a window is, on the Mac or in an iPhone or iPad tab (docs/NATIVE_APP_PLAN.md section 4.5; shared since
// the iOS rebuild, docs/IOS_REBUILD_PLAN.md): a native screen (Home, a list, a folder, search)
// or a note in the Page View. Routes travel as the web's own paths (`/d/<id>`, `/folders/<id>`, `/drafts`), so
// window restoration, `navigate.request`, Home's rows (`HomeRow.route`) and folevi:// links all speak one
// language with the web router (apps/web/src/lib/app/router.tsx `parseRoute`).
import Foundation
import FoleviEngine

public enum FrameRoute: Hashable, Sendable {
    case home
    /// Home's Catch me up / Your week card on its own screen.
    case catchUp
    /// All notes, Drafts (`unsorted`), Starred, Archive, Trash, Templates.
    case notes(NotesListView)
    case folder(String)
    case tag(String)
    case shared
    case changes
    /// Tasks on one of its views (Inbox, Today, Upcoming, All, Completed, Mine).
    case tasks(TaskViewName)
    /// The calendar on a day (YYYY-MM-DD), or today.
    case calendar(String?)
    /// Search over the open place (native until the search screen lands, N11).
    case search(String)
    case note(String)
    /// A web route native has no screen for (shown as a placeholder that names it).
    case web(String)

    /// The web path (what restoration saves and links carry).
    public var path: String {
        switch self {
        case .home: return "/documents"
        case .catchUp: return "/catch-up"
        case .notes(let v):
            switch v {
            case .all: return "/notes"
            case .unsorted: return "/drafts"
            case .starred: return "/starred"
            case .archive: return "/archive"
            case .trash: return "/trash"
            case .templates: return "/templates"
            case .folder, .tag: return "/notes"
            }
        case .folder(let id): return "/folders/\(Self.escape(id))"
        case .tag(let id): return "/tags/\(Self.escape(id))"
        case .shared: return "/shared"
        case .changes: return "/changes"
        case .tasks(let v): return "/tasks/\(v.rawValue)"
        case .calendar(let d): return d.map { "/calendar?date=\($0)" } ?? "/calendar"
        case .search(let q):
            var c = URLComponents()
            c.path = "/search"
            if !q.isEmpty { c.queryItems = [URLQueryItem(name: "q", value: q)] }
            return c.string ?? "/search"
        case .note(let id): return "/d/\(Self.escape(id))"
        case .web(let path): return path
        }
    }

    /// Reads a web path (the web router's heads; unknown ones become `.web`). Never fails: "/" is Home.
    public init(path raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        let comps = URLComponents(string: trimmed.hasPrefix("/") ? trimmed : "/" + trimmed)
        let parts = (comps?.path ?? trimmed).split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        let a = parts.count > 1 ? parts[1] : nil
        switch parts.first {
        case nil, "documents", "home": self = .home
        case "catch-up": self = .catchUp
        case "notes": self = .notes(.all)
        case "drafts", "unsorted": self = .notes(.unsorted)
        case "starred": self = .notes(.starred)
        case "archive": self = .notes(.archive)
        case "trash": self = .notes(.trash)
        case "templates": self = .notes(.templates)
        case "shared": self = a.map { .web("/shared/\(Self.escape($0))") } ?? .shared
        case "changes": self = .changes
        case "inbox": self = .tasks(.inbox)
        case "tasks": self = .tasks(a.flatMap(TaskViewName.init(rawValue:)) ?? .today)
        case "calendar":
            let date = comps?.queryItems?.first { $0.name == "date" }?.value ?? a
            self = .calendar(date.flatMap { $0.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? $0 : nil })
        case "search": self = .search(comps?.queryItems?.first { $0.name == "q" }?.value ?? "")
        case "folders": self = a.map { .folder($0) } ?? .web("/folders")
        case "tags": self = a.map { .tag($0) } ?? .web("/tags")
        case "d": self = a.map { .note($0) } ?? .home
        default: self = .web(comps?.path ?? trimmed)
        }
    }

    public var noteId: String? {
        if case .note(let id) = self { return id }
        return nil
    }

    public var isNote: Bool { noteId != nil }

    /// Home's tab, the pinned first one (the Mac's and the iPad's tab strip).
    public static let homeTabKey = "home"

    /// The tab a route lives in (web tabs.tsx `viewKey`): a note's own id; one tab per view kind; one per folder
    /// or tag. Home is the pinned first tab.
    public var tabKey: String {
        switch self {
        case .home: return Self.homeTabKey
        case .note(let id): return id
        case .folder(let id): return "view:folder:\(id)"
        case .tag(let id): return "view:tag:\(id)"
        case .notes(let v): return "view:\(v.rawValue)"
        case .catchUp: return "view:catch-up"
        case .shared: return "view:shared"
        case .changes: return "view:changes"
        case .tasks: return "view:tasks"
        case .calendar: return "view:calendar"
        case .search: return "view:search"
        // The Vault is one tab whichever section a link opened (as the web's route "vault").
        case .web(let p) where p == "/vault" || p.hasPrefix("/vault/"): return "view:vault"
        // Foli AI is one tab: a new chat keeps its tab when it gets its address (/ai to /ai/<id>), as on the web.
        // Settings is one tab whichever section is open (it follows you between them).
        case .web(let p): return p == "/ai" || p.hasPrefix("/ai/") ? "view:ai" : p.hasPrefix("/settings") ? "view:settings" : "view:web:\(p)"
        }
    }

    /// A title before anything better is known (folder and tag names, note titles come from the engine).
    public var fallbackTitle: String {
        switch self {
        case .home: return "Home"
        case .catchUp: return "Catch me up"
        case .notes(let v):
            switch v {
            case .all: return "All notes"
            case .unsorted: return "Drafts"
            case .starred: return "Starred"
            case .archive: return "Archive"
            case .trash: return "Trash"
            case .templates: return "Templates"
            case .folder: return "Folder"
            case .tag: return "Tag"
            }
        case .folder: return "Folder"
        case .tag: return "Tag"
        case .shared: return "Shared with me"
        case .changes: return "Changes"
        case .tasks: return "Tasks"
        case .calendar: return "Calendar"
        case .search(let q): return q.isEmpty ? "Search" : "Search: \(q)"
        case .note: return "Untitled"
        case .web(let p) where p == "/vault" || p.hasPrefix("/vault/"): return "Vault"
        case .web("/folders"): return "Folders"
        case .web("/tags"): return "Tags"
        case .web(let p):
            if p.hasPrefix("/settings") { return "Settings" }
            if p.hasPrefix("/help") { return "Help" }
            if p.hasPrefix("/graph") { return "Graph" }
            if p.hasPrefix("/review") { return "Reviews" }
            if p.hasPrefix("/shared/") { return "Shared folder" }
            return "Folevi"
        }
    }

    /// The SF Symbol for the route's tab and sidebar row.
    public var symbol: String {
        switch self {
        case .home: return "house"
        case .catchUp: return "sparkles"
        case .notes(let v):
            switch v {
            case .all: return "doc.text"
            case .unsorted: return "tray"
            case .starred: return "star"
            case .archive: return "archivebox"
            case .trash: return "trash"
            case .templates: return "square.on.square"
            case .folder: return "folder"
            case .tag: return "number"
            }
        case .folder: return "folder"
        case .tag: return "number"
        case .shared: return "person.2"
        case .changes: return "clock.arrow.circlepath"
        case .tasks: return "checklist"
        case .calendar: return "calendar"
        case .search: return "magnifyingglass"
        case .note: return "doc"
        case .web: return "globe"
        }
    }

    private static func escape(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }
}
