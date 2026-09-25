import SwiftUI

/// A task derived from its canonical todo block (the block stays the source of truth).
struct LocalTask: Identifiable, Hashable {
    var id: String { blockId }
    var blockId: String
    var documentId: String
    var documentTitle: String
    var documentIcon: String?
    var title: String
    var checked: Bool
    var dueDate: String?
    var dueTime: String?
    var priority: TaskPriority
    var assigneeId: String?
    var completedAt: Double?
    var wire: WireBlock
}

@MainActor
enum TaskStore {
    /// All tasks from local blocks (works offline).
    static func load(app: AppModel) async -> [LocalTask] {
        guard let engine = app.session?.engine else { return [] }
        let docs = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return await engine.todoBlocks().compactMap { entry -> LocalTask? in
            guard let doc = docs[entry.documentId], doc.deletedAt == nil,
                  let p = try? entry.block.props.decode(TodoProps.self) else { return nil }
            if p.canceled == true { return nil }
            return LocalTask(blockId: entry.block.id, documentId: entry.documentId, documentTitle: doc.displayTitle, documentIcon: doc.icon,
                             title: RichText.plainText(entry.block.inlineText), checked: p.checked, dueDate: p.dueDate, dueTime: p.dueTime,
                             priority: p.priority ?? .none, assigneeId: p.assigneeId, completedAt: p.completedAt, wire: entry.block)
        }
    }

    static func setChecked(_ task: LocalTask, _ checked: Bool, app: AppModel) async {
        await mutate(task, app: app) { p in
            p.checked = checked
            p.completedAt = checked ? (Date().timeIntervalSince1970 * 1000).rounded() : nil
        }
    }

    static func mutate(_ task: LocalTask, app: AppModel, _ change: (inout TodoProps) -> Void) async {
        guard let engine = app.session?.engine else { return }
        let current = await engine.entity(task.blockId)?.block ?? task.wire
        guard var p = try? current.props.decode(TodoProps.self) else { return }
        change(&p)
        var block = current
        block.props = (try? JSONValue(encoding: p)) ?? block.props
        await engine.applyLocal(documentId: task.documentId, upserts: [(block, [.content])])
    }

    /// Quick Add: appends a to-do to today's Daily Note (created locally with its deterministic id).
    static func quickAdd(title: String, dueDate: String?, app: AppModel) async -> Bool {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let engine = app.session?.engine else { return false }
        guard let docId = await app.dailyNoteId(for: TaskLogic.localDate()) else { return false }
        let siblings = await engine.blocks(documentId: docId).filter { $0.parentId == nil }
        let rank = (try? Tree.rankForPosition(siblings, parentId: nil, afterId: Tree.flatten(siblings).last?.block.id)) ?? "V"
        let props = TodoProps(checked: false, dueDate: dueDate)
        let block = WireBlock(id: ULID.make(), type: "todo", parentId: nil, rank: rank,
                              text: (try? JSONValue(encoding: RichText.text(String(trimmed.prefix(500))))) ?? .array([]),
                              props: (try? JSONValue(encoding: props)) ?? .emptyObject)
        await engine.applyLocal(documentId: docId, upserts: [(block, [.content, .position])])
        return true
    }
}

struct TasksView: View {
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var view: TaskLogic.View = .today
    @State private var tasks: [LocalTask] = []
    @State private var quickTitle = ""

    private var today: String { TaskLogic.localDate() }

    private func matches(_ t: LocalTask, _ v: TaskLogic.View) -> Bool {
        TaskLogic.views(status: t.checked ? .done : .open, dueDate: t.dueDate, assigneeId: t.assigneeId, today: today,
                        viewerId: app.profile?.id ?? "").contains(v)
    }

    private var visible: [LocalTask] {
        let filtered = tasks.filter { matches($0, view) }
        if view == .completed { return filtered.sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) } }
        return filtered.sorted { a, b in
            let da = a.dueDate ?? "9999", db = b.dueDate ?? "9999"
            if da != db { return da < db }
            return a.title.localizedStandardCompare(b.title) == .orderedAscending
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Tasks").font(FoleviType.display(28)).accessibilityAddTraits(.isHeader)
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            Picker("View", selection: $view) {
                ForEach(TaskLogic.View.allCases) { v in
                    Text(label(v) + countSuffix(v)).tag(v)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .accessibilityIdentifier("tasks.viewPicker")
            HStack {
                Image(systemName: "plus.circle").foregroundStyle(FoleviColor.accent).accessibilityHidden(true)
                TextField("Add a task to today's note", text: $quickTitle)
                    .textFieldStyle(.plain)
                    .onSubmit { Task { await add() } }
                    .accessibilityIdentifier("tasks.quickAdd")
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(FoleviColor.surfaceRaised))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(FoleviColor.line))
            .padding(.horizontal, 24)
            if visible.isEmpty {
                EmptyStateView(systemImage: "checkmark.circle", title: "All clear", message: emptyMessage)
            } else {
                List {
                    ForEach(visible) { task in
                        TaskRow(task: task, today: today, openDocument: openDocument) { checked in
                            Task {
                                await TaskStore.setChecked(task, checked, app: app)
                                await reload()
                            }
                        }
                        .draggable(TaskDragPayload(blockId: task.blockId))
                    }
                }
                .scrollContentBackground(.hidden)
            }
        }
        .background(FoleviColor.canvas)
        .task { await reload() }
        .onChange(of: app.blockRevision) { _, _ in Task { await reload() } }
        .onChange(of: app.documentsRevision) { _, _ in Task { await reload() } }
    }

    private var emptyMessage: LocalizedStringKey {
        switch view {
        case .today: return "Nothing due today. Enjoy the calm."
        case .inbox: return "Tasks without a date land here."
        case .upcoming: return "No upcoming tasks."
        case .completed: return "Completed tasks appear here."
        case .mine: return "Nothing assigned to you."
        case .all: return "Add a to-do in any document with [] and a space."
        }
    }

    private func label(_ v: TaskLogic.View) -> String {
        switch v {
        case .inbox: return String(localized: "Inbox")
        case .today: return String(localized: "Today")
        case .upcoming: return String(localized: "Upcoming")
        case .all: return String(localized: "All")
        case .completed: return String(localized: "Completed")
        case .mine: return String(localized: "My Tasks")
        }
    }

    private func countSuffix(_ v: TaskLogic.View) -> String {
        guard v != .completed else { return "" }
        let n = tasks.filter { matches($0, v) }.count
        return n > 0 ? " \(n)" : ""
    }

    private func reload() async {
        tasks = await TaskStore.load(app: app)
    }

    private func add() async {
        let due: String? = view == .today ? today : nil
        if await TaskStore.quickAdd(title: quickTitle, dueDate: due, app: app) {
            quickTitle = ""
            await reload()
        }
    }
}

