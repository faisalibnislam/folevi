// Tasks' view model (plan 5.8; web iphone/Tasks.tsx, views/TasksView.tsx): the views as chips with counts (Today,
// Inbox, Upcoming, All, Mine, Completed), the tasks grouped by note (Upcoming by day) with folding headers, a
// filter over what's loaded, checking off (the box ticks at once, the task leaves after a moment, Undo brings it
// back), swipe actions (Tomorrow, Date), and Quick Add with dates read by the engine (`task.parse`, `task.create`
// through the engine's outbox, so it works offline). Every value comes from the engine; the launch snapshot shows
// the last list at once.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

/// A task view chip: its title, short title and symbol (web CHIPS).
public struct TaskViewChip: Hashable, Sendable, Identifiable {
    public var id: TaskViewName
    public var title: String
    public var short: String
    public var symbol: String

    public static let all: [TaskViewChip] = [
        TaskViewChip(id: .today, title: "Today", short: "Today", symbol: "sun.max"),
        TaskViewChip(id: .inbox, title: "Inbox", short: "Inbox", symbol: "tray"),
        TaskViewChip(id: .upcoming, title: "Upcoming", short: "Upcoming", symbol: "calendar"),
        TaskViewChip(id: .all, title: "All tasks", short: "All", symbol: "checklist"),
        TaskViewChip(id: .mine, title: "My tasks", short: "Mine", symbol: "person"),
        TaskViewChip(id: .completed, title: "Completed", short: "Done", symbol: "checkmark.circle"),
    ]

    public static func chip(_ v: TaskViewName) -> TaskViewChip { all.first { $0.id == v }! }
}

/// A section of the list as drawn: a note or a day, folded or not.
public struct TaskSection: Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: TaskGroup.Kind
    /// The note's title or the day's name ("Tomorrow").
    public var title: String
    /// A day's date beside its name ("Saturday, Oct 24").
    public var detail: String?
    /// Tasks shown (none while folded).
    public var tasks: [TaskRow]
    /// All tasks of the group, folded or not.
    public var count: Int
    public var folded: Bool
}

/// A task typed in Quick Add that the engine hasn't confirmed yet.
public struct PendingTask: Hashable, Sendable, Identifiable {
    public enum State: Hashable, Sendable {
        case sending
        /// The engine wasn't ready (starting, reloading): sent again when it is.
        case waiting
        case failed(String)
    }
    public var id: UUID
    public var text: String
    public var dueDate: String?
    public var keepText: Bool
    public var state: State
}

@MainActor
@Observable
public final class TasksModel: TaskSheetHost {
    public let client: EngineClient
    let feedback: ScreenFeedback
    public let space: SpaceRef?
    public private(set) var view: TaskViewName
    public private(set) var list: ValueStore<TasksValue>
    public let counts: ValueStore<TaskCounts>
    public let session: ValueStore<SessionValue>
    /// Workspaces only: who tasks can be assigned to.
    public private(set) var members: ValueStore<MembersValue>?

    public var filter = ""
    public private(set) var folded: Set<String>
    /// Ticked boxes, moved dates and details changes shown before the engine confirms them.
    public let edits: TaskEdits
    public private(set) var pending: [PendingTask] = []
    /// The task whose details are open.
    public var detail: TaskRow?

    // Quick Add
    public var quickText = "" { didSet { if quickText != oldValue { scheduleParse() } } }
    public private(set) var parsed: TaskParseValue?
    /// The person tapped the date chip's x: the date words stay text.
    public var keepText = false

    @ObservationIgnored public var parseDelay: Duration = .milliseconds(150)
    @ObservationIgnored private var parseTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults

    public init(client: EngineClient, view: TaskViewName = .today, space: SpaceRef? = nil, feedback: ScreenFeedback = ScreenFeedback(), defaults: UserDefaults = .standard) {
        self.client = client
        self.feedback = feedback
        self.space = space
        self.view = view
        self.defaults = defaults
        self.folded = Set(defaults.stringArray(forKey: Self.foldKey) ?? [])
        self.list = client.watch(.tasksList(space: space, view: view), snapshotKey: Self.snapshotKey(client.place, space, view))
        self.counts = client.watch(.tasksCounts(space: space), snapshotKey: "tasks.counts.\(client.place).\(space ?? "current")")
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.edits = TaskEdits(client: client, feedback: feedback)
        edits.today = { [weak self] in self?.today ?? TaskDates.today() }
    }

    static let foldKey = "folevi.tasks.folded"
    static func snapshotKey(_ place: String, _ space: SpaceRef?, _ view: TaskViewName) -> String { "tasks.\(place).\(space ?? "current").\(view.rawValue)" }

    // MARK: The view

    public var chip: TaskViewChip { TaskViewChip.chip(view) }
    public var title: String { "Tasks" }

