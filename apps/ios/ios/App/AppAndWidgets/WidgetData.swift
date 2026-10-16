// The widgets' copy of what they show: today's and overdue tasks and the recent notes, fetched with this
// device's token and kept in the App Group (widgets.json), so widgets draw offline and between refreshes.
// The widget extension refreshes it on its timeline (every 20 minutes or so); the app refreshes it when it
// goes to the background and reloads the widgets. A task checked off in a widget is marked done here at once
// and sent to Folevi (ToggleTaskIntent); one sent while offline waits in `pending` for the next refresh.
// Compiled into the app and the widget extension.
import Foundation
import WidgetKit

struct WidgetSnapshot: Codable, Equatable {
    enum State: String, Codable {
        /// No token on this device (never signed in, or signed out): "Open Folevi to sign in".
        case signedOut
        case ready
    }

    var state: State
    /// Open tasks due tomorrow or earlier, in the order widgets show them (tomorrow's are only for the large
    /// widgets' Tomorrow; everything else shows today's and overdue ones, `openTasks`).
    var tasks: [TaskItem]
    var notes: [NoteSummary]
    /// The day `tasks` was fetched for (YYYY-MM-DD, this device's time zone).
    var day: String
    var fetchedAt: Date
    /// Tasks checked off (or back on) in a widget and not yet sent: id to completed.
    var pending: [String: Bool] = [:]

    static let signedOut = WidgetSnapshot(state: .signedOut, tasks: [], notes: [], day: "", fetchedAt: .distantPast)

    /// Today's open tasks and overdue ones: one checked off in a widget drops out at once, before Folevi
    /// hears of it.
    var openTasks: [TaskItem] {
        tasks.filter { pending[$0.id] != true && !$0.done && ($0.dueDate ?? day) <= day }
    }

    /// The overdue ones of those, oldest first.
    var overdueTasks: [TaskItem] { openTasks.filter { ($0.dueDate ?? day) < day } }

    /// Those due today.
    var todayTasks: [TaskItem] { openTasks.filter { ($0.dueDate ?? day) >= day } }

    /// Open tasks due tomorrow (the large widgets show them when there's room).
    var tomorrowTasks: [TaskItem] {
        let tomorrow = DayFormat.next(day)
        return tasks.filter { pending[$0.id] != true && !$0.done && $0.dueDate == tomorrow }
    }

    func isOverdue(_ task: TaskItem, now: Date = Date()) -> Bool {
        guard let due = task.dueDate else { return false }
        return due < DayFormat.string(now)
    }

    /// Overdue first (oldest first), then by time of day (untimed last), then priority, then by name.
    static func ordered(_ tasks: [TaskItem], today: String) -> [TaskItem] {
        let rank = ["high": 0, "medium": 1, "low": 2]
        return tasks.sorted { a, b in
            let aOver = (a.dueDate ?? today) < today, bOver = (b.dueDate ?? today) < today
            if aOver != bOver { return aOver }
            // Overdue oldest first; otherwise today before tomorrow.
            if a.dueDate != b.dueDate { return (a.dueDate ?? today) < (b.dueDate ?? today) }
            switch (a.dueTime, b.dueTime) {
            case let (x?, y?) where x != y: return x < y
            case (.some, nil): return true
            case (nil, .some): return false
            default: break
            }
            let pa = rank[a.priority ?? ""] ?? 3, pb = rank[b.priority ?? ""] ?? 3
            if pa != pb { return pa < pb }
            return a.text.localizedCaseInsensitiveCompare(b.text) == .orderedAscending
        }
    }
}

/// Reads and refreshes the widgets' copy.
final class WidgetStore {
    static let shared = WidgetStore(file: Folevi.container.appendingPathComponent("widgets.json"))

    private let file: URL
    private let lock = NSLock()

    init(file: URL) {
        self.file = file
    }

    /// Refreshed at most this often by the widgets' timelines (the app's own refreshes always run).
    static let freshFor: TimeInterval = 10 * 60

    func load() -> WidgetSnapshot {
        lock.lock()
        defer { lock.unlock() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: file), let snapshot = try? decoder.decode(WidgetSnapshot.self, from: data) else { return .signedOut }
        return snapshot
    }

