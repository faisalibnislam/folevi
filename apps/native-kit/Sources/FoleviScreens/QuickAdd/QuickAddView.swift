// Quick Add's content (QuickAddModel). iPhone and iPad: a sheet with Task / Note, the field with its round add
// button, the line saying what was read, and a row of chips (Date, Time, Priority, where it goes). Mac: the panel's
// one growing field (docs/MAC_POLISH_PLAN.md 3.8): a 56 pt row with the checkbox outline, the field and the place
// chip, and a second row only once there's something to show. Keys on the Mac: Return adds and closes, Shift-Return
// adds and stays for another, Command-Return adds and opens it, Command-1 and Command-2 pick Task or Note, Escape
// closes (the panel). In a note, Return is a new line and Command-Return adds.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct QuickAddView: View {
    public enum Style: Sendable { case sheet, panel }

    @Bindable var model: QuickAddModel
    let style: Style
    let close: () -> Void
    @FocusState private var focused: Bool
    @State private var pickingPage = false
    @State private var pickingDate = false

    public init(model: QuickAddModel, style: Style? = nil, close: @escaping () -> Void = {}) {
        self.model = model
        #if os(macOS)
        self.style = style ?? .panel
        #else
        self.style = style ?? .sheet
        #endif
        self.close = close
    }

    public var body: some View {
        Group {
            if style == .panel { panel } else { sheet }
        }
        .onAppear {
            focused = true
            model.start()
        }
        .accessibilityIdentifier("quick-add")
    }

    // MARK: iPhone and iPad

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 10) {
            SegmentedControl(selection: $model.mode, options: [(QuickAddModel.Mode.task, "Task"), (.note, "Note")])
                .frame(maxWidth: 260)
                .accessibilityIdentifier("quick-add-mode")
            HStack(alignment: .top, spacing: 8) {
                field
                    .font(FoleviFonts.font(.ui, size: 17, relativeTo: .body))
                    .frame(minHeight: 44)
                Button { Task { await model.save() } } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Folevi.color.canvas)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Folevi.color.heading))
                        .opacity(model.canSave ? 1 : 0.3)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(!model.canSave)
                .accessibilityLabel(model.mode == .task ? "Add task" : "Add note")
                .accessibilityIdentifier("quick-add-save")
            }
            readLines
            chips
            status
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(Folevi.color.canvas)
    }

    // MARK: Mac panel

    private var panel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: model.mode == .task ? "square" : "doc.text")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(Folevi.color.inkFaint)
                    .frame(width: 22)
                field
                    .font(FoleviFonts.font(.ui, size: 17))
                    .lineLimit(1...5)
                destinationMenu(compact: true)
            }
            .padding(.horizontal, 18)
            .frame(minHeight: 56)
            if !model.trimmed.isEmpty || model.confirmation != nil || model.error != nil {
                Divider().opacity(0.5)
                VStack(alignment: .leading, spacing: 6) {
                    readLines
                    HStack(spacing: 8) {
                        chips
                        Spacer(minLength: 0)
                        Text(model.mode == .task ? "Return to add" : "⌘Return to add").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint)
                    }
                    status
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
            }
        }
        .background(Color.clear)
        .background(
            Group {
                Button("") { model.mode = .task }.keyboardShortcut("1", modifiers: .command)
                Button("") { model.mode = .note }.keyboardShortcut("2", modifiers: .command)
                Button("") { Task { await model.save(open: true) } }.keyboardShortcut(.return, modifiers: .command)
                Button("") { Task { await model.save(keepOpen: true) } }.keyboardShortcut(.return, modifiers: .shift)
                Button("", action: close).keyboardShortcut(.cancelAction)
            }
            .opacity(0)
            .accessibilityHidden(true)
        )
    }

    // MARK: Parts

    @ViewBuilder private var field: some View {
        if model.mode == .note {
            TextField(model.placeholder, text: $model.text, axis: .vertical)
                .textFieldStyle(.plain)
                .focused($focused)
                .foregroundStyle(Folevi.color.ink)
                .accessibilityLabel("Note")
                .accessibilityIdentifier("quick-add-field")
        } else {
            TextField(model.placeholder, text: $model.text, axis: style == .panel ? .vertical : .horizontal)
                .textFieldStyle(.plain)
                .focused($focused)
                .foregroundStyle(Folevi.color.ink)
                .submitLabel(.done)
                .onSubmit { Task { await model.save() } }
                #if os(macOS)
                .onKeyPress(.return, phases: .down) { press in
                    if press.modifiers.isEmpty {
                        Task { await model.save() }
                        return .handled
                    }
                    return .ignored
                }
                #endif
                .accessibilityLabel("Task")
                .accessibilityIdentifier("quick-add-field")
        }
    }

    @ViewBuilder private var readLines: some View {
        if model.repeatLine != nil || model.parsedLine != nil {
            HStack(alignment: .center, spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    if let r = model.repeatLine { Text(r) }
                    if let line = model.parsedLine { Text(line).accessibilityIdentifier("quick-add-parsed") }
                }
                if model.parsedLine != nil {
                    Button { model.keepDateAsText() } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).frame(width: 28, height: 28) }
                        .buttonStyle(.plain)
                        .foregroundStyle(Folevi.color.inkFaint)
                        .accessibilityLabel("Keep \u{201C}\(model.parsed?.dateText ?? "")\u{201D} as text")
                        .accessibilityIdentifier("quick-add-keep-text")
                }
            }
            .foleviFont(.footnote)
            .foregroundStyle(Folevi.color.inkMuted)
        }
    }

    @ViewBuilder private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if model.mode == .task {
                    dateChip
                    if model.effectiveDueDate != nil { timeChip }
                    priorityChip
                }
                if style == .sheet { destinationMenu(compact: false) }
            }
            .padding(.vertical, 2)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    @ViewBuilder private var status: some View {
        if let e = model.error {
            Text(e).foleviFont(.callout).foregroundStyle(Folevi.color.destructive).accessibilityIdentifier("quick-add-error")
        } else if let c = model.confirmation {
            Label(c, systemImage: "checkmark.circle.fill").foleviFont(.callout).foregroundStyle(Folevi.color.success)
                .accessibilityIdentifier("quick-add-confirmation")
        } else if model.queue.count > 0 {
            Text(model.queue.count == 1 ? "1 item waits on this device." : "\(model.queue.count) items wait on this device.")
                .foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted)
                .accessibilityIdentifier("quick-add-queued")
        }
    }

    private func chipLabel(_ title: String, _ symbol: String, active: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 14, weight: .medium))
            Text(title).lineLimit(1)
        }
        .foleviFont(.callout)
        .foregroundStyle(active ? Folevi.color.ink : Folevi.color.inkMuted)
        .padding(.horizontal, 12)
        .frame(height: style == .panel ? 28 : 36)
        .background(Capsule().fill(Folevi.color.surfaceSunken))
        .overlay(Capsule().strokeBorder(Folevi.color.line, lineWidth: 0.5))
        .contentShape(Capsule())
    }

    private var dateChip: some View {
        Button { pickingDate = true } label: {
            chipLabel(model.effectiveDueDate.map { QuickAddModel.dayLabel($0, today: model.session.value?.today) } ?? "Date", "calendar", active: model.effectiveDueDate != nil)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("quick-add-date")
        .popover(isPresented: $pickingDate) {
            VStack(spacing: 10) {
                DatePicker("Due date", selection: Binding(get: { Self.date(model.effectiveDueDate) ?? Date() }, set: { model.dueDate = Self.ymd($0) }), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .labelsHidden()
                if model.effectiveDueDate != nil {
                    Button("No date") {
                        model.dueDate = nil
                        model.dueTime = nil
                        if model.parsed?.dueDate != nil { model.keepDateAsText() }
                        pickingDate = false
                    }
                }
            }
            .padding()
            .frame(minWidth: 300)
            .presentationCompactAdaptation(.popover)
        }
    }

    private var timeChip: some View {
        Menu {
            ForEach(["09:00", "12:00", "15:00", "18:00", "20:00"], id: \.self) { t in
                Button(QuickAddModel.clock(t)) { model.dueTime = t }
            }
            if model.effectiveDueTime != nil { Button("No time", role: .destructive) { model.dueTime = nil } }
        } label: {
            chipLabel(model.effectiveDueTime.map(QuickAddModel.clock) ?? "Time", "clock", active: model.effectiveDueTime != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityIdentifier("quick-add-time")
    }

    private var priorityChip: some View {
        Menu {
            Button { model.priority = nil } label: { Text("None") }
            ForEach([TaskCreateArgs.Priority.low, .medium, .high], id: \.self) { p in
                Button { model.priority = p } label: { Label(p.rawValue.capitalized, systemImage: "flag.fill") }
            }
        } label: {
            chipLabel(model.priority.map { $0.rawValue.capitalized } ?? "Priority", "flag", active: model.priority != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityIdentifier("quick-add-priority")
    }

    private func destinationMenu(compact: Bool) -> some View {
        Menu {
            if model.mode == .task {
                Button { model.choose(page: nil) } label: { Label("Inbox", systemImage: "tray") }
                Button { pickingPage = true } label: { Label("Choose a page…", systemImage: "doc.text.magnifyingglass") }
            } else {
                Button { model.choose(folder: nil) } label: { Label("Drafts", systemImage: "tray") }
                ForEach(model.folders, id: \.id) { f in
                    Button { model.choose(folder: f) } label: { Label(String(repeating: "   ", count: f.depth) + f.name, systemImage: "folder") }
                }
            }
            if model.spaces.count > 1 {
                Section("Space") {
                    ForEach(model.spaces, id: \.id) { s in
                        Button { model.choose(space: s) } label: {
                            if (model.destination.space ?? model.session.value?.space) == s.id { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                        }
                    }
                }
            }
        } label: {
            chipLabel(model.destinationLabel, model.mode == .task ? (model.destination.noteId == nil ? "tray" : "doc.text") : (model.destination.folderId == nil ? "tray" : "folder"), active: true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onTapGesture { if model.mode == .note { model.loadFolders() } }
        .simultaneousGesture(TapGesture().onEnded { if model.mode == .note { model.loadFolders() } })
        .accessibilityLabel("Adds to \(model.destinationLabel), change")
        .accessibilityIdentifier("quick-add-destination")
        .popover(isPresented: $pickingPage) {
            PagePicker(model: model) { pickingPage = false }
                .frame(minWidth: 320, minHeight: 360)
                .presentationCompactAdaptation(.sheet)
        }
    }

    static func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    static func date(_ ymd: String?) -> Date? {
        guard let ymd else { return nil }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: ymd)
    }
}

/// "Add to": search the pages by title.
struct PagePicker: View {
    @Bindable var model: QuickAddModel
    let done: () -> Void
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            SearchField(text: $query, prompt: "Search pages")
                .padding(12)
                .onChange(of: query) { _, q in model.searchPages(q) }
                .accessibilityIdentifier("quick-add-page-search")
            List {
                Button { model.choose(page: nil); done() } label: { Label("Inbox", systemImage: "tray") }
                ForEach(model.pageHits, id: \.id) { h in
                    Button { model.choose(page: h); done() } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.title.isEmpty ? "Untitled" : h.title).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                            if let f = h.folder?.name ?? h.spaceName { Text(f).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted) }
                        }
                    }
                    .accessibilityIdentifier("quick-add-page-\(h.id)")
                }
            }
            .listStyle(.plain)
        }
    }
}
