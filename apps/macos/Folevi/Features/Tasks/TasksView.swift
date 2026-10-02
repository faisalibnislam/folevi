import Observation
import SwiftUI
import UniformTypeIdentifiers

/// A task derived from its canonical todo block (the block stays the source of truth).
struct LocalTask: Identifiable, Hashable {
    var id: String { blockId }
    var blockId: String
    var documentId: String
    var documentTitle: String
    var documentIcon: String?
    var title: String
    var checked: Bool
    var canceled = false
    var dueDate: String?
    var dueTime: String?
    var priority: TaskPriority
    var assigneeId: String?
    var completedAt: Double?
    var updatedAt: Double = 0
    var wire: WireBlock

    var status: TaskLogic.Status { canceled ? .canceled : checked ? .done : .open }
}

@MainActor
enum TaskStore {
    /// Open and done tasks from local blocks (works offline); canceled ones are left out.
    static func load(app: AppModel) async -> [LocalTask] {
        await loadAll(app: app).filter { !$0.canceled }
    }

    /// Every task from local blocks, canceled ones too (Tasks' Completed view shows them).
    static func loadAll(app: AppModel) async -> [LocalTask] {
        guard let engine = app.session?.engine else { return [] }
        let docs = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return await engine.todoBlocks().compactMap { entry -> LocalTask? in
            // As the server's task index (convex/lib/documents.ts): checklists inside templates are blueprints,
            // not tasks.
            guard let doc = docs[entry.documentId], doc.deletedAt == nil, doc.kind != .template,
                  let p = try? entry.block.props.decode(TodoProps.self) else { return nil }
            return LocalTask(blockId: entry.block.id, documentId: entry.documentId, documentTitle: doc.title, documentIcon: doc.icon,
                             title: String(RichText.plainText(entry.block.inlineText).prefix(500)), checked: p.checked, canceled: p.canceled == true,
                             dueDate: p.dueDate, dueTime: p.dueTime, priority: p.priority ?? .none, assigneeId: p.assigneeId,
                             completedAt: p.completedAt, updatedAt: doc.updatedAt, wire: entry.block)
        }
    }

    static func setChecked(_ task: LocalTask, _ checked: Bool, app: AppModel) async {
        await edit(task, TaskEdit(checked: checked), app: app)
    }

    /// Edits a task's block with the server's rules (tasks:update), through the sync engine so it works offline.
    static func edit(_ task: LocalTask, _ change: TaskEdit, app: AppModel) async {
        guard !change.isEmpty else { return }
        await mutate(task, app: app) { change.apply(to: &$0, now: (Date().timeIntervalSince1970 * 1000).rounded()) }
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

    /// Quick Add: appends a to-do to a page, or to the person's Inbox page (created locally with its
    /// deterministic id). Returns the page it went to.
    static func quickAdd(title: String, dueDate: String?, dueTime: String? = nil, priority: TaskPriority = .none, documentId: String? = nil,
                         app: AppModel) async -> String? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let engine = app.session?.engine else { return nil }
        var target = documentId
        if target == nil { target = await app.inboxDocumentId() }
        guard let docId = target else { return nil }
        let siblings = await engine.blocks(documentId: docId).filter { $0.parentId == nil }
        let rank = (try? Tree.rankForPosition(siblings, parentId: nil, afterId: Tree.flatten(siblings).last?.block.id)) ?? "V"
        let props = TodoProps(checked: false, dueDate: dueDate, dueTime: dueDate != nil ? dueTime : nil, priority: priority == .none ? nil : priority)
        let block = WireBlock(id: ULID.make(), type: "todo", parentId: nil, rank: rank,
                              text: (try? JSONValue(encoding: RichText.text(String(trimmed.prefix(500))))) ?? .array([]),
                              props: (try? JSONValue(encoding: props)) ?? .emptyObject)
        await engine.applyLocal(documentId: docId, upserts: [(block, [.content, .position])])
        return docId
    }

