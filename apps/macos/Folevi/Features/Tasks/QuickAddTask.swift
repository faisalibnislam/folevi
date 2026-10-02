import SwiftUI

/// Quick Add Task (⇧⌘A), as the web's QuickAddTask: the task becomes a to-do in the chosen page (the open
/// page by default, or the Inbox page when none is chosen), with an optional due date, time and priority.
/// Every task always lives in a page. Works offline (the to-do is written through the sync engine).
struct QuickAddTaskDialog: View {
    /// The page open in this window (the default target).
    var documentId: String?
    /// Opens the page a task went to (the toast's "Open").
    var openDocument: (String) -> Void
    @DialogDismiss private var dismiss

    var body: some View {
        FoleviDialogShell(title: String(localized: "Quick add task"),
                          description: String(localized: "Press Enter to add. Tasks without a page go to your Inbox page."),
                          size: .sm, onClose: { dismiss() }) {
            QuickAddForm(currentDoc: documentId, openDocument: openDocument) { dismiss() }
        }
    }
}

/// The standalone Quick Add window (the menu bar's "Quick Add Task…" while no Folevi window is in front).
struct QuickAddView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        Group {
            if app.phase != .ready {
                FoleviDialogShell(title: String(localized: "Quick add task"), size: .sm, onClose: { dismissWindow(id: "quickAdd") }) {
                    Text("Sign in to Folevi to add tasks.").font(.ui(14)).foregroundStyle(FoleviColor.inkMuted)
                }
            } else {
                FoleviDialogShell(title: String(localized: "Quick add task"),
                                  description: String(localized: "Press Enter to add. Tasks without a page go to your Inbox page."),
                                  size: .sm, onClose: { dismissWindow(id: "quickAdd") }) {
                    QuickAddForm(currentDoc: nil, openDocument: { id in
                        NSApp.activate()
                        OpenWindowBridge.shared.openDocument?(id)
                    }) { dismissWindow(id: "quickAdd") }
                }
            }
        }
        // The web's dialog card (radius 14) at the top of a see-through window: the window keeps a title bar's
        // worth of extra height that macOS won't give up, and it stays invisible below the card.
        .background(FoleviColor.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(QuickAddWindowChrome())
        .ignoresSafeArea()
        .containerBackground(.clear, for: .window)
    }
}

private struct QuickAddForm: View {
    var currentDoc: String?
    var openDocument: (String) -> Void
    var close: () -> Void
    @Environment(AppModel.self) private var app
    @State private var title = ""
    @State private var due: Date?
    @State private var time: Date?
    @State private var priority: TaskPriority = .none
    /// nil: not chosen yet (the open page, else the Inbox); .some(nil): the Inbox; .some(id): that page.
    @State private var target: String??
    @State private var busy = false
    @State private var error: String?
    @FocusState private var titleFocused: Bool

