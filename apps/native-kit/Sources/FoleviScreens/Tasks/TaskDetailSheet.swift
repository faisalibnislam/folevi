// A task's details (web iphone/TaskSheet.tsx, Reminders' details in Folevi's look): the task with its box, its
// status as a segmented control, its date (the system's calendar picker) and time, the days people pick most a tap
// away, priority and assignee as menus, how it repeats, and the note it lives in. Every change is saved as it's
// made; the sheet closes with Done or a drag down.
import SwiftUI
import FoleviDesign
import FoleviEngine

struct TaskDetailSheet: View {
    let model: any TaskSheetHost
    let taskId: String
    let initial: TaskRow
    @State private var showsCalendar = false
    @State private var showsTime = false
    @Environment(\.dismiss) private var dismiss
    private let send = IntentSender()

    /// The task as it is now: the engine's latest row with this sheet's changes over it.
    private var task: TaskRow {
        model.edits.shown(model.latest(taskId) ?? initial)
    }

    var body: some View {
        let t = task
        let today = model.today
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 2) {
                        Button { setStatus(t.status == "open" ? "done" : "open") } label: {
                            TaskBox(status: t.status).frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(t.status == "done" ? "Mark as not done" : "Mark as done")
                        Text(t.title.isEmpty ? "Untitled task" : t.title)
                            .foleviFont(.bodyStrong)
                            .foregroundStyle(t.status == "open" ? Folevi.color.heading : Folevi.color.inkMuted)
                            .padding(.top, 11)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.leading, -11)

                    SegmentedControl(selection: Binding(get: { t.status }, set: { setStatus($0) }), options: [("open", "Open"), ("done", "Done"), ("canceled", "Canceled")])
                        .accessibilityLabel("Status")
                        .disabled(!model.canEdit)

                    RowGroup {
                        dateRow(t, today: today)
                        if showsCalendar { calendar(t, today: today) }
                        if t.dueDate != nil {
                            RowDivider(leadingInset: 46)
                            timeRow(t)
                            if showsTime { timePicker(t) }
                        }
                        quickDates(t, today: today)
                    }
                    .disabled(!model.canEdit)

                    RowGroup {
                        priorityRow(t)
                        if model.inWorkspace || t.assigneeId != nil {
                            RowDivider(leadingInset: 46)
                            assigneeRow(t)
                        }
                        if let r = t.repeat {
                            RowDivider(leadingInset: 46)
                            detailRow("repeat", "Repeats", value: r)
                        }
                    }
                    .disabled(!model.canEdit)

                    RowGroup {
                        Button {
                            dismiss()
                            send(.openNote(id: t.noteId, blockId: t.id))
                        } label: {
                            HStack(spacing: 12) {
                                RowIcon("doc.text")
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("In the note").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                                    Text(t.noteTitle.isEmpty ? "Untitled" : t.noteTitle).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Folevi.color.inkFaint)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 56)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("task-open-note")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(Folevi.color.canvas)
            .navigationTitle("Task")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(FoleviTokens.Radius.sheet)
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 560)
        #endif
        .accessibilityIdentifier("task-sheet")
    }

    // MARK: Rows

    private func detailRow(_ symbol: String, _ label: String, value: String, tone: Color = Folevi.color.inkMuted, chevron: Bool = false) -> some View {
        HStack(spacing: 12) {
            RowIcon(symbol)
            Text(label).foleviFont(.body).foregroundStyle(Folevi.color.ink)
            Spacer(minLength: 8)
            Text(value).foleviFont(.body).foregroundStyle(tone).lineLimit(1)
            if chevron { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Folevi.color.inkFaint) }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }

