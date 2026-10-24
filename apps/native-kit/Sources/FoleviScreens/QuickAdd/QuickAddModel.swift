// Quick Add (plan 5.12; web parity: components/iphone/QuickAddSheet.tsx and the Mac's one growing field,
// docs/MAC_POLISH_PLAN.md 3.8): a task or a note from one field. Tasks read their date and repeat as they're typed
// (`task.parse`), each shown as a chip that can be removed to keep the words as text; Date, Time, Priority and where
// it goes (the Inbox or a page, in any space) are chips too. Notes go to a folder or Drafts (`note.create { text }`,
// revision 8: the first line is the title, the rest the body).
//
// The engine queues writes itself while offline, so a command only fails here when no engine is reachable (the page
// is still starting, or its process ended): then the item waits in `QuickAddQueue` on the device and goes as soon
// as the engine is back.
import Foundation
import Observation
import FoleviEngine

@MainActor
@Observable
public final class QuickAddModel {
    public enum Mode: String, CaseIterable, Sendable { case task, note }

    /// Where it goes: a space, and a page (tasks) or a folder (notes); nil for the Inbox or Drafts.
    public struct Destination: Equatable, Sendable {
        public var space: SpaceRef?
        public var spaceName: String?
        public var noteId: String?
        public var noteTitle: String?
        public var folderId: String?
        public var folderName: String?

        public init(space: SpaceRef? = nil, spaceName: String? = nil, noteId: String? = nil, noteTitle: String? = nil, folderId: String? = nil, folderName: String? = nil) {
            self.space = space
            self.spaceName = spaceName
            self.noteId = noteId
            self.noteTitle = noteTitle
            self.folderId = folderId
            self.folderName = folderName
        }
    }

    public let client: EngineClient
    let feedback: ScreenFeedback
    public let queue: QuickAddQueue
    public let session: ValueStore<SessionValue>
    public private(set) var tree: ValueStore<FoldersTreeValue>?

    public var mode: Mode {
        didSet { if mode != oldValue { parsed = nil; scheduleParse() } }
    }
    public var text = "" {
        didSet { if text != oldValue { error = nil; scheduleParse() } }
    }
    /// What `task.parse` read in the text (nil while there's nothing to read).
    public private(set) var parsed: TaskParseValue?
    /// The person removed the date chip: the date words stay in the title.
    public private(set) var keepText = false
    public var dueDate: String?
    public var dueTime: String?
    public var priority: TaskCreateArgs.Priority?
    public var destination = Destination()

    public private(set) var busy = false
    public private(set) var error: String?
    /// "Added to Inbox" after saving, for 1.2 s (the Mac's confirmation in the panel).
    public private(set) var confirmation: String?
    /// Search results for the page picker.
    public private(set) var pageHits: [SearchHit] = []

    @ObservationIgnored private var parseTask: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var listener: Task<Void, Never>?
    @ObservationIgnored var parseDelay: Duration = .milliseconds(120)
    /// Called after a save that closes Quick Add (Return), with the new task's or note's id.
    @ObservationIgnored public var onSaved: (@MainActor (_ id: String?, _ open: Bool) -> Void)?

    public init(client: EngineClient, mode: Mode = .task, queue: QuickAddQueue = QuickAddQueue(), feedback: ScreenFeedback = ScreenFeedback(), destination: Destination = Destination()) {
        self.client = client
        self.mode = mode
        self.queue = queue
        self.feedback = feedback
        self.destination = destination
        self.session = client.watch(.session)
    }

