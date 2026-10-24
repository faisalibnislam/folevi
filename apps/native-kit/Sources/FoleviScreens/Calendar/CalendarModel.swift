// The Calendar's view model (plan 5.8, owner decision D4; web views/CalendarView.tsx, iphone/Agenda.tsx,
// iphone/WeekStrip.tsx): the picked day, the layout (the agenda with the week strip on iPhone; Month and Week on
// iPad and Mac), tasks with due dates (`tasks.range`) and events from subscribed calendars (`calendars.events`)
// over the days shown, overdue tasks first on today, adding a task on a day, rescheduling by drag (with Undo), and
// the subscriptions (`calendars.list`, `calendar.add/update/remove/refresh`).
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

public enum CalendarLayout: String, CaseIterable, Sendable {
    case agenda, week, month
    public var title: String {
        switch self {
        case .agenda: "Agenda"
        case .week: "Week"
        case .month: "Month"
        }
    }
}

/// An event placed on a day: its time on that day (minutes), or all day.
public struct PlacedEvent: Hashable, Sendable, Identifiable {
    public var event: CalendarEvent
    public var day: String
    /// All day, or a day in the middle of a longer event.
    public var allDay: Bool
    public var startMinute: Int
    public var endMinute: Int
    public var id: String { "\(event.id)@\(day)" }
}

/// One day of the agenda: its tasks (overdue ones first on today) and events.
public struct AgendaDay: Hashable, Sendable, Identifiable {
    public var day: String
    public var overdue: [TaskRow]
    public var tasks: [TaskRow]
    public var events: [PlacedEvent]
    public var id: String { day }
    public var isEmpty: Bool { overdue.isEmpty && tasks.isEmpty && events.isEmpty }
}

@MainActor
@Observable
public final class CalendarModel: TaskSheetHost {
    public let client: EngineClient
    let feedback: ScreenFeedback
    public let space: SpaceRef?
    public let session: ValueStore<SessionValue>
    public private(set) var tasks: ValueStore<TasksRangeValue>
    public private(set) var events: ValueStore<CalendarEventsValue>
    /// Today's list, for the overdue tasks shown first on today.
    public let todayList: ValueStore<TasksValue>
    /// Opened with the subscriptions sheet.
    public private(set) var calendars: ValueStore<CalendarsValue>?
    public private(set) var members: ValueStore<MembersValue>?
    public let edits: TaskEdits

    public private(set) var selected: String
    /// The layout picked on this device; nil until picked (the screen uses the agenda when compact, else Month).
    public private(set) var chosenLayout: CalendarLayout?
    /// The task whose details are open.
    public var detail: TaskRow?
    /// The event whose details are open.
    public var openEvent: CalendarEvent?
    /// The day "Add a task" is open for.
    public var addingOn: String?
    public var showsCalendars = false

    /// Days fetched (both included).
    public private(set) var range: (from: String, to: String)
    @ObservationIgnored private let defaults: UserDefaults
    static let layoutKey = "folevi.calendar.layout"

    public init(client: EngineClient, date: String? = nil, space: SpaceRef? = nil, feedback: ScreenFeedback = ScreenFeedback(), defaults: UserDefaults = .standard) {
        self.client = client
        self.feedback = feedback
        self.space = space
        self.defaults = defaults
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        let tz = session.value.flatMap { TimeZone(identifier: $0.timeZone) } ?? .current
        let today = session.value?.today ?? TaskDates.today(in: tz)
        let start = date ?? today
        self.selected = start
        self.chosenLayout = defaults.string(forKey: Self.layoutKey).flatMap(CalendarLayout.init(rawValue:))
        let r = Self.range(for: start)
        self.range = r
        self.tasks = client.watch(.tasksRange(space: space, from: r.from, to: r.to), snapshotKey: "calendar.tasks.\(client.place).\(space ?? "current")")
        self.events = client.watch(.calendarsEvents(from: TaskDates.ms(day: r.from, timeZone: tz), to: TaskDates.ms(day: TaskDates.add(r.to, days: 1), timeZone: tz)), snapshotKey: "calendar.events.\(client.place)")
        self.todayList = client.watch(.tasksList(space: space, view: .today), snapshotKey: TasksModel.snapshotKey(client.place, space, .today))
        self.edits = TaskEdits(client: client, feedback: feedback)
        edits.today = { [weak self] in self?.today ?? TaskDates.today() }
    }

    /// The month grid around a day plus 30 days after it (the agenda), as whole weeks.
    static func range(for day: String) -> (from: String, to: String) {
        let rows = TaskDates.monthRows(day)
        let from = rows.first?.first ?? TaskDates.startOfWeek(day)
        let gridEnd = rows.last?.last ?? TaskDates.add(day, days: 41)
        let agendaEnd = TaskDates.add(day, days: 30)
        return (from, max(gridEnd, agendaEnd))
    }

    // MARK: Session