    /// Checking a task off (or reopening it), with the web's toast and Undo (useToggleTask).
    static func toggle(_ task: LocalTask, app: AppModel) {
        Task {
            if task.canceled {
                await edit(task, TaskEdit(canceled: false), app: app)
                app.showToast(String(localized: "Task reopened"), action: .undo { Task { await edit(task, TaskEdit(canceled: true), app: app) } })
                return
            }
            let checked = !task.checked
            await edit(task, TaskEdit(checked: checked), app: app)
            app.showToast(checked ? String(localized: "Task completed") : String(localized: "Task reopened"),
                          action: .undo { Task { await edit(task, TaskEdit(checked: !checked), app: app) } })
        }
    }
}

/// The people a task can be assigned to: the workspace's members, or in Personal just you.
@MainActor
@Observable
final class TaskPeople {
    static let shared = TaskPeople()

    struct Person: Hashable, Identifiable {
        var id: String
        var name: String
        var isYou: Bool
    }

    private(set) var people: [Person] = []
    private var loadedScope: String?

    func name(_ id: String?) -> String? {
        guard let id else { return nil }
        return people.first { $0.id == id }?.name
    }

    func load(app: AppModel) async {
        guard let session = app.session, let profile = app.profile else { return }
        guard let workspaceId = session.scope.workspaceId else {
            people = [Person(id: profile.id, name: profile.displayName, isYou: true)]
            loadedScope = session.scope.key
            return
        }
        let key = "tasks.people.\(workspaceId)"
        if loadedScope != session.scope.key {
            people = ((try? await session.store.codable([CachedPerson].self, forKey: key)) ?? []).map { Person(id: $0.id, name: $0.name, isYou: $0.id == profile.id) }
            loadedScope = session.scope.key
        }
        guard app.sync.isOnline, let data = try? await session.workspacesRepo.members(workspaceId) else { return }
        people = data.members.map { Person(id: $0.profileId, name: $0.displayName, isYou: $0.isYou) }
        try? await session.store.setCodable(people.map { CachedPerson(id: $0.id, name: $0.name) }, forKey: key)
    }

    private struct CachedPerson: Codable { var id: String; var name: String }
}

/// Tasks (the web's TasksView): Inbox, Today, Upcoming, All, Completed and My Tasks, with counts, a filter,
/// and each task's page, assignee, priority and due date. Every task lives in a note.
struct TasksView: View {
    var openDocument: (String, Bool) -> Void
    /// Opens the calendar (it's reached from Tasks, as on the web).
    var openCalendar: (() -> Void)?
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
    @State private var view: TaskLogic.View = .today
    @State private var tasks: [LocalTask]?
    @State private var filter = ""
    @State private var editing: LocalTask?
    private var people: TaskPeople { .shared }

    private var today: String { TaskLogic.localDate() }
    private var personal: Bool { app.scope.isPersonal }

    private func matches(_ t: LocalTask, _ v: TaskLogic.View) -> Bool {
        TaskBrowse.views(status: t.status, dueDate: t.dueDate, assigneeId: t.assigneeId, today: today, viewerId: app.profile?.id ?? "", personal: personal).contains(v)
    }

    private func list(_ v: TaskLogic.View) -> [LocalTask] {
        let filtered = (tasks ?? []).filter { matches($0, v) }
        if v == .completed { return filtered.sorted { ($0.completedAt ?? $0.updatedAt) > ($1.completedAt ?? $1.updatedAt) }.prefix(200).map { $0 } }
        return filtered.sorted { TaskBrowse.openOrder(($0.dueDate, $0.dueTime, $0.updatedAt), ($1.dueDate, $1.dueTime, $1.updatedAt)) }
    }

