import SwiftUI

/// Month grid + agenda of tasks (by due date). Drag a task onto a day to reschedule
/// (tasks:update when online, a local block edit when offline) — undoable.
struct CalendarView: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @State private var month = Calendar.current.date(from: Calendar.current.dateComponents([.year, .month], from: Date())) ?? Date()
    @State private var selectedDay = TaskLogic.localDate()
    @State private var tasks: [LocalTask] = []
    @State private var overrides: [String: String?] = [:]
    @State private var dropDay: String?

    private let calendar = Calendar.current

    private var days: [Date?] {
        guard let range = calendar.range(of: .day, in: .month, for: month) else { return [] }
        let firstWeekday = calendar.component(.weekday, from: month)
        let leading = (firstWeekday - calendar.firstWeekday + 7) % 7
        var out: [Date?] = Array(repeating: nil, count: leading)
        for d in range {
            out.append(calendar.date(byAdding: .day, value: d - 1, to: month))
        }
        while out.count % 7 != 0 { out.append(nil) }
        return out
    }

    private func due(_ t: LocalTask) -> String? {
        if let o = overrides[t.blockId] { return o }
        return t.dueDate
    }

    private func tasks(on day: String) -> [LocalTask] {
        tasks.filter { due($0) == day }.sorted { !$0.checked && $1.checked }
    }


    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 18) {
                header
                VStack(spacing: 0) {
                    weekdayHeader
                        .frame(height: 38)
                    FoleviColor.line.frame(height: 1)
                    let rows = days.count / 7
                    Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                        ForEach(0..<rows, id: \.self) { r in
                            GridRow {
                                ForEach(0..<7, id: \.self) { c in
                                    let date = days[r * 7 + c]
                                    Group {
                                        if let date { dayCell(date) } else { Color.clear }
                                    }
                                    .frame(maxWidth: .infinity, minHeight: 96, maxHeight: .infinity)
                                    .overlay(alignment: .trailing) { if c < 6 { FoleviColor.line.frame(width: 1) } }
                                    .overlay(alignment: .bottom) { if r < rows - 1 { FoleviColor.line.frame(height: 1) } }
                                }
                            }
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: FoleviRadius.card, style: .continuous))
                .foleviCard()
            }
            .frame(maxWidth: .infinity)
            agenda
                .frame(width: 290)
                .padding(.top, 66)
        }
        .padding(.horizontal, 32)
        .padding(.top, 30)
        .padding(.bottom, 28)
        .task { await reload() }
        .onChange(of: app.blockRevision) { _, _ in Task { await reload() } }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Text(month, format: .dateTime.month(.wide).year())
                .foleviViewTitle(size: 34)
            Spacer()
            IconButton(systemImage: "chevron.left", label: "Previous Month") { shiftMonth(-1) }
            Button("Today") {
                month = calendar.date(from: calendar.dateComponents([.year, .month], from: Date())) ?? Date()
                selectedDay = TaskLogic.localDate()
            }
            .buttonStyle(.folevi(.secondary, .medium))
            IconButton(systemImage: "chevron.right", label: "Next Month") { shiftMonth(1) }
        }
    }

    private var weekdayHeader: some View {
        let symbols = calendar.shortWeekdaySymbols
        let ordered = Array(symbols[(calendar.firstWeekday - 1)...] + symbols[..<(calendar.firstWeekday - 1)])
        return HStack(spacing: 0) {
            ForEach(ordered, id: \.self) { s in
                Text(s).font(.ui(13, .medium)).foregroundStyle(FoleviColor.inkMuted).frame(maxWidth: .infinity)
            }
        }
    }

    private func dayCell(_ date: Date) -> some View {
        let key = TaskLogic.localDate(date)
        let dayTasks = tasks(on: key)
        let isToday = key == TaskLogic.localDate()
        let isSelected = key == selectedDay
        let inMonth = calendar.isDate(date, equalTo: month, toGranularity: .month)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(calendar.component(.day, from: date))")
                    .font(.ui(13, isToday ? .bold : .medium))
                    .monospacedDigit()
                    .foregroundStyle(isToday ? Color.white : inMonth ? FoleviColor.ink : FoleviColor.inkFaint)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Circle().fill(isToday ? FoleviColor.emberInk : Color.clear))
                Spacer()
            }
            ForEach(dayTasks.prefix(3)) { t in
                Text(t.title)
                    .font(.ui(12))
                    .strikethrough(t.checked)
                    .foregroundStyle(t.checked ? FoleviColor.inkMuted : FoleviColor.accentSoftInk)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(FoleviColor.accentSoft))
                    .draggable(TaskDragPayload(blockId: t.blockId))
            }
            if dayTasks.count > 3 {
                Text("+\(dayTasks.count - 3) more").font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(dropDay == key ? FoleviColor.accentSoft : isToday ? FoleviColor.emberSoft.opacity(0.7) : isSelected ? FoleviColor.accentSoft.opacity(0.45) : FoleviColor.surface)
        .overlay {
            if isSelected && !isToday { Rectangle().strokeBorder(FoleviColor.ember.opacity(0.5), lineWidth: 1.5) }
        }
        .contentShape(Rectangle())
        .onTapGesture { selectedDay = key }
        .dropDestination(for: TaskDragPayload.self) { items, _ in
            for item in items { reschedule(item.blockId, to: key) }
            return !items.isEmpty
        } isTargeted: { targeted in
            dropDay = targeted ? key : (dropDay == key ? nil : dropDay)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(date, format: .dateTime.weekday(.wide).month(.wide).day()))
        .accessibilityValue(Text("\(dayTasks.count) tasks"))
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }

    private var agenda: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(TaskLogic.parseLocalDate(selectedDay) ?? Date(), format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.ui(17, .semibold))
                    .foregroundStyle(FoleviColor.heading)
                    .accessibilityAddTraits(.isHeader)
            }
            let dayTasks = tasks(on: selectedDay)
            if dayTasks.isEmpty {
                Text("No tasks due.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(dayTasks) { t in
                        TaskRow(task: t, today: TaskLogic.localDate(), openDocument: openDocument) { checked in
                            Task {
                                await TaskStore.setChecked(t, checked, app: app)
                                await reload()
                            }
                        }
                        .padding(14)
                        .foleviCard(radius: 14)
                        .draggable(TaskDragPayload(blockId: t.blockId))
                    }
                    Text("Tip: drag tasks between days to reschedule.")
                        .font(.ui(12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                    let undated = tasks.filter { due($0) == nil && !$0.checked }
                    if !undated.isEmpty {
                        Text("Unscheduled").foleviCapsLabel().padding(.top, 14)
                        ForEach(undated.prefix(30)) { t in
                            Text(t.title.isEmpty ? String(localized: "Untitled task") : t.title)
                                .font(.ui(13))
                                .foregroundStyle(FoleviColor.ink)
                                .lineLimit(2)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(10), shadow: FoleviShadow.control)
                                .draggable(TaskDragPayload(blockId: t.blockId))
                                .accessibilityHint(Text("Drag onto a day to schedule"))
                        }
                    }
                }
                .padding(4)
            }
            .scrollIndicators(.never)
            Spacer(minLength: 0)
        }
    }

    private func shiftMonth(_ delta: Int) {
        month = calendar.date(byAdding: .month, value: delta, to: month) ?? month
    }

    private func reload() async {
        tasks = await TaskStore.load(app: app)
        // Drop optimistic overrides the data has caught up with.
        overrides = overrides.filter { id, value in tasks.first { $0.blockId == id }?.dueDate != value }
    }

    private func reschedule(_ blockId: String, to day: String) {
        guard let task = tasks.first(where: { $0.blockId == blockId }) else { return }
        let previous = due(task)
        guard previous != day else { return }
        setDue(task, day, undoTo: previous)
    }

    private func setDue(_ task: LocalTask, _ day: String?, undoTo previous: String?) {
        overrides[task.blockId] = .some(day)
        let online = app.sync.isOnline
        Task {
            let hasLocalWork = await app.session?.engine.state.pending.contains { $0.targetBlockId == task.blockId } ?? false
            if online, !hasLocalWork, let session = app.session {
                do {
                    _ = try await session.tasks.update(blockId: task.blockId, fields: ["dueDate": day.map { .string($0) } ?? .null])
                    await session.engine.syncNow()
                } catch {
                    await TaskStore.mutate(task, app: app) { $0.dueDate = day }
                }
            } else {
                await TaskStore.mutate(task, app: app) { $0.dueDate = day }
            }
        }
        undoManager?.registerUndo(withTarget: app) { _ in
            MainActor.assumeIsolated { setDue(task, previous, undoTo: day) }
        }
        undoManager?.setActionName(String(localized: "Reschedule Task"))
    }
}
