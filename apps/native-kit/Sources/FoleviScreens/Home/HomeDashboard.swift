// Home's redesign (the owner's design version 19; web HomeDashboard.tsx, HomeBlocks.tsx, HomeStats.tsx and
// lib/app/homeLayout.ts): the blocks a person can move, take off Home and add back, laid over their saved layout
// (homePrefs, the engine's `home.prefs` and `home.setLayout`); At a glance (`home.stats`); Today (`calendars.events`
// and the open tasks); My tasks (`tasks.list` All); Foli DNA of the week (`graph`); and the capture field, which
// saves a note where it says (`note.create`). Shared by the Mac and iPad Home (WebHomeScreen) and the iPhone's.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

// MARK: The blocks (homeLayout.ts)

public enum HomeBlockId: String, CaseIterable, Hashable, Sendable {
    case recent, bookmarks, folders, stats, dna, today, tasks, shared, pinned, templates

    public var label: String {
        switch self {
        case .recent: "Recent notes"
        case .bookmarks: "Bookmarks"
        case .folders: "Recent folders"
        case .stats: "At a glance"
        case .dna: "Foli DNA"
        case .today: "Today"
        case .tasks: "My tasks"
        case .shared: "Shared with me"
        case .pinned: "Pinned note"
        case .templates: "Templates"
        }
    }

    /// Off until the person adds it (Customize, Add a block).
    public var hiddenByDefault: Bool { self == .shared || self == .pinned || self == .templates }

    public enum Pair: Sendable { case main, side }
    /// Shares a row with the paired blocks next to it: main ones in the left column (1fr), side ones in the right
    /// (1.15fr). At a glance beside Foli DNA, Today beside My tasks.
    public var pair: Pair? {
        switch self {
        case .stats, .today: .main
        case .dna, .tasks: .side
        default: nil
        }
    }
}

public struct HomeArranged: Hashable, Sendable {
    public var block: HomeBlockId
    public var hidden: Bool
}

public enum HomeRowLayout: Hashable, Sendable {
    case one(HomeBlockId)
    case pair(main: [HomeBlockId], side: [HomeBlockId])
}

public enum HomeBlocks {

    /// The blocks in this person's order with whether each is hidden (arrangeHome): unknown ids are dropped; blocks
    /// the saved order doesn't name go in at their default place, shown or hidden as their default says.
    public static func arrange(_ saved: HomeLayout?) -> [HomeArranged] {
        let named = Set(saved?.order ?? [])
        let hidden = Set(saved?.hidden ?? [])
        var order: [HomeBlockId] = []
        for id in saved?.order ?? [] { if let b = HomeBlockId(rawValue: id), !order.contains(b) { order.append(b) } }
        let all = HomeBlockId.allCases
        for (def, b) in all.enumerated() where !order.contains(b) {
            var at = 0
            for i in stride(from: def - 1, through: 0, by: -1) {
                if let prev = order.firstIndex(of: all[i]) { at = prev + 1; break }
            }
            order.insert(b, at: at)
        }
        return order.map { HomeArranged(block: $0, hidden: hidden.contains($0.rawValue) || (!named.contains($0.rawValue) && $0.hiddenByDefault)) }
    }

    static func layout(_ rows: [HomeArranged]) -> HomeLayout {
        HomeLayout(order: rows.map(\.block.rawValue), hidden: rows.filter(\.hidden).map(\.block.rawValue))
    }

    /// Home's rows (homeRows): a block on its own, or a run of paired blocks in two columns. A run without both
    /// kinds is drawn one block per row.
    public static func rows(_ shown: [HomeBlockId]) -> [HomeRowLayout] {
        var rows: [HomeRowLayout] = []
        var run: [HomeBlockId] = []
        func flush() {
            let main = run.filter { $0.pair == .main }, side = run.filter { $0.pair == .side }
            if !main.isEmpty && !side.isEmpty { rows.append(.pair(main: main, side: side)) } else { rows += run.map(HomeRowLayout.one) }
            run = []
        }
        for b in shown {
            if b.pair == .main && run.contains(where: { $0.pair == .side }) { flush() }
            if b.pair != nil { run.append(b) } else { flush(); rows.append(.one(b)) }
        }
        flush()
        return rows
    }

    /// The layout after moving `id` one place earlier (-1) or later (+1) among the shown blocks.
    public static func move(_ saved: HomeLayout?, _ id: HomeBlockId, by dir: Int) -> HomeLayout {
        var rows = arrange(saved)
        let shown = rows.filter { !$0.hidden }.map(\.block)
        if let i = shown.firstIndex(of: id), shown.indices.contains(i + dir),
           let a = rows.firstIndex(where: { $0.block == id }), let b = rows.firstIndex(where: { $0.block == shown[i + dir] }) {
            rows.swapAt(a, b)
        }
        return layout(rows)
    }

