// The Calendar on the Mac, drawn as the web's (views/CalendarView.tsx, CalendarWeek.tsx, CalendarSubscriptions.tsx):
// the period as a title with its paging and Today, Calendars (subscriptions by link) and the layout switch (Month,
// Week, Agenda, kept on this Mac); the month grid with the selected day's tasks, events and the unscheduled tasks
// beside it; the week with its all-day row and the hour grid (tasks with a time as half-hour blocks, side by side
// when they overlap, the line at the current time); the agenda of the next 30 days. Tasks drag onto a day (or a
// time) to be rescheduled, with Undo. Arrow keys move between days.
#if os(macOS) || os(iOS)
#if os(macOS)
import AppKit
#else
import UIKit
#endif
import SwiftUI
import UniformTypeIdentifiers
import FoleviDesign
import FoleviEngine
import FoleviScreens

enum WebCalendarLayout: String, CaseIterable {
    case month, week, agenda
}

/// What the web Calendar keeps beyond CalendarModel: tasks with completed ones (`tasks.range` includeCompleted),
/// the unscheduled tasks, the subscriptions, and its own month, week and selected day.
@MainActor
@Observable
final class WebCalendarState {
    let base: CalendarModel
    let client: EngineClient
    var layout: WebCalendarLayout { didSet { UserDefaults.standard.set(layout.rawValue, forKey: Self.layoutKey) } }
    var month: String
    var anchor: String
    var selected: String
    private(set) var tasks: ValueStore<TasksRangeValue>
    let unscheduled: ValueStore<TasksRangeValue>
    let calendars: ValueStore<CalendarsValue>
    private var range: (String, String) = ("", "")
    static let layoutKey = "folevi.mac.calendar.layout"

    init(base: CalendarModel) {
        self.base = base
        client = base.client
        let today = base.today
        layout = UserDefaults.standard.string(forKey: Self.layoutKey).flatMap(WebCalendarLayout.init(rawValue:)) ?? .month
        month = String(today.prefix(7))
        anchor = today
        selected = today
        tasks = base.client.watch(.tasksRange(from: today, to: today, includeCompleted: true))
        unscheduled = base.client.watch(.tasksUnscheduled())
        calendars = base.client.watch(.calendarsList)
        fetch()
    }

    var today: String { base.today }

    /// The days the layout shows.
    var weekDays: [String] { (0..<7).map { TaskDates.add(TaskDates.startOfWeek(anchor), days: $0) } }
    var monthDays: [String] { PlannerDates.monthGrid(month) }
    var agendaDays: [String] { (0..<31).map { TaskDates.add(today, days: $0) } }

    /// Watches the tasks of the days shown (and keeps CalendarModel's events on the same days).
    func fetch() {
        let days: [String]
        switch layout {
        case .month: days = monthDays
        case .week: days = weekDays
        case .agenda: days = agendaDays
        }
        let r = (days.first!, days.last!)
        if r != range {
            range = r
            tasks.cancel()
            tasks = client.watch(.tasksRange(from: r.0, to: r.1, includeCompleted: true))
        }
        base.select(layout == .month ? "\(month)-01" : layout == .week ? TaskDates.startOfWeek(anchor) : today)
    }

    func setLayout(_ next: WebCalendarLayout) {
        guard next != layout else { return }
        if next == .week { anchor = selected }
        if next == .month, layout == .week { month = String(anchor.prefix(7)) }
        layout = next
        fetch()
    }

    /// Tasks by due day, in the range's order, with changes made here.
    var byDate: [String: [TaskRow]] {
        var out: [String: [TaskRow]] = [:]
        for raw in tasks.value?.tasks ?? [] where !base.edits.isGone(raw.id) {
            let t = base.edits.shown(raw)
            guard let d = t.dueDate else { continue }
            out[d, default: []].append(t)
        }
        return out
    }

    var unscheduledTasks: [TaskRow] {
        (unscheduled.value?.tasks ?? []).filter { !base.edits.isGone($0.id) }.map { base.edits.shown($0) }.filter { $0.dueDate == nil && $0.status == "open" }
    }

    var failing: Bool { calendars.value?.calendars.contains { $0.lastError != nil } ?? false }
    var feeds: Bool { base.session.value?.mode == .account }

    func move(_ delta: Int) {
        switch layout {
        case .month: month = PlannerDates.shiftMonth(month, delta)
        case .week: anchor = TaskDates.add(anchor, days: 7 * delta)
        case .agenda: return
        }
        fetch()
    }

    func goToday() {
        month = String(today.prefix(7))
        anchor = today
        selected = today
        fetch()
    }

    /// Arrow keys on a day: the selection moves, the month or week follows.
    func step(_ delta: Int) {
        let next = TaskDates.add(selected, days: delta)
        selected = next
        if layout == .month, !next.hasPrefix(month) { month = String(next.prefix(7)) }
        if layout == .week, !weekDays.contains(next) { anchor = next }
        fetch()
    }
}

/// The calendar's short headings (MAC-20).
enum CalendarHeading {
    /// "Nov 2 to 8" in one month, "Nov 30 to Dec 6" across two, "Dec 28 to Jan 3, 2027" across years.
    static func week(first: String, last: String) -> String {
        let a = PlannerDates.format(first, "MMMd")
        if first.prefix(7) == last.prefix(7) { return "\(a) to \(Int(last.suffix(2)) ?? 0)" }
        if first.prefix(4) == last.prefix(4) { return "\(a) to \(PlannerDates.format(last, "MMMd"))" }
        return "\(a) to \(PlannerDates.format(last, "MMMdyyyy"))"
    }
}

