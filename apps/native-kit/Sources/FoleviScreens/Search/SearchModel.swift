// Search's view model (plan 5.7; web app/CommandPalette.tsx, iphone/SearchScopes.tsx): what's typed, asked of the
// engine 120 ms after the last key (`search`, answered on the device for spaces with a full copy), with scopes (this
// space, everywhere, by meaning) and the web's filters (folder, tag, updated, archived). Results come by type: notes
// (with the matched text), notes found by meaning, folders and tasks. Before typing: recent searches and recent
// notes. Folders, tasks and titles already on the device answer at once, and stand in when the engine can't
// (offline, starting).
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

public enum SearchScope: String, CaseIterable, Sendable {
    case place, everywhere, meaning
}

public enum SearchUpdated: String, CaseIterable, Sendable {
    case week = "7", month = "30", year = "365"
    public var title: String {
        switch self {
        case .week: "Past week"
        case .month: "Past month"
        case .year: "Past year"
        }
    }
    public var days: Int { Int(rawValue) ?? 7 }
}

/// One result, as a row.
public enum SearchItem: Hashable, Sendable, Identifiable {
    case note(SearchHit)
    case recentNote(NoteRow)
    case folder(FolderNode)
    case task(TaskRow)
    case recentSearch(String)

    public var id: String {
        switch self {
        case .note(let h): "n:\(h.id):\(h.blockId ?? "")"
        case .recentNote(let r): "r:\(r.id)"
        case .folder(let f): "f:\(f.id)"
        case .task(let t): "t:\(t.id)"
        case .recentSearch(let s): "s:\(s)"
        }
    }
}

public struct SearchSection: Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var items: [SearchItem]
}

@MainActor
@Observable
public final class SearchModel {
    public let client: EngineClient
    let feedback: ScreenFeedback
    public let space: SpaceRef?
    public let session: ValueStore<SessionValue>
    public let home: ValueStore<HomeValue>
    public let tree: ValueStore<FoldersTreeValue>
    /// Open tasks, loaded the first time something is typed (task results).
    public private(set) var tasks: ValueStore<TasksValue>?

    public var text = "" { didSet { if text != oldValue { schedule() } } }
    public var scope: SearchScope = .place { didSet { if scope != oldValue { schedule(now: true) } } }
    public var folderId: String? { didSet { if folderId != oldValue { schedule(now: true) } } }
    public var tagId: String? { didSet { if tagId != oldValue { schedule(now: true) } } }
    public var updated: SearchUpdated? { didSet { if updated != oldValue { schedule(now: true) } } }
    public var includeArchived = false { didSet { if includeArchived != oldValue { schedule(now: true) } } }

    /// The engine's answer for `answeredText`.
    public private(set) var result: SearchValue?
    public private(set) var answeredText = ""
    public private(set) var searching = false
    /// The engine couldn't answer; results come from what's on the device.
    public private(set) var offline = false
    public private(set) var recentSearches: [String]
    /// The row the keyboard is on (iPad and Mac), as an index into `flatItems`.
    public var selection: Int?

    @ObservationIgnored public var debounce: Duration = .milliseconds(120)
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var lastHits: [String: SearchHit] = [:]
    static let recentKey = "folevi.search.recent"

    public init(client: EngineClient, text: String = "", space: SpaceRef? = nil, feedback: ScreenFeedback = ScreenFeedback(), defaults: UserDefaults = .standard) {
        self.client = client
        self.feedback = feedback
        self.space = space
        self.defaults = defaults
        self.recentSearches = defaults.stringArray(forKey: Self.recentKey) ?? []
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.home = client.watch(.home(space: space), snapshotKey: "home.\(client.place).\(space ?? "current")")
        self.tree = client.watch(.foldersTree(space: space))
        self.text = text
        if !text.isEmpty { schedule(now: true) }
    }

    // MARK: Scopes and filters

    public var spaceName: String {
        guard let s = session.value, let sp = s.spaces.first(where: { $0.id == (space ?? s.space) }) else { return home.value?.spaceName ?? "Personal" }
        return sp.name
    }

    /// Everywhere is offered when the place has more than one space.
    public var offersEverywhere: Bool { (session.value?.spaces.count ?? 1) > 1 }
    /// By meaning is offered where the plan has it (the engine says so with each answer; Foli AI on before that).
    public var offersMeaning: Bool { result?.meaningAvailable ?? (session.value?.capabilities.ai ?? false) }
    /// Folder and tag filters belong to one space.
    public var filtersAllowed: Bool { scope != .everywhere }
    public var prompt: String { scope == .everywhere ? "Search everywhere" : "Search in \(spaceName)" }