    func save(_ snapshot: WidgetSnapshot) {
        lock.lock()
        defer { lock.unlock() }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(snapshot).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: file)
    }

    /// Fetches tasks and notes again (first sending checks made offline). Signed out: the signed-out state.
    /// Offline: what was there, unchanged.
    @discardableResult
    func refresh(api: FoleviAPI? = SharedAccount.api(), now: Date = Date()) async -> WidgetSnapshot {
        guard let api else {
            let out = WidgetSnapshot.signedOut
            save(out)
            return out
        }
        var current = load()
        for (id, completed) in current.pending {
            do {
                try await api.setTask(id, completed: completed)
                current.pending[id] = nil
            } catch let failure as FoleviAPI.Failure where !failure.isTemporary {
                // Gone or not allowed any more: nothing to send.
                current.pending[id] = nil
            } catch {
                break
            }
        }
        let today = DayFormat.string(now)
        do {
            // Through tomorrow: the large widgets show tomorrow's when today leaves room.
            async let tasks = api.openTasks(dueBefore: DayFormat.next(today))
            async let notes = api.recentNotes(limit: 10)
            let fresh = WidgetSnapshot(state: .ready, tasks: WidgetSnapshot.ordered(try await tasks, today: today), notes: try await notes, day: today, fetchedAt: now, pending: current.pending)
            save(fresh)
            return fresh
        } catch FoleviAPI.Failure.signedOut {
            SharedAccount.forget()
            let out = WidgetSnapshot.signedOut
            save(out)
            return out
        } catch {
            save(current)
            return current
        }
    }

    /// A check in a widget: shown at once, then sent (kept in `pending` while it can't be).
    func setTask(_ id: String, completed: Bool, api: FoleviAPI? = SharedAccount.api()) async {
        var snapshot = load()
        snapshot.pending[id] = completed
        save(snapshot)
        guard let api else { return }
        do {
            try await api.setTask(id, completed: completed)
            snapshot = load()
            snapshot.pending[id] = nil
            if completed { snapshot.tasks.removeAll { $0.id == id } }
            save(snapshot)
        } catch let failure as FoleviAPI.Failure where !failure.isTemporary {
            snapshot = load()
            snapshot.pending[id] = nil
            save(snapshot)
        } catch {
            // Sent on the next refresh.
        }
    }
}

// MARK: Timelines

struct FoleviEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

/// One provider for every Folevi widget: the cached copy at once, refreshed when it's older than ten minutes,
/// and the next look about twenty minutes on (sooner at midnight, when today's tasks change).
struct FoleviTimelineProvider: TimelineProvider {
    var store: WidgetStore = .shared
    var api: () -> FoleviAPI? = { SharedAccount.api() }
    var now: () -> Date = Date.init

    func placeholder(in context: Context) -> FoleviEntry {
        FoleviEntry(date: now(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (FoleviEntry) -> Void) {
        if context.isPreview {
            let cached = store.load()
            return completion(FoleviEntry(date: now(), snapshot: cached.state == .ready ? cached : .sample))
        }
        completion(FoleviEntry(date: now(), snapshot: store.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FoleviEntry>) -> Void) {
        Task {
            completion(await timeline())
        }
    }

    func timeline() async -> Timeline<FoleviEntry> {
        let at = now()
        var snapshot = store.load()
        let stale = snapshot.state != .ready || at.timeIntervalSince(snapshot.fetchedAt) > WidgetStore.freshFor || snapshot.day != DayFormat.string(at)
        if stale || api() == nil { snapshot = await store.refresh(api: api(), now: at) }
        let next = min(at.addingTimeInterval(20 * 60), Calendar.current.startOfDay(for: at).addingTimeInterval(24 * 60 * 60 + 60))
        return Timeline(entries: [FoleviEntry(date: at, snapshot: snapshot)], policy: .after(next))
    }
}

extension WidgetSnapshot {
    /// What the widget gallery shows before anything is fetched.
    static var sample: WidgetSnapshot {
        let today = DayFormat.string(Date())
        let note = TaskItem.NoteRef(id: "01JAAAAAAAAAAAAAAAAAAAAAAA", title: "Inbox")
        return WidgetSnapshot(
            state: .ready,
            tasks: [
                TaskItem(id: "a", text: "Send the proposal", status: "open", dueDate: today, dueTime: "09:30", priority: "high", note: note, place: nil),
                TaskItem(id: "b", text: "Book the venue", status: "open", dueDate: today, dueTime: nil, priority: nil, note: note, place: nil),
                TaskItem(id: "c", text: "Water the plants", status: "open", dueDate: today, dueTime: nil, priority: nil, note: note, place: nil),
            ],
            notes: [
                NoteSummary(id: "01JBBBBBBBBBBBBBBBBBBBBBBB", title: "Weekly review", place: .init(id: "personal", name: "Personal"), updatedAt: ISO8601DateFormatter().string(from: Date()), url: nil),
                NoteSummary(id: "01JCCCCCCCCCCCCCCCCCCCCCCC", title: "Reading list", place: .init(id: "personal", name: "Personal"), updatedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600)), url: nil),
            ],
            day: today,
            fetchedAt: Date()
        )
    }
}

extension DayFormat {
    /// The day after a YYYY-MM-DD day, the same way ("2026-10-16" for "2026-10-15").
    static func next(_ day: String, calendar: Calendar = .current) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)),
              let after = calendar.date(byAdding: .day, value: 1, to: date) else { return day }
        return string(after, calendar: calendar)
    }
}