    /// The layout after showing or hiding `id` (a block shown again goes to the end).
    public static func setHidden(_ saved: HomeLayout?, _ id: HomeBlockId, _ hide: Bool) -> HomeLayout {
        var rows = arrange(saved).map { $0.block == id ? HomeArranged(block: $0.block, hidden: hide) : $0 }
        if !hide, let row = rows.first(where: { $0.block == id }) {
            rows = rows.filter { $0.block != id } + [row]
        }
        return layout(rows)
    }
}

// MARK: Words and numbers

public enum HomeWords {
    /// "Good morning" / "Good afternoon" / "Good evening" for an hour of the day (greetingFor).
    public static func greeting(hour: Int) -> String {
        if hour < 5 { return "Good evening" }
        if hour < 12 { return "Good morning" }
        if hour < 18 { return "Good afternoon" }
        return "Good evening"
    }

    /// "Good morning, Faisal" (the first name only).
    public static func greeting(hour: Int, name: String) -> String {
        let first = name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        return greeting(hour: hour) + (first.isEmpty ? "" : ", \(first)")
    }

    /// Words read a minute (HomeStats.tsx READ_WPM).
    public static let readWpm = 238

    /// "≈ 52 min of reading", "≈ 3 h of reading", "under a minute of reading".
    public static func readingTime(_ words: Int) -> String {
        let min = Int((Double(words) / Double(readWpm)).rounded())
        if min < 1 { return "under a minute of reading" }
        if min < 60 { return "≈ \(min) min of reading" }
        let h = (Double(min) / 6).rounded() / 10
        return "≈ \(h.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(h)) : String(format: "%.1f", h)) h of reading"
    }

    /// 980 as is; 12,400 as "12.4K".
    public static func stat(_ n: Int) -> String {
        n < 10_000 ? n.formatted() : n.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }

    public static func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n.formatted()) \(n == 1 ? one : many)" }

    /// The Today card's tag on the first event still to come: "Now" while it's on, "Up next · in 25 min" (or "in 2 h",
    /// "in 1 h 10 min") before it starts (upNextTag). `at`, `end` and `now` in ms.
    public static func upNextTag(at: Int?, end: Int?, now: Int) -> String? {
        guard let at else { return nil }
        if at <= now { return end.map { $0 > now } == true ? "Now" : nil }
        let min = max(1, Int((Double(at - now) / 60_000).rounded()))
        if min < 60 { return "Up next · in \(min) min" }
        let h = min / 60, m = min % 60
        return "Up next · in \(h) h\(m > 0 ? " \(m) min" : "")"
    }
}

// MARK: Today and Foli DNA

public struct HomeAgendaItem: Hashable, Sendable, Identifiable {
    public var id: String
    /// ms, nil for an all-day event.
    public var at: Int?
    public var end: Int?
    public var time: String
    public var title: String
    public var meta: String
    public var color: String
}

public struct HomeDnaWeek: Hashable, Sendable {
    public var count: Int
    public var hub: GraphNode?
    public var around: [GraphNode]

    /// Where the linked notes sit around the hub, as a share of the map (x, y), as the web's RING.
    public static let ring: [(Double, Double)] = [(0.20, 0.25), (0.80, 0.24), (0.24, 0.78), (0.77, 0.77), (0.50, 0.86), (0.50, 0.14)]

