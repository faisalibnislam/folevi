// The task dialogs as the web draws them: Edit task (views/TasksView.tsx TaskEditForm: status, due date and time,
// priority, assignee, Open in the page), Move task (MoveTaskDialog), and Quick add task (app/QuickAddTask.tsx:
// the task's words with the date and repeat Folevi reads in them, due date, time, priority and the page it goes
// to). Return in a field submits, Escape and Command-period close.
#if os(macOS)
import AppKit
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

private let priorities: [PlannerSelect.Option] = [
    .init(id: "none", title: "None"), .init(id: "low", title: "Low"), .init(id: "medium", title: "Medium"), .init(id: "high", title: "High"),
]

/// The footer row of a dialog's form: optional leading content, then Cancel and the primary button.
struct DialogButtons<Leading: View>: View {
    let primary: String
    var busy = false
    var disabled = false
    let cancel: () -> Void
    let submit: () -> Void
    @ViewBuilder var leading: () -> Leading
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: PS("edit.footer").resolve(scheme).gap) {
            leading()
            Spacer(minLength: 0)
            PlannerButton("Cancel", style: "edit.cancel", action: cancel)
                .keyboardShortcut(.cancelAction)
            PlannerButton(primary, style: "edit.save", hover: nil, action: submit)
                .keyboardShortcut(.defaultAction)
                .disabled(disabled || busy)
        }
    }
}

extension DialogButtons where Leading == EmptyView {
    init(primary: String, busy: Bool = false, disabled: Bool = false, cancel: @escaping () -> Void, submit: @escaping () -> Void) {
        self.init(primary: primary, busy: busy, disabled: disabled, cancel: cancel, submit: submit, leading: { EmptyView() })
    }
}