func calendarColor(_ key: String) -> ColorPair { PV(key == "muted" ? "color-ink-muted" : "color-\(key)") }

struct WebCalendarScreen: View {
    @State private var state: WebCalendarState
    @State private var tasks: PlannerTasks
    let frame: FrameModel
    @State private var bodyHeight: CGFloat = 748
    @FocusState private var gridFocused: Bool
    @Environment(\.colorScheme) private var scheme

    init(model: CalendarModel, frame: FrameModel) {
        self.frame = frame
        _state = State(initialValue: WebCalendarState(base: model))
        _tasks = State(initialValue: PlannerTasks(frame: frame, host: model))
    }

    var body: some View {
        let content = PS("cal.content").resolve(scheme)
        let byDate = state.byDate
        let events = state.base.eventsByDay
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                toolbar
                // Month, Week and Agenda trade places with a short crossfade.
                Group {
                    switch state.layout {
                    case .month: month(byDate: byDate, events: events)
                    case .week: week(byDate: byDate, events: events)
                    case .agenda: agenda(byDate: byDate, events: events)
                    }
                }
                .id(state.layout)
                .transition(.opacity)
                .animation(WebMotion.change(WebMotion.viewSwitch), value: state.layout)
            }
            .padding(content.padding.edgeInsets)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bodyHeight = $0 }
        .plannerAnchor(tasks.anchor)
        .onReceive(NotificationCenter.default.publisher(for: .init("folevi.calendar.layout"))) { n in
            if let s = n.object as? String, let l = WebCalendarLayout(rawValue: s) { state.setLayout(l) }
        }
        .onAppear {
            state.base.setVisible(true)
            state.fetch()
        }
        .onDisappear { state.base.setVisible(false) }
        .onChange(of: state.tasks.value) { _, v in if let v { state.base.edits.reconcile(v.tasks) } }
        .accessibilityIdentifier("calendar-screen")
    }

    // MARK: The toolbar

    private var heading: String {
        switch state.layout {
        case .month: return PlannerDates.format("\(state.month)-01", "MMMMyyyy")
        case .week:
            let d = state.weekDays
            return "\(PlannerDates.format(d[0], "MMMd")) to \(PlannerDates.format(d[6], "MMMdyyyy"))"
        case .agenda: return "Next 30 days"
        }
    }

    /// A narrow window's heading: "Nov 2 to 8" (MAC-20), "Nov 30 to Dec 6" across months.
    private var shortHeading: String {
        guard state.layout == .week else { return state.layout == .month ? PlannerDates.format("\(state.month)-01", "MMMyyyy") : heading }
        let d = state.weekDays
        return CalendarHeading.week(first: d[0], last: d[6])
    }

    /// The toolbar in one row as the web lays it out; when that doesn't fit (a narrow window with the sidebar
    /// open, MAC-20), the shorter heading and Calendars and Subscribe as icons; narrower still, two rows. The
    /// content's side margins always stay.
    private var toolbar: some View {
        let bar = PS("cal.toolbar").resolve(scheme)
        return ViewThatFits(in: .horizontal) {
            toolbarRow(heading: heading, compact: false).frame(height: bar.height)
            toolbarRow(heading: shortHeading, compact: true).frame(height: bar.height)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: bar.gap) { StyledText(shortHeading, "cal.heading").fixedSize(); Spacer(minLength: 0) }
                HStack(spacing: bar.gap) { stepper; Spacer(minLength: 0); actions(compact: true) }
            }
        }
        .padding(.bottom, bar.margin.bottom)
    }

    private func toolbarRow(heading: String, compact: Bool) -> some View {
        HStack(spacing: PS("cal.toolbar").resolve(scheme).gap) {
            StyledText(heading, "cal.heading").fixedSize()
            stepper
            Spacer(minLength: 0)
            actions(compact: compact)
        }
    }

    @ViewBuilder private var stepper: some View {
        let unit = state.layout == .month ? "month" : "week"
        if state.layout != .agenda {
            HStack(spacing: 4) {
                PlannerIconButton(icon: .chevronLeft, label: "Previous \(unit)") { state.move(-1) }
                PlannerButton("Today", style: "cal.today") { state.goToday() }.fixedSize()
                PlannerIconButton(icon: .chevronRight, label: "Next \(unit)") { state.move(1) }
            }
            .fixedSize()
        }
    }

    private func actions(compact: Bool) -> some View {
        HStack(spacing: 6) {
            CalendarsButton(state: state, frame: frame, compact: compact)
            if state.feeds {
                if compact {
                    PlannerIconButton(icon: .rss, label: "Subscribe") { openFeed() }.foleviTooltip("Subscribe")
                } else {
                    PlannerButton("Subscribe", icon: .rss, style: "cal.calendars") { openFeed() }
                }
            }
            WebSeg(items: WebCalendarLayout.allCases.map { SegItem(id: $0.rawValue, title: $0.rawValue.capitalized) }, selected: state.layout.rawValue, base: "cal.layout", fill: false) { id in
                if let l = WebCalendarLayout(rawValue: id) { state.setLayout(l) }
            }
            .fixedSize()
        }
        .fixedSize()
    }

    private func openFeed() {
        guard let w = tasks.window else { return }
        PlannerPanel.dialog(in: w) { close in CalendarFeedDialog(client: frame.client, frame: frame, close: close) }
    }

    // MARK: Month

    private func month(byDate: [String: [TaskRow]], events: [String: [PlacedEvent]]) -> some View {
        let split = PS("cal.split").resolve(scheme)
        let grid = PS("cal.grid")
        let r = grid.resolve(scheme).radius
        let days = state.monthDays
        let line = PV("color-line").c(scheme)
        return HStack(alignment: .top, spacing: split.gap) {
            VStack(spacing: 0) {
                let wd = PS("cal.weekdays").resolve(scheme)
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { i in
                        let day = TaskDates.add("2024-01-01", days: i)
                        StyledText(PlannerDates.format(day, "EEE"), "cal.weekday").frame(maxWidth: .infinity).padding(.vertical, 8)
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(PlannerDates.format(day, "EEEE"))
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Weekdays")
                .frame(height: wd.height - 1)
                .background(wd.background.color)
                Rectangle().fill(line).frame(height: 1)
                ForEach(0..<6, id: \.self) { w in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { i in
                            let d = days[w * 7 + i]
                            MonthCell(day: d, inMonth: d.hasPrefix(state.month), today: state.today, selected: state.selected == d, last: i == 6, items: byDate[d] ?? [], events: events[d] ?? [], state: state, tasks: tasks)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipShape(RoundedRectangle(cornerRadius: r, style: .circular))
            .webBox(grid)
            .focusable()
            .focused($gridFocused)
            .focusEffectDisabled()
            .onKeyPress(phases: .down) { press in arrows(press, week: 7) }
            // The grid is one element holding the days: its name is the month's, theirs their own (a label on a
            // plain stack would name every day in it after the month, F07).
            .accessibilityElement(children: .contain)
            .accessibilityLabel(PlannerDates.format("\(state.month)-01", "MMMMyyyy"))
            .topAligned()
            aside(byDate: byDate, events: events).frame(width: 300).topAligned()
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func arrows(_ press: KeyPress, week: Int) -> KeyPress.Result {
        switch press.key {
        case .leftArrow: state.step(-1)
        case .rightArrow: state.step(1)
        case .upArrow: state.step(-week)
        case .downArrow: state.step(week)
        default: return .ignored
        }
        return .handled
    }

    private func aside(byDate: [String: [TaskRow]], events: [String: [PlacedEvent]]) -> some View {
        let items = byDate[state.selected] ?? []
        let evs = events[state.selected] ?? []
        let card = PS("cal.aside.card").resolve(scheme)
        return VStack(alignment: .leading, spacing: 0) {
            StyledText(PlannerDates.long(state.selected), "cal.aside.title")
            TaskCard {
                if items.isEmpty {
                    PlannerEmpty(icon: .calendarCheck, title: "No tasks due", message: "Drag a task onto this day to schedule it.", inline: true)
                }
                ForEach(items, id: \.id) { t in PlannerTaskRow(raw: t, tasks: tasks) }
            }
            .padding(.top, card.margin.top)
            if !evs.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Events").webText(.role(.subheadline, weight: 600)).foregroundStyle(PV("color-ink").c(scheme))
                    TaskCard { ForEach(evs) { p in EventRow(placed: p, timeZone: state.base.timeZone) } }
                }
                .padding(.top, 16)
            }
            PrettyText("Drag tasks between days to reschedule, or use a task’s edit button to pick a date. Arrow keys move between days.", PS("cal.aside.hint").resolve(scheme).text)
                .foregroundStyle(PS("cal.aside.hint").resolve(scheme).color.color)
                .padding(.top, PS("cal.aside.hint").resolve(scheme).margin.top)
            unscheduled(target: state.selected)
        }
    }

    // MARK: Unscheduled

    private func unscheduled(target: String) -> some View {
        let list = state.unscheduledTasks
        let label = target == state.today ? "today" : PlannerDates.format(target, "MMMd")
        let s = PS("cal.unscheduled").resolve(scheme)
        return VStack(alignment: .leading, spacing: 0) {
            let t = PS("cal.unscheduled.title").resolve(scheme)
            StyledText("Unscheduled", "cal.unscheduled.title").padding(.bottom, t.margin.bottom)
            if list.isEmpty {
                TaskCard { PlannerEmpty(title: "Nothing unscheduled", message: "Every open task has a date.", inline: true) }
            } else {
                TaskCard {
                    ForEach(list.prefix(8), id: \.id) { task in
                        PlannerTaskRow(raw: task, tasks: tasks) {
                            ScheduleButton(label: label) { tasks.reschedule(task, to: target) }
                                .accessibilityLabel("Schedule “\(task.title.isEmpty ? "Untitled task" : task.title)” for \(label)")
                        }
                    }
                }
            }
            if list.count > 8 {
                let n = list.count - 8
                Button { frame.open(.tasks(.all)) } label: {
                    Text("\(n) more undated task\(n == 1 ? "" : "s") in Tasks").webText(.role(.subheadline)).underline().foregroundStyle(PV("color-accent").c(scheme))
                }
                .buttonStyle(.webLink)
                .padding(.top, 8)
            }
        }
        .padding(.top, s.margin.top)
    }

    // MARK: Week

    private func week(byDate: [String: [TaskRow]], events: [String: [PlacedEvent]]) -> some View {
        let card = PS("week.card")
        let r = card.resolve(scheme).radius
        let days = state.weekDays
        let line = PV("color-line").c(scheme)
        let head = PS("week.head").resolve(scheme)
        let label = PS("week.allday.label").resolve(scheme)
        let scrollHeight = min((bodyHeight + 72) * 0.68, 748)
        return VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    Color.clear.frame(width: 56)
                    ForEach(days, id: \.self) { d in
                        let today = d == state.today
                        let n = PS(today ? "week.head.number.today" : "week.head.number")
                        let ns = n.resolve(scheme)
                        HStack(spacing: 6) {
                            StyledText(PlannerDates.format(d, "EEE"), "week.head.day")
                            Text("\(Int(d.suffix(2)) ?? 0)").webText(ns.text).monospacedDigit().foregroundStyle(ns.color.color)
                                .padding(ns.padding.edgeInsets).frame(minWidth: 24, minHeight: 24).webBox(n)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: head.height - 1)
                .background(head.background.color)
                Rectangle().fill(line).frame(height: 1)
                HStack(alignment: .top, spacing: 0) {
                    Text("All day").webText(label.text).foregroundStyle(label.color.color).lineLimit(1)
                        .padding(label.padding.edgeInsets).frame(width: 56, alignment: .trailing)
                        .topAligned()
                    ForEach(days, id: \.self) { d in
                        AllDayCell(day: d, selected: state.selected == d, items: (byDate[d] ?? []).filter { TaskDates.minutes($0.dueTime) == nil }, events: (events[d] ?? []).filter(\.allDay), state: state, tasks: tasks)
                            .topAligned()
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                Rectangle().fill(line).frame(height: 1)
                .focusable()
                .focused($gridFocused)
                .focusEffectDisabled()
                .onKeyPress(phases: .down) { press in arrows(press, week: 7) }
                HourGrid(days: days, today: state.today, byDate: byDate, events: events, state: state, tasks: tasks)
                    .frame(height: scrollHeight)
            }
            .clipShape(RoundedRectangle(cornerRadius: r, style: .circular))
            .webBox(card)
            let hint = PS("week.hint").resolve(scheme)
            PrettyText("Drag a task to a time to set it, or to the all-day row to keep just the date. Select a task to edit it.", hint.text)
                .foregroundStyle(hint.color.color)
                .padding(.top, hint.margin.top)
            unscheduled(target: days.contains(state.selected) ? state.selected : state.today)
        }
    }

    // MARK: Agenda

    private func agenda(byDate: [String: [TaskRow]], events: [String: [PlacedEvent]]) -> some View {
        let overdue = state.base.overdue
        let days = state.agendaDays.filter { byDate[$0] != nil || events[$0] != nil || $0 == state.today }
        let title = PS("agenda.section.title").resolve(scheme)
        return VStack(alignment: .leading, spacing: 24) {
            if !overdue.isEmpty {
                VStack(alignment: .leading, spacing: title.margin.bottom) {
                    Text("Overdue").webText(title.text).foregroundStyle(PV("color-danger").c(scheme))
                    TaskCard { ForEach(overdue, id: \.id) { t in PlannerTaskRow(raw: t, tasks: tasks) } }
                }
            }
            ForEach(days, id: \.self) { d in
                VStack(alignment: .leading, spacing: title.margin.bottom) {
                    StyledText(d == state.today ? "Today" : PlannerDates.long(d), "agenda.section.title")
                    TaskCard {
                        if (byDate[d] ?? []).isEmpty && events[d] == nil {
                            Text("Nothing due.").webText(.role(.subheadline)).foregroundStyle(PV("color-ink-muted").c(scheme))
                                .padding(.horizontal, 16).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(byDate[d] ?? [], id: \.id) { t in PlannerTaskRow(raw: t, tasks: tasks) }
                        ForEach(events[d] ?? []) { p in EventRow(placed: p, timeZone: state.base.timeZone) }
                    }
                }
            }
            unscheduled(target: state.today).padding(.top, -24)
        }
    }
}

// MARK: Month cells

struct MonthCell: View {
    let day: String
    let inMonth: Bool
    let today: String
    let selected: Bool
    let last: Bool
    let items: [TaskRow]
    let events: [PlacedEvent]
    let state: WebCalendarState
    let tasks: PlannerTasks
    @State private var targeted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let cell = PS(selected ? "cal.cell.selected" : inMonth ? "cal.cell" : "cal.cell.outside").resolve(scheme)
        let isToday = day == today
        let num = PS(isToday ? "cal.cell.number.today" : inMonth ? "cal.cell.number" : "cal.cell.number.outside")
        let ns = num.resolve(scheme)
        let room = max(0, 3 - items.count)
        let hidden = max(0, items.count - 3) + max(0, events.count - room)
        let line = PV("color-line").c(scheme)
        VStack(alignment: .leading, spacing: 0) {
            Text("\(Int(day.suffix(2)) ?? 0)").webText(ns.text).monospacedDigit().foregroundStyle(ns.color.color)
                .padding(ns.padding.edgeInsets).frame(minWidth: 24, minHeight: 24).webBox(num)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(items.prefix(3), id: \.id) { t in
                    MonthChip(task: t, tasks: tasks)
                }
                ForEach(events.prefix(room)) { p in EventChip(placed: p) }
                if hidden > 0 {
                    Text("+\(hidden) more").webText(.role(.footnote)).foregroundStyle(PV("color-ink-muted").c(scheme)).padding(.horizontal, 4)
                }
            }
            .padding(.top, 4)
        }
        .padding(cell.padding.edgeInsets)
        .frame(maxWidth: .infinity, minHeight: cell.height, alignment: .topLeading)
        .background(cell.background.color)
        .background(targeted ? PV("color-accent-soft").c(scheme) : .clear)
        .overlay(alignment: .bottom) { Rectangle().fill(line).frame(height: 1) }
        .overlay(alignment: .trailing) { if !last { Rectangle().fill(line).frame(width: 1) } }
        .contentShape(Rectangle())
        .webHover(radius: 0)
        .onTapGesture { state.selected = day }
        .onDrop(of: [.text], isTargeted: $targeted) { providers in
            dropTask(providers) { id in reschedule(id) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Self.accessibilityName(day: day, today: today, tasks: items.count, events: events.count))
        #if os(macOS)
        .accessibilityValue(selected ? "Selected" : "")
        #endif
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { state.selected = day }
        .accessibilityIdentifier("calendar-cell-\(day)")
    }

    /// A day as VoiceOver names it (F07): its full date, its own month and year even when it's from the month
    /// before or after, whether it's today, and what's on it.
    static func accessibilityName(day: String, today: String, tasks: Int, events: Int) -> String {
        var out = "\(day == today ? "Today, " : "")\(PlannerDates.format(day, "EEEEMMMMdyyyy")), \(tasks == 0 ? "no tasks" : tasks == 1 ? "1 task" : "\(tasks) tasks")"
        if events > 0 { out += events == 1 ? ", 1 event" : ", \(events) events" }
        return out
    }

    private func reschedule(_ id: String) {
        let all = (state.tasks.value?.tasks ?? []) + (state.unscheduled.value?.tasks ?? []) + state.base.overdue
        if let t = all.first(where: { $0.id == id }) { tasks.reschedule(t, to: day) }
    }
}

/// Reads a dragged task's id.
func dropTask(_ providers: [NSItemProvider], _ done: @escaping @MainActor (String) -> Void) -> Bool {
    guard let p = providers.first else { return false }
    _ = p.loadObject(ofClass: NSString.self) { obj, _ in
        guard let s = obj as? String else { return }
        Task { @MainActor in done(s) }
    }
    return true
}

/// A task on a month day: accent-soft while open, struck through when done; a click edits it.
struct MonthChip: View {
    let task: TaskRow
    let tasks: PlannerTasks
    var style = "cal.chip"
    var showsTime = true
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let s = PS(style).resolve(scheme)
        let open = task.status == "open"
        Button { tasks.edit(task) } label: {
            Text("\(showsTime ? task.dueTime.map { "\($0) " } ?? "" : "")\(task.title.isEmpty && !showsTime ? "Untitled task" : task.title)")
                .webText(s.text)
                .lineLimit(1)
                .truncationMode(.tail)
                .strikethrough(!open)
                .foregroundStyle(open ? s.color.color : PV("color-ink-faint").c(scheme))
                .padding(s.padding.edgeInsets)
                .frame(maxWidth: .infinity, minHeight: s.height, maxHeight: s.height, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(open ? s.background.color : PV("color-surface-sunken").c(scheme)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: s.radius))
        .foleviTooltip(task.title)
        .onDrag { NSItemProvider(object: task.id as NSString) }
    }
}

/// A subscribed calendar's event on a month day: muted, its calendar's colour as a dot.
struct EventChip: View {
    let placed: PlacedEvent
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = PlannerAnchor()
    @State private var over = false

    var body: some View {
        let e = placed.event
        let time = !placed.allDay && placed.startMinute > 0 ? PlannerDates.time(placed.startMinute) + " " : ""
        Button { showEvent(e, anchor: anchor) } label: {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 3, style: .circular).fill(calendarColor(e.color).c(scheme)).frame(width: 6, height: 6)
                Text("\(time)\(e.title.isEmpty ? "Untitled event" : e.title)").webText(.role(.footnote)).lineLimit(1)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 20, maxHeight: 20, alignment: .leading)
            .foregroundStyle(PV("color-ink-muted").c(scheme))
            .background(RoundedRectangle(cornerRadius: 4, style: .circular).fill(PV(over ? "color-surface-sunken" : "color-surface").c(scheme)))
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
        .foleviTooltip(e.title)
    }
}

@MainActor
func showEvent(_ e: CalendarEvent, anchor: PlannerAnchor) {
    guard let v = anchor.view else { return }
    PlannerPanel.popover(below: v) { _ in EventPopover(event: e, timeZone: .current) }
}

/// "09:00 to 10:30", "Tue, Oct 27, all day" or a date range (CalendarSubscriptions.tsx eventWhen).
func eventWhen(_ e: CalendarEvent, timeZone: TimeZone) -> String {
    let utc = TimeZone(identifier: "UTC")!
    let fmt: (String) -> String = { PlannerDates.format($0, "EEEMMMd") }
    if e.allDay {
        let first = TaskDates.day(ms: e.start, timeZone: utc)
        let last = TaskDates.day(ms: max(e.start, e.end - 86_400_000), timeZone: utc)
        return first == last ? "\(fmt(first)), all day" : "\(fmt(first)) to \(fmt(last))"
    }
    let sd = TaskDates.day(ms: e.start, timeZone: timeZone), sm = TaskDates.minuteOfDay(ms: e.start, timeZone: timeZone)
    let ed = TaskDates.day(ms: e.end, timeZone: timeZone), em = TaskDates.minuteOfDay(ms: e.end, timeZone: timeZone)
    if e.end <= e.start { return "\(fmt(sd)), \(PlannerDates.time(sm))" }
    if sd == ed { return "\(fmt(sd)), \(PlannerDates.time(sm)) to \(PlannerDates.time(em))" }
    return "\(fmt(sd)), \(PlannerDates.time(sm)) to \(fmt(ed)), \(PlannerDates.time(em))"
}

/// An event in a list (the selected day, the agenda): muted, read-only, opens its details.
struct EventRow: View {
    let placed: PlacedEvent
    let timeZone: TimeZone
    @Environment(\.colorScheme) private var scheme
    @State private var anchor = PlannerAnchor()
    @State private var over = false

    var body: some View {
        let e = placed.event
        Button { showEvent(e, anchor: anchor) } label: {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 3, style: .circular).fill(calendarColor(e.color).c(scheme)).frame(width: 10, height: 10).padding(.top, 6)
                VStack(alignment: .leading, spacing: 0) {
                    Text(e.title.isEmpty ? "Untitled event" : e.title).webText(WebTextStyle(size: 14, leading: 18.9)).foregroundStyle(PV("color-ink-muted").c(scheme))
                    Text("\(eventWhen(e, timeZone: timeZone)) · \(e.calendarName)").webText(.role(.footnote)).foregroundStyle(PV("color-ink-faint").c(scheme))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(over ? PV("color-surface").c(scheme) : .clear)
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
    }
}

/// An event's details, read-only.
struct EventPopover: View {
    let event: CalendarEvent
    let timeZone: TimeZone
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let pop = PS("cals.pop")
        let p = pop.resolve(scheme)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 3, style: .circular).fill(calendarColor(event.color).c(scheme)).frame(width: 10, height: 10)
                Text(event.calendarName).webText(.role(.footnote))
            }
            .foregroundStyle(PV("color-ink-muted").c(scheme))
            Text(event.title.isEmpty ? "Untitled event" : event.title).webText(.role(.headline, weight: 600)).foregroundStyle(PV("color-heading").c(scheme)).padding(.top, 6)
            Text(eventWhen(event, timeZone: timeZone)).webText(.role(.subheadline)).foregroundStyle(PV("color-ink-muted").c(scheme)).padding(.top, 4)
            if !event.location.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    WebIconView(.mapPin, size: 14).foregroundStyle(PV("color-ink-faint").c(scheme)).padding(.top, 2)
                    Text(event.location).webText(.role(.subheadline))
                }
                .padding(.top, 8)
            }
            if !event.description.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Rectangle().fill(PV("color-line").c(scheme)).frame(height: 1)
                    ScrollView { Text(event.description).webText(.role(.subheadline)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12) }
                        .frame(maxHeight: 240)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 12)
            }
            Text("From a calendar you subscribe to. Change it in the app it comes from.").webText(.role(.footnote)).foregroundStyle(PV("color-ink-faint").c(scheme)).padding(.top, 12)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(16)
        .frame(width: 320, alignment: .leading)
        .background(WebMaterial(radius: p.radius))
        .webBox(pop)
    }
}