    public var today: String { session.value?.today ?? TaskDates.today(in: timeZone) }
    public var timeZone: TimeZone { session.value.flatMap { TimeZone(identifier: $0.timeZone) } ?? .current }
    public var currentSpace: SpaceInfo? {
        guard let s = session.value else { return nil }
        return s.spaces.first { $0.id == (space ?? s.space) }
    }
    public var canEdit: Bool { currentSpace?.canEdit ?? true }
    public var inWorkspace: Bool { currentSpace?.kind == .workspace }

    public var assignees: [MemberRow] {
        if let m = members?.value?.members { return m }
        guard let s = session.value else { return [] }
        return [MemberRow(id: s.profile.id, name: s.profile.name, email: s.profile.email, role: "owner", isYou: true)]
    }

    public func latest(_ id: String) -> TaskRow? {
        tasks.value?.tasks.first { $0.id == id } ?? todayList.value?.groups.lazy.flatMap(\.tasks).first { $0.id == id }
    }

    // MARK: Layout and the picked day

    public func layout(compact: Bool) -> CalendarLayout {
        if compact { return chosenLayout == .month ? .month : (chosenLayout == .week ? .week : .agenda) }
        return chosenLayout ?? .month
    }

    public func choose(_ layout: CalendarLayout) {
        chosenLayout = layout
        defaults.set(layout.rawValue, forKey: Self.layoutKey)
        feedback.haptic(.selection)
    }

    /// The Calendar's title: the picked day's month ("October", "January 2027").
    public var title: String { TaskDates.monthTitle(selected, today: today) }

    public func select(_ day: String) {
        guard day != selected, TaskDates.isDay(day) else { return }
        selected = day
        let r = Self.range(for: day)
        if day < range.from || TaskDates.add(day, days: 30) > range.to || r.from < range.from { refetch(r) }
    }

    public func goToday() {
        feedback.haptic(.selection)
        select(today)
    }

    /// Next or previous page: a week, a month, or (agenda) a week.
    public func page(_ by: Int, layout: CalendarLayout) {
        switch layout {
        case .month: select(TaskDates.addMonths(selected, by))
        case .week, .agenda: select(TaskDates.add(selected, days: 7 * by))
        }
    }

    func refetch(_ r: (from: String, to: String)) {
        range = r
        tasks.cancel()
        events.cancel()
        tasks = client.watch(.tasksRange(space: space, from: r.from, to: r.to))
        events = client.watch(.calendarsEvents(from: TaskDates.ms(day: r.from, timeZone: timeZone), to: TaskDates.ms(day: TaskDates.add(r.to, days: 1), timeZone: timeZone)))
    }

    // MARK: What's on each day

    /// Open tasks by due day (done ones too, ticked, until the engine drops them), with changes made here.
    public var tasksByDay: [String: [TaskRow]] {
        var out: [String: [TaskRow]] = [:]
        for raw in tasks.value?.tasks ?? [] where !edits.isGone(raw.id) {
            let t = edits.shown(raw)
            guard let d = t.dueDate, t.status != "canceled" else { continue }
            out[d, default: []].append(t)
        }
        for (d, list) in out {
            out[d] = list.sorted { (TaskDates.minutes($0.dueTime) ?? -1, $0.updatedAt) < (TaskDates.minutes($1.dueTime) ?? -1, $1.updatedAt) }
        }
        return out
    }

    /// Events by day: an event over several days shows on each (all day on the middle ones).
    public var eventsByDay: [String: [PlacedEvent]] {
        var out: [String: [PlacedEvent]] = [:]
        let tz = timeZone
        for e in events.value?.events ?? [] {
            let first: String
            let last: String
            if e.allDay {
                // All-day events cover whole days in UTC; their end is the next midnight.
                first = TaskDates.day(ms: e.start, timeZone: TimeZone(identifier: "UTC")!)
                last = TaskDates.day(ms: max(e.start, e.end - 1), timeZone: TimeZone(identifier: "UTC")!)
            } else {
                first = TaskDates.day(ms: e.start, timeZone: tz)
                last = TaskDates.day(ms: max(e.start, e.end - 1), timeZone: tz)
            }
            var d = first
            var guardDays = 0
            while d <= last && guardDays < 400 {
                let isFirst = d == first, isLast = d == last
                let allDay = e.allDay || (!isFirst && !isLast)
                let start = isFirst && !e.allDay ? TaskDates.minuteOfDay(ms: e.start, timeZone: tz) : 0
                let end = isLast && !e.allDay ? max(start + 15, TaskDates.minuteOfDay(ms: e.end, timeZone: tz)) : 24 * 60
                out[d, default: []].append(PlacedEvent(event: e, day: d, allDay: allDay, startMinute: start, endMinute: end))
                d = TaskDates.add(d, days: 1)
                guardDays += 1
            }
        }
        for (d, list) in out { out[d] = list.sorted { ($0.allDay ? 0 : 1, $0.startMinute, $0.event.title) < ($1.allDay ? 0 : 1, $1.startMinute, $1.event.title) } }
        return out
    }