    /// The open page when it's a normal page you can see, otherwise the Inbox.
    private var effective: String? {
        if let target { return target }
        guard let id = currentDoc, let d = app.document(id), d.deletedAt == nil else { return nil }
        return id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("What needs doing?", text: $title)
                .textFieldStyle(.plain)
                .font(.ui(15))
                .focused($titleFocused)
                .padding(.horizontal, 12)
                .frame(height: 44)
                .foleviInputSurface(focused: titleFocused)
                .onChange(of: title) { _, v in
                    error = nil
                    if v.count > 500 { title = String(v.prefix(500)) }
                }
                .onSubmit(add)
                .accessibilityLabel(Text("Task"))
            HStack(alignment: .bottom, spacing: 12) {
                field(String(localized: "Due date")) {
                    OptionalDateField(value: $due, components: .date, placeholder: String(localized: "mm/dd/yyyy"), label: String(localized: "Due date"))
                }
                if due != nil {
                    field(String(localized: "Time (optional)")) {
                        OptionalDateField(value: $time, components: .hourAndMinute, placeholder: "--:--", label: String(localized: "Time"))
                    }
                }
                field(String(localized: "Priority")) {
                    FoleviSelect(selection: $priority, options: [
                        .init(value: .none, title: String(localized: "None")), .init(value: .low, title: String(localized: "Low")),
                        .init(value: .medium, title: String(localized: "Medium")), .init(value: .high, title: String(localized: "High")),
                    ], accessibilityLabel: String(localized: "Priority"), height: 36, fontSize: 13)
                }
            }
            .padding(.top, 12)
            DocumentPicker(value: effective) { target = .some($0) }
                .padding(.top, 12)
            if let error {
                Text(error).font(.ui(13)).foregroundStyle(FoleviColor.destructive).padding(.top, 12)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            HStack(spacing: 8) {
                Spacer()
                Button("Cancel", action: close).buttonStyle(.folevi(.secondary, .medium)).keyboardShortcut(.cancelAction)
                Button("Add task", action: add).buttonStyle(.folevi(.primary, .medium)).disabled(busy)
                    .accessibilityIdentifier("quickAdd.add")
            }
            .padding(.top, 20)
        }
        .claimsFocus($titleFocused)
        .accessibilityIdentifier("quickAdd.title")
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            content()
        }
    }

    private func add() {
        guard !busy else { return }
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            error = String(localized: "Write the task first.")
            return
        }
        busy = true
        error = nil
        let dueDate = due.map { TaskLogic.localDate($0) }
        let dueTime: String? = (due != nil) ? time.map { Self.timeString($0) } : nil
        let page = effective
        let pageTitle = page.flatMap { app.document($0)?.title }
        Task {
            defer { busy = false }
            guard let docId = await QuickAdd.add(title: text, dueDate: dueDate, dueTime: dueTime, priority: priority, documentId: page, app: app) else {
                error = String(localized: "Something went wrong. Please try again.")
                return
            }
            close()
            let message = page != nil
                ? String(localized: "Task added to \((pageTitle?.isEmpty ?? true) ? String(localized: "Untitled") : pageTitle!)")
                : String(localized: "Task added to Inbox")
            app.showToast(message, action: ToastAction(title: String(localized: "Open")) { openDocument(docId) }, tone: .success)
        }
    }

    private static func timeString(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// A date (or time) the person may leave empty: empty shows a placeholder in an input; filled, the field and
/// a clear button.
private struct OptionalDateField: View {
    @Binding var value: Date?
    var components: DatePickerComponents
    var placeholder: String
    var label: String

    var body: some View {
        HStack(spacing: 4) {
            if let v = value {
                DatePicker(label, selection: Binding(get: { v }, set: { value = $0 }), displayedComponents: components)
                    .labelsHidden()
                    .datePickerStyle(.field)
                    .font(.ui(13))
                Button { value = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 9.5, weight: .bold)).foregroundStyle(FoleviColor.inkFaint)
                        .frame(width: 18, height: 18).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear \(label)"))
            } else {
                Button {
                    value = components == .date ? Date() : Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date())
                } label: {
                    // The web's empty date input: its format hint and a calendar icon, 134pt wide with padding.
                    HStack(spacing: 6) {
                        Text(placeholder).font(.ui(13)).foregroundStyle(FoleviColor.inkFaint)
                        Spacer(minLength: 0)
                        Image(systemName: components == .date ? "calendar" : "clock").font(.system(size: 12)).foregroundStyle(FoleviColor.ink)
                    }
                    .frame(width: components == .date ? 118 : 84)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(label))
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 36)
        .foleviInputSurface()
    }
}