// MARK: The week's rows

struct AllDayCell: View {
    let day: String
    let selected: Bool
    let items: [TaskRow]
    let events: [PlacedEvent]
    let state: WebCalendarState
    let tasks: PlannerTasks
    @State private var targeted = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = PS(selected ? "week.allday.cell.selected" : "week.allday.cell").resolve(scheme)
        VStack(alignment: .leading, spacing: 2) {
            ForEach(items, id: \.id) { t in MonthChip(task: t, tasks: tasks, style: "week.allday.chip", showsTime: false) }
            ForEach(events) { p in EventChip(placed: p) }
        }
        .padding(c.padding.edgeInsets)
        .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity, alignment: .topLeading)
        .background(c.background.color)
        .background(targeted ? PV("color-accent-soft").c(scheme) : .clear)
        .overlay(alignment: .leading) { Rectangle().fill(PV("color-line").c(scheme)).frame(width: 1) }
        .contentShape(Rectangle())
        .webHover(radius: 0)
        .onTapGesture { state.selected = day }
        .onDrop(of: [.text], isTargeted: $targeted) { providers in
            dropTask(providers) { id in
                let all = (state.tasks.value?.tasks ?? []) + (state.unscheduled.value?.tasks ?? [])
                if let t = all.first(where: { $0.id == id }) { tasks.reschedule(t, to: day, time: .some(nil)) }
            }
        }
    }
}

