// Tasks and Calendar. Tasks live in notes (a to-do line is a task); this is every task of the space by view
// (Inbox, Today, Upcoming, All, Completed, Assigned to Me), with a quick-add field that reads dates in plain words
// ("call Sam tomorrow 3pm"), due dates, priorities, reminders and repeats. Calendar is a month of tasks with due
// dates and the person's subscribed calendars (iCal feeds), and Folevi's own feed to subscribe to elsewhere.
import FoleviDesign
import FoleviEngine
import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

struct TasksScreen: View {
    let window: WindowModel
    let view: TasksView
    private var app: AppModel { .shared }
    @State private var tasks = Live<Views.TasksList>()
    @State private var draft = ""
    @State private var parsed: TaskParseValue?
    @State private var filter = ""
    @FocusState private var adding: Bool
    @FocusState private var filterFocused: Bool

    /// The groups with only the tasks whose title or page matches the filter.
    private func filtered(_ v: TasksValue) -> [TaskGroup] {
        let q = filter.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return v.groups }
        return v.groups.compactMap { g in
            let t = g.tasks.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.noteTitle.localizedCaseInsensitiveContains(q) }
            return t.isEmpty ? nil : TaskGroup(id: g.id, kind: g.kind, title: g.title, icon: g.icon, tasks: t)
        }
    }

    private var openCount: Int { (tasks.value?.groups ?? []).flatMap(\.tasks).filter { $0.status != "done" && $0.status != "canceled" && $0.completedAt == nil }.count }

    private var facts: String {
        guard let v = tasks.value else { return "" }
        if view == .completed { let n = v.groups.flatMap(\.tasks).count; return "\(view.title) · \(n) done" }
        return "\(view.title) · \(openCount) open"
    }

    private var emptyText: (String, String) {
        switch view {
        case .inbox: ("No Undated Tasks", "Tasks without a due date land here.")
        case .today: ("Nothing Due Today", "Enjoy the quiet.")
        case .upcoming: ("Nothing Coming Up", "Tasks with a date in the next weeks show up here.")
        case .all: ("No Tasks", "Type a task above, or add a to-do line in any note.")
        case .completed: ("Nothing Completed Yet", "Tasks you finish show up here.")
        case .mine: ("Nothing Assigned to You", "Tasks someone gives you in a workspace show up here.")
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: Binding(get: { view }, set: { window.go(.tasks($0)) })) {
                ForEach(TasksView.allCases) { v in
                    Text(v.title + count(v)).tag(v)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 24)
            .padding(.vertical, 12)

            if view != .completed { quickAdd }

            if let value = tasks.value {
                if value.groups.allSatisfy(\.tasks.isEmpty) {
                    EmptyScreen(symbol: view == .completed ? "checkmark.circle" : "checklist", title: emptyText.0, message: emptyText.1)
                } else if filtered(value).isEmpty {
                    EmptyScreen(symbol: "magnifyingglass", title: "No Tasks Match That Filter", message: "Nothing here matches “\(filter)”.")
                } else {
                    List {
                        ForEach(filtered(value), id: \.id) { group in
                            Section {
                                ForEach(group.tasks, id: \.id) { task in
                                    TaskLine(task: task, window: window, showNote: group.kind != .note)
                                        .listRowSeparator(.hidden)
                                }
                            } header: {
                                HStack(spacing: 6) {
                                    if group.kind == .note { NoteMark(icon: group.icon, size: 12) }
                                    Text(group.title)
                                }
                            }
                        }
                    }
                    .listStyle(.inset)
                }
            } else {
                SkeletonRows()
            }
        }
        .screenSearch(text: $filter, prompt: "Filter by Task or Page")
        .screenSubtitle(facts)
        .screenActions {
            Group {
                Button { window.quickAddShown = true } label: { Label("Add Task", coreSymbol: "plus") }.help("Add Task (⌘N)")
            }
        }
        .task(id: view) { tasks.bind(app.client, Views.TasksList(TasksListArgs(space: nil, view: TaskViewName(rawValue: view.rawValue) ?? .today))) }
    }

    private func count(_ v: TasksView) -> String {
        guard let c = app.taskCounts.value else { return "" }
        let n: Int
        switch v {
        case .inbox: n = c.inbox
        case .today: n = c.today
        case .upcoming: n = c.upcoming
        case .all: n = c.all
        case .mine: n = c.mine
        case .completed: return ""
        }
        return n > 0 ? "  \(n)" : ""
    }

    private var quickAdd: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle").foregroundStyle(.secondary)
                TextField("New task: “Send the draft to Sam tomorrow 3pm”", text: $draft)
                    .textFieldStyle(.plain)
                    .focused($adding)
                    .onSubmit(add)
                    .onChange(of: draft) { parse() }
                if !draft.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button("Add", action: add).buttonStyle(.borderedProminent).controlSize(.regular)
                }
            }
            if let p = parsed, p.dateText != nil || p.repeatLabel != nil {
                HStack(spacing: 8) {
                    if let d = p.dateText { Label(d, coreSymbol: "calendar").font(.caption) }
                    if let r = p.repeatLabel { Label(r, coreSymbol: "repeat").font(.caption) }
                }
                .foregroundStyle(.secondary)
                .padding(.leading, 26)
            }
        }
        .padding(10)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
        .padding(.horizontal, 24)
        .padding(.bottom, 10)
    }

    @State private var parseTask: Task<Void, Never>?

    private func parse() {
        parseTask?.cancel()
        let text = draft
        parseTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, !text.isEmpty else { parsed = nil; return }
            parsed = try? await app.client?.query(Views.TaskParse(TaskParseArgs(text: text)))
        }
    }

    private func add() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        parsed = nil
        let due: String? = view == .today ? Date().formatted(CoreDates.dayFormat) : nil
        app.perform { client in
            let r = try await client.command(Commands.TaskCreate(TaskCreateArgs(text: text, space: nil, noteId: nil, dueDate: due, dueTime: nil, priority: nil, keepText: nil)))
            app.toast("Task added to \(r.where)")
        }
    }
}