    public var folders: [FolderNode] { tree.value?.folders ?? [] }
    public var tags: [TagRow] { home.value?.tags ?? [] }
    public var folderName: String? { folderId.flatMap { id in folders.first { $0.id == id }?.name } }
    public var tagName: String? { tagId.flatMap { id in tags.first { $0.id == id }?.name } }
    public var hasFilters: Bool { folderId != nil || tagId != nil || updated != nil || includeArchived }

    public func clearFilters() {
        folderId = nil
        tagId = nil
        updated = nil
        includeArchived = false
    }

    // MARK: Asking the engine

    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    func schedule(now: Bool = false) {
        pending?.cancel()
        selection = nil
        let q = trimmed
        guard !q.isEmpty else {
            result = nil
            answeredText = ""
            searching = false
            offline = false
            return
        }
        if tasks == nil { tasks = client.watch(.tasksList(space: space, view: .all)) }
        searching = true
        pending = Task { [weak self] in
            guard let self else { return }
            if !now { try? await Task.sleep(for: self.debounce) }
            guard !Task.isCancelled else { return }
            await self.run(q)
        }
    }

    func run(_ q: String) async {
        let everywhere = scope == .everywhere
        let updatedAfter = updated.map { Int((ScreenClock.now().timeIntervalSince1970 - Double($0.days) * 86_400) / 3600) * 3600 * 1000 }
        do {
            let v = try await client.query(.search(
                text: q,
                scope: everywhere ? .everywhere : .place,
                space: everywhere ? nil : space,
                folderId: filtersAllowed ? folderId : nil,
                tagId: filtersAllowed ? tagId : nil,
                updatedAfter: updatedAfter,
                includeArchived: includeArchived ? true : nil,
                meaning: scope == .meaning ? true : nil,
                limit: 40
            ))
            guard !Task.isCancelled, q == trimmed else { return }
            result = v
            answeredText = q
            offline = false
            for h in v.hits { lastHits[h.id] = h }
        } catch is CancellationError {
            return
        } catch {
            guard q == trimmed else { return }
            offline = true
            result = nil
            answeredText = q
        }
        searching = false
    }

    // MARK: Results