/// The hour grid (24 hours of 52 pt, as the web's): hours as "9 AM" (an hour near now gives way to now's time),
/// tasks with a time as 30-minute blocks and timed events, tinted with a coloured edge, today's column lighter with
/// now's line and dot; it opens an hour before now when today is shown, else at 6:00.
struct HourGrid: View {
    let days: [String]
    let today: String
    let byDate: [String: [TaskRow]]
    let events: [String: [PlacedEvent]]
    let state: WebCalendarState
    let tasks: PlannerTasks
    static let hour: CGFloat = 52
    @Environment(\.colorScheme) private var scheme
    @State private var now = Self.minutesNow()
    @State private var hover: (day: String, minutes: Int)?
    let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    static func minutesNow() -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// "9 AM", or "21" where the clock is 24-hour (web hourLabel).
    static func hourLabel(_ h: Int) -> String {
        var parts = DateComponents()
        parts.hour = h
        return Calendar.current.date(from: parts).map { $0.formatted(.dateTime.hour(.defaultDigits(amPM: .abbreviated))) } ?? "\(h)"
    }

    /// Minutes after midnight in this device's clock (web clock()).
    static func clock(_ minutes: Int) -> String {
        var parts = DateComponents()
        parts.hour = minutes / 60
        parts.minute = minutes % 60
        return Calendar.current.date(from: parts).map { $0.formatted(date: .omitted, time: .shortened) } ?? PlannerDates.time(minutes)
    }