    /// Sends what waited on the device once the engine is up, and again whenever it says it's ready.
    public func start() {
        guard listener == nil else { return }
        let stream = client.events()
        listener = Task { [weak self] in
            await self?.flushQueue()
            for await event in stream {
                guard let self else { return }
                if case .engineReady = event { await self.flushQueue() }
            }
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
        parseTask?.cancel()
        searchTask?.cancel()
    }

    // MARK: What it shows

    public var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var canSave: Bool { !trimmed.isEmpty && !busy && canEditTarget }

    /// The spaces Quick Add can add to (the ones this person may edit).
    public var spaces: [SpaceInfo] { (session.value?.spaces ?? []).filter { $0.canEdit && !$0.locked } }

    public var canEditTarget: Bool {
        guard let s = session.value else { return true }
        let id = destination.space ?? s.space
        return s.spaces.first { $0.id == id }?.canEdit ?? true
    }

    public var placeholder: String { mode == .task ? "What needs doing?" : "New note" }

    /// The chip saying where it goes: "Inbox", "Drafts", a page's or folder's name, with the space when it isn't the
    /// open one.
    public var destinationLabel: String {
        let base: String
        switch mode {
        case .task: base = destination.noteId == nil ? "Inbox" : (destination.noteTitle?.isEmpty == false ? destination.noteTitle! : "Untitled")
        case .note: base = destination.folderName ?? "Drafts"
        }
        guard let name = destination.spaceName, let s = session.value, destination.space != nil, destination.space != s.space else { return base }
        return "\(name) · \(base)"
    }

    /// The due date in effect: picked, else read from the text (unless kept as text).
    public var effectiveDueDate: String? { dueDate ?? (keepText ? nil : parsed?.dueDate) }
    public var effectiveDueTime: String? { dueTime ?? (keepText ? nil : parsed?.dueTime) }

    /// "Due tomorrow, 9:00 AM, from “tomorrow 9am”" (the web's line under the field).
    public var parsedLine: String? {
        guard mode == .task, !keepText, let p = parsed, let date = p.dueDate, let words = p.dateText else { return nil }
        var s = "Due \(Self.dayLabel(date, today: session.value?.today))"
        if let t = p.dueTime { s += ", \(Self.clock(t))" }
        return "\(s), from \u{201C}\(words.trimmingCharacters(in: .whitespaces))\u{201D}"
    }

    public var repeatLine: String? {
        guard mode == .task, !keepText, let label = parsed?.repeatLabel else { return nil }
        return "Repeats \(label.lowercased())"
    }

    /// "Today", "Tomorrow", "Mon 3 Nov".
    static func dayLabel(_ ymd: String, today: String?) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: ymd) else { return ymd }
        if let today, let t = f.date(from: today) {
            let days = Calendar(identifier: .gregorian).dateComponents([.day], from: t, to: d).day ?? 99
            if days == 0 { return "Today" }
            if days == 1 { return "Tomorrow" }
            if days == -1 { return "Yesterday" }
        }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_GB")
        out.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return out.string(from: d)
    }

    /// "15:00" as this device writes a time.
    static func clock(_ hhmm: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        guard let d = f.date(from: hhmm) else { return hhmm }
        return d.formatted(date: .omitted, time: .shortened)
    }

    // MARK: Reading the text

    private func scheduleParse() {
        parseTask?.cancel()
        guard mode == .task, !trimmed.isEmpty else {
            parsed = nil
            keepText = false
            return
        }
        let text = self.text
        let delay = parseDelay
        parseTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            let value = try? await self.client.query(.taskParse(text: text))
            guard !Task.isCancelled, self.text == text else { return }
            // Removing the chip keeps those words; new date words bring the chip back.
            if self.keepText, value?.dateText != self.parsed?.dateText { self.keepText = false }
            self.parsed = value
        }
    }

    /// The chip's ✕: keeps the date and repeat words in the title.
    public func keepDateAsText() {
        keepText = true
        feedback.haptic(.selection)
    }

    // MARK: Where it goes

    public func loadFolders() {
        if tree == nil || tree?.value?.space != (destination.space ?? session.value?.space) {
            tree?.cancel()
            tree = client.watch(.foldersTree(space: destination.space))
        }
    }

    public var folders: [FolderNode] { tree?.value?.folders ?? [] }

    public func choose(space: SpaceInfo) {
        destination = Destination(space: space.id, spaceName: space.name)
        tree?.cancel()
        tree = nil
        feedback.haptic(.selection)
    }

    public func choose(folder: FolderNode?) {
        destination.folderId = folder?.id
        destination.folderName = folder?.name
        feedback.haptic(.selection)
    }

    public func choose(page: SearchHit?) {
        destination.noteId = page?.id
        destination.noteTitle = page?.title
        if let s = page?.space, s != destination.space {
            destination.space = s
            destination.spaceName = page?.spaceName
        }
        feedback.haptic(.selection)
    }

    /// Finds pages for "Add to" as the person types.
    public func searchPages(_ query: String) {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else {
            pageHits = []
            return
        }
        let space = destination.space
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, let self else { return }
            let value = try? await self.client.query(.search(text: q, scope: space == nil ? .everywhere : .place, space: space, limit: 20))
            guard !Task.isCancelled else { return }
            self.pageHits = (value?.hits ?? []).filter { !$0.archived && $0.kind != "template" }
        }
    }

    // MARK: Saving

    /// Return: saves and closes. `keepOpen` (⇧Return): saves and stays for another. `open` (⌘Return): opens it.
    public func save(keepOpen: Bool = false, open: Bool = false) async {
        guard canSave else { return }
        busy = true
        error = nil
        defer { busy = false }
        let item = makeItem()
        do {
            let (id, where_) = try await send(item)
            feedback.haptic(.success)
            confirm(mode == .task ? "Added to \(where_)" : "Note added to \(where_)")
            reset()
            if !keepOpen { onSaved?(id, open) }
        } catch let f as EngineFailure where Self.shouldQueue(f) {
            queue.enqueue(item)
            feedback.haptic(.success)
            confirm("Saved on this device. It's added when Folevi is ready.")
            reset()
            if !keepOpen { onSaved?(nil, false) }
        } catch let f as EngineFailure {
            error = f.message
            feedback.haptic(.error)
        } catch {
            self.error = "That didn't save. Try again."
            feedback.haptic(.error)
        }
    }

    /// Failures that mean no engine answered (not a refusal): the item waits on the device.
    static func shouldQueue(_ f: EngineFailure) -> Bool {
        switch f {
        case .notReady, .timeout, .transport, .pageGone: return true
        case .engine(let e): return ["engine_not_ready", "page_gone"].contains(e.code)
        default: return false
        }
    }

    func makeItem() -> QuickAddQueue.Item {
        QuickAddQueue.Item(
            id: UUID().uuidString,
            kind: mode,
            text: trimmed,
            space: destination.space,
            noteId: mode == .task ? destination.noteId : nil,
            folderId: mode == .note ? destination.folderId : nil,
            dueDate: mode == .task ? dueDate : nil,
            dueTime: mode == .task ? dueTime : nil,
            priority: mode == .task ? priority?.rawValue : nil,
            keepText: mode == .task && keepText ? true : nil,
            createdAt: Date().timeIntervalSince1970
        )
    }

    /// Sends one item: the new task's or note's id and where it went.
    func send(_ item: QuickAddQueue.Item) async throws -> (String?, String) {
        switch item.kind {
        case .task:
            let r = try await client.command(.taskCreate(text: item.text, space: item.space, noteId: item.noteId, dueDate: item.dueDate, dueTime: item.dueTime, priority: item.priority.flatMap(TaskCreateArgs.Priority.init(rawValue:)), keepText: item.keepText))
            return (r.id, r.where)
        case .note:
            let r = try await client.command(.noteCreate(space: item.space, folderId: item.folderId, text: item.text))
            return (r.id, destination.folderName ?? "Drafts")
        }
    }

    /// Sends what waited, oldest first; stops at the first that still can't go.
    public func flushQueue() async {
        for item in queue.items {
            do {
                _ = try await send(item)
                queue.remove(item.id)
            } catch let f as EngineFailure where Self.shouldQueue(f) {
                return
            } catch {
                // Refused for good (the page was deleted, no access): it can't ever go; say so once.
                queue.remove(item.id)
                feedback.toast(ScreenToast("\u{201C}\(item.text.prefix(40))\u{201D} couldn't be added.", tone: .error))
            }
        }
    }

    private func confirm(_ text: String) {
        confirmation = text
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            if self?.confirmation == text { self?.confirmation = nil }
        }
    }

    private func reset() {
        text = ""
        parsed = nil
        keepText = false
        dueDate = nil
        dueTime = nil
        priority = nil
    }
}