    /// The note with the most links made this week in the middle, the notes it's linked with around it (DnaWeek). A
    /// week without new links shows the most linked notes of all, so the map isn't empty most weeks.
    public static func of(_ graph: GraphValue, now: Date) -> HomeDnaWeek {
        let since = now.timeIntervalSince1970 * 1000 - 7 * 86_400_000
        let notes = Dictionary(graph.nodes.filter { $0.kind == "note" }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let between = graph.edges.filter { notes[$0.source] != nil && notes[$0.target] != nil }
        let thisWeek = between.filter { ($0.createdAt ?? 0) >= since }
        let edges = thisWeek.isEmpty ? between : thisWeek
        var degree: [String: Int] = [:]
        var firstSeen: [String: Int] = [:]
        for (i, e) in edges.enumerated() {
            for id in [e.source, e.target] {
                degree[id, default: 0] += 1
                if firstSeen[id] == nil { firstSeen[id] = i }
            }
        }
        let hubId = degree.max { a, b in a.value != b.value ? a.value < b.value : (firstSeen[a.key] ?? 0) > (firstSeen[b.key] ?? 0) }?.key
        guard let hubId, let hub = notes[hubId] else { return HomeDnaWeek(count: thisWeek.count, hub: nil, around: []) }
        var seen = Set<String>()
        var around: [GraphNode] = []
        for e in edges {
            let other = e.source == hubId ? e.target : e.target == hubId ? e.source : nil
            if let other, other != hubId, seen.insert(other).inserted, let n = notes[other] { around.append(n) }
        }
        return HomeDnaWeek(count: thisWeek.count, hub: hub, around: Array(around.prefix(ring.count)))
    }
}

/// Where a capture saves: a space and a folder in it (nil: its Drafts).
public struct HomeCaptureDest: Codable, Hashable, Sendable {
    public var space: SpaceRef
    public var folderId: String?
    public init(space: SpaceRef, folderId: String?) {
        self.space = space
        self.folderId = folderId
    }
}

// MARK: The model

@MainActor
@Observable
public final class HomeDashboardModel {
    public let client: EngineClient
    public let feedback: ScreenFeedback
    public let space: SpaceRef?
    public let stats: ValueStore<HomeStatsValue>
    public let prefs: ValueStore<HomePrefsValue>
    public let events: ValueStore<CalendarEventsValue>
    public let session: ValueStore<SessionValue>
    /// My tasks and Today's due line: the Tasks page's All (open tasks, soonest due first), ticked off here.
    public let tasks: TasksModel
    /// Foli DNA's map, watched once its block is on screen (`loadGraph`).
    public private(set) var graph: ValueStore<GraphValue>?
    /// Customize mode.
    public var editing = false
    /// A layout saved here, shown until the engine's `home.prefs` has it.
    private var pendingLayout: HomeLayout?
    private var hasPending = false
    /// Folders of the other spaces, for the capture field's picker (watched while it's open).
    public private(set) var spaceFolders: [SpaceRef: ValueStore<FoldersTreeValue>] = [:]
    public private(set) var dest: HomeCaptureDest?
    public private(set) var saving = false
    /// Opens a note the capture just made (the toast's Open); the screen sets it.
    @ObservationIgnored public var openNote: (@MainActor (String) -> Void)?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let destKey: String

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback(), space: SpaceRef? = nil, defaults: UserDefaults = .standard) {
        self.client = client
        self.feedback = feedback
        self.space = space
        self.defaults = defaults
        let now = ScreenClock.now()
        let start = Calendar.current.startOfDay(for: now)
        let startMs = Int(start.timeIntervalSince1970 * 1000)
        let place = client.place
        self.stats = client.watch(.homeStats(space: space, todayStart: startMs), snapshotKey: "home.stats.\(place).\(space ?? "current")")
        self.prefs = client.watch(.homePrefs, snapshotKey: "home.prefs.\(place)")
        self.events = client.watch(.calendarsEvents(from: startMs, to: startMs + 86_400_000))
        self.session = client.watch(.session, snapshotKey: "session.\(place)")
        self.tasks = TasksModel(client: client, view: .all, space: space, feedback: feedback, defaults: defaults)
        self.destKey = "folevi.home.captureTo.\(place)"
        if let data = defaults.data(forKey: destKey), let d = try? JSONDecoder().decode(HomeCaptureDest.self, from: data) { dest = d }
    }

    // MARK: Layout

    public var layout: HomeLayout? { hasPending ? pendingLayout : prefs.value?.layout }
    public var arranged: [HomeArranged] { HomeBlocks.arrange(layout) }
    public var shown: [HomeBlockId] { arranged.filter { !$0.hidden }.map(\.block) }
    public var hiddenBlocks: [HomeBlockId] { arranged.filter(\.hidden).map(\.block) }
    public var rows: [HomeRowLayout] { HomeBlocks.rows(shown) }

    public func isFirst(_ id: HomeBlockId) -> Bool { shown.first == id }
    public func isLast(_ id: HomeBlockId) -> Bool { shown.last == id }

    public func move(_ id: HomeBlockId, by dir: Int) { save(HomeBlocks.move(layout, id, by: dir)) }
    public func hide(_ id: HomeBlockId) { save(HomeBlocks.setHidden(layout, id, true)) }
    public func show(_ id: HomeBlockId) { save(HomeBlocks.setHidden(layout, id, false)) }
    /// Reset: Home's default blocks and order (homePrefs.setLayout(null)).
    public func reset() { save(nil) }

    private func save(_ next: HomeLayout?) {
        feedback.haptic(.selection)
        pendingLayout = next
        hasPending = true
        Task {
            do {
                try await client.command(.homeSetLayout(layout: next))
                // Shown as saved until the view has it (a short wait at most).
                for _ in 0..<20 where prefs.value?.layout != next && pendingLayout == next { try? await Task.sleep(for: .milliseconds(100)) }
                if pendingLayout == next { hasPending = false }
            } catch {
                if pendingLayout == next { hasPending = false }
                feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
            }
        }
    }

    public var pinnedNote: String? { prefs.value?.pinnedNote }