    var body: some View {
        let label = PS("week.hour.label").resolve(scheme)
        let line = PV("color-line").c(scheme)
        let showsToday = days.contains(today)
        let ember = FoleviTokens.Chrome.ember.resolve(scheme).color
        let openHour = showsToday ? max(0, min(16, now / 60 - 1)) : CalendarMath.firstVisibleHour
        ScrollViewReader { reader in
            ScrollView {
                ZStack(alignment: .topLeading) {
                    // Where it opens: an hour before now on today, else 6:00, less 10 pt.
                    VStack(spacing: 0) {
                        Color.clear.frame(width: 1, height: max(0, CGFloat(openHour) * Self.hour - 10))
                        Color.clear.frame(width: 1, height: 1).id("start")
                    }
                    HStack(alignment: .top, spacing: 0) {
                        ZStack(alignment: .topTrailing) {
                            Color.clear
                            ForEach(Array(1..<24).filter { !showsToday || abs($0 * 60 - now) >= 20 }, id: \.self) { h in
                                Text(Self.hourLabel(h)).webText(label.text).monospacedDigit().lineLimit(1).fixedSize().foregroundStyle(label.color.color)
                                    .padding(.trailing, 8)
                                    .offset(y: CGFloat(h) * Self.hour - label.height / 2)
                            }
                            if showsToday {
                                Text(Self.clock(now)).webText(WebTextStyle(size: 11, leading: 14, weight: 600)).monospacedDigit().lineLimit(1).fixedSize()
                                    .foregroundStyle(ember)
                                    .padding(.horizontal, 2)
                                    .background(PV("color-canvas").c(scheme))
                                    .padding(.trailing, 6)
                                    .offset(y: CGFloat(now) / 60 * Self.hour - 7)
                            }
                        }
                        .frame(width: 56, height: 24 * Self.hour, alignment: .topTrailing)
                        ForEach(days, id: \.self) { d in column(d, line: line) }
                    }
                }
            }
            .scrollIndicators(.automatic)
            .onAppear { reader.scrollTo("start", anchor: .top) }
        }
        .onReceive(timer) { _ in now = Self.minutesNow() }
    }