/// Quick Add items saved on the device while no engine could take them (JSON in Application Support). Never holds
/// anything from encrypted spaces' notes: only what the person typed into Quick Add.
@MainActor
@Observable
public final class QuickAddQueue {
    public struct Item: Codable, Equatable, Sendable, Identifiable {
        public var id: String
        public var kind: QuickAddModel.Mode
        public var text: String
        public var space: SpaceRef?
        public var noteId: String?
        public var folderId: String?
        public var dueDate: String?
        public var dueTime: String?
        public var priority: String?
        public var keepText: Bool?
        public var createdAt: Double
    }

    public private(set) var items: [Item] = []
    @ObservationIgnored let url: URL?

    /// `url`: where the queue lives; the default is Application Support/Folevi/quick-add-queue.json. Nil keeps it in
    /// memory only (tests, previews).
    public init(url: URL? = QuickAddQueue.defaultURL) {
        self.url = url
        if let url, let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode([Item].self, from: data) { items = saved }
    }

    public nonisolated static var defaultURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("Folevi/quick-add-queue.json")
    }

    public var count: Int { items.count }

    public func enqueue(_ item: Item) {
        items.append(item)
        save()
    }

    public func remove(_ id: String) {
        items.removeAll { $0.id == id }
        save()
    }

    private func save() {
        guard let url else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    }
}

extension QuickAddModel.Mode: Codable {}