/// One task: its checkbox, title, the note it's in, when it's due, priority and repeat; its menu sets them.
struct TaskLine: View {
    let task: TaskRow
    let window: WindowModel
    var showNote = true
    private var app: AppModel { .shared }
    @State private var editingDue = false
    @State private var editing = false
    @State private var due = Date()
    @State private var hovering = false
    @State private var moving = false

    private var done: Bool { task.status == "done" || task.completedAt != nil }
    private var canceled: Bool { task.status == "canceled" }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button { toggle() } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(done ? Color.foleviInk : priorityColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "Mark as not done" : "Mark as done")

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(task.title.nonEmpty ?? "Untitled task")
                        .strikethrough(done || canceled)
                        .foregroundStyle(done || canceled ? .secondary : .primary)
                    if canceled { Text("Canceled").font(.caption).foregroundStyle(.secondary) }
                }
                HStack(spacing: 10) {
                    if let d = task.dueDate {
                        Label(dueText(d), coreSymbol: "calendar").foregroundStyle(task.overdue ? .red : .secondary)
                    }
                    if task.reminderAt != nil { Image(systemName: "bell").foregroundStyle(.secondary) }
                    if let r = task.repeat, !r.isEmpty { Label(r, coreSymbol: "repeat").foregroundStyle(.secondary) }
                    if let a = task.assigneeName { Label(a, coreSymbol: "person").foregroundStyle(.secondary) }
                    if showNote {
                        Button { window.go(.note(task.noteId)) } label: {
                            Text(task.noteTitle.nonEmpty ?? "Untitled")
                        }
                        .buttonStyle(InkLinkStyle())
                    }
                }
                .font(.caption)
            }
            Spacer()
            if hovering {
                Button { editing = true } label: { Image(systemName: "pencil") }
                    .buttonStyle(.borderless).help("Edit Task").accessibilityLabel("Edit Task")
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .draggable(TaskDrag(id: task.id, due: task.dueDate, time: task.dueTime))
        .contextMenu {
            Button(canceled ? "Reopen" : done ? "Mark as Not Done" : "Mark as Done") { toggle() }
            Button("Edit Task…") { editing = true }
            Button("Move To…") { moving = true }
            Divider()
            Button("Open Note") { window.go(.note(task.noteId)) }
            Divider()
            Button("Due Today") { setDue(Date()) }
            Button("Due Tomorrow") { setDue(Calendar.current.date(byAdding: .day, value: 1, to: Date())!) }
            Button("Due Next Week") { setDue(Calendar.current.date(byAdding: .day, value: 7, to: Date())!) }
            Button("Choose Date…") { due = Date(); editingDue = true }
            if task.dueDate != nil { Button("Remove Due Date") { send { $0.dueDate = .clear; $0.dueTime = .clear } } }
            Divider()
            Menu("Priority") {
                ForEach(TaskUpdateArgs.Priority.allCases, id: \.self) { p in
                    Button(p.rawValue.capitalized) { send { $0.priority = p } }
                }
            }
            Menu("Repeat") {
                ForEach(["", "daily", "weekdays", "weekly", "monthly", "yearly"], id: \.self) { r in
                    Button(r.isEmpty ? "Never" : r.capitalized) { send { $0.repeat = r.isEmpty ? .clear : .set(r) } }
                }
            }
            Divider()
            Button("Cancel Task") { send { $0.canceled = true } }
        }
        .sheet(isPresented: $editing) { TaskEditSheet(task: task) }
        .sheet(isPresented: $moving) {
            NotePickerSheet(title: "Move “\(task.title)” to the end of another page") { id in
                guard id != task.noteId else { return }
                app.perform { client in
                    _ = try await client.command(Commands.TaskMoveToNote(TaskMoveArgs(id: task.id, noteId: id)))
                    app.toast("Task moved")
                }
            }
        }
        .onTapGesture(count: 2) { editing = true }
        .popover(isPresented: $editingDue) {
            VStack {
                DatePicker("Due", selection: $due, displayedComponents: [.date]).datePickerStyle(.graphical).labelsHidden()
                HStack { Spacer(); Button("Set") { setDue(due); editingDue = false }.keyboardShortcut(.defaultAction) }
            }
            .padding()
        }
    }

    /// Done, not done, or reopened, with Undo.
    private func toggle() {
        let reopen = done || canceled
        var a = update(checked: !reopen)
        if canceled { a.canceled = false }
        let args = a
        app.perform { client in
            _ = try await client.command(Commands.TaskUpdate(args))
            app.toast(reopen ? "Task reopened" : "Task completed", action: "Undo") {
                var undo = TaskUpdateArgs(id: task.id)
                undo.checked = reopen
                if canceled { undo.canceled = true }
                let u = undo
                app.perform { _ = try await $0.command(Commands.TaskUpdate(u)) }
            }
        }
    }

    private var priorityColor: Color {
        switch task.priority {
        case "high": .red
        case "medium": .orange
        case "low": .blue
        default: .secondary
        }
    }

    private func dueText(_ d: String) -> String {
        guard let date = try? Date(d, strategy: CoreDates.dayFormat) else { return d }
        let cal = Calendar.current
        var s = cal.isDateInToday(date) ? "Today" : cal.isDateInTomorrow(date) ? "Tomorrow" : cal.isDateInYesterday(date) ? "Yesterday" : date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        if let t = task.dueTime { s += " \(t)" }
        return s
    }

    private func update(checked: Bool? = nil) -> TaskUpdateArgs {
        TaskUpdateArgs(id: task.id, checked: checked, canceled: nil, dueDate: nil, dueTime: nil, priority: nil, assigneeId: nil, reminderAt: nil, repeat: nil, noteId: nil)
    }

    private func send(_ change: (inout TaskUpdateArgs) -> Void) {
        var args = update()
        change(&args)
        app.perform { _ = try await $0.command(Commands.TaskUpdate(args)) }
    }

    private func setDue(_ d: Date) {
        send { $0.dueDate = .set(d.formatted(CoreDates.dayFormat)) }
    }
}