    public func pin(_ noteId: String?) async {
        do { try await client.command(.homeSetPinnedNote(noteId: noteId)) } catch { feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error)) }
    }

    // MARK: Today and My tasks

    public var today: String { tasks.today }

    /// The open tasks, soonest due first (the Tasks page's All), with changes made here.
    public var openTasks: [TaskRow]? {
        guard let v = tasks.list.value else { return nil }
        return v.groups.flatMap(\.tasks).filter { !tasks.edits.isGone($0.id) && $0.status == "open" }.sorted { a, b in
            let ad = a.dueDate ?? "9999", bd = b.dueDate ?? "9999"
            if ad != bd { return ad < bd }
            return (a.dueTime ?? "99") < (b.dueTime ?? "99")
        }
    }

    /// Open tasks due today or earlier (the Today card's footer).
    public var dueCount: Int { (openTasks ?? []).filter { ($0.dueDate ?? "~") <= today }.count }

    /// Today's events that haven't ended, all-day ones first, then by time (upNext's events), five at most.
    public func agenda(now: Date, time: (Date) -> String) -> [HomeAgendaItem]? {
        guard let v = events.value else { return events.error != nil ? [] : nil }
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let items = v.events.filter { $0.allDay || $0.end > nowMs }.map { e in
            HomeAgendaItem(id: e.id, at: e.allDay ? nil : e.start, end: e.end, time: e.allDay ? "All day" : time(Date(timeIntervalSince1970: Double(e.start) / 1000)),
                           title: e.title.isEmpty ? "Untitled event" : e.title, meta: [e.location, e.calendarName].filter { !$0.isEmpty }.joined(separator: " · "), color: e.color)
        }
        return Array(items.sorted { a, b in
            if (a.at == nil) != (b.at == nil) { return a.at == nil }
            return (a.at ?? 0) < (b.at ?? 0)
        }.prefix(5))
    }

    // MARK: Foli DNA

    public func loadGraph() {
        guard graph == nil else { return }
        graph = client.watch(.graph(space: space))
    }

    public func dnaWeek(now: Date) -> HomeDnaWeek? { graph?.value.map { HomeDnaWeek.of($0, now: now) } }

    // MARK: Capture

    public var spaces: [SpaceInfo] { session.value?.spaces ?? [] }
    public var currentSpace: SpaceRef? { space ?? session.value?.space }

    /// Where the next capture saves: the remembered place while its space is still there, else this space's Drafts.
    public var where_: HomeCaptureDest? {
        if let dest, spaces.contains(where: { $0.id == dest.space }) { return dest }
        return currentSpace.map { HomeCaptureDest(space: $0, folderId: nil) }
    }

    public func folders(in space: SpaceRef) -> [FolderNode] { spaceFolders[space]?.value?.folders ?? [] }

    /// The picker opened: watch every space's folders.
    public func loadFolders() {
        for s in spaces where spaceFolders[s.id] == nil { spaceFolders[s.id] = client.watch(.foldersTree(space: s.id)) }
    }

    /// "Drafts", "Ideas", or "Studio › Drafts" when there's more than one space.
    public var destLabel: String {
        guard let w = where_ else { return "Drafts" }
        let folder = w.folderId.flatMap { id in folders(in: w.space).first { $0.id == id } }
        let name = spaces.first { $0.id == w.space }?.name ?? "Personal"
        return (spaces.count > 1 ? "\(name) › " : "") + (folder?.name ?? "Drafts")
    }

    public func pick(_ d: HomeCaptureDest) {
        dest = d
        if let data = try? JSONEncoder().encode(d) { defaults.set(data, forKey: destKey) }
    }

    /// Save: a note of the text (its first line the title) where it says; the toast offers Open.
    @discardableResult
    public func capture(_ text: String) async -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !saving else { return false }
        saving = true
        defer { saving = false }
        let w = where_
        let folderId = w?.folderId.flatMap { id in folders(in: w!.space).contains { $0.id == id } || spaceFolders[w!.space] == nil ? id : nil }
        do {
            let r = try await client.command(.noteCreate(space: w?.space, folderId: folderId, open: false, text: value))
            let open = openNote
            feedback.toast(ScreenToast("Saved to \(destLabel)", tone: .success, actionTitle: "Open", action: { open?(r.id) }))
            return true
        } catch {
            feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
            return false
        }
    }

    /// The capture field's task button: the first line becomes a task in that space.
    @discardableResult
    public func addTask(_ text: String) async -> Bool {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").first.map(String.init) ?? ""
        guard !line.isEmpty, !saving else { return false }
        saving = true
        defer { saving = false }
        do {
            _ = try await client.command(.taskCreate(text: String(line.prefix(500)), space: where_?.space))
            feedback.toast(ScreenToast("Task added", tone: .success))
            return true
        } catch {
            feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
            return false
        }
    }

    public func setVisible(_ visible: Bool) {
        stats.setVisible(visible)
        prefs.setVisible(visible)
        events.setVisible(visible)
        graph?.setVisible(visible)
    }
}