    public func select(_ next: TaskViewName) {
        guard next != view else { return }
        feedback.haptic(.selection)
        list.cancel()
        view = next
        list = client.watch(.tasksList(space: space, view: next), snapshotKey: Self.snapshotKey(client.place, space, next))
    }

    public func count(for v: TaskViewName) -> Int? {
        guard let c = counts.value else { return nil }
        let n: Int
        switch v {
        case .today: n = c.today
        case .inbox: n = c.inbox
        case .upcoming: n = c.upcoming
        case .all: n = c.all
        case .mine: n = c.mine
        case .completed: return nil
        }
        return n > 0 ? n : nil
    }

    public var today: String { session.value?.today ?? TaskDates.today(in: timeZone) }
    public var timeZone: TimeZone { session.value.flatMap { TimeZone(identifier: $0.timeZone) } ?? .current }

    public var currentSpace: SpaceInfo? {
        guard let s = session.value else { return nil }
        return s.spaces.first { $0.id == (space ?? s.space) }
    }

    public var inWorkspace: Bool { currentSpace?.kind == .workspace }
    public var canEdit: Bool { currentSpace?.canEdit ?? true }
    public var isLoading: Bool { list.value == nil }

    /// The engine's value for the view being shown (a snapshot of another view is never shown for this one).
    var value: TasksValue? {
        guard let v = list.value, v.view == view else { return nil }
        return v
    }

    /// Tasks loaded in the view (before the filter).
    public var total: Int { value?.total ?? 0 }

    /// The sections as drawn: filtered, with ticked and moved tasks as they are now.
    public var sections: [TaskSection] {
        guard let value else { return [] }
        let needle = filter.trimmingCharacters(in: .whitespaces)
        let today = self.today
        var out: [TaskSection] = []
        out.reserveCapacity(value.groups.count)
        for g in value.groups {
            var tasks: [TaskRow] = []
            tasks.reserveCapacity(g.tasks.count)
            for t in g.tasks where !edits.isGone(t.id) {
                if !needle.isEmpty && !Self.matches(t, needle) { continue }
                tasks.append(shown(t))
            }
            guard !tasks.isEmpty else { continue }
            let key = foldKey(g.id)
            let isFolded = folded.contains(key)
            var title = g.title.isEmpty ? (g.kind == .note ? "Untitled" : "No date") : g.title
            var detail: String?
            if g.kind == .day, TaskDates.isDay(g.id) {
                let h = TaskDates.dayHeading(g.id, today: today)
                title = h.name
                detail = h.date
            }
            out.append(TaskSection(id: g.id, kind: g.kind, title: title, detail: detail, tasks: isFolded ? [] : tasks, count: tasks.count, folded: isFolded))
        }
        return out
    }

    public var isEmpty: Bool { value != nil && sections.isEmpty }

    /// The empty screen's words (web TasksView's `empty` per view).
    public var emptyText: (title: String, message: String?) {
        if !filter.trimmingCharacters(in: .whitespaces).isEmpty { return ("No tasks match that filter", nil) }
        switch view {
        case .today: return ("Nothing due today", "Tasks due today and overdue ones show up here.")
        case .inbox: return ("Your Inbox is empty", "Tasks you add without a note land here.")
        case .upcoming: return ("Nothing coming up", "Tasks with a date show up here by day.")
        case .all: return ("No open tasks", "Add a to-do to any note, or use Quick Add.")
        case .mine: return ("Nothing assigned to you", "Tasks assigned to you in this workspace show up here.")
        case .completed: return ("No completed tasks yet", nil)
        }
    }