// MARK: Calendar

/// The calendar: Month, Week (an all-day row over an hour grid) and Agenda (overdue, then the next 31 days), tasks
/// beside events from calendars you subscribe to. Drag a task to a day, a half hour or the all-day row (Undo puts
/// it back); the arrow keys move a day or a week; the aside shows the day, a field for a new task on it, and the
/// open tasks with no date.
struct CalendarScreen: View {
    let window: WindowModel
    let month: String?
    private var app: AppModel { .shared }
    @State private var anchor = Date()
    @State private var events = Live<Views.CalendarsEvents>()
    @State private var tasks = Live<Views.TasksRange>()
    @State private var unscheduled = Live<Views.TasksUnscheduled>()
    @State private var calendars = Live<Views.CalendarsList>()
    @State private var selected = Date()
    @State private var adding = false
    @State private var feedShown = false
    @State private var calendarsShown = false
    @State private var editingTask: TaskRow?
    @State private var newTask = ""
    @State private var now = Date()
    @AppStorage("core.calendar.layout") private var layout = "month"
    @FocusState private var focused: Bool

    static let hourHeight: CGFloat = 52
    private var cal: Calendar { Calendar.current }

    private var monthStart: Date { cal.date(from: cal.dateComponents([.year, .month], from: anchor))! }
    private var gridStart: Date {
        let weekday = cal.component(.weekday, from: monthStart)
        let back = (weekday - cal.firstWeekday + 7) % 7
        return cal.date(byAdding: .day, value: -back, to: monthStart)!
    }
    private var days: [Date] { (0..<42).map { cal.date(byAdding: .day, value: $0, to: gridStart)! } }
    private var weekStart: Date { cal.dateInterval(of: .weekOfYear, for: anchor)?.start ?? cal.startOfDay(for: anchor) }
    private var weekDays: [Date] { (0..<7).map { cal.date(byAdding: .day, value: $0, to: weekStart)! } }