    private func column(_ d: String, line: Color) -> some View {
        let timed = (byDate[d] ?? []).compactMap { t in TaskDates.minutes(t.dueTime).map { (t, $0) } }
        let evs = (events[d] ?? []).filter { !$0.allDay }
        let spans = timed.map { CalendarMath.Span(id: "t:\($0.0.id)", start: $0.1, end: $0.1 + CalendarMath.taskMinutes) }
            + evs.map { CalendarMath.Span(id: "e:\($0.event.id)", start: $0.startMinute, end: max($0.endMinute, $0.startMinute + CalendarMath.taskMinutes)) }
        let placed = Dictionary(CalendarMath.layoutOverlaps(spans).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                // Today's column a touch lighter, so it stands out.
                if d == today { PV("color-ink").c(scheme).opacity(0.025) }
                VStack(spacing: 0) {
                    ForEach(0..<24, id: \.self) { _ in
                        Color.clear.frame(height: Self.hour - 1)
                        Rectangle().fill(line.opacity(0.6)).frame(height: 1)
                    }
                }
                if let h = hover, h.day == d {
                    RoundedRectangle(cornerRadius: 4, style: .circular)
                        .strokeBorder(PV("color-accent").c(scheme), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                        .background(RoundedRectangle(cornerRadius: 4).fill(PV("color-accent-soft").c(scheme).opacity(0.5)))
                        .frame(width: w - 8, height: Self.hour / 2)
                        .offset(x: 4, y: CGFloat(h.minutes) / 60 * Self.hour)
                }
                ForEach(evs) { p in
                    if let pl = placed["e:\(p.event.id)"] { eventBlock(p, pl, width: w) }
                }
                ForEach(timed, id: \.0.id) { t, start in
                    if let pl = placed["t:\(t.id)"] { taskBlock(t, pl, width: w) }
                }
                if d == today {
                    let ember = FoleviTokens.Chrome.ember.resolve(scheme).color
                    let y = CGFloat(now) / 60 * Self.hour
                    ZStack(alignment: .topLeading) {
                        ember.frame(width: w, height: 2).offset(y: y - 1)
                        RoundedRectangle(cornerRadius: 4, style: .circular).fill(ember).frame(width: 8, height: 8).offset(x: -4, y: y - 4)
                    }
                    .allowsHitTesting(false)
                }
            }
            .frame(width: w, height: 24 * Self.hour, alignment: .topLeading)
            .contentShape(Rectangle())
            .onDrop(of: [.text], delegate: SlotDrop(day: d, hover: $hover) { id, minutes in
                let all = (state.tasks.value?.tasks ?? []) + (state.unscheduled.value?.tasks ?? [])
                if let t = all.first(where: { $0.id == id }) { tasks.reschedule(t, to: d, time: .some(PlannerDates.time(minutes))) }
            })
        }
        .frame(height: 24 * Self.hour)
        .overlay(alignment: .leading) { Rectangle().fill(line).frame(width: 1) }
    }