/// "Add to": the Inbox, or any page in the open scope found by search (the web's DocumentPicker).
private struct DocumentPicker: View {
    /// The chosen page; nil is the Inbox.
    var value: String?
    var choose: (String?) -> Void
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var open = false
    @State private var active = 0
    @State private var hits: [(id: String, title: String)]?
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var options: [(id: String?, title: String)] {
        let q = query.trimmingCharacters(in: .whitespaces)
        let docs: [(id: String, title: String)]
        if q.isEmpty {
            docs = app.documents.filter { $0.deletedAt == nil && $0.kind != .template && $0.kind != .collectionRow }
                .sorted { $0.updatedAt > $1.updatedAt }.prefix(6).map { ($0.id, $0.title) }
        } else {
            docs = hits ?? []
        }
        return [(nil, String(localized: "Inbox (your task page)"))] + docs.map { (Optional($0.id), $0.title) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Add to").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
            HStack(spacing: 8) {
                if let value, !open {
                    HStack(spacing: 4) {
                        Text(title(value)).font(.ui(12.5, .semibold)).lineLimit(1)
                        Button { choose(nil) } label: {
                            Image(systemName: "xmark").font(.system(size: 9.5, weight: .bold)).frame(width: 20, height: 20).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Add to Inbox instead"))
                    }
                    .foregroundStyle(FoleviColor.accentSoftInk)
                    .padding(.leading, 10)
                    .padding(.trailing, 2)
                    .frame(height: 26)
                    .background(FoleviColor.accentSoft, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                TextField(value != nil ? String(localized: "Search another page…") : String(localized: "Inbox, or search a page…"), text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(13))
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .foleviInputSurface(focused: focused || open)
                    .onChange(of: focused) { _, f in if f { open = true } }
                    .onChange(of: query) { _, _ in
                        open = true
                        active = 0
                        search()
                    }
                    .onKeyPress(.downArrow) {
                        open = true
                        active = min(options.count - 1, active + 1)
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        active = max(0, active - 1)
                        return .handled
                    }
                    .onKeyPress(.return) {
                        guard open else { return .ignored }
                        pick(options[min(active, options.count - 1)].id)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        guard open else { return .ignored }
                        open = false
                        return .handled
                    }
                    .accessibilityLabel(Text("Add to"))
            }
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(options.enumerated()), id: \.offset) { idx, o in
                        Button { pick(o.id) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: o.id == nil ? "tray" : "doc.text").font(.system(size: 12)).foregroundStyle(FoleviColor.inkMuted)
                                Text(o.title.isEmpty ? String(localized: "Untitled") : o.title).font(.ui(13.5)).lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .foregroundStyle(idx == active ? FoleviColor.heading : FoleviColor.ink)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(idx == active ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .onHover { if $0 { active = idx } }
                    }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty, let hits, hits.isEmpty {
                        Text("No matching pages").font(.ui(13.5)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 8).padding(.vertical, 6)
                    }
                }
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foleviGlassPop()
                .padding(.top, 4)
            }
        }
    }

    private func title(_ id: String) -> String {
        let t = app.document(id)?.title ?? ""
        return t.isEmpty ? String(localized: "Untitled") : t
    }

    private func pick(_ id: String?) {
        choose(id)
        query = ""
        open = false
    }

    /// Searches the open scope 150ms after typing stops (this Mac's copy offline).
    private func search() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        hits = nil
        guard !q.isEmpty else { return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            if app.sync.isOnline, let session = app.session,
               let found = try? await session.search.search(scope: session.scope, query: q, limit: 8) {
                hits = found.filter { $0.kind != "template" }.map { ($0.id, $0.title) }
            } else {
                let n = SearchText.normalize(q)
                hits = app.documents.filter { $0.deletedAt == nil && $0.kind != .template && SearchText.normalize($0.title).contains(n) }
                    .prefix(8).map { ($0.id, $0.title) }
            }
        }
    }
}

/// Writes a quick-added to-do through the sync engine (offline too): at the end of the chosen page, or the
/// person's Inbox page (created locally with its deterministic id). Returns the page's id.
@MainActor
enum QuickAdd {
    static func add(title: String, dueDate: String?, dueTime: String? = nil, priority: TaskPriority = .none, documentId: String? = nil,
                    app: AppModel) async -> String? {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let engine = app.session?.engine else { return nil }
        let target: String?
        if let documentId { target = documentId } else { target = await app.inboxDocumentId() }
        guard let docId = target else { return nil }
        let siblings = await engine.blocks(documentId: docId).filter { $0.parentId == nil }
        let rank = (try? Tree.rankForPosition(siblings, parentId: nil, afterId: Tree.flatten(siblings).last?.block.id)) ?? "V"
        let props = TodoProps(checked: false, dueDate: dueDate, dueTime: dueDate == nil ? nil : dueTime, priority: priority == .none ? nil : priority)
        let block = WireBlock(id: ULID.make(), type: "todo", parentId: nil, rank: rank,
                              text: (try? JSONValue(encoding: RichText.text(String(trimmed.prefix(500))))) ?? .array([]),
                              props: (try? JSONValue(encoding: props)) ?? .emptyObject)
        await engine.applyLocal(documentId: docId, upserts: [(block, [.content, .position])])
        return docId
    }
}

/// The Quick Add window without traffic lights (its dialog has a Close button), movable by its background, and
/// see-through around its card (the shadow follows the card).
private struct QuickAddWindowChrome: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { ChromeView() }
    func updateNSView(_ view: NSView, context: Context) {}

    private final class ChromeView: NSView {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { window.standardWindowButton(kind)?.isHidden = true }
            window.isMovableByWindowBackground = true
            window.isOpaque = false
            window.backgroundColor = .clear
            window.hasShadow = true
            DispatchQueue.main.async { window.invalidateShadow() }
        }
    }
}