    /// The span the views watch for the layout shown.
    private var range: (Date, Date) {
        switch layout {
        case "week": return (weekStart, cal.date(byAdding: .day, value: 7, to: weekStart)!)
        case "agenda":
            let today = cal.startOfDay(for: Date())
            return (cal.date(byAdding: .day, value: -120, to: today)!, cal.date(byAdding: .day, value: 32, to: today)!)
        default: return (gridStart, cal.date(byAdding: .day, value: 42, to: gridStart)!)
        }
    }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                header
                Group {
                    switch layout {
                    case "week": week
                    case "agenda": agenda
                    default: monthGrid
                    }
                }
                .transition(.opacity)
            }
            .frame(minWidth: 560)
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onKeyPress(.leftArrow) { step(days: -1); return .handled }
            .onKeyPress(.rightArrow) { step(days: 1); return .handled }
            .onKeyPress(.upArrow) { step(days: -7); return .handled }
            .onKeyPress(.downArrow) { step(days: 7); return .handled }
            dayDetail.frame(minWidth: 250, idealWidth: 300, maxWidth: 380)
        }
        .coreAnimation(Motion.fade, value: layout)
        .onAppear {
            if let month, let d = try? Date(month + "-01", strategy: CoreDates.dayFormat) { anchor = d; selected = d }
            bind()
            focused = true
        }
        .onChange(of: anchor) { bind() }
        .onChange(of: layout) { bind() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                now = Date()
            }
        }
        .sheet(isPresented: $adding) { AddCalendarSheet() }
        .sheet(isPresented: $feedShown) { CalendarFeedSheet() }
        .sheet(item: $editingTask) { TaskEditSheet(task: $0) }
        .screenActions {
            Group {
                Button { calendarsShown = true } label: {
                    Label("Calendars", coreSymbol: "calendar.badge.plus")
                        .overlay(alignment: .topTrailing) { if hasError { Circle().fill(.red).frame(width: 7, height: 7).offset(x: 3, y: -2) } }
                }
                .help(hasError ? "Calendars (one isn't loading)" : "Calendars")
                .popover(isPresented: $calendarsShown, arrowEdge: .bottom) {
                    CalendarsPopover(calendars: calendars.value?.calendars ?? []) { adding = true } feed: { feedShown = true }
                }
            }
        }
    }

    private var hasError: Bool { (calendars.value?.calendars ?? []).contains { $0.lastError != nil } }

    private func bind() {
        let (from, to) = range
        events.bind(app.client, Views.CalendarsEvents(CalendarEventsArgs(from: ms(from), to: ms(to))))
        tasks.bind(app.client, Views.TasksRange(TasksRangeArgs(space: nil, from: iso(from), to: iso(to), includeCompleted: true)))
        unscheduled.bind(app.client, Views.TasksUnscheduled(SpaceArgs()))
        calendars.bind(app.client, Views.CalendarsList())
    }

    private func ms(_ d: Date) -> Int { Int(d.timeIntervalSince1970 * 1000) }
    private func iso(_ d: Date) -> String { d.formatted(CoreDates.dayFormat) }

    private func step(days n: Int) {
        selected = cal.date(byAdding: .day, value: n, to: selected)!
        switch layout {
        case "week": if !weekDays.contains(where: { cal.isDate($0, inSameDayAs: selected) }) { anchor = selected }
        case "month": if !cal.isDate(selected, equalTo: anchor, toGranularity: .month) { anchor = selected }
        default: break
        }
    }

    private func page(_ direction: Int) {
        switch layout {
        case "week": anchor = cal.date(byAdding: .weekOfYear, value: direction, to: anchor)!
        case "agenda": break
        default: anchor = cal.date(byAdding: .month, value: direction, to: anchor)!
        }
        selected = anchor
    }

    private var heading: String {
        switch layout {
        case "week":
            let end = weekDays.last!
            let sameYear = cal.isDate(weekStart, equalTo: end, toGranularity: .year)
            let first = weekStart.formatted(.dateTime.month(.abbreviated).day())
            let last = cal.isDate(weekStart, equalTo: end, toGranularity: .month) ? end.formatted(.dateTime.day()) : end.formatted(.dateTime.month(.abbreviated).day())
            return "\(first) to \(last)" + (sameYear ? " " + end.formatted(.dateTime.year()) : ", " + end.formatted(.dateTime.year()))
        case "agenda": return "Next 30 Days"
        default: return anchor.formatted(.dateTime.month(.wide).year())
        }
    }

    private var header: some View {
        HStack {
            Text(heading).font(CoreType.screenTitle(24)).lineLimit(1).minimumScaleFactor(0.8)
            Spacer()
            Picker("Calendar View", selection: $layout) {
                Text("Month").tag("month"); Text("Week").tag("week"); Text("Agenda").tag("agenda")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            if layout != "agenda" {
                ControlGroup {
                    Button { page(-1) } label: { Image(systemName: "chevron.left") }.help(layout == "week" ? "Previous Week (⌘←)" : "Previous Month (⌘←)").keyboardShortcut(.leftArrow, modifiers: .command)
                    Button("Today") { anchor = Date(); selected = Date() }
                    Button { page(1) } label: { Image(systemName: "chevron.right") }.help(layout == "week" ? "Next Week (⌘→)" : "Next Month (⌘→)").keyboardShortcut(.rightArrow, modifiers: .command)
                }
                .fixedSize()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    // MARK: items

    private var allTasks: [TaskRow] { tasks.value?.tasks ?? [] }

    private func items(on day: Date) -> (events: [CalendarEvent], tasks: [TaskRow]) {
        let key = iso(day)
        let start = cal.startOfDay(for: day), end = cal.date(byAdding: .day, value: 1, to: start)!
        let s = ms(start), e = ms(end)
        return ((events.value?.events ?? []).filter { $0.start < e && $0.end > s }, allTasks.filter { $0.dueDate == key })
    }

    private func isDone(_ t: TaskRow) -> Bool { t.status == "done" || t.completedAt != nil }

    // MARK: month

    private var monthGrid: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(cal.shortWeekdaySymbols[(i + cal.firstWeekday - 1) % 7]).font(.caption.weight(.medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                ForEach(days, id: \.self) { day in dayCell(day) }
            }
            .padding(.horizontal, 12)
            Spacer(minLength: 0)
        }
    }

    private func dayCell(_ day: Date) -> some View {
        let inMonth = cal.isDate(day, equalTo: anchor, toGranularity: .month)
        let today = cal.isDateInToday(day)
        let picked = cal.isDate(day, inSameDayAs: selected)
        let it = items(on: day)
        return VStack(alignment: .leading, spacing: 2) {
            Text(day.formatted(.dateTime.day()))
                .font(.callout.weight(today ? .bold : .regular))
                .foregroundStyle(today ? Color.foleviOnInk : inMonth ? Color.primary : Color.secondary)
                .frame(width: 24, height: 24)
                .background { if today { Circle().fill(Color.foleviInk) } }
            ForEach(it.events.prefix(2), id: \.id) { e in EventChip(event: e) }
            ForEach(it.tasks.prefix(2), id: \.id) { t in taskChip(t) }
            if it.events.count + it.tasks.count > 4 { Text("+\(it.events.count + it.tasks.count - 4)").font(.caption2).foregroundStyle(.tertiary) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
        .background(picked ? Color.foleviInk.opacity(0.1) : .clear, in: .rect(cornerRadius: 6))
        .overlay(alignment: .top) { Divider() }
        .opacity(inMonth ? 1 : 0.55)
        .contentShape(Rectangle())
        .onTapGesture { selected = day; focused = true }
        .dropDestination(for: TaskDrag.self) { items, _ in reschedule(items, to: day, time: .keep) } isTargeted: { _ in }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }

    private func taskChip(_ t: TaskRow) -> some View {
        Button { editingTask = t } label: {
            Label(t.title, systemImage: isDone(t) ? "checkmark.circle.fill" : "circle")
                .font(.caption2).lineLimit(1).strikethrough(isDone(t))
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(isDone(t) ? Color.clear : Color.foleviInk.opacity(0.08), in: .rect(cornerRadius: 3))
        }
        .buttonStyle(.plain)
        .foregroundStyle(isDone(t) ? .secondary : .primary)
        .draggable(TaskDrag(id: t.id, due: t.dueDate, time: t.dueTime))
        .help("Edit \(t.title)")
    }

    // MARK: week

    private var week: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: 52, height: 1)
                ForEach(weekDays, id: \.self) { day in
                    VStack(spacing: 2) {
                        Text(day.formatted(.dateTime.weekday(.abbreviated))).font(.caption).foregroundStyle(.secondary)
                        Text(day.formatted(.dateTime.day()))
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(cal.isDateInToday(day) ? Color.foleviOnInk : .primary)
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .background { if cal.isDateInToday(day) { Capsule().fill(Color.foleviInk) } }
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture { selected = day }
                }
            }
            .padding(.bottom, 6)
            // All-day: untimed tasks and all-day events; a task dropped here keeps its date and loses its time.
            HStack(alignment: .top, spacing: 0) {
                Text("all-day").font(.caption2).foregroundStyle(.secondary).frame(width: 52, alignment: .trailing).padding(.trailing, 6)
                ForEach(weekDays, id: \.self) { day in
                    let it = items(on: day)
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(it.events.filter(\.allDay), id: \.id) { e in EventChip(event: e) }
                        ForEach(it.tasks.filter { $0.dueTime == nil }, id: \.id) { t in taskChip(t) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 28, alignment: .topLeading)
                    .padding(2)
                    .overlay(alignment: .leading) { Divider() }
                    .contentShape(Rectangle())
                    .dropDestination(for: TaskDrag.self) { items, _ in reschedule(items, to: day, time: .clear) }
                }
            }
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    HStack(alignment: .top, spacing: 0) {
                        VStack(spacing: 0) {
                            ForEach(0..<24, id: \.self) { h in
                                Text(hourLabel(h)).font(.caption2).foregroundStyle(.secondary)
                                    .frame(width: 46, height: Self.hourHeight, alignment: .topTrailing)
                                    .padding(.trailing, 6)
                                    .id("h\(h)")
                            }
                        }
                        ForEach(weekDays, id: \.self) { day in hourColumn(day) }
                    }
                }
                .task {
                    // After the first layout: the working day in view.
                    try? await Task.sleep(for: .milliseconds(60))
                    proxy.scrollTo("h8", anchor: .top)
                }
            }
            Text("Drag a task to a time to set it, or to the all-day row to keep just the date. Click a task to edit it.")
                .font(.caption).foregroundStyle(.secondary).padding(8)
        }
        .padding(.horizontal, 12)
    }

    private func hourLabel(_ h: Int) -> String {
        cal.date(bySettingHour: h, minute: 0, second: 0, of: Date())!.formatted(.dateTime.hour())
    }

    private struct Block: Identifiable { let id: String; let start: Double; let end: Double; let task: TaskRow?; let event: CalendarEvent?; var column = 0; var columns = 1 }

    /// Timed tasks (half an hour each) and events by their span, side by side where they overlap.
    private func blocks(_ day: Date) -> [Block] {
        let it = items(on: day)
        let dayStart = cal.startOfDay(for: day).timeIntervalSince1970
        var out: [Block] = []
        for e in it.events where !e.allDay {
            let s = max(0, Double(e.start) / 1000 - dayStart) / 3600, en = min(24, Double(e.end) / 1000 - dayStart) / 3600
            out.append(Block(id: "e" + e.id, start: s, end: max(en, s + 0.25), task: nil, event: e))
        }
        for t in it.tasks {
            guard let time = t.dueTime, let m = minutes(time) else { continue }
            let s = Double(m) / 60
            out.append(Block(id: "t" + t.id, start: s, end: s + 0.5, task: t, event: nil))
        }
        out.sort { $0.start < $1.start }
        // Greedy columns within each cluster of overlapping blocks.
        var i = 0
        while i < out.count {
            var j = i, clusterEnd = out[i].end
            while j + 1 < out.count, out[j + 1].start < clusterEnd { j += 1; clusterEnd = max(clusterEnd, out[j].end) }
            var colEnds: [Double] = []
            for k in i...j {
                if let c = colEnds.firstIndex(where: { $0 <= out[k].start }) { out[k].column = c; colEnds[c] = out[k].end } else { out[k].column = colEnds.count; colEnds.append(out[k].end) }
            }
            for k in i...j { out[k].columns = colEnds.count }
            i = j + 1
        }
        return out
    }

    private func minutes(_ hhmm: String) -> Int? {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        guard p.count >= 2 else { return nil }
        return p[0] * 60 + p[1]
    }

    private func hourColumn(_ day: Date) -> some View {
        let today = cal.isDateInToday(day)
        return GeometryReader { g in
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(0..<48, id: \.self) { slot in
                        Rectangle().fill(Color.clear)
                            .frame(height: Self.hourHeight / 2)
                            .overlay(alignment: .top) { if slot % 2 == 0 { Divider() } }
                            .contentShape(Rectangle())
                            .dropDestination(for: TaskDrag.self) { items, _ in
                                reschedule(items, to: day, time: .set(String(format: "%02d:%02d", slot / 2, (slot % 2) * 30)))
                            } isTargeted: { _ in }
                    }
                }
                ForEach(blocks(day)) { b in
                    let w = (g.size.width - 4) / CGFloat(b.columns)
                    blockView(b)
                        .frame(width: w - 2, height: max(18, CGFloat(b.end - b.start) * Self.hourHeight - 2))
                        .offset(x: 2 + CGFloat(b.column) * w, y: CGFloat(b.start) * Self.hourHeight + 1)
                }
                if today {
                    let comps = cal.dateComponents([.hour, .minute], from: now)
                    let y = (CGFloat(comps.hour ?? 0) + CGFloat(comps.minute ?? 0) / 60) * Self.hourHeight
                    Rectangle().fill(Color.red).frame(height: 1.5).offset(y: y)
                    Text(now.formatted(date: .omitted, time: .shortened)).font(.system(size: 9, weight: .semibold)).foregroundStyle(.red)
                        .padding(.horizontal, 3).background(.background, in: .capsule).offset(x: 2, y: y - 6)
                }
            }
        }
        .frame(height: Self.hourHeight * 24)
        .frame(maxWidth: .infinity)
        .background(today ? Color.foleviInk.opacity(0.03) : .clear)
        .overlay(alignment: .leading) { Divider() }
    }

    @ViewBuilder private func blockView(_ b: Block) -> some View {
        if let t = b.task {
            Button { editingTask = t } label: {
                Text(t.title).font(.caption2).strikethrough(isDone(t)).lineLimit(2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(3)
                    .background(Color.foleviInk.opacity(isDone(t) ? 0.05 : 0.12), in: .rect(cornerRadius: 4))
            }
            .buttonStyle(.plain)
            .draggable(TaskDrag(id: t.id, due: t.dueDate, time: t.dueTime))
        } else if let e = b.event {
            EventChip(event: e, block: true)
        }
    }

    // MARK: agenda

    private var agenda: some View {
        let today = cal.startOfDay(for: Date())
        let overdue = allTasks.filter { t in !isDone(t) && (t.dueDate.flatMap { try? Date($0, strategy: CoreDates.dayFormat) }.map { $0 < today } ?? false) }
        let span = (0..<31).map { cal.date(byAdding: .day, value: $0, to: today)! }
        return List {
            if !overdue.isEmpty {
                Section {
                    ForEach(overdue, id: \.id) { t in TaskLine(task: t, window: window) }
                } header: {
                    Text("Overdue").foregroundStyle(.red)
                }
            }
            ForEach(span, id: \.self) { day in
                let it = items(on: day)
                let isToday = cal.isDateInToday(day)
                if isToday || !it.events.isEmpty || !it.tasks.isEmpty {
                    Section(isToday ? "Today · " + day.formatted(.dateTime.weekday(.wide).day().month(.wide)) : day.formatted(.dateTime.weekday(.wide).day().month(.wide))) {
                        if it.events.isEmpty && it.tasks.isEmpty { Text("Nothing due.").foregroundStyle(.secondary) }
                        ForEach(it.events, id: \.id) { e in EventChip(event: e, row: true) }
                        ForEach(it.tasks, id: \.id) { t in TaskLine(task: t, window: window) }
                    }
                    .dropDestination(for: TaskDrag.self) { items, _ in reschedule(items, to: day, time: .keep) }
                }
            }
        }
        .listStyle(.inset)
    }

    // MARK: the day

    private var dayDetail: some View {
        let it = items(on: selected)
        let open = (unscheduled.value?.tasks ?? []).filter { !isDone($0) }
        return List {
            Section(selected.formatted(.dateTime.weekday(.wide).day().month(.wide))) {
                HStack {
                    Image(systemName: "plus.circle").foregroundStyle(.secondary)
                    TextField("New task on \(selected.formatted(.dateTime.weekday(.abbreviated).day()))", text: $newTask)
                        .textFieldStyle(.plain)
                        .onSubmit(addTask)
                }
                if it.events.isEmpty && it.tasks.isEmpty { Text("Nothing on this day").foregroundStyle(.secondary) }
                ForEach(it.events, id: \.id) { e in EventChip(event: e, row: true) }
                ForEach(it.tasks, id: \.id) { t in TaskLine(task: t, window: window).draggable(TaskDrag(id: t.id, due: t.dueDate, time: t.dueTime)) }
            }
            Section("Unscheduled") {
                if open.isEmpty { Text("Nothing unscheduled. Every open task has a date.").foregroundStyle(.secondary) }
                ForEach(open.prefix(8), id: \.id) { t in
                    VStack(alignment: .leading, spacing: 2) {
                        TaskLine(task: t, window: window).draggable(TaskDrag(id: t.id, due: nil, time: nil))
                        Button(cal.isDateInToday(selected) ? "Schedule for Today" : "Schedule for \(selected.formatted(.dateTime.month(.abbreviated).day()))") {
                            _ = reschedule([TaskDrag(id: t.id, due: nil, time: nil)], to: selected, time: .keep)
                        }
                        .buttonStyle(.link).font(.caption).padding(.leading, 30)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        // The day's pane shares the window's background (as Foli AI's chat list does), the split's divider between.
        .scrollContentBackground(.hidden)
    }

    private func addTask() {
        let text = newTask.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        newTask = ""
        let due = iso(selected)
        app.perform { client in
            let r = try await client.command(Commands.TaskCreate(TaskCreateArgs(text: text, space: nil, noteId: nil, dueDate: due, dueTime: nil, priority: nil, keepText: nil)))
            app.toast("Task added to \(r.where)")
        }
    }

    enum TimeChange { case keep, clear, set(String) }

    /// Tasks dropped on a day (and maybe a time) are due then; Undo puts them back.
    private func reschedule(_ items: [TaskDrag], to day: Date, time: TimeChange) -> Bool {
        let key = iso(day)
        for t in items {
            var a = TaskUpdateArgs(id: t.id)
            a.dueDate = .set(key)
            var label = day.formatted(.dateTime.month(.abbreviated).day())
            switch time {
            case .keep: break
            case .clear: a.dueTime = .clear
            case .set(let hhmm): a.dueTime = .set(hhmm); label += ", " + hhmm
            }
            let args = a
            let before = (t.due, t.time)
            app.perform { client in
                _ = try await client.command(Commands.TaskUpdate(args))
                app.toast("Moved to \(label)", action: "Undo") {
                    var undo = TaskUpdateArgs(id: t.id)
                    undo.dueDate = before.0.map { .set($0) } ?? .clear
                    undo.dueTime = before.1.map { .set($0) } ?? .clear
                    let u = undo
                    app.perform { _ = try await $0.command(Commands.TaskUpdate(u)) }
                }
            }
        }
        return true
    }
}

/// An event from a subscribed calendar: a chip, a block in the hour grid, or a row; click shows its details.
struct EventChip: View {
    let event: CalendarEvent
    var block = false
    var row = false
    @State private var shown = false

    var body: some View {
        Button { shown = true } label: {
            if row {
                HStack {
                    Circle().fill(Color(hex: event.color)).frame(width: 8, height: 8)
                    Text(event.title.nonEmpty ?? "Untitled event")
                    Spacer()
                    Text(event.allDay ? "All day" : start.formatted(date: .omitted, time: .shortened)).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            } else {
                Text(event.title.nonEmpty ?? "Untitled event").font(.caption2).lineLimit(block ? 3 : 1)
                    .padding(.horizontal, 4).padding(.vertical, block ? 3 : 0)
                    .frame(maxWidth: .infinity, maxHeight: block ? .infinity : nil, alignment: .topLeading)
                    .background(Color(hex: event.color).opacity(0.22), in: .rect(cornerRadius: block ? 4 : 3))
            }
        }
        .buttonStyle(.plain)
        .popover(isPresented: $shown, arrowEdge: .trailing) { details }
    }

    private var start: Date { Date(timeIntervalSince1970: Double(event.start) / 1000) }
    private var end: Date { Date(timeIntervalSince1970: Double(event.end) / 1000) }

    private var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(Color(hex: event.color)).frame(width: 8, height: 8)
                Text(event.calendarName).font(.caption).foregroundStyle(.secondary)
            }
            Text(event.title.nonEmpty ?? "Untitled event").font(.headline).textSelection(.enabled)
            Text(event.allDay ? start.formatted(.dateTime.weekday(.wide).day().month(.wide)) + ", all day" : "\(start.formatted(date: .abbreviated, time: .shortened)) to \(end.formatted(date: .omitted, time: .shortened))")
                .font(.callout)
            if !event.location.isEmpty { Label(event.location, coreSymbol: "mappin.and.ellipse").font(.callout).textSelection(.enabled) }
            if !event.description.isEmpty {
                ScrollView { Text(event.description).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxHeight: 180)
            }
            Text("From a calendar you subscribe to. Change it where it lives.").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(14)
        .frame(width: 300)
    }
}

/// Calendars you subscribe to: show or hide each, rename, recolour, refresh, remove; subscribe to another; the
/// Folevi feed.
struct CalendarsPopover: View {
    let calendars: [CalendarSubscription]
    let subscribe: () -> Void
    let feed: () -> Void
    private var app: AppModel { .shared }
    @State private var editing: String?
    @State private var name = ""
    @State private var color = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Calendars you subscribe to by link show beside your tasks. They're read-only here. Turn one off to hide its events.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if calendars.isEmpty { Text("No calendars yet.").foregroundStyle(.secondary) }
            ForEach(calendars, id: \.id) { c in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Circle().fill(Color(hex: c.color)).frame(width: 10, height: 10)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(c.name).foregroundStyle(c.visible ? .primary : .secondary)
                            Text([URL(string: c.url)?.host, c.loading ? "Loading…" : c.lastFetchedAt.map { "Updated " + CoreDates.short($0) }].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("Show", isOn: Binding(get: { c.visible }, set: { v in app.perform { _ = try await $0.command(Commands.CalendarUpdate(CalendarUpdateArgs(id: c.id, name: nil, color: nil, visible: v))) } }))
                            .toggleStyle(.switch).labelsHidden().controlSize(.regular)
                        Button(editing == c.id ? "Close" : "Edit") {
                            if editing == c.id { editing = nil } else { editing = c.id; name = c.name; color = c.color }
                        }
                        .buttonStyle(.borderless)
                    }
                    if let e = c.lastError {
                        Label(e, coreSymbol: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                    }
                    if editing == c.id {
                        TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                        HStack(spacing: 8) {
                            ForEach(TagColors.all, id: \.id) { t in
                                Button { color = t.id } label: {
                                    Circle().fill(Color.folevi(t.id)).frame(width: 16, height: 16)
                                        .overlay { if color == t.id { Circle().strokeBorder(Color.primary, lineWidth: 2).padding(-3) } }
                                }
                                .buttonStyle(.plain).help(t.name)
                            }
                        }
                        HStack {
                            Button("Remove…", role: .destructive) { remove(c) }
                            Spacer()
                            Button("Refresh") { app.perform { _ = try await $0.command(Commands.CalendarRefresh(CalendarIdArgs(id: c.id))) } }
                            Button("Save") {
                                let n = name, col = color
                                app.perform { _ = try await $0.command(Commands.CalendarUpdate(CalendarUpdateArgs(id: c.id, name: n, color: col, visible: nil))) }
                                editing = nil
                            }
                            .buttonStyle(InkPillStyle())
                        }
                        .controlSize(.regular)
                    }
                }
                Divider()
            }
            HStack {
                Button("Subscribe to a Calendar…", action: subscribe)
                Spacer()
                Button("Folevi Calendar Feed…", action: feed)
            }
        }
        .padding(14)
        .frame(width: 360)
    }

    private func remove(_ c: CalendarSubscription) {
        let alert = NSAlert()
        alert.messageText = "Remove “\(c.name)”?"
        alert.informativeText = "Its events stop showing in Folevi. The calendar itself isn't changed."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Remove")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        CoreAlerts.cancelIsDefault(alert)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        app.perform { _ = try await $0.command(Commands.CalendarRemove(CalendarIdArgs(id: c.id))) }
        editing = nil
    }
}

/// Subscribing to a calendar by its address (an .ics feed).
struct AddCalendarSheet: View {
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var name = ""

    var body: some View {
        Form {
            Text("Subscribe to Calendar").font(.headline)
            TextField("Address", text: $url, prompt: Text("https://… or webcal://…"))
            TextField("Name", text: $name, prompt: Text("Optional"))
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Subscribe") {
                    let u = url, n = name
                    app.perform { _ = try await $0.command(Commands.CalendarAdd(CalendarAddArgs(url: u, name: n.isEmpty ? nil : n, color: nil))) }
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

extension Color {
    /// "#rrggbb" (a calendar's colour) as a colour; grey when it isn't one.
    init(hex: String) {
        if let c = RGBA(hex: hex) { self = c.color } else { self = .gray }
    }
}

/// Folevi's own calendar feed (tasks with due dates), to subscribe to in Calendar or another app.
struct CalendarFeedSheet: View {
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var feed = Live<Views.CalendarFeed>()
    @State private var workspaces = true

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Folevi Calendar Feed").font(.headline)
            Text("Subscribe to your tasks' due dates in Calendar or any app that reads calendar feeds.").foregroundStyle(.secondary)
            if let f = feed.value {
                if f.active, let url = f.url {
                    HStack {
                        Text(url).font(.caption.monospaced()).textSelection(.enabled).lineLimit(1)
                        Button("Copy") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url, forType: .string) }
                    }
                    if let u = URL(string: url.replacingOccurrences(of: "https://", with: "webcal://")) {
                        Button("Subscribe in Calendar") { NSWorkspace.shared.open(u) }
                    }
                    Toggle("Workspace tasks assigned to you", isOn: Binding(get: { f.includeWorkspaces }, set: { v in
                        app.perform { _ = try await $0.command(Commands.CalendarFeedWorkspaces(CalendarFeedWorkspacesArgs(includeWorkspaces: v))) }
                    }))
                    Text("Your personal tasks are always in it.").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Make a New Link") { app.perform { _ = try await $0.command(Commands.CalendarFeedCreate(CalendarFeedCreateArgs(includeWorkspaces: f.includeWorkspaces))) } }
                        Button("Turn Off Feed", role: .destructive) { app.perform { _ = try await $0.command(Commands.CalendarFeedRevoke()) } }
                    }
                    Text("A new link stops the old one working.").font(.caption).foregroundStyle(.secondary)
                } else {
                    Toggle("Workspace tasks assigned to you", isOn: $workspaces)
                    Text("Your personal tasks are always in it.").font(.caption).foregroundStyle(.secondary)
                    Button("Make a Link") { let w = workspaces; app.perform { _ = try await $0.command(Commands.CalendarFeedCreate(CalendarFeedCreateArgs(includeWorkspaces: w))) } }
                        .buttonStyle(InkPillStyle())
                }
            } else {
                ProgressView()
            }
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }
        }
        .padding(20)
        .frame(width: 460)
        .task { feed.bind(app.client, Views.CalendarFeed()) }
    }
}