    static func matches(_ t: TaskRow, _ needle: String) -> Bool {
        t.title.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
            || t.noteTitle.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    /// A task as it is now (with changes made here that the engine hasn't confirmed yet).
    public func shown(_ t: TaskRow) -> TaskRow { edits.shown(t) }

    // MARK: Folding

    func foldKey(_ group: String) -> String { "\(view.rawValue):\(group)" }

    public func isFolded(_ group: String) -> Bool { folded.contains(foldKey(group)) }

    public func toggleFold(_ group: String) {
        let key = foldKey(group)
        if folded.contains(key) { folded.remove(key) } else { folded.insert(key) }
        defaults.set(Array(folded).sorted(), forKey: Self.foldKey)
        feedback.haptic(.selection)
    }

    // MARK: Checking off

    /// The box: an open task ticks at once and leaves after a moment (with Undo); a done or canceled one reopens.
    public func toggle(_ task: TaskRow) {
        let view = self.view
        edits.toggle(task) { status in status == "done" ? view != .completed : view == .completed }
    }

    // MARK: Dates

    /// Swipe left, Tomorrow (web `moveTo`): with Undo.
    public func moveToTomorrow(_ task: TaskRow) async {
        let day = TaskDates.add(today, days: 1)
        await edits.setDue(task, date: day, message: "Moved to tomorrow", leaves: leavesView(dueDate: day))
    }

    /// Sets the due date (and time); nil clears it. With a toast and Undo when `message` is given.
    public func setDue(_ task: TaskRow, date: String?, time: PatchField<String> = .keep, message: String? = nil) async {
        await edits.setDue(task, date: date, time: time, message: message, leaves: leavesView(dueDate: date))
    }

    /// Today shows what's due today or before; moving a task later takes it out of Today at once.
    func leavesView(dueDate: String?) -> Bool {
        switch view {
        case .today: return dueDate.map { $0 > today } ?? true
        case .upcoming: return dueDate == nil
        default: return false
        }
    }

    // MARK: Details

    public func open(_ task: TaskRow) {
        detail = shown(task)
        if inWorkspace, members == nil { members = client.watch(.members(space: space)) }
    }

    /// The people tasks can go to: the workspace's members, or just you in Personal.
    public var assignees: [MemberRow] {
        if let m = members?.value?.members { return m }
        guard let s = session.value else { return [] }
        return [MemberRow(id: s.profile.id, name: s.profile.name, email: s.profile.email, role: "owner", isYou: true)]
    }

    public func latest(_ id: String) -> TaskRow? { value?.groups.lazy.flatMap(\.tasks).first { $0.id == id } }

    // MARK: Quick Add

    func scheduleParse() {
        parseTask?.cancel()
        keepText = false
        let text = quickText.trimmingCharacters(in: .whitespaces)
        guard text.count >= 3 else {
            parsed = nil
            return
        }
        parseTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: self.parseDelay)
            guard !Task.isCancelled else { return }
            let value = try? await self.client.query(.taskParse(text: text))
            guard !Task.isCancelled, self.quickText.trimmingCharacters(in: .whitespaces) == text else { return }
            self.parsed = value
        }
    }

    /// The chip under the field: "Due tomorrow 15:00", from what the engine read.
    public var parsedDueLabel: String? {
        guard !keepText, let p = parsed, let d = p.dueDate else { return nil }
        let day = TaskDates.dueLabel(d, today: today)
        let words = ["Today", "Tomorrow", "Yesterday"].contains(day) ? day.lowercased() : day
        return "Due \(words)\(p.dueTime.map { " \(TaskDates.timeLabel($0))" } ?? "")"
    }

    public var parsedRepeatLabel: String? {
        guard !keepText, let p = parsed else { return nil }
        return p.repeatLabel
    }

    /// Adds what's typed. On Today a task without a date is due today (it would vanish otherwise).
    public func add() async {
        let text = quickText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let readsDate = !keepText && parsed?.dueDate != nil
        let due: String? = (view == .today && !readsDate) ? today : nil
        let item = PendingTask(id: UUID(), text: text, dueDate: due, keepText: keepText, state: .sending)
        pending.append(item)
        quickText = ""
        parsed = nil
        keepText = false
        await send(item)
    }

    func send(_ item: PendingTask) async {
        set(item.id, .sending)
        do {
            let r = try await client.command(.taskCreate(text: item.text, space: space, dueDate: item.dueDate, keepText: item.keepText ? true : nil))
            pending.removeAll { $0.id == item.id }
            feedback.haptic(.success)
            feedback.toast(ScreenToast("Task added to \(r.where)", tone: .success))
        } catch let failure as EngineFailure where failure.isRetryable {
            set(item.id, .waiting)
        } catch {
            set(item.id, .failed(ScreenErrors.message(error)))
            feedback.haptic(.error)
        }
    }

    private func set(_ id: UUID, _ state: PendingTask.State) {
        if let i = pending.firstIndex(where: { $0.id == id }) { pending[i].state = state }
    }

    /// Sends again what waited for the engine (on appear, after `engine.ready`), or one that failed.
    public func retry(_ id: UUID? = nil) async {
        for item in pending where id == nil ? item.state == .waiting : item.id == id {
            await send(item)
        }
    }

    public func discard(_ id: UUID) { pending.removeAll { $0.id == id } }

    // MARK: Lifecycle

    public func refresh() async {
        do { try await client.command(.engineRefresh) } catch { fail(error) }
    }

    public func setVisible(_ visible: Bool) {
        list.setVisible(visible)
        counts.setVisible(visible)
        if visible { Task { await retry() } }
    }

    /// The engine's value replaced what was shown here: drop changes it now agrees with.
    public func reconcile() {
        guard let value else { return }
        edits.reconcile(value.groups.lazy.flatMap(\.tasks))
    }

    func fail(_ error: any Error) {
        feedback.haptic(.error)
        feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
    }
}
