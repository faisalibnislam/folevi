// Where a Folevi Core window can be: a sidebar section, a list, a note, or one of the screens that stay on the
// page. Parsed from and written to Folevi's app paths (lib/app/router.tsx's parseRoute), so links inside notes,
// folevi-core:// links, notifications and Spotlight all land on the same places.
import Foundation
import FoleviDesign

enum TasksView: String, Codable, Hashable, CaseIterable, Identifiable {
    case inbox, today, upcoming, all, completed, mine
    var id: String { rawValue }

    var title: String {
        switch self {
        case .inbox: "Inbox"
        case .today: "Today"
        case .upcoming: "Upcoming"
        case .all: "All Tasks"
        case .completed: "Completed"
        case .mine: "Assigned to Me"
        }
    }

    var symbol: String {
        switch self {
        case .inbox: "tray"
        case .today: "star"
        case .upcoming: "calendar"
        case .all: "checklist"
        case .completed: "checkmark.circle"
        case .mine: "person.crop.circle"
        }
    }
}

enum Destination: Hashable, Codable {
    case home
    case search(String)
    case foliAI(String?)
    case inbox
    case notifications
    case tasks(TasksView)
    case calendar(String?)
    case daily(String?)
    case allNotes
    case recent
    case starred
    case shared
    case sharedFolder(String)
    case drafts
    case changes
    case templates
    case folders
    case folder(String)
    case tags
    case tag(String)
    case archive
    case trash
    case vault
    case reviews
    case catchUp
    case graph
    case note(String)
    case invite(kind: InviteKind, token: String)

    enum InviteKind: String, Codable, Hashable { case workspace, page, folder }

    var isNote: Bool { if case .note = self { true } else { false } }

    var isFoliAI: Bool { if case .foliAI = self { true } else { false } }

    /// Screens with a filter field ⌘F goes to.
    var hasFilter: Bool {
        switch self {
        case .allNotes, .starred, .drafts, .folder, .tag, .archive, .trash, .templates, .folders, .tags, .tasks: true
        default: false
        }
    }

    /// Screens a new tab may open again beside one already open (Search starts fresh).
    var isSearchLike: Bool { if case .search = self { true } else { false } }

    var noteId: String? { if case .note(let id) = self { id } else { nil } }

    /// Folevi's app path for this place (what links and the engine use).
    var path: String {
        switch self {
        case .home: "/documents"
        case .search(let q): q.isEmpty ? "/search" : "/documents?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
        case .foliAI(let id): id.map { "/ai/\($0)" } ?? "/ai"
        case .inbox: "/inbox"
        case .notifications: "/notifications"
        case .tasks(let v): "/tasks/\(v.rawValue)"
        case .calendar(let m): m.map { "/calendar/\($0)" } ?? "/calendar"
        case .daily(let d): d.map { "/daily/\($0)" } ?? "/daily"
        case .allNotes: "/notes"
        case .recent: "/documents"
        case .starred: "/starred"
        case .shared: "/shared"
        case .sharedFolder(let id): "/shared/\(id)"
        case .drafts: "/unsorted"
        case .changes: "/changes"
        case .templates: "/templates"
        case .folders: "/folders"
        case .folder(let id): "/folders/\(id)"
        case .tags: "/tags"
        case .tag(let id): "/tags/\(id)"
        case .archive: "/archive"
        case .trash: "/trash"
        case .vault: "/vault"
        case .reviews: "/review"
        case .catchUp: "/catch-up"
        case .graph: "/graph"
        case .note(let id): "/d/\(id)"
        case .invite(let kind, let token):
            switch kind {
            case .workspace: "/invite/\(token)"
            case .page: "/share-invite/\(token)"
            case .folder: "/share-invite/folder/\(token)"
            }
        }
    }