struct DialogError: View {
    let text: String?
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        if let text {
            Text(text).webText(.role(.subheadline)).foregroundStyle(PV("color-danger").c(scheme)).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: Edit task

struct TaskEditDialog: View {
    let tasks: PlannerTasks
    let task: TaskRow
    let close: () -> Void
    @State private var status: String
    @State private var dueDate: String
    @State private var dueTime: String
    @State private var priority: String
    @State private var assignee: String
    @State private var busy = false
    @State private var error: String?
    @State private var overLink = false
    @Environment(\.colorScheme) private var scheme

    init(tasks: PlannerTasks, task: TaskRow, close: @escaping () -> Void) {
        self.tasks = tasks
        self.task = task
        self.close = close
        _status = State(initialValue: task.status)
        _dueDate = State(initialValue: task.dueDate ?? "")
        _dueTime = State(initialValue: task.dueTime ?? "")
        _priority = State(initialValue: task.priority ?? "none")
        _assignee = State(initialValue: task.assigneeId ?? "")
    }

    var body: some View {
        let form = PS("edit.form").resolve(scheme)
        let row = PS("edit.dates").resolve(scheme)
        PlannerDialog(title: "Edit task", close: close) {
            VStack(alignment: .leading, spacing: 0) {
                let t = PS("edit.task").resolve(scheme)
                Text(task.title.isEmpty ? "Untitled task" : task.title).webText(t.text).foregroundStyle(t.color.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, t.margin.top).padding(.bottom, t.margin.bottom)
                VStack(alignment: .leading, spacing: form.gap) {
                    VStack(alignment: .leading, spacing: PS("edit.seg").resolve(scheme).margin.top) {
                        StyledText("Status", "edit.legend")
                        WebSeg(items: [SegItem(id: "open", title: "Open"), SegItem(id: "done", title: "Done"), SegItem(id: "canceled", title: "Canceled")], selected: status, base: "edit.seg", fill: false) { status = $0 }
                            .fixedSize()
                    }
                    VStack(alignment: .leading, spacing: row.gap) {
                        HStack(alignment: .bottom, spacing: row.gap) {
                            FieldLabel(title: "Due date") { PlannerDateField(value: $dueDate, clearable: false) }
                            if !dueDate.isEmpty { FieldLabel(title: "Time (optional)") { PlannerTimeField(value: $dueTime) } }
                        }
                        if !dueDate.isEmpty {
                            PlannerButton("Clear date", style: "edit.clear") {
                                dueDate = ""
                                dueTime = ""
                            }
                        }
                    }
                    HStack(alignment: .bottom, spacing: row.gap) {
                        FieldLabel(title: "Priority") { PlannerSelect(options: priorities, value: $priority, label: "Priority") }
                        FieldLabel(title: "Assignee") { PlannerSelect(options: people, value: $assignee, fill: true, label: "Assignee") }
                            .frame(maxWidth: .infinity)
                    }
                    DialogError(text: error)
                    DialogButtons(primary: "Save", busy: busy, cancel: close, submit: save) {
                        let link = PS("edit.open").resolve(scheme)
                        Button {
                            tasks.openNote(task)
                            close()
                        } label: {
                            Text("Open in \(task.noteTitle.isEmpty ? "Untitled" : task.noteTitle)").webText(link.text).lineLimit(1)
                                .underline(true, color: link.color.color.opacity(overLink ? 1 : 0.6))
                                .foregroundStyle(link.color.color)
                        }
                        .buttonStyle(PlainPress())
                        .onHover { overLink = $0 }
                    }
                }
            }
        }
    }

    private var people: [PlannerSelect.Option] {
        var out: [PlannerSelect.Option] = [.init(id: "", title: "Unassigned")]
        let members = tasks.host.assignees
        out += members.map { .init(id: $0.id, title: $0.name + ($0.isYou ? " (you)" : "")) }
        if let a = task.assigneeId, !members.contains(where: { $0.id == a }) {
            out.append(.init(id: a, title: task.assigneeName ?? "Former member"))
        }
        return out
    }

    private func save() {
        guard !busy else { return }
        busy = true
        error = nil
        var args = TaskPatchArgs(id: task.id)
        if status != task.status {
            if status == "canceled" { args.canceled = true } else if status == "done" { args.checked = true } else if task.status == "canceled" { args.canceled = false } else { args.checked = false }
        }
        let date: String? = dueDate.isEmpty ? nil : dueDate
        if date != task.dueDate { args.dueDate = date.map { .set($0) } ?? .clear }
        let time: String? = date == nil ? nil : (dueTime.isEmpty ? nil : dueTime)
        if time != task.dueTime { args.dueTime = time.map { .set($0) } ?? .clear }
        if priority != (task.priority ?? "none") { args.priority = TaskUpdateArgs.Priority(rawValue: priority) }
        let who: String? = assignee.isEmpty ? nil : assignee
        if who != task.assigneeId { args.assigneeId = who.map { .set($0) } ?? .clear }
        let frame = tasks.frame
        let edits = tasks.edits
        Task {
            if await edits.update(task, args) {
                frame.toast("Task updated", tone: .success)
                close()
            } else {
                error = "Couldn't save the task."
            }
            busy = false
        }
    }
}

// MARK: Move task

struct MoveTaskDialog: View {
    let tasks: PlannerTasks
    let task: TaskRow
    let close: () -> Void
    @State private var target: PageTarget?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        PlannerDialog(title: "Move task", description: "Move “\(task.title.isEmpty ? "Untitled task" : task.title)” to the end of another page.", close: close) {
            VStack(alignment: .leading, spacing: 0) {
                DocumentPicker(client: tasks.frame.client, value: $target, label: "Move to", exclude: task.noteId)
                DialogError(text: error).padding(.top, error == nil ? 0 : 12)
                DialogButtons(primary: "Move", busy: busy, cancel: close, submit: move).padding(.top, 20)
            }
        }
    }

    private func move() {
        busy = true
        let frame = tasks.frame
        let target = self.target
        Task {
            do {
                _ = try await frame.client.command(.taskMoveToNote(id: task.id, noteId: target?.id))
                frame.toast("Task moved to \(target.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Inbox")", tone: .success)
                close()
            } catch {
                self.error = ScreenErrors.message(error)
            }
            busy = false
        }
    }
}

// MARK: Quick add task

struct QuickAddDialog: View {
    let frame: FrameModel
    var initialDue: String?
    var currentNote: PageTarget?
    let close: () -> Void
    @State private var title = ""
    @State private var due = ""
    @State private var time = ""
    @State private var priority = "none"
    @State private var target: PageTarget?
    @State private var targetChosen = false
    @State private var parsed: TaskParseValue?
    @State private var keepText = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let fields = PS("quick.fields").resolve(scheme)
        PlannerDialog(title: "Quick add task", description: "Press Enter to add. Tasks without a page go to your Inbox page.", close: close) {
            VStack(alignment: .leading, spacing: 0) {
                PlannerField(placeholder: "What needs doing?", text: $title, style: "quick.input", focused: $focused) { submit() }
                    .onChange(of: title) { _, _ in error = nil; keepText = false }
                if let r = repeatLabel {
                    chip(icon: .repeat, text: r) { keepText = true }.padding(.top, 8)
                }
                if let d = dueLabel {
                    HStack(spacing: 8) {
                        chip(icon: .calendarDays, text: "Due \(d)") { keepText = true }
                        if let words = parsed?.dateText {
                            Text("from “\(words.trimmingCharacters(in: .whitespaces))”").webText(.role(.subheadline)).lineLimit(1).foregroundStyle(PV("color-ink-muted").c(scheme))
                        }
                    }
                    .padding(.top, 8)
                }
                Group {
                    if due.isEmpty {
                        HStack(alignment: .bottom, spacing: fields.gap) {
                            FieldLabel(title: "Due date") { PlannerDateField(value: $due) }
                            FieldLabel(title: "Priority") { PlannerSelect(options: priorities, value: $priority, label: "Priority") }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: fields.gap) {
                            HStack(alignment: .bottom, spacing: fields.gap) {
                                FieldLabel(title: "Due date") { PlannerDateField(value: $due) }
                                FieldLabel(title: "Time (optional)") { PlannerTimeField(value: $time) }
                            }
                            FieldLabel(title: "Priority") { PlannerSelect(options: priorities, value: $priority, label: "Priority") }
                        }
                    }
                }
                .padding(.top, fields.margin.top)
                DocumentPicker(client: frame.client, value: Binding(get: { effective }, set: { target = $0; targetChosen = true }))
                    .padding(.top, 12)
                DialogError(text: error).padding(.top, error == nil ? 0 : 12)
                DialogButtons(primary: "Add task", busy: busy, cancel: close, submit: submit).padding(.top, 20)
            }
        }
        .onAppear {
            if let initialDue { due = initialDue }
            focused = true
        }
        .task(id: title) { await parse() }
    }