/// Editing a task: done or not, due date and time, priority, who it's for, a reminder, how it repeats, and which
/// note it lives in.
struct TaskEditSheet: View {
    let task: TaskRow
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var done = false
    @State private var hasDue = false
    @State private var due = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var priority: TaskUpdateArgs.Priority = .none
    @State private var assignee: String?
    @State private var hasReminder = false
    @State private var reminder = Date()
    @State private var repeatRule = ""
    @State private var members = Live<Views.Members>()
    @State private var moving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section {
                    Text(task.title).font(.headline)
                    Toggle("Done", isOn: $done)
                }
                Section("When") {
                    Toggle("Due date", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Date", selection: $due, displayedComponents: .date)
                        Toggle("Time", isOn: $hasTime)
                        if hasTime { DatePicker("At", selection: $time, displayedComponents: .hourAndMinute) }
                    }
                    Picker("Repeat", selection: $repeatRule) {
                        Text("Never").tag("")
                        Text("Every day").tag("daily")
                        Text("Weekdays").tag("weekdays")
                        Text("Every week").tag("weekly")
                        Text("Every month").tag("monthly")
                        Text("Every year").tag("yearly")
                    }
                    Toggle("Remind me", isOn: $hasReminder)
                    if hasReminder { DatePicker("At", selection: $reminder) }
                }
                Section {
                    Picker("Priority", selection: $priority) {
                        Text("None").tag(TaskUpdateArgs.Priority.none)
                        Text("Low").tag(TaskUpdateArgs.Priority.low)
                        Text("Medium").tag(TaskUpdateArgs.Priority.medium)
                        Text("High").tag(TaskUpdateArgs.Priority.high)
                    }
                    if let m = members.value?.members, m.count > 1 {
                        Picker("Assigned to", selection: $assignee) {
                            Text("Nobody").tag(String?.none)
                            ForEach(m, id: \.id) { Text($0.isYou ? "\($0.name) (you)" : $0.name).tag(Optional($0.id)) }
                        }
                    }
                    LabeledContent("In", value: task.noteTitle.nonEmpty ?? "Untitled")
                    Button("Move to Another Note…") { moving = true }
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save", action: save).buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 440, height: 560)
        .onAppear(perform: load)
        .task { members.bind(app.client, Views.Members(SpaceArgs())) }
        .sheet(isPresented: $moving) { NotePickerSheet(title: "Move Task To") { id in
            app.perform { _ = try await $0.command(Commands.TaskMoveToNote(TaskMoveArgs(id: task.id, noteId: id))) }
            dismiss()
        } }
    }