    static func contains(_ s: String, _ q: String) -> Bool {
        s.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    /// Notes from the engine, or (when it can't answer) from earlier answers and recent notes on the device.
    var noteHits: [SearchHit] {
        let q = trimmed
        if let result, answeredText == q { return result.hits.filter { $0.matchIn != "meaning" } }
        guard offline else { return [] }
        var seen = Set<String>()
        var out: [SearchHit] = []
        for h in lastHits.values where Self.contains(h.title, q) || Self.contains(h.snippet, q) {
            if seen.insert(h.id).inserted { out.append(h) }
        }
        for r in home.value?.recents ?? [] where Self.contains(r.title, q) || Self.contains(r.excerpt, q) {
            if seen.insert(r.id).inserted {
                out.append(SearchHit(id: r.id, title: r.title, icon: nil, snippet: r.excerpt, folder: r.folder, updatedAt: r.updatedAt, archived: false, kind: r.kind, space: nil, spaceName: nil, matchIn: "text", blockId: nil, page: nil))
            }
        }
        return out.sorted { $0.updatedAt > $1.updatedAt }
    }

    var meaningHits: [SearchHit] {
        guard let result, answeredText == trimmed else { return [] }
        let found = Set(result.hits.filter { $0.matchIn != "meaning" }.map(\.id))
        return result.hits.filter { $0.matchIn == "meaning" && !found.contains($0.id) }
    }

    var folderHits: [FolderNode] {
        let q = trimmed
        guard !q.isEmpty, scope != .everywhere else { return [] }
        return Array(folders.filter { Self.contains($0.name, q) }.prefix(6))
    }

    var taskHits: [TaskRow] {
        let q = trimmed
        guard !q.isEmpty, scope != .everywhere, let groups = tasks?.value?.groups else { return [] }
        var out: [TaskRow] = []
        for g in groups {
            for t in g.tasks where Self.contains(t.title, q) {
                out.append(t)
                if out.count == 8 { return out }
            }
        }
        return out
    }

    /// The sections as drawn.
    public var sections: [SearchSection] {
        if trimmed.isEmpty {
            var out: [SearchSection] = []
            if !recentSearches.isEmpty { out.append(SearchSection(id: "recent-searches", title: "Recent searches", items: recentSearches.map { .recentSearch($0) })) }
            let recents = (home.value?.recents ?? []).prefix(8)
            if !recents.isEmpty { out.append(SearchSection(id: "recent-notes", title: "Recent notes", items: recents.map { .recentNote($0) })) }
            return out
        }
        var out: [SearchSection] = []
        let notes = noteHits
        if !notes.isEmpty { out.append(SearchSection(id: "notes", title: "Notes", items: notes.map { .note($0) })) }
        let meaning = meaningHits
        if !meaning.isEmpty { out.append(SearchSection(id: "meaning", title: "By meaning", items: meaning.map { .note($0) })) }
        let f = folderHits
        if !f.isEmpty { out.append(SearchSection(id: "folders", title: "Folders", items: f.map { .folder($0) })) }
        let t = taskHits
        if !t.isEmpty { out.append(SearchSection(id: "tasks", title: "Tasks", items: t.map { .task($0) })) }
        return out
    }

    public var flatItems: [SearchItem] { sections.flatMap(\.items) }

    /// Typed, answered, and nothing found.
    public var noResults: Bool { !trimmed.isEmpty && !searching && sections.isEmpty }

    // MARK: Keyboard

    public func moveSelection(_ by: Int) {
        let n = flatItems.count
        guard n > 0 else { return }
        if let s = selection { selection = min(max(0, s + by), n - 1) } else { selection = by > 0 ? 0 : n - 1 }
    }

    public var selectedItem: SearchItem? {
        guard let s = selection else { return nil }
        let items = flatItems
        return items.indices.contains(s) ? items[s] : nil
    }

    // MARK: Recent searches

    /// Remembers what was searched when a result is opened (newest first, at most 8).
    public func remember() {
        let q = trimmed
        guard q.count >= 2 else { return }
        recentSearches.removeAll { $0.caseInsensitiveCompare(q) == .orderedSame }
        recentSearches.insert(q, at: 0)
        recentSearches = Array(recentSearches.prefix(8))
        defaults.set(recentSearches, forKey: Self.recentKey)
    }

    public func forget(_ s: String) {
        recentSearches.removeAll { $0 == s }
        defaults.set(recentSearches, forKey: Self.recentKey)
    }

    public func clearRecents() {
        recentSearches = []
        defaults.set(recentSearches, forKey: Self.recentKey)
    }

    // MARK: Opening

    /// What opening an item does: a route or an intent for the frame (and filling the field for a recent search).
    public enum Action: Equatable, Sendable {
        case route(ScreenRoute)
        case intent(ScreenIntent)
        case fill(String)
    }

    public func action(for item: SearchItem) -> Action {
        switch item {
        case .recentSearch(let s): return .fill(s)
        case .recentNote(let r): return .route(.note(id: r.id))
        case .note(let h): return h.blockId != nil ? .intent(.openNote(id: h.id, blockId: h.blockId)) : .route(.note(id: h.id))
        case .folder(let f): return .route(.folder(id: f.id))
        case .task(let t): return .intent(.openNote(id: t.noteId, blockId: t.id))
        }
    }

    // MARK: Matches

    /// The snippet with every match of what's typed marked (bold, the heading colour).
    public static func highlighted(_ text: String, query: String) -> AttributedString {
        var out = AttributedString(text)
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init).filter { $0.count >= 1 }
        guard !words.isEmpty else { return out }
        for w in words {
            var searchStart = text.startIndex
            while searchStart < text.endIndex, let r = text.range(of: w, options: [.caseInsensitive, .diacriticInsensitive], range: searchStart..<text.endIndex) {
                if let lower = AttributedString.Index(r.lowerBound, within: out), let upper = AttributedString.Index(r.upperBound, within: out) {
                    out[lower..<upper].inlinePresentationIntent = .stronglyEmphasized
                    out[lower..<upper].foregroundColor = Folevi.color.heading
                }
                searchStart = r.upperBound
            }
        }
        return out
    }

    public func setVisible(_ visible: Bool) {
        home.setVisible(visible)
        tree.setVisible(visible)
        tasks?.setVisible(visible)
    }
}