    private var effective: PageTarget? { targetChosen ? target : currentNote }

    private var dueLabel: String? {
        guard due.isEmpty, !keepText, let p = parsed, let d = p.dueDate else { return nil }
        let today = TaskDates.today()
        let day = PlannerDates.dueLabel(d, today: today)
        let words = ["Today", "Tomorrow", "Yesterday"].contains(day) ? day.lowercased() : day
        return "\(words)\(p.dueTime.map { " \($0)" } ?? "")"
    }

    private var repeatLabel: String? {
        guard !keepText, let p = parsed else { return nil }
        return p.repeatLabel
    }

    private func chip(icon: WebIcon, text: String, keep: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            WebIconView(icon, size: 13)
            Text(text).webText(.role(.footnote, weight: 500)).lineLimit(1)
            ClearButton(action: keep).padding(.trailing, -4).help("Keep as text")
        }
        .foregroundStyle(PV("color-accent-soft-ink").c(scheme))
        .padding(.leading, 8).padding(.trailing, 6)
        .frame(height: 24)
        .background(RoundedRectangle(cornerRadius: 6, style: .circular).fill(PV("color-accent-soft").c(scheme)))
    }

    private func parse() async {
        let text = title.trimmingCharacters(in: .whitespaces)
        guard text.count >= 3 else { parsed = nil; return }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return }
        let v = try? await frame.client.query(.taskParse(text: text))
        guard !Task.isCancelled else { return }
        parsed = v
    }

    private func submit() {
        guard !busy else { return }
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            error = "Write the task first."
            return
        }
        busy = true
        error = nil
        let where_ = effective.map { $0.title.isEmpty ? "Untitled" : $0.title } ?? "Inbox"
        let frame = self.frame
        let p: TaskCreateArgs.Priority? = priority == "none" ? nil : TaskCreateArgs.Priority(rawValue: priority)
        Task {
            do {
                let r = try await frame.client.command(.taskCreate(text: text, noteId: effective?.id, dueDate: due.isEmpty ? nil : due, dueTime: due.isEmpty || time.isEmpty ? nil : time, priority: p, keepText: keepText || !due.isEmpty ? true : nil))
                close()
                frame.toast("Task added to \(where_)", tone: .success, actionTitle: "Open") { frame.open(.note(r.noteId)) }
            } catch {
                self.error = ScreenErrors.message(error)
            }
            busy = false
        }
    }
}

extension FrameModel {
    /// Quick Add task (the web's dialog), over this window; `due` starts it on a day.
    func showQuickAdd(in window: NSWindow?, due: String? = nil) {
        guard let window = window ?? NSApp.keyWindow else { return }
        PlannerPanel.dialog(in: window) { close in
            QuickAddDialog(frame: self, initialDue: due, close: close)
        }
    }
}
#endif