    var body: some View {
        let all = list(view)
        let needle = filter.lowercased()
        let shown = all.filter { needle.isEmpty || $0.title.lowercased().contains(needle) || $0.documentTitle.lowercased().contains(needle) }
        let groups: [(key: String, label: String?, items: [LocalTask])] = view == .upcoming
            ? TaskBrowse.groupByDate(shown, dueDate: { $0.dueDate }).map { ($0.key, Optional($0.label), $0.items) }
            : [("all", nil, shown)]
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ViewBar(subtitle: "\(TaskBrowse.label(view))\(tasks == nil ? "" : " · \(shown.count) \(view == .completed ? "done" : "open")")",
                        statusIdentifier: "tasks.title") {
                    if let openCalendar {
                        Button(action: openCalendar) { Label("Calendar", systemImage: "calendar") }
                            .buttonStyle(.folevi(.secondary, .small, horizontalPadding: 12))
                            .accessibilityIdentifier("tasks.calendar")
                    }
                    Button { openWindow(id: "quickAdd") } label: { Label("Add task", systemImage: "plus") }
                        .buttonStyle(.folevi(.primary, .small))
                        .accessibilityIdentifier("tasks.add")
                }
                VStack(alignment: .leading, spacing: 0) {
                    tabs
                    TextField("Filter by task or page", text: $filter)
                        .textFieldStyle(.plain)
                        .font(.ui(13))
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .foleviWell(shape: .rounded(6))
                        .padding(.top, 16)
                        .accessibilityLabel(Text("Filter tasks"))
                    if tasks == nil {
                        VStack(spacing: 8) {
                            ForEach(0..<3, id: \.self) { _ in PulsePlaceholder(radius: 6, fill: FoleviColor.surface).frame(height: 48) }
                        }
                        .padding(.top, 24)
                    } else if shown.isEmpty {
                        Text(filter.isEmpty ? TaskBrowse.emptyMessage(view, personal: personal) : String(localized: "No tasks match that filter."))
                            .font(FoleviType.display(24))
                            .tracking(FoleviType.displayTracking(24))
                            .foregroundStyle(FoleviColor.inkMuted)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    } else {
                        ForEach(groups, id: \.key) { g in
                            VStack(alignment: .leading, spacing: 8) {
                                if let label = g.label {
                                    Text(label).font(.ui(12, .semibold)).textCase(.uppercase).tracking(0.06 * 12).foregroundStyle(FoleviColor.inkFaint)
                                        .accessibilityAddTraits(.isHeader)
                                }
                                TaskList(items: g.items, today: today, openDocument: openDocument, onEdit: { editing = $0 })
                            }
                            .padding(.top, 24)
                            .accessibilityElement(children: .contain)
                            .accessibilityLabel(Text(g.label ?? TaskBrowse.label(view)))
                        }
                    }
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: 768, alignment: .leading) // the max width includes the padding, as in CSS
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .onChange(of: view, initial: true) { _, v in app.tasksViewLabel = TaskBrowse.label(v) }
        .task { await reload() }
        .task(id: app.scope.key) { await people.load(app: app) }
        .onAppear {
            if let v = TasksRoute.pending {
                view = v
                TasksRoute.pending = nil
            }
        }
        .onChange(of: app.blockRevision) { _, _ in Task { await reload() } }
        .onChange(of: app.documentsRevision) { _, _ in Task { await reload() } }
        // The top bar's "Add Task" (and the menu command) open Quick add, as on the web.
        .onReceive(NotificationCenter.default.publisher(for: .foleviFocusQuickTask)) { _ in openWindow(id: "quickAdd") }
        .foleviDialog(item: $editing) { t in TaskEditSheet(task: t, openDocument: openDocument).environment(app) }
    }