    private func frameFor(_ p: CalendarMath.Placed, width: CGFloat) -> CGRect {
        let colW = (width - 1) / CGFloat(p.cols)
        let top = CGFloat(p.start) / 60 * Self.hour + 1
        let h = CGFloat(p.end - p.start) / 60 * Self.hour - 2
        return CGRect(x: 1 + colW * CGFloat(p.col) + 2, y: top, width: colW - 4, height: h)
    }

    private func taskBlock(_ t: TaskRow, _ p: CalendarMath.Placed, width: CGFloat) -> some View {
        let r = frameFor(p, width: width)
        let open = t.status == "open"
        let bar = PV(open ? "color-heading" : "color-line-strong").c(scheme)
        return Button { tasks.edit(t) } label: {
            // web taskChipClass: the heading's ink as a tint and a 3 pt bar down its edge; done ones quiet.
            Text(t.title.isEmpty ? "Untitled task" : t.title)
                .webText(WebTextStyle(size: 12, leading: 16, weight: 500))
                .lineLimit(1)
                .strikethrough(!open)
                .foregroundStyle(PV(open ? "color-ink" : "color-ink-faint").c(scheme))
                .padding(.leading, 6 + 3)
                .padding(.trailing, 6)
                .padding(.top, 2)
                .frame(width: r.width, height: r.height, alignment: .topLeading)
                .background(open ? PV("color-heading").c(scheme).opacity(0.09) : PV("color-surface-sunken").c(scheme))
                .overlay(alignment: .leading) { bar.frame(width: 3) }
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .circular))
                .background(RoundedRectangle(cornerRadius: 5, style: .circular).fill(PV("color-canvas").c(scheme)).padding(-1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.webHover(radius: 4))
        .foleviTooltip("\(t.dueTime ?? "") \(t.title)")
        .onDrag { NSItemProvider(object: t.id as NSString) }
        .offset(x: r.minX, y: r.minY)
    }

