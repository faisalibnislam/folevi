// Tasks and Calendar. Tasks live in notes (a to-do line is a task); this is every task of the space by view
// (Inbox, Today, Upcoming, All, Completed, Assigned to Me), with a quick-add field that reads dates in plain words
// ("call Sam tomorrow 3pm"), due dates, priorities, reminders and repeats. Calendar is a month of tasks with due
// dates and the person's subscribed calendars (iCal feeds), and Folevi's own feed to subscribe to elsewhere.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct TasksScreen: View {
    let window: WindowModel
    let view: TasksView
    private var app: AppModel { .shared }
    @State private var tasks = Live<Views.TasksList>()
    @State private var draft = ""
    @State private var parsed: TaskParseValue?
    @FocusState private var adding: Bool

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
                    EmptyScreen(symbol: view == .completed ? "checkmark.circle" : "checklist", title: view == .completed ? "Nothing Completed Yet" : "No Tasks", message: view == .today ? "Tasks due today and overdue show up here." : "Type a task above, or add a to-do line in any note.")
                } else {
                    List {
                        ForEach(value.groups, id: \.id) { group in
                            Section {
                                ForEach(group.tasks, id: \.id) { task in
                                    TaskLine(task: task, window: window, showNote: group.kind != .note)
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
                LoadingScreen()
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
                    Button("Add", action: add).buttonStyle(.borderedProminent).controlSize(.small)
                }
            }
            if let p = parsed, p.dateText != nil || p.repeatLabel != nil {
                HStack(spacing: 8) {
                    if let d = p.dateText { Label(d, systemImage: "calendar").font(.caption) }
                    if let r = p.repeatLabel { Label(r, systemImage: "repeat").font(.caption) }
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

    private var done: Bool { task.status == "done" || task.completedAt != nil }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button {
                app.perform { _ = try await $0.command(Commands.TaskUpdate(update(checked: !done))) }
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(done ? Color.foleviInk : priorityColor)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(done ? "Mark as not done" : "Mark as done")

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .strikethrough(done)
                    .foregroundStyle(done ? .secondary : .primary)
                HStack(spacing: 10) {
                    if let d = task.dueDate {
                        Label(dueText(d), systemImage: "calendar").foregroundStyle(task.overdue ? .red : .secondary)
                    }
                    if task.reminderAt != nil { Image(systemName: "bell").foregroundStyle(.secondary) }
                    if let r = task.repeat, !r.isEmpty { Label(r, systemImage: "repeat").foregroundStyle(.secondary) }
                    if let a = task.assigneeName { Label(a, systemImage: "person").foregroundStyle(.secondary) }
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
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button("Edit Task…") { editing = true }
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
        .onTapGesture(count: 2) { editing = true }
        .popover(isPresented: $editingDue) {
            VStack {
                DatePicker("Due", selection: $due, displayedComponents: [.date]).datePickerStyle(.graphical).labelsHidden()
                HStack { Spacer(); Button("Set") { setDue(due); editingDue = false }.keyboardShortcut(.defaultAction) }
            }
            .padding()
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

struct CalendarScreen: View {
    let window: WindowModel
    let month: String?
    private var app: AppModel { .shared }
    @State private var anchor = Date()
    @State private var events = Live<Views.CalendarsEvents>()
    @State private var tasks = Live<Views.TasksRange>()
    @State private var calendars = Live<Views.CalendarsList>()
    @State private var selected = Date()
    @State private var adding = false
    @State private var feedShown = false

    private var cal: Calendar { Calendar.current }

    private var monthStart: Date { cal.date(from: cal.dateComponents([.year, .month], from: anchor))! }
    private var gridStart: Date {
        let weekday = cal.component(.weekday, from: monthStart)
        let back = (weekday - cal.firstWeekday + 7) % 7
        return cal.date(byAdding: .day, value: -back, to: monthStart)!
    }
    private var days: [Date] { (0..<42).map { cal.date(byAdding: .day, value: $0, to: gridStart)! } }

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                header
                weekdays
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                    ForEach(days, id: \.self) { day in dayCell(day) }
                }
                .padding(.horizontal, 12)
                Spacer(minLength: 0)
            }
            .frame(minWidth: 520)
            dayDetail.frame(minWidth: 240, idealWidth: 300, maxWidth: 380)
        }
        .onAppear {
            if let month, let d = try? Date(month + "-01", strategy: CoreDates.dayFormat) { anchor = d }
            bind()
        }
        .onChange(of: anchor) { bind() }
        .sheet(isPresented: $adding) { AddCalendarSheet() }
        .sheet(isPresented: $feedShown) { CalendarFeedSheet() }
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                Menu {
                    ForEach(calendars.value?.calendars ?? [], id: \.id) { c in
                        Menu(c.name) {
                            Button("Refresh") { app.perform { _ = try await $0.command(Commands.CalendarRefresh(CalendarIdArgs(id: c.id))) } }
                            Button(c.visible ? "Hide" : "Show") { app.perform { _ = try await $0.command(Commands.CalendarUpdate(CalendarUpdateArgs(id: c.id, name: nil, color: nil, visible: !c.visible))) } }
                            Button("Remove", role: .destructive) { app.perform { _ = try await $0.command(Commands.CalendarRemove(CalendarIdArgs(id: c.id))) } }
                        }
                    }
                    Divider()
                    Button("Subscribe to Calendar…") { adding = true }
                    Divider()
                    Button("Folevi Calendar Feed…") { feedShown = true }
                } label: { Label("Calendars", systemImage: "calendar.badge.plus") }
            }
        }
    }

    private func bind() {
        let from = gridStart, to = cal.date(byAdding: .day, value: 42, to: gridStart)!
        events.bind(app.client, Views.CalendarsEvents(CalendarEventsArgs(from: Int(from.timeIntervalSince1970 * 1000), to: Int(to.timeIntervalSince1970 * 1000))))
        tasks.bind(app.client, Views.TasksRange(TasksRangeArgs(space: nil, from: iso(from), to: iso(to), includeCompleted: true)))
        calendars.bind(app.client, Views.CalendarsList())
    }

    private func iso(_ d: Date) -> String { d.formatted(CoreDates.dayFormat) }

    private var header: some View {
        HStack {
            Text(anchor.formatted(.dateTime.month(.wide).year())).font(CoreType.screenTitle(24))
            Spacer()
            ControlGroup {
                Button { anchor = cal.date(byAdding: .month, value: -1, to: anchor)! } label: { Image(systemName: "chevron.left") }.help("Previous Month")
                Button("Today") { anchor = Date(); selected = Date() }
                Button { anchor = cal.date(byAdding: .month, value: 1, to: anchor)! } label: { Image(systemName: "chevron.right") }.help("Next Month")
            }
            .frame(width: 160)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var weekdays: some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { i in
                Text(cal.shortWeekdaySymbols[(i + cal.firstWeekday - 1) % 7]).font(.caption.weight(.medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
    }

    private func items(on day: Date) -> (events: [CalendarEvent], tasks: [TaskRow]) {
        let key = iso(day)
        let start = cal.startOfDay(for: day), end = cal.date(byAdding: .day, value: 1, to: start)!
        let s = Int(start.timeIntervalSince1970 * 1000), e = Int(end.timeIntervalSince1970 * 1000)
        return ((events.value?.events ?? []).filter { $0.start < e && $0.end > s }, (tasks.value?.tasks ?? []).filter { $0.dueDate == key })
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
            ForEach(it.events.prefix(2), id: \.id) { e in
                Text(e.title).font(.caption2).lineLimit(1).padding(.horizontal, 4).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: e.color).opacity(0.2), in: .rect(cornerRadius: 3))
            }
            ForEach(it.tasks.prefix(2), id: \.id) { t in
                Label(t.title, systemImage: t.completedAt != nil ? "checkmark.circle.fill" : "circle").font(.caption2).lineLimit(1).foregroundStyle(.secondary)
            }
            if it.events.count + it.tasks.count > 4 { Text("+\(it.events.count + it.tasks.count - 4)").font(.caption2).foregroundStyle(.tertiary) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
        .background(picked ? Color.foleviInk.opacity(0.1) : .clear, in: .rect(cornerRadius: 6))
        .overlay(alignment: .top) { Divider() }
        .opacity(inMonth ? 1 : 0.55)
        .contentShape(Rectangle())
        .onTapGesture { selected = day }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }

    private var dayDetail: some View {
        let it = items(on: selected)
        return List {
            Section(selected.formatted(.dateTime.weekday(.wide).day().month(.wide))) {
                if it.events.isEmpty && it.tasks.isEmpty { Text("Nothing on this day").foregroundStyle(.secondary) }
                ForEach(it.events, id: \.id) { e in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack { Circle().fill(Color(hex: e.color)).frame(width: 8, height: 8); Text(e.title).font(.body.weight(.medium)) }
                        Text(e.allDay ? "All day" : "\(Date(timeIntervalSince1970: Double(e.start) / 1000).formatted(date: .omitted, time: .shortened)) – \(Date(timeIntervalSince1970: Double(e.end) / 1000).formatted(date: .omitted, time: .shortened))").font(.caption).foregroundStyle(.secondary)
                        if !e.location.isEmpty { Text(e.location).font(.caption).foregroundStyle(.secondary) }
                        Text(e.calendarName).font(.caption2).foregroundStyle(.tertiary)
                    }
                }
                ForEach(it.tasks, id: \.id) { t in TaskLine(task: t, window: window) }
            }
        }
        .listStyle(.sidebar)
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
                    Button("Turn Off Feed", role: .destructive) { app.perform { _ = try await $0.command(Commands.CalendarFeedRevoke()) } }
                } else {
                    Toggle("Include workspaces", isOn: .constant(f.includeWorkspaces)).disabled(true)
                    Button("Make a Feed") { app.perform { _ = try await $0.command(Commands.CalendarFeedCreate(CalendarFeedCreateArgs(includeWorkspaces: true))) } }
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
                .buttonStyle(.plain)
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