    /// The views as a segmented row; open counts in small badges (Completed has none).
    private var tabs: some View {
        HStack(spacing: 2) {
            ForEach(TaskLogic.View.allCases) { v in
                let active = v == view
                let n = v == .completed ? 0 : (tasks ?? []).filter { matches($0, v) }.count
                Button { view = v } label: {
                    HStack(spacing: 6) {
                        Text(TaskBrowse.label(v)).lineLimit(1)
                        if n > 0 {
                            Text("\(n)")
                                .font(.ui(11, .semibold))
                                .monospacedDigit()
                                .foregroundStyle(active ? FoleviColor.canvas : FoleviColor.inkFaint)
                                .padding(.horizontal, 6)
                                .frame(minHeight: 18)
                                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(active ? FoleviColor.heading : .clear))
                        }
                    }
                    .font(.ui(13, active ? .semibold : .medium))
                    .foregroundStyle(active ? FoleviColor.heading : FoleviColor.inkMuted)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 32)
                    .background {
                        if active { Color.clear.foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(6), shadow: FoleviShadow.control) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(TaskBrowse.label(v)))
                .accessibilityValue(Text(n > 0 ? "\(n)" : ""))
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(2)
        .foleviWell(shape: .rounded(8))
        .help(Text("Every task lives in a note. Open its page to see the context it was written in."))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Task views"))
        .accessibilityIdentifier("tasks.viewPicker")
    }

    private func reload() async {
        tasks = await TaskStore.loadAll(app: app)
    }
}

/// Tasks in a card with dividers (a Tasks section, the calendar's day and its Unscheduled list).
struct TaskList<Action: View>: View {
    var items: [LocalTask]
    var today: String
    var openDocument: (String, Bool) -> Void
    var onEdit: ((LocalTask) -> Void)?
    @ViewBuilder var action: (LocalTask) -> Action

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, t in
                TaskItemRow(task: t, today: today, openDocument: openDocument, onEdit: onEdit, action: action(t))
                if i < items.count - 1 { FoleviColor.line.frame(height: 1) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .foleviCard(radius: 8)
    }
}

extension TaskList where Action == EmptyView {
    init(items: [LocalTask], today: String, openDocument: @escaping (String, Bool) -> Void, onEdit: ((LocalTask) -> Void)?) {
        self.init(items: items, today: today, openDocument: openDocument, onEdit: onEdit) { _ in EmptyView() }
    }
}

/// One task (the web's TaskItem): its checkbox, title, page, assignee, status, priority and due date, and an
/// edit button on hover. Drag it onto a calendar day to reschedule it.
struct TaskItemRow<Action: View>: View {
    let task: LocalTask
    let today: String
    var openDocument: (String, Bool) -> Void
    var onEdit: ((LocalTask) -> Void)?
    var action: Action
    @Environment(AppModel.self) private var app
    @State private var hovering = false
    private var people: TaskPeople { .shared }

