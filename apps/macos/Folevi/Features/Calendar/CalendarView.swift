import SwiftUI

/// Where Tasks should open next (the calendar's "N more undated tasks in Tasks" opens All).
@MainActor
enum TasksRoute {
    static var pending: TaskLogic.View?
}

/// The month grid and an agenda of dated tasks (the web's CalendarView). Drag a task onto a day to
/// reschedule it (with Undo); undated tasks can be scheduled from the Unscheduled list.
struct CalendarView: View {
    var openDocument: (String, Bool) -> Void
    /// Opens Tasks (All), for the undated tasks that don't fit here.
    var openTasks: (() -> Void)?
    @Environment(AppModel.self) private var app
    @State private var month = String(TaskLogic.localDate().prefix(7))
    @State private var mode: Mode = .month
    @State private var selected = TaskLogic.localDate()
    @State private var tasks: [LocalTask] = []
    @State private var editing: LocalTask?
    @State private var dropDay: String?
    @State private var wide = true
    @FocusState private var gridFocused: Bool

    enum Mode: String { case month, agenda }

    private var today: String { TaskLogic.localDate() }
    /// Open and done tasks (the calendar leaves canceled ones out).
    private var dated: [LocalTask] { tasks.filter { $0.status != .canceled } }

    private func items(on day: String) -> [LocalTask] {
        dated.filter { $0.dueDate == day }.sorted { TaskBrowse.openOrder(($0.dueDate, $0.dueTime, $0.updatedAt), ($1.dueDate, $1.dueTime, $1.updatedAt)) }
    }

