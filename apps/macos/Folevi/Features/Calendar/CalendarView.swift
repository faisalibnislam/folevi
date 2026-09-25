import SwiftUI

/// Month grid + agenda of tasks (by due date) and Daily Notes. Drag a task onto a day to reschedule
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

    private func daily(on day: String) -> DocumentSummary? {
        app.documents.first { $0.kind == .daily && $0.dailyDate == day && $0.deletedAt == nil }
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 10) {
                header
                weekdayHeader
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                    ForEach(Array(days.enumerated()), id: \.offset) { _, date in
                        if let date { dayCell(date) } else { Color.clear.frame(height: 92) }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            Divider()
            agenda
                .frame(width: 300)
        }
        .background(FoleviColor.canvas)
        .task { await reload() }
        .onChange(of: app.blockRevision) { _, _ in Task { await reload() } }
    }

    private var header: some View {
        HStack {
            Text(month, format: .dateTime.month(.wide).year())
                .font(FoleviType.display(26))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            IconButton(systemImage: "chevron.left", label: "Previous Month") { shiftMonth(-1) }
            Button("Today") {
                month = calendar.date(from: calendar.dateComponents([.year, .month], from: Date())) ?? Date()
                selectedDay = TaskLogic.localDate()
            }
            IconButton(systemImage: "chevron.right", label: "Next Month") { shiftMonth(1) }
        }
    }

    private var weekdayHeader: some View {
        let symbols = calendar.shortWeekdaySymbols
        let ordered = Array(symbols[(calendar.firstWeekday - 1)...] + symbols[..<(calendar.firstWeekday - 1)])
        return HStack {
            ForEach(ordered, id: \.self) { s in
                Text(s).font(.caption.weight(.semibold)).foregroundStyle(FoleviColor.inkMuted).frame(maxWidth: .infinity)
            }
        }
    }

    private func dayCell(_ date: Date) -> some View {
        let key = TaskLogic.localDate(date)
        let dayTasks = tasks(on: key)
        let isToday = key == TaskLogic.localDate()
        let isSelected = key == selectedDay
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("\(calendar.component(.day, from: date))")
                    .font(.system(size: 12, weight: isToday ? .bold : .regular))
                    .foregroundStyle(isToday ? FoleviColor.accentInk : FoleviColor.ink)
                    .padding(.horizontal, 5)
                    .background(Capsule().fill(isToday ? FoleviColor.accent : Color.clear))
                Spacer()
                if daily(on: key) != nil {
                    Image(systemName: "sun.max.fill").font(.system(size: 9)).foregroundStyle(FoleviColor.marigold)
                        .accessibilityLabel(Text("Daily note"))
                }
            }
            ForEach(dayTasks.prefix(3)) { t in
                Text(t.title)
                    .font(.system(size: 10))
                    .strikethrough(t.checked)
                    .lineLimit(1)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 3).fill(FoleviColor.accentSoft))
                    .draggable(TaskDragPayload(blockId: t.blockId))
            }
            if dayTasks.count > 3 {
                Text("+\(dayTasks.count - 3) more").font(.system(size: 9)).foregroundStyle(FoleviColor.inkMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(5)
        .frame(height: 92)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(dropDay == key ? FoleviColor.accentSoft : (isSelected ? FoleviColor.surfaceRaised : FoleviColor.surface))
        )
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(isSelected ? FoleviColor.accent : FoleviColor.line))
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
            Text(TaskLogic.parseLocalDate(selectedDay) ?? Date(), format: .dateTime.weekday(.wide).month(.wide).day())
                .font(FoleviType.sectionTitle)
            if let note = daily(on: selectedDay) {
                Button {
                    openDocument(note.id, NSEvent.modifierFlags.contains(.option))
                } label: {
                    Label(note.displayTitle, systemImage: "sun.max").frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            } else {
                Button {
                    Task { if let id = await app.dailyNoteId(for: selectedDay) { openDocument(id, false) } }
                } label: {
                    Label("Open Daily Note", systemImage: "sun.max")
                }
            }
            Divider()
            let dayTasks = tasks(on: selectedDay)
            if dayTasks.isEmpty {
                Text("No tasks due. Drag a task onto a day to schedule it.").font(.callout).foregroundStyle(FoleviColor.inkMuted)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(dayTasks) { t in
                        TaskRow(task: t, today: TaskLogic.localDate(), openDocument: openDocument) { checked in
                            Task {
                                await TaskStore.setChecked(t, checked, app: app)
                                await reload()
                            }
                        }
                        .draggable(TaskDragPayload(blockId: t.blockId))
                    }
                    let undated = tasks.filter { due($0) == nil && !$0.checked }
                    if !undated.isEmpty {
                        Text("Unscheduled").font(.caption.weight(.semibold)).foregroundStyle(FoleviColor.inkMuted).padding(.top, 12)
                        ForEach(undated.prefix(30)) { t in
                            Text(t.title.isEmpty ? String(localized: "Untitled task") : t.title)
                                .font(.system(size: 12))
                                .padding(6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 6).fill(FoleviColor.surfaceRaised))
                                .draggable(TaskDragPayload(blockId: t.blockId))
                                .accessibilityHint(Text("Drag onto a day to schedule"))
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
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