struct TaskRow: View {
    let task: LocalTask
    let today: String
    var openDocument: (String, Bool) -> Void
    var onToggle: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button { onToggle(!task.checked) } label: {
                Image(systemName: task.checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16))
                    .foregroundStyle(task.checked ? FoleviColor.accent : FoleviColor.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(task.checked ? "Mark as not done" : "Mark as done"))
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title.isEmpty ? String(localized: "Untitled task") : task.title)
                    .strikethrough(task.checked)
                    .foregroundStyle(task.checked ? FoleviColor.inkMuted : FoleviColor.ink)
                Button {
                    openDocument(task.documentId, NSEvent.modifierFlags.contains(.option))
                } label: {
                    Text("\(task.documentIcon ?? "📄") \(task.documentTitle)").font(.caption).foregroundStyle(FoleviColor.inkMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Open \(task.documentTitle)"))
            }
            Spacer()
            if task.priority != .none {
                Image(systemName: "flag.fill")
                    .foregroundStyle(task.priority == .high ? FoleviColor.coral : task.priority == .medium ? FoleviColor.marigold : FoleviColor.inkFaint)
                    .accessibilityLabel(Text("\(task.priority.rawValue) priority"))
            }
            if let due = task.dueDate {
                Chip(text: due == today ? String(localized: "Today") : (TaskLogic.parseLocalDate(due)?.formatted(.dateTime.month(.abbreviated).day()) ?? due),
                     systemImage: "calendar",
                     tint: !task.checked && due < today ? FoleviColor.destructive : FoleviColor.accent)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

struct TaskDragPayload: Codable, Transferable {
    var blockId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviTask)
    }
}

extension UTType {
    static let foleviTask = UTType(exportedAs: "com.folevi.mac.task-ref")
}

// MARK: - Quick Add panel

struct QuickAddView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var title = ""
    @State private var due: DueChoice = .none
    @State private var customDate = Date()
    @FocusState private var focused: Bool

    enum DueChoice: String, CaseIterable, Identifiable {
        case none, today, tomorrow, custom
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                FoleviMark(size: 16).foregroundStyle(FoleviColor.accent)
                Text("Quick Add Task").font(.headline)
            }
            if app.phase != .ready {
                Text("Sign in to Folevi to add tasks.").foregroundStyle(FoleviColor.inkMuted)
            } else {
                TextField("What needs doing?", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit { Task { await add() } }
                    .accessibilityIdentifier("quickAdd.title")
                Picker("Due", selection: $due) {
                    Text("No date").tag(DueChoice.none)
                    Text("Today").tag(DueChoice.today)
                    Text("Tomorrow").tag(DueChoice.tomorrow)
                    Text("Pick a date").tag(DueChoice.custom)
                }
                .pickerStyle(.segmented)
                if due == .custom {
                    DatePicker("Date", selection: $customDate, displayedComponents: .date)
                }
                Text("Tasks are added to today's Daily Note and sync when you're online.")
                    .font(.caption).foregroundStyle(FoleviColor.inkMuted)
                HStack {
                    Spacer()
                    Button("Cancel") { dismissWindow(id: "quickAdd") }.keyboardShortcut(.cancelAction)
                    Button("Add Task") { Task { await add() } }
                        .keyboardShortcut(.defaultAction)
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .padding(18)
        .frame(width: 380)
        .onAppear { focused = true }
    }

    private func add() async {
        let date: String? = {
            switch due {
            case .none: return nil
            case .today: return TaskLogic.localDate()
            case .tomorrow: return TaskLogic.addDays(TaskLogic.localDate(), 1)
            case .custom: return TaskLogic.localDate(customDate)
            }
        }()
        if await TaskStore.quickAdd(title: title, dueDate: date, app: app) {
            title = ""
            app.showToast(String(localized: "Task added to today's note"))
            dismissWindow(id: "quickAdd")
        }
    }
}

import UniformTypeIdentifiers