    /// Open tasks due before today (shown first under today).
    public var overdue: [TaskRow] {
        let today = self.today
        var out: [TaskRow] = []
        for raw in todayList.value?.groups.lazy.flatMap(\.tasks) ?? [] where !edits.isGone(raw.id) {
            let t = edits.shown(raw)
            if let d = t.dueDate, d < today, t.status == "open" || edits.status[t.id] != nil { out.append(t) }
        }
        return out.sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }
    }

    /// Whether a day has tasks or events (the week strip's dot).
    public func marked(_ day: String, tasks: [String: [TaskRow]], events: [String: [PlacedEvent]]) -> Bool {
        !(tasks[day]?.isEmpty ?? true) || !(events[day]?.isEmpty ?? true)
    }

    /// The agenda: the picked day and the 30 after it, leaving out empty days except the picked one.
    public var agenda: [AgendaDay] {
        let byTask = tasksByDay, byEvent = eventsByDay
        let late = selected == today ? overdue : []
        var out: [AgendaDay] = []
        for i in 0...30 {
            let d = TaskDates.add(selected, days: i)
            let day = AgendaDay(day: d, overdue: d == selected ? late : [], tasks: byTask[d] ?? [], events: byEvent[d] ?? [])
            if d == selected || !day.isEmpty { out.append(day) }
        }
        return out
    }

    /// Open tasks without a date (iPad and Mac, beside the month: drag onto a day).
    public var unscheduledHint: String { "Drag a task onto a day to give it that date." }

    // MARK: Tasks

    public func toggle(_ task: TaskRow) {
        edits.toggle(task) { _ in false }
    }

    public func open(_ task: TaskRow) {
        detail = edits.shown(task)
        if inWorkspace, members == nil { members = client.watch(.members(space: space)) }
    }

    /// Dropped on a day (and a time in the week grid): the task's new date, with Undo.
    public func reschedule(_ task: TaskRow, to day: String, time: PatchField<String> = .keep) async {
        let label = TaskDates.dueLabel(day, today: today)
        let words = ["Today", "Tomorrow", "Yesterday"].contains(label) ? label.lowercased() : label
        await edits.setDue(task, date: day, time: time, message: "Moved to \(words)")
    }

    public func task(id: String) -> TaskRow? { latest(id).map(edits.shown) }

    /// "Add a task" on a day: the engine reads dates in the words unless the day is the one asked for.
    public func addTask(_ text: String, on day: String) async -> Bool {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        do {
            let r = try await client.command(.taskCreate(text: text, space: space, dueDate: day))
            feedback.haptic(.success)
            feedback.toast(ScreenToast("Task added to \(r.where)", tone: .success))
            return true
        } catch {
            feedback.haptic(.error)
            feedback.toast(ScreenToast(ScreenErrors.message(error), tone: .error))
            return false
        }
    }

    public func reconcile() {
        edits.reconcile((tasks.value?.tasks ?? []) + (todayList.value?.groups.flatMap(\.tasks) ?? []))
    }

    // MARK: Subscriptions

    public func openCalendars() {
        if calendars == nil { calendars = client.watch(.calendarsList) }
        showsCalendars = true
    }

    public static let colors: [(id: String, label: String)] = [("accent", "Cocoa"), ("moss", "Moss"), ("marigold", "Marigold"), ("plum", "Plum"), ("coral", "Coral"), ("muted", "Gray")]

    /// Adds a calendar by its link (webcal:// or https://).
    public func addCalendar(url: String, name: String?, color: String) async -> String? {
        var link = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if link.lowercased().hasPrefix("webcal://") { link = "https://" + link.dropFirst("webcal://".count) }
        guard let u = URL(string: link), let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http", u.host != nil else {
            return "Paste the calendar's link (it starts with https:// or webcal://)."
        }
        do {
            _ = try await client.command(.calendarAdd(url: link, name: name?.isEmpty == false ? name : nil, color: color))
            feedback.haptic(.success)
            feedback.toast(ScreenToast("Calendar added", tone: .success))
            return nil
        } catch {
            return ScreenErrors.message(error)
        }
    }

    public func updateCalendar(_ id: String, name: String? = nil, color: String? = nil, visible: Bool? = nil) async {
        do { _ = try await client.command(.calendarUpdate(id: id, name: name, color: color, visible: visible)) } catch { edits.fail(error) }
    }

    public func refreshCalendar(_ id: String) async {
        do {
            _ = try await client.command(.calendarRefresh(id: id))
            feedback.toast(ScreenToast("Refreshing…"))
        } catch { edits.fail(error) }
    }

    public func removeCalendar(_ cal: CalendarSubscription) async {
        do {
            _ = try await client.command(.calendarRemove(id: cal.id))
            feedback.haptic(.warning)
            feedback.toast(ScreenToast("Removed \(cal.name)"))
        } catch { edits.fail(error) }
    }

    /// Refreshes every subscribed calendar and re-pulls tasks (pull to refresh).
    public func refresh() async {
        do { _ = try await client.command(.engineRefresh) } catch { edits.fail(error) }
        for cal in calendars?.value?.calendars ?? [] { _ = try? await client.command(.calendarRefresh(id: cal.id)) }
    }

    public func setVisible(_ visible: Bool) {
        tasks.setVisible(visible)
        events.setVisible(visible)
        todayList.setVisible(visible)
    }
}