    var body: some View {
        let closed = task.status != .open
        let overdue = TaskLogic.isOverdue(status: task.status, dueDate: task.dueDate, today: today)
        HStack(alignment: .top, spacing: 12) {
            TaskCheckbox(task: task) { TaskStore.toggle(task, app: app) }
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title.isEmpty ? String(localized: "Untitled task") : task.title)
                    .font(.ui(15))
                    .uiLineHeight(15 * 1.375, size: 15) // text-[15px] leading-snug
                    .strikethrough(closed, color: FoleviColor.inkMuted)
                    .foregroundStyle(closed ? FoleviColor.inkMuted : FoleviColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                FlowLayout(spacing: 8) {
                    // The web's "{icon} {title}" (the page's own icon first, when it has one).
                    PageLink(title: (task.documentIcon.flatMap { $0.isEmpty ? nil : $0 + " " } ?? "")
                             + (task.documentTitle.isEmpty ? String(localized: "Untitled") : task.documentTitle)) {
                        openDocument(task.documentId, NSEvent.modifierFlags.contains(.option))
                    }
                    if let name = people.name(task.assigneeId) { Text("· \(name)") }
                    if task.status == .canceled {
                        Text("Canceled").font(.ui(11, .medium)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 6)
                            .background(FoleviColor.surfaceSunken, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    if task.status == .done, let done = task.completedAt { Text("· done \(CollabTime.relative(done))") }
                }
                .font(.ui(12))
                .uiLineHeight(16, size: 12) // text-xs
                .foregroundStyle(FoleviColor.inkMuted)
                if !(action is EmptyView) { action.padding(.top, 4) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if task.priority != .none {
                Text(PriorityChoice.label(task.priority))
                    .font(.ui(11, .medium))
                    .uiLineHeight(11 * 1.55, size: 11, weight: .medium)
                    .foregroundStyle(task.priority == .high ? FoleviColor.coralInk : task.priority == .medium ? FoleviColor.marigoldInk : FoleviColor.inkMuted)
                    .padding(.horizontal, 8)
                    .background(task.priority == .high ? FoleviColor.coralSoft : task.priority == .medium ? FoleviColor.marigoldSoft : FoleviColor.surfaceSunken,
                                in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(.top, 2)
            }
            if let due = task.dueDate {
                Text("\(overdue ? "Overdue · " : "")\(BrowseFormat.dueLabel(due, today: today))\(task.dueTime.map { " \($0)" } ?? "")")
                    .font(.ui(12, overdue ? .medium : .regular))
                    .uiLineHeight(16, size: 12, weight: overdue ? .medium : .regular)
                    .foregroundStyle(overdue ? FoleviColor.destructive : FoleviColor.inkMuted)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.top, 2)
            }
            if let onEdit {
                Button { onEdit(task) } label: {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 12, weight: .medium))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(EditTaskButtonStyle())
                .help(Text("Edit task"))
                .accessibilityLabel(Text("Edit “\(task.title.isEmpty ? String(localized: "Untitled task") : task.title)”: date, priority, assignee, status"))
                .opacity(hovering ? 1 : 0)
                .padding(.vertical, -2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(hovering ? FoleviColor.surface : .clear)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .draggable(TaskDragPayload(blockId: task.blockId)) {
            Text(task.title).font(.ui(13, .medium)).padding(.horizontal, 12).frame(height: 30)
                .foleviSurface(.color(FoleviColor.surface), shape: .rounded(6), shadow: FoleviShadow.lift)
        }
        .accessibilityElement(children: .contain)
    }
}

extension TaskItemRow where Action == EmptyView {
    init(task: LocalTask, today: String, openDocument: @escaping (String, Bool) -> Void, onEdit: ((LocalTask) -> Void)?) {
        self.init(task: task, today: today, openDocument: openDocument, onEdit: onEdit, action: EmptyView())
    }
}

/// The task's page, as a link.
private struct PageLink: View {
    var title: String
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title).underline(hovering).foregroundStyle(hovering ? FoleviColor.ink : FoleviColor.inkMuted).lineLimit(1)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text("Open \(title)"))
    }
}

private struct EditTaskButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { Look(configuration: configuration) }
    private struct Look: View {
        let configuration: ButtonStyle.Configuration
        @State private var hovering = false
        var body: some View {
            configuration.label
                .foregroundStyle(hovering ? FoleviColor.ink : FoleviColor.inkFaint)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviColor.surfaceSunken : .clear))
                .onHover { hovering = $0 }
        }
    }
}

/// The task's checkbox: a moss check when done, a dash when canceled.
struct TaskCheckbox: View {
    let task: LocalTask
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                switch task.status {
                case .done:
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(LinearGradient(colors: [FoleviColor.moss.mix(with: .white, by: 0.18), FoleviColor.moss], startPoint: .top, endPoint: .bottom))
                    Text("✓").font(.system(size: 11)).foregroundStyle(.white)
                case .canceled:
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surfaceSunken)
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.lineStrong, lineWidth: 1.5)
                    Text("–").font(.system(size: 11)).foregroundStyle(FoleviColor.inkFaint)
                case .open:
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FoleviColor.surface)
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(hovering ? FoleviColor.moss : FoleviColor.lineStrong, lineWidth: 1.5)
                }
            }
            .frame(width: 18, height: 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(task.status == .done ? [.isSelected] : [])
    }

    private var label: String {
        let t = task.title
        switch task.status {
        case .done: return String(localized: "Mark “\(t)” as not done")
        case .canceled: return String(localized: "Reopen canceled task “\(t)”")
        case .open: return String(localized: "Mark “\(t)” as done")
        }
    }
}