    /// The place a path names; nil for paths Core doesn't open in a window (settings, onboarding, the engine's
    /// own pages), which the caller handles.
    init?(path raw: String) {
        let pathOnly = raw.split(separator: "?", maxSplits: 1).first.map(String.init) ?? raw
        let query = raw.contains("?") ? URLComponents(string: "x://y" + raw)?.queryItems ?? [] : []
        let parts = pathOnly.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
        let head = parts.first ?? "documents"
        let a = parts.count > 1 ? parts[1] : nil
        let id = { (s: String?) -> String? in s.flatMap { $0.range(of: "^[0-9A-Za-z_-]{1,64}$", options: .regularExpression) != nil ? $0 : nil } }
        switch head {
        case "documents", "":
            if let q = query.first(where: { $0.name == "q" })?.value, !q.isEmpty { self = .search(q) } else { self = .home }
        case "search":
            self = .search(query.first(where: { $0.name == "q" })?.value ?? "")
        case "notes": self = .allNotes
        case "d": guard let n = id(a) else { return nil }; self = .note(n)
        case "ai", "foli-ai": self = .foliAI(id(a))
        case "inbox": self = .inbox
        case "notifications": self = .notifications
        case "tasks": self = .tasks(a.flatMap(TasksView.init(rawValue:)) ?? .today)
        case "calendar": self = .calendar(a.flatMap { $0.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil ? $0 : nil })
        case "daily": self = .daily(a.flatMap { $0.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? $0 : nil })
        case "shared": if let f = id(a) { self = .sharedFolder(f) } else { self = .shared }
        case "vault": self = .vault
        case "review": self = .reviews
        case "catch-up": self = .catchUp
        case "graph": self = .graph
        case "changes": self = .changes
        case "templates": self = .templates
        case "starred": self = .starred
        case "archive": self = .archive
        case "trash": self = .trash
        case "drafts", "unsorted": self = .drafts
        case "folders": if let f = id(a) { self = .folder(f) } else { self = .folders }
        case "tags": if let t = id(a) { self = .tag(t) } else { self = .tags }
        case "invite": guard let t = a, !t.isEmpty else { return nil }; self = .invite(kind: .workspace, token: t)
        case "share-invite":
            if a == "folder" { guard parts.count > 2 else { return nil }; self = .invite(kind: .folder, token: parts[2]) }
            else { guard let t = a, !t.isEmpty else { return nil }; self = .invite(kind: .page, token: t) }
        default: return nil
        }
    }

    /// The settings section a path names ("/settings/ai"), for the Settings window.
    static func settingsSection(path: String) -> String? {
        let parts = path.split(separator: "?").first?.split(separator: "/").map(String.init) ?? []
        guard parts.first == "settings" else { return nil }
        return parts.count > 1 ? parts[1] : "account"
    }

    /// The window title of a place that isn't a note (a note's title comes from the note).
    var title: String {
        switch self {
        case .home: "Home"
        case .search: "Search"
        case .foliAI: "Foli AI"
        case .inbox: "Inbox"
        case .notifications: "Notifications"
        case .tasks(let v): v == .today ? "Tasks" : v.title
        case .calendar: "Calendar"
        case .daily: "Daily Note"
        case .allNotes: "All Notes"
        case .recent: "Recent"
        case .starred: "Starred"
        case .shared: "Shared with Me"
        case .sharedFolder: "Shared Folder"
        case .drafts: "Drafts"
        case .changes: "Changes"
        case .templates: "Templates"
        case .folders: "Folders"
        case .folder: "Folder"
        case .tags: "Tags"
        case .tag: "Tag"
        case .archive: "Archive"
        case .trash: "Trash"
        case .vault: "Vault"
        case .reviews: "Reviews"
        case .catchUp: "Catch Me Up"
        case .graph: "Foli DNA"
        case .note: "Note"
        case .invite: "Invitation"
        }
    }

    /// The main app's own icon for the place (the web's icon set, as today's Folevi draws its sidebar).
    var webIcon: WebIcon {
        switch self {
        case .home: .house
        case .search: .search
        case .foliAI: .sparkles
        case .inbox: .inbox
        case .notifications: .bell
        case .tasks: .listTodo
        case .calendar: .calendar
        case .daily: .sunMedium
        case .allNotes: .notebookText
        case .recent: .clock
        case .starred: .bookmark
        case .shared, .sharedFolder: .users
        case .drafts: .penLine
        case .changes: .rotateCcwClock
        case .templates: .layoutTemplate
        case .folders, .folder: .folder
        case .tags, .tag: .hash
        case .archive: .archive
        case .trash: .trash
        case .vault: .shieldCheck
        case .reviews: .layers
        case .catchUp: .sparkles
        case .graph: .waypoints
        case .note: .fileText
        case .invite: .mail
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .search: "magnifyingglass"
        case .foliAI: "sparkles"
        case .inbox: "tray.and.arrow.down"
        case .notifications: "bell"
        case .tasks: "checklist"
        case .calendar: "calendar"
        case .daily: "sun.max"
        case .allNotes: "doc.text"
        case .recent: "clock"
        case .starred: "star"
        case .shared, .sharedFolder: "person.2"
        case .drafts: "tray"
        case .changes: "clock.arrow.trianglehead.counterclockwise.rotate.90"
        case .templates: "square.on.square"
        case .folders, .folder: "folder"
        case .tags, .tag: "tag"
        case .archive: "archivebox"
        case .trash: "trash"
        case .vault: "lock.shield"
        case .reviews: "rectangle.stack"
        case .catchUp: "sparkles"
        case .graph: "point.3.connected.trianglepath.dotted"
        case .note: "doc.text"
        case .invite: "envelope.open"
        }
    }
}