    private var unscheduled: [LocalTask] {
        tasks.filter { $0.status == .open && $0.dueDate == nil }
            .sorted { TaskBrowse.openOrder(($0.dueDate, $0.dueTime, $0.updatedAt), ($1.dueDate, $1.dueTime, $1.updatedAt)) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ViewBar(subtitle: mode == .month ? BrowseFormat.calendarDate("\(month)-01", .monthYear) : String(localized: "Next 30 days")) {
                    modePicker
                }
                VStack(alignment: .leading, spacing: 0) {
                    if mode == .month {
                        HStack(spacing: 4) {
                            Spacer()
                            IconButton(systemImage: "chevron.left", label: "Previous month", size: 32) { month = CalendarMonth.shift(month, -1) }
                            Button("Today") { month = String(today.prefix(7)) }.buttonStyle(.folevi(.secondary, .small))
                            IconButton(systemImage: "chevron.right", label: "Next month", size: 32) { month = CalendarMonth.shift(month, 1) }
                        }
                        .frame(minHeight: 32)
                        .padding(.bottom, 16)
                        let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: 24)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 24))
                        layout {
                            grid
                            aside.frame(width: wide ? 300 : nil)
                        }
                    } else {
                        agenda
                    }
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: 1180, alignment: .leading) // the max width includes the padding, as in CSS
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: Bool.self) { $0.size.width >= 760 } action: { wide = $0 }
            }
        }
        .scrollContentBackground(.hidden)
        .task { await reload() }
        .task(id: app.scope.key) { await TaskPeople.shared.load(app: app) }
        .onChange(of: app.blockRevision) { _, _ in Task { await reload() } }
        .onChange(of: app.documentsRevision) { _, _ in Task { await reload() } }
        .sheet(item: $editing) { t in TaskEditSheet(task: t, openDocument: openDocument).environment(app) }
    }

    /// Month / Agenda.
    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach([Mode.month, .agenda], id: \.self) { m in
                let on = mode == m
                Button { mode = m } label: {
                    Text(m == .month ? "Month" : "Agenda")
                        .font(.ui(12, on ? .medium : .regular))
                        .foregroundStyle(on ? FoleviColor.ink : FoleviColor.inkMuted)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background { if on { Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control) } }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
        .padding(2)
        .foleviWell(shape: .rounded(6))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Calendar layout"))
    }

    // MARK: Month

    private var grid: some View {
        let days = CalendarMonth.days(month: month)
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(BrowseFormat.calendarDate("2024-01-0\(1 + i)", .weekdayShort))
                        .font(.ui(12, .medium))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .background(FoleviColor.surface)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            ForEach(0..<6, id: \.self) { week in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { col in
                        let i = week * 7 + col
                        if days.indices.contains(i) { dayCell(days[i], lastColumn: col == 6) }
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .foleviCard(radius: 8)
        .focusable()
        .focused($gridFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow]) { press in
            let delta = press.key == .rightArrow ? 1 : press.key == .leftArrow ? -1 : press.key == .downArrow ? 7 : -7
            let next = CalendarMonth.move(selected, by: delta, shownMonth: month)
            selected = next.date
            if next.month != month { month = next.month }
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(BrowseFormat.calendarDate("\(month)-01", .monthYear)))
        .frame(maxWidth: .infinity)
    }

    private func dayCell(_ date: String, lastColumn: Bool) -> some View {
        let inMonth = date.hasPrefix(month)
        let list = items(on: date)
        let isToday = date == today
        let isSelected = date == selected
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(Int(date.suffix(2)) ?? 0)")
                .font(.ui(12, isToday ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(isToday ? FoleviColor.canvas : inMonth ? FoleviColor.ink : FoleviColor.inkFaint)
                .padding(.horizontal, 4)
                .frame(minWidth: 24, minHeight: 24)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isToday ? FoleviColor.heading : .clear))
            VStack(alignment: .leading, spacing: 2) {
                ForEach(list.prefix(3)) { t in
                    Text("\(t.dueTime.map { "\($0) " } ?? "")\(t.title)")
                        .font(.ui(11.5))
                        .strikethrough(t.status == .done)
                        .foregroundStyle(t.status == .done ? FoleviColor.inkFaint : FoleviColor.accentSoftInk)
                        .lineLimit(1)
                        .padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(t.status == .done ? FoleviColor.surfaceSunken : FoleviColor.accentSoft))
                        .help(Text(t.title))
                        .draggable(TaskDragPayload(blockId: t.blockId))
                }
                if list.count > 3 {
                    Text("+\(list.count - 3) more").font(.ui(11)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 4)
                }
            }
            .padding(.top, 2)
            Spacer(minLength: 0)
        }
        .padding(6)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .background(dropDay == date ? FoleviColor.accentSoft : isSelected ? FoleviColor.accentSoft.opacity(0.4) : inMonth ? .clear : FoleviColor.surface.opacity(0.6))
        .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
        .overlay(alignment: .trailing) { if !lastColumn { FoleviColor.line.frame(width: 1) } }
        .overlay { if isSelected && gridFocused { Rectangle().strokeBorder(FoleviColor.focus, lineWidth: 2) } }
        .contentShape(Rectangle())
        .onTapGesture {
            selected = date
            gridFocused = true
        }
        .dropDestination(for: TaskDragPayload.self) { items, _ in
            for item in items { reschedule(item.blockId, to: date) }
            dropDay = nil
            return !items.isEmpty
        } isTargeted: { on in
            dropDay = on ? date : (dropDay == date ? nil : dropDay)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(CalendarMonth.dayLabel(date, count: list.count)))
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }

    /// The selected day: its tasks, the tip, and Unscheduled.
    private var aside: some View {
        let list = items(on: selected)
        return VStack(alignment: .leading, spacing: 0) {
            Text(BrowseFormat.calendarDate(selected, .weekdayMonthDay))
                .font(.ui(16, .semibold))
                .foregroundStyle(FoleviColor.heading)
                .accessibilityAddTraits(.isHeader)
            Group {
                if list.isEmpty {
                    Text("No tasks due. Drag a task here to schedule it.")
                        .font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foleviCard(radius: 8)
                        .dropDestination(for: TaskDragPayload.self) { items, _ in
                            for item in items { reschedule(item.blockId, to: selected) }
                            return !items.isEmpty
                        }
                } else {
                    TaskList(items: list, today: today, openDocument: openDocument, onEdit: { editing = $0 })
                }
            }
            .padding(.top, 12)
            Text("Drag tasks between days to reschedule, or use a task’s edit button to pick a date. Arrow keys move between days.")
                .font(.ui(12)).foregroundStyle(FoleviColor.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            unscheduledSection(target: selected)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Selected day"))
    }

    // MARK: Agenda

    private var agenda: some View {
        let overdue = dated.filter { $0.status == .open && ($0.dueDate ?? "9999") < today }
            .sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }
        let days = (0...30).map { TaskLogic.addDays(today, $0) }.filter { $0 == today || !items(on: $0).isEmpty }
        return VStack(alignment: .leading, spacing: 24) {
            if !overdue.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Overdue").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.destructive).accessibilityAddTraits(.isHeader)
                    TaskList(items: overdue, today: today, openDocument: openDocument, onEdit: { editing = $0 })
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Overdue"))
            }
            ForEach(days, id: \.self) { d in
                let list = items(on: d)
                VStack(alignment: .leading, spacing: 8) {
                    Text(d == today ? String(localized: "Today") : BrowseFormat.calendarDate(d, .weekdayMonthDay))
                        .font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
                    if list.isEmpty {
                        Text("Nothing due.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .foleviCard(radius: 8)
                    } else {
                        TaskList(items: list, today: today, openDocument: openDocument, onEdit: { editing = $0 })
                    }
                }
                .dropDestination(for: TaskDragPayload.self) { items, _ in
                    for item in items { reschedule(item.blockId, to: d) }
                    return !items.isEmpty
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(d))
            }
            unscheduledSection(target: today)
        }
    }

    // MARK: Unscheduled

    /// Open tasks without a date: drag onto a day, or schedule them for `target` in one click.
    private func unscheduledSection(target: String) -> some View {
        let list = unscheduled
        let label = target == today ? String(localized: "today") : BrowseFormat.calendarDate(target, .monthDay)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Unscheduled").font(.ui(14, .semibold)).foregroundStyle(FoleviColor.heading).accessibilityAddTraits(.isHeader)
            if list.isEmpty {
                Text("Every open task has a date.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
            } else {
                TaskList(items: Array(list.prefix(8)), today: today, openDocument: openDocument, onEdit: { editing = $0 }) { t in
                    Button { reschedule(t.blockId, to: target) } label: {
                        Label("Schedule for \(label)", systemImage: "calendar.badge.plus")
                    }
                    .buttonStyle(.folevi(.ghost, .small))
                    .padding(.leading, -10)
                    .accessibilityLabel(Text("Schedule “\(t.title.isEmpty ? String(localized: "Untitled task") : t.title)” for \(label)"))
                }
            }
            if list.count > 8 {
                Button {
                    TasksRoute.pending = .all
                    openTasks?()
                } label: {
                    Text(CalendarMonth.moreUnscheduled(list.count - 8)).font(.ui(14)).underline().foregroundStyle(FoleviColor.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 24)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Unscheduled tasks"))
    }

    // MARK: Data

    private func reload() async {
        tasks = await TaskStore.loadAll(app: app)
    }

    /// Moves a task to a day, with the web's toast and Undo.
    private func reschedule(_ blockId: String, to date: String) {
        guard let task = tasks.first(where: { $0.blockId == blockId }), task.dueDate != date else { return }
        let previous = task.dueDate
        Task {
            await TaskStore.edit(task, TaskEdit(dueDate: .some(date)), app: app)
            await reload()
            app.showToast(CalendarMonth.movedMessage(date), action: .undo {
                Task {
                    var moved = task
                    moved.dueDate = date
                    await TaskStore.edit(moved, TaskEdit(dueDate: .some(previous)), app: app)
                }
            })
        }
    }
}
