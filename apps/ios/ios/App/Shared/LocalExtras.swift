// The widgets, Shortcuts and Spotlight in local mode ("Keep notes on my devices"), where there's no account and
// no REST API: the library lives in the page (the built-in interface), so the extensions work from what the
// page hands them and leave it what they can't do themselves. Compiled into every target.
//
//   widgets.json        the widgets' copy (WidgetStore), written by the page (foleviNative.setWidgetSnapshot)
//   local-notes.json    the notes Shortcuts can pick from (Open note, Add a task to a note), from the page too
//   LocalActions/<id>   what a widget, Siri or Shortcuts did while the page wasn't there to do it: a task
//                       checked off, a task added, a note made. The page takes them when it next runs
//                       (takeLocalActions, the same pattern as the share extension's queue) and lets each one
//                       go once it's in the library (finishLocalAction).
//
// docs/LOCAL_MODE_PLAN.md §4.2 "Extensions in local mode".
import Foundation

/// Whether the app is in local mode (written by the app each launch, read by the widgets and intents).
enum LocalMode {
    private static let key = "localMode"

    static var on: Bool {
        get { Folevi.defaults.bool(forKey: key) }
        set { Folevi.defaults.set(newValue, forKey: key) }
    }
}

/// Something done outside the page in local mode, waiting for it.
struct LocalAction: Codable, Equatable, Identifiable {
    enum Kind: String, Codable {
        /// A widget's check-off (or back on): `taskId` (the to-do block's id) and `completed`.
        case toggleTask
        /// Add a task: `text`, maybe `dueDate` (YYYY-MM-DD) and `noteId` (else the Inbox).
        case addTask
        /// New note with text: `title` and `markdown`.
        case newNote
    }

    let id: String
    let kind: Kind
    var taskId: String?
    var completed: Bool?
    var text: String?
    var dueDate: String?
    var noteId: String?
    var title: String?
    var markdown: String?
    /// Microseconds since 1970 (the queue's order).
    let createdAt: Int64
}

final class LocalActions {
    static let shared = LocalActions(root: Folevi.container.appendingPathComponent("LocalActions", isDirectory: true))

    /// Posted (a Darwin notification, so it crosses from the widget extension) when an action is queued: the
    /// app, if it's running, tells the page at once.
    static let changed = "com.folevi.local-actions"

    /// How many can wait: the oldest go beyond this (a widget tapped all day with the app never opened).
    static let limit = 500

    private let root: URL
    private let fm = FileManager.default
    private let lock = NSLock()

    init(root: URL) {
        self.root = root
    }

    /// Queues an action. A check-off replaces an earlier one for the same task (only the last one counts).
    @discardableResult
    func add(_ kind: LocalAction.Kind, taskId: String? = nil, completed: Bool? = nil, text: String? = nil, dueDate: String? = nil, noteId: String? = nil, title: String? = nil, markdown: String? = nil) throws -> LocalAction {
        let now = Int64(Date().timeIntervalSince1970 * 1_000_000)
        let action = LocalAction(id: "\(now)-\(UUID().uuidString.prefix(8).lowercased())", kind: kind, taskId: taskId, completed: completed, text: text, dueDate: dueDate, noteId: noteId, title: title, markdown: markdown, createdAt: now)
        try lock.withLock {
            try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var queued = unlockedAll()
            if kind == .toggleTask, let taskId {
                for old in queued where old.kind == .toggleTask && old.taskId == taskId { remove(old.id, locked: true) }
                queued.removeAll { $0.kind == .toggleTask && $0.taskId == taskId }
            }
            for old in queued.prefix(max(0, queued.count - Self.limit + 1)) { remove(old.id, locked: true) }
            try JSONEncoder().encode(action).write(to: root.appendingPathComponent("\(action.id).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        Self.post()
        return action
    }

    /// Every queued action, oldest first.
    func all() -> [LocalAction] {
        lock.withLock { unlockedAll() }
    }

    private func unlockedAll() -> [LocalAction] {
        guard let files = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        let decoder = JSONDecoder()
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { (try? Data(contentsOf: $0)).flatMap { try? decoder.decode(LocalAction.self, from: $0) } }
            .sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    func action(_ id: String) -> LocalAction? {
        all().first { $0.id == id }
    }

    /// Done (in the library now, or nothing to do): it goes.
    func remove(_ id: String) {
        lock.withLock { remove(id, locked: true) }
    }

    private func remove(_ id: String, locked: Bool) {
        guard Self.validId(id) else { return }
        try? fm.removeItem(at: root.appendingPathComponent("\(id).json"))
    }

    func removeAll() {
        lock.withLock { _ = try? fm.removeItem(at: root) }
    }

    /// Whether a check-off for this task is still waiting.
    func togglePending(_ taskId: String) -> Bool {
        all().contains { $0.kind == .toggleTask && $0.taskId == taskId }
    }

    static func validId(_ id: String) -> Bool {
        id.range(of: #"^[0-9]{1,20}-[0-9a-f]{1,8}$"#, options: .regularExpression) != nil
    }

    static func post() {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(changed as CFString), nil, nil, true)
    }
}

/// The notes Shortcuts offers in local mode (Open note, Add a task to a note): the library's most recently
/// edited ones, titles only, from the page.
enum LocalCatalog {
    static var file: URL { Folevi.container.appendingPathComponent("local-notes.json") }

    /// At most this many are kept.
    static let limit = 500

    static func save(_ notes: [NoteSummary]) {
        try? JSONEncoder().encode(Array(notes.prefix(limit))).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func load() -> [NoteSummary] {
        (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([NoteSummary].self, from: $0) } ?? []
    }

    static func clear() {
        try? FileManager.default.removeItem(at: file)
    }

    /// Titles containing the words typed (any order, any case), most recently edited first.
    static func search(_ text: String, in notes: [NoteSummary] = load(), limit: Int = 10) -> [NoteSummary] {
        let words = text.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return Array(notes.prefix(limit)) }
        return Array(notes.filter { note in
            let title = note.title.lowercased()
            return words.allSatisfy { title.localizedStandardContains($0) }
        }.prefix(limit))
    }
}