    private func load() {
        done = task.status == "done" || task.completedAt != nil
        if let d = task.dueDate, let date = try? Date(d, strategy: CoreDates.dayFormat) { hasDue = true; due = date }
        if let t = task.dueTime, let date = Self.timeFormatter.date(from: t) { hasTime = true; time = date }
        priority = TaskUpdateArgs.Priority(rawValue: task.priority ?? "none") ?? .none
        assignee = task.assigneeId
        if let r = task.reminderAt { hasReminder = true; reminder = Date(timeIntervalSince1970: r / 1000) }
        repeatRule = task.repeat ?? ""
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private func save() {
        var a = TaskUpdateArgs(id: task.id, checked: done, priority: priority)
        a.dueDate = hasDue ? .set(due.formatted(CoreDates.dayFormat)) : .clear
        a.dueTime = hasDue && hasTime ? .set(Self.timeFormatter.string(from: time)) : .clear
        a.assigneeId = assignee.map { .set($0) } ?? .clear
        a.reminderAt = hasReminder ? .set(reminder.timeIntervalSince1970 * 1000) : .clear
        a.repeat = repeatRule.isEmpty ? .clear : .set(repeatRule)
        let args = a
        app.perform { _ = try await $0.command(Commands.TaskUpdate(args)) }
        dismiss()
    }
}

/// Picking a note by searching (moving a task, linking).
struct NotePickerSheet: View {
    let title: String
    let picked: (String) -> Void
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [SearchHit] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            TextField("Search notes", text: $query).textFieldStyle(.roundedBorder)
            List(hits, id: \.id) { h in
                Button { picked(h.id); dismiss() } label: {
                    VStack(alignment: .leading) {
                        Text(h.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(14))
                        if let f = h.folder { Text(f.name).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                .buttonStyle(.hoverPlain)
            }
            .frame(height: 260)
            HStack { Spacer(); Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(16)
        .frame(width: 400)
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            if q.isEmpty {
                let r = try? await app.client?.query(Views.Recent(RecentArgs(scope: .place, limit: 20)))
                hits = (r?.rows ?? []).map { SearchHit(id: $0.row.id, title: $0.row.title, icon: nil, snippet: "", folder: $0.row.folder, updatedAt: $0.row.updatedAt, archived: false, kind: $0.row.kind, space: nil, spaceName: nil, matchIn: "title", blockId: nil, page: nil) }
            } else {
                try? await Task.sleep(for: .milliseconds(150))
                let r = try? await app.client?.query(Views.Search(SearchArgs(text: q, limit: 30)))
                hits = r?.hits ?? []
            }
        }
    }
}

/// A task dragged onto a day (its old due date, for Undo).
struct TaskDrag: Codable, Transferable {
    var id: String
    var due: String?
    /// The time it had, for Undo.
    var time: String? = nil

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: UTType(exportedAs: "com.folevi.task-drag"))
    }
}

extension TaskRow: @retroactive Identifiable {}