    private func dateRow(_ t: TaskRow, today: String) -> some View {
        let overdue = t.status == "open" && (t.dueDate.map { $0 < today } ?? false)
        return Button { withAnimation(.folevi()) { showsCalendar.toggle() } } label: {
            detailRow("calendar", "Date", value: t.dueDate.map { TaskDates.whenLabel($0, today: today) } ?? "None", tone: overdue ? Folevi.color.destructive : Folevi.color.inkMuted, chevron: true)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("task-date")
    }

    private func calendar(_ t: TaskRow, today: String) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            DatePicker("Due date", selection: Binding(
                get: { TaskDates.pickerDate(day: t.dueDate ?? today, time: nil, timeZone: model.timeZone) },
                set: { d in
                    let day = TaskDates.fromPicker(d, timeZone: model.timeZone).day
                    if day != t.dueDate { save(TaskPatchArgs(id: t.id, dueDate: .set(day))) }
                }
            ), displayedComponents: .date)
            .datePickerStyle(.graphical)
            .environment(\.timeZone, model.timeZone)
            .labelsHidden()
            .tint(Folevi.color.heading)
            if t.dueDate != nil {
                Button("Remove date") { save(TaskPatchArgs(id: t.id, dueDate: .clear, dueTime: .clear)); showsCalendar = false }
                    .buttonStyle(.folevi(.ghost, size: .small))
                    .padding(.trailing, 8)
                    .padding(.bottom, 8)
            }
        }
        .padding(.horizontal, 6)
    }

    private func timeRow(_ t: TaskRow) -> some View {
        Button { withAnimation(.folevi()) { showsTime.toggle() } } label: {
            detailRow("clock", "Time", value: t.dueTime.map { TaskDates.timeLabel($0) } ?? "All day", chevron: true)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("task-time")
    }

    private func timePicker(_ t: TaskRow) -> some View {
        HStack {
            DatePicker("Time", selection: Binding(
                get: { TaskDates.pickerDate(day: t.dueDate ?? model.today, time: t.dueTime ?? "09:00", timeZone: model.timeZone) },
                set: { d in
                    let time = TaskDates.fromPicker(d, timeZone: model.timeZone).time
                    if time != t.dueTime { save(TaskPatchArgs(id: t.id, dueTime: .set(time))) }
                }
            ), displayedComponents: .hourAndMinute)
            .environment(\.timeZone, model.timeZone)
            .labelsHidden()
            Spacer()
            if t.dueTime != nil {
                Button("All day") { save(TaskPatchArgs(id: t.id, dueTime: .clear)); showsTime = false }.buttonStyle(.folevi(.ghost, size: .small))
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private func quickDates(_ t: TaskRow, today: String) -> some View {
        let days = [("Today", today), ("Tomorrow", TaskDates.add(today, days: 1)), ("Next week", TaskDates.nextWeek(today))]
        return HStack(spacing: 8) {
            ForEach(days, id: \.0) { label, day in
                let on = t.dueDate == day
                Button {
                    model.edits.feedback.haptic(.selection)
                    save(TaskPatchArgs(id: t.id, dueDate: .set(day)))
                } label: {
                    Text(label)
                        .foleviFont(.callout).fontWeight(.medium)
                        .foregroundStyle(on ? Folevi.color.canvas : Folevi.color.ink)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(Capsule().fill(on ? Folevi.color.heading : Folevi.color.ink.opacity(0.07)))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    private static let priorities: [(TaskUpdateArgs.Priority, String)] = [(.none, "None"), (.low, "Low"), (.medium, "Medium"), (.high, "High")]

    private func priorityRow(_ t: TaskRow) -> some View {
        let current = TaskUpdateArgs.Priority(rawValue: t.priority ?? "none") ?? .none
        return Menu {
            Picker("Priority", selection: Binding(get: { current }, set: { p in
                guard p != current else { return }
                model.edits.feedback.haptic(.selection)
                save(TaskPatchArgs(id: t.id, priority: p))
            })) {
                ForEach(Self.priorities, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.inline)
        } label: {
            detailRow("flag", "Priority", value: Self.priorities.first { $0.0 == current }?.1 ?? "None", chevron: true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityIdentifier("task-priority")
    }

    private func assigneeRow(_ t: TaskRow) -> some View {
        let people = model.assignees
        let name = t.assigneeId.map { id in people.first { $0.id == id }?.name ?? t.assigneeName ?? "Someone" } ?? "Nobody"
        return Menu {
            Picker("Assignee", selection: Binding(get: { t.assigneeId ?? "" }, set: { id in
                guard id != (t.assigneeId ?? "") else { return }
                model.edits.feedback.haptic(.selection)
                save(TaskPatchArgs(id: t.id, assigneeId: id.isEmpty ? .clear : .set(id)))
            })) {
                Text("Nobody").tag("")
                Divider()
                ForEach(people, id: \.id) { m in Text(m.isYou ? "\(m.name) (you)" : m.name).tag(m.id) }
            }
            .pickerStyle(.inline)
        } label: {
            detailRow("person", "Assignee", value: name, chevron: true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityIdentifier("task-assignee")
    }

    // MARK: Saving

    private func setStatus(_ status: String) {
        let t = task
        guard status != t.status else { return }
        if status == "done" { model.edits.feedback.haptic(.success) } else { model.edits.feedback.haptic(.selection) }
        let patch: TaskPatchArgs
        switch status {
        case "canceled": patch = TaskPatchArgs(id: t.id, canceled: true)
        case "done": patch = TaskPatchArgs(id: t.id, checked: true)
        default: patch = t.status == "canceled" ? TaskPatchArgs(id: t.id, canceled: false) : TaskPatchArgs(id: t.id, checked: false)
        }
        save(patch)
    }

    private func save(_ patch: TaskPatchArgs) {
        Task { _ = await model.edits.update(task, patch) }
    }
}