/// Edits a task's status, due date and time, priority and assignee without opening its page (the web's
/// TaskEditDialog).
struct TaskEditSheet: View {
    let task: LocalTask
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @DialogDismiss private var dismiss
    @State private var status: TaskLogic.Status = .open
    @State private var dueDate = ""
    @State private var dueTime = ""
    @State private var priority: TaskPriority = .none
    @State private var assigneeId = ""
    private var people: TaskPeople { .shared }

    var body: some View {
        // The web's TaskEditDialog: the small dialog, the task's title under its heading, then the fields 16pt
        // apart.
        FoleviDialogShell(title: String(localized: "Edit task"), size: .sm, onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 16) {
                Text(task.title.isEmpty ? String(localized: "Untitled task") : task.title)
                    .font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                    .uiLineHeight(13 * 1.4286, size: 13)
                    .padding(.top, -8) // -mt-2
                VStack(alignment: .leading, spacing: 8) {
                    Text("Status").font(.ui(13, .medium)).foregroundStyle(FoleviColor.ink)
                    FoleviSegmented(selection: $status, items: [
                        .init(value: .open, title: "Open"), .init(value: .done, title: "Done"), .init(value: .canceled, title: "Canceled"),
                    ], height: 32, fontSize: 13, accessibilityLabel: "Status")
                    .fixedSize()
                }
                // Date and time side by side; Clear date wraps under them, as the web's flex-wrap row does here.
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .bottom, spacing: 12) {
                        FieldLabel(title: String(localized: "Due date")) {
                            DateField(date: $dueDate, accessibilityLabel: String(localized: "Due date")).frame(width: 134)
                        }
                        if !dueDate.isEmpty {
                            FieldLabel(title: String(localized: "Time (optional)")) {
                                TimeField(time: $dueTime, accessibilityLabel: String(localized: "Time (optional)")).frame(width: 104)
                            }
                        }
                    }
                    if !dueDate.isEmpty {
                        Button("Clear date") {
                            dueDate = ""
                            dueTime = ""
                        }
                        .buttonStyle(.folevi(.quiet, .small))
                    }
                }
                HStack(alignment: .bottom, spacing: 12) {
                    FieldLabel(title: String(localized: "Priority")) {
                        FoleviSelect(selection: $priority, options: PriorityChoice.options, accessibilityLabel: String(localized: "Priority"), height: 36)
                    }
                    FieldLabel(title: String(localized: "Assignee")) {
                        FoleviSelect(selection: $assigneeId, options: assigneeOptions, accessibilityLabel: String(localized: "Assignee"),
                                     fillsWidth: true, height: 36)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 8) {
                    Button {
                        dismiss()
                        openDocument(task.documentId, false)
                    } label: {
                        Text("Open in \(task.documentTitle.isEmpty ? String(localized: "Untitled") : task.documentTitle)")
                            .font(.ui(13)).underline().foregroundStyle(FoleviColor.accent).lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    Spacer(minLength: 8)
                    Button("Cancel") { dismiss() }.buttonStyle(.folevi(.secondary, .medium)).keyboardShortcut(.cancelAction)
                    Button("Save") { save() }.buttonStyle(.folevi(.primary, .medium)).keyboardShortcut(.defaultAction)
                }
            }
        }
        .background(FoleviColor.surface)
        .onAppear {
            status = task.status
            dueDate = task.dueDate ?? ""
            dueTime = task.dueTime ?? ""
            priority = task.priority
            assigneeId = task.assigneeId ?? ""
        }
    }

    private var assigneeOptions: [FoleviSelect<String>.Option] {
        var out: [FoleviSelect<String>.Option] = [.init(value: "", title: String(localized: "Unassigned"))]
        out += people.people.map { .init(value: $0.id, title: $0.isYou ? "\($0.name) (you)" : $0.name) }
        if let id = task.assigneeId, !people.people.contains(where: { $0.id == id }) {
            out.append(.init(value: id, title: String(localized: "Former member")))
        }
        return out
    }

    private func save() {
        let change = TaskEdit.fromForm(status: task.status, dueDate: task.dueDate, dueTime: task.dueTime, priority: task.priority, assigneeId: task.assigneeId,
                                       status: status, dueDate: dueDate, dueTime: dueTime, priority: priority, assigneeId: assigneeId)
        dismiss()
        Task {
            await TaskStore.edit(task, change, app: app)
            app.showToast(String(localized: "Task updated"))
        }
    }
}