    private func eventBlock(_ pe: PlacedEvent, _ p: CalendarMath.Placed, width: CGFloat) -> some View {
        let r = frameFor(p, width: width)
        let e = pe.event
        return EventBlock(event: e, start: pe.startMinute, first: pe.startMinute > 0 || TaskDates.day(ms: e.start, timeZone: .current) == pe.day, size: r.size)
            .offset(x: r.minX, y: r.minY)
    }
}

struct EventBlock: View {
    let event: CalendarEvent
    let start: Int
    let first: Bool
    let size: CGSize
    @State private var anchor = PlannerAnchor()
    @State private var over = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let tone = calendarColor(event.color).c(scheme)
        Button { showEvent(event, anchor: anchor) } label: {
            // web eventStyle: the calendar's colour as a tint and a 3 pt bar; the title up to three lines, the time
            // under it when there's room.
            HStack(spacing: 0) {
                tone.frame(width: 3)
                VStack(alignment: .leading, spacing: 0) {
                    Text(event.title.isEmpty ? "Untitled event" : event.title)
                        .webText(WebTextStyle(size: 12, leading: 16, weight: 500)).lineLimit(3)
                        .foregroundStyle(PV("color-ink").c(scheme))
                    if first, size.height >= 38 {
                        Text(HourGrid.clock(start)).webText(WebTextStyle(size: 11, leading: 14)).monospacedDigit().lineLimit(1)
                            .foregroundStyle(PV("color-ink-muted").c(scheme))
                    }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(width: size.width, height: size.height)
            .background(tone.opacity(over ? 0.24 : 0.16))
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .circular))
            .contentShape(Rectangle())
            .plannerAnchor(anchor)
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
    }
}

/// A drop on the hour grid: the half hour under the pointer (calendarLayout.ts slotAt).
struct SlotDrop: DropDelegate {
    let day: String
    @Binding var hover: (day: String, minutes: Int)?
    let drop: @MainActor (String, Int) -> Void

    /// The half hour under the pointer, on this grid's 52 pt hours.
    func slot(_ info: DropInfo) -> Int {
        let m = Int(info.location.y / HourGrid.hour * 60) / CalendarMath.slotMinutes * CalendarMath.slotMinutes
        return max(0, min(24 * 60 - CalendarMath.slotMinutes, m))
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        let m = slot(info)
        if hover?.day != day || hover?.minutes != m { hover = (day, m) }
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) { hover = nil }

    func performDrop(info: DropInfo) -> Bool {
        let m = slot(info)
        hover = nil
        return dropTask(info.itemProviders(for: [.text])) { id in drop(id, m) }
    }
}

/// "Schedule for today" under an unscheduled task.
struct ScheduleButton: View {
    let label: String
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @State private var over = false

    var body: some View {
        let s = PS("cal.schedule").resolve(scheme)
        Button(action: action) {
            HStack(spacing: s.gap) {
                WebIconView(.calendarPlus, size: 13)
                Text("Schedule for \(label)").webText(s.text).lineLimit(1).fixedSize()
            }
            .padding(s.padding.edgeInsets)
            .frame(height: s.height)
            .foregroundStyle(over ? PV("color-heading").c(scheme) : s.color.color)
            .background { if over { RoundedRectangle(cornerRadius: s.radius, style: .circular).fill(PV("glass-hover").c(scheme)) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainPress())
        .onHover { over = $0 }
        .padding(.leading, s.margin.left)
    }
}
#endif