struct TaskDragPayload: Codable, Transferable {
    var blockId: String
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviTask)
    }
}

extension Notification.Name {
    static let foleviFocusQuickTask = Notification.Name("FoleviFocusQuickTask")
}

extension UTType {
    static let foleviTask = UTType(exportedAs: "com.folevi.mac.task-ref")
}

// Quick Add Task lives in QuickAddTask.swift.

struct QuickAddTarget: Hashable {
    var id: String
    var title: String
}

/// "Add to": the Inbox, or any page here found by its title.
private struct QuickAddPagePicker: View {
    @Binding var target: QuickAddTarget?
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var open = false
    @State private var active = 0
    @FocusState private var focused: Bool

    private var options: [QuickAddTarget?] {
        let needle = SearchText.normalize(query)
        let pages = app.documents.filter { $0.deletedAt == nil && $0.kind != .template }
        let docs: [DocumentSummary] = needle.isEmpty
            ? Array(pages.sorted { $0.updatedAt > $1.updatedAt }.prefix(6))
            : Array(pages.filter { SearchText.normalize($0.title).contains(needle) }.sorted { $0.updatedAt > $1.updatedAt }.prefix(8))
        return [nil] + docs.map { QuickAddTarget(id: $0.id, title: $0.title) }
    }

    var body: some View {
        let list = options
        VStack(alignment: .leading, spacing: 4) {
            Text("Add to").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            HStack(spacing: 8) {
                if let target, !open {
                    HStack(spacing: 4) {
                        Text(target.title.isEmpty ? String(localized: "Untitled") : target.title).lineLimit(1)
                        Button { self.target = nil } label: {
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 20, height: 20).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Add to Inbox instead"))
                    }
                    .font(.ui(12.5, .medium))
                    .foregroundStyle(FoleviColor.accentSoftInk)
                    .padding(.leading, 10)
                    .padding(.trailing, 4)
                    .frame(height: 26)
                    .background(FoleviColor.accentSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                TextField(target == nil ? "Inbox, or search a page…" : "Search another page…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .foleviWell(shape: .rounded(6))
                    .onChange(of: focused) { _, on in open = on }
                    .onChange(of: query) { _, _ in
                        open = true
                        active = 0
                    }
                    .onKeyPress(.downArrow) {
                        open = true
                        active = min(active + 1, list.count - 1)
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        active = max(active - 1, 0)
                        return .handled
                    }
                    .onKeyPress(.return) {
                        guard open, list.indices.contains(active) else { return .ignored }
                        choose(list[active])
                        return .handled
                    }
                    .onExitCommand { open = false }
                    .accessibilityLabel(Text("Add to"))
            }
            if open {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(list.enumerated()), id: \.offset) { i, t in
                        Button { choose(t) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: t == nil ? "tray" : "doc.text").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                                Text(t.map { $0.title.isEmpty ? String(localized: "Untitled") : $0.title } ?? String(localized: "Inbox (your task page)"))
                                    .font(.ui(13.5)).foregroundStyle(FoleviColor.ink).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 30)
                            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(i == active ? FoleviGlass.hover : .clear))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { if $0 { active = i } }
                        .accessibilityAddTraits(i == active ? .isSelected : [])
                    }
                    if !query.isEmpty && list.count == 1 {
                        Text("No matching pages").font(.ui(13.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.vertical, 6)
                    }
                }
                .padding(6)
                .frame(maxHeight: 208)
                .foleviPop(radius: 10)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Pages"))
            }
        }
    }

    private func choose(_ t: QuickAddTarget?) {
        target = t
        query = ""
        open = false
        focused = false
    }
}
