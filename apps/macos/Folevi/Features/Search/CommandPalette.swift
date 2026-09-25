import SwiftUI

/// ⌘K command palette: recent documents, full-text search (server when online, local otherwise) with
/// highlighted matches, and actions. Fully keyboard navigable.
struct CommandPaletteHost: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        if app.showCommandPalette {
            ZStack(alignment: .top) {
                FoleviColor.scrim.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture { app.showCommandPalette = false }
                    .accessibilityHidden(true)
                CommandPalette(nav: nav, openDocument: openDocument)
                    .padding(.top, 80)
            }
            .transition(.opacity)
        }
    }
}

struct PaletteItem: Identifiable, Equatable {
    enum Kind: Equatable {
        case document(String)
        case action(String)
    }
    var id: String
    var kind: Kind
    var title: String
    var subtitle: String?
    var icon: String?
    var systemImage: String?
    var section: String
}

struct CommandPalette: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var results: [PaletteItem] = []
    @State private var selected = 0
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(FoleviColor.inkMuted).accessibilityHidden(true)
                TextField("Search documents or type a command", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 17))
                    .focused($fieldFocused)
                    .onSubmit { activate(selected) }
                    .onKeyPress(.downArrow) {
                        move(1)
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        move(-1)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        app.showCommandPalette = false
                        return .handled
                    }
                    .accessibilityIdentifier("palette.field")
                if searching { ProgressView().controlSize(.small) }
            }
            .padding(14)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.element.id) { idx, item in
                            if idx == 0 || results[idx - 1].section != item.section {
                                Text(item.section).font(.caption.weight(.semibold)).foregroundStyle(FoleviColor.inkMuted)
                                    .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)
                            }
                            row(item, selected: idx == selected)
                                .id(idx)
                                .onTapGesture { activate(idx) }
                        }
                        if results.isEmpty {
                            Text(query.isEmpty ? "Start typing to search." : "No results for “\(query)”.")
                                .foregroundStyle(FoleviColor.inkMuted)
                                .padding(20)
                        }
                    }
                    .padding(.bottom, 8)
                }
                .onChange(of: selected) { _, s in proxy.scrollTo(s) }
            }
            .frame(height: 380)
        }
        .frame(width: 620)
        .background(RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous).fill(FoleviColor.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: FoleviRadius.sheet, style: .continuous).strokeBorder(FoleviColor.line))
        .shadow(color: .black.opacity(0.2), radius: 30, y: 12)
        .onAppear {
            fieldFocused = true
            refresh()
        }
        .onChange(of: query) { _, _ in refresh() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Command palette"))
        .accessibilityAddTraits(.isModal)
    }

    private func row(_ item: PaletteItem, selected: Bool) -> some View {
        HStack(spacing: 10) {
            Group {
                if let icon = item.icon { Text(icon) } else { Image(systemName: item.systemImage ?? "doc.text") }
            }
            .frame(width: 22)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(highlight(item.title))
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(highlight(subtitle))
                        .font(.system(size: 12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .lineLimit(2)
                }
            }
            Spacer()
            if selected { Image(systemName: "return").font(.caption).foregroundStyle(FoleviColor.inkFaint).accessibilityHidden(true) }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? FoleviColor.accentSoft : Color.clear).padding(.horizontal, 6))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    private func highlight(_ text: String) -> AttributedString {
        var attr = AttributedString(text)
        guard !query.isEmpty else { return attr }
        let chars = Array(text)
        for r in SearchText.highlightRanges(text, query: query) where r.upperBound <= chars.count {
            let start = attr.characters.index(attr.startIndex, offsetBy: r.lowerBound)
            let end = attr.characters.index(attr.startIndex, offsetBy: r.upperBound)
            attr[start..<end].inlinePresentationIntent = .stronglyEmphasized
            attr[start..<end].backgroundColor = FoleviColor.highlightYellow
        }
        return attr
    }

    private func move(_ delta: Int) {
        guard !results.isEmpty else { return }
        selected = (selected + delta + results.count) % results.count
    }

    private var actions: [PaletteItem] {
        [
            PaletteItem(id: "a.new", kind: .action("new"), title: String(localized: "New Document"), systemImage: "square.and.pencil", section: String(localized: "Actions")),
            PaletteItem(id: "a.today", kind: .action("today"), title: String(localized: "Open Today's Daily Note"), systemImage: "sun.max", section: String(localized: "Actions")),
            PaletteItem(id: "a.tasks", kind: .action("tasks"), title: String(localized: "Go to Tasks"), systemImage: "checklist", section: String(localized: "Actions")),
            PaletteItem(id: "a.calendar", kind: .action("calendar"), title: String(localized: "Go to Calendar"), systemImage: "calendar", section: String(localized: "Actions")),
            PaletteItem(id: "a.quickadd", kind: .action("quickadd"), title: String(localized: "Quick Add Task"), systemImage: "plus.circle", section: String(localized: "Actions")),
            PaletteItem(id: "a.appearance", kind: .action("appearance"), title: String(localized: "Toggle Dark Appearance"), systemImage: "circle.lefthalf.filled", section: String(localized: "Actions")),
            PaletteItem(id: "a.import", kind: .action("import"), title: String(localized: "Import Markdown…"), systemImage: "square.and.arrow.down", section: String(localized: "Actions")),
        ]
    }

    private func refresh() {
        searchTask?.cancel()
        selected = 0
        let q = query.trimmingCharacters(in: .whitespaces)
        let matchingActions = actions.filter { q.isEmpty || SearchText.normalize($0.title).contains(SearchText.normalize(q)) }
        if q.isEmpty {
            let recent = app.documents.filter { $0.deletedAt == nil && $0.kind != .collectionRow }
                .sorted { $0.updatedAt > $1.updatedAt }
                .prefix(8)
                .map { PaletteItem(id: "d.\($0.id)", kind: .document($0.id), title: $0.displayTitle, subtitle: $0.excerpt, icon: $0.icon ?? "📄", section: String(localized: "Recent")) }
            results = Array(recent) + matchingActions
            return
        }
        // Instant local results, then server full-text when online.
        let local = localResults(q)
        results = local + matchingActions
        guard app.sync.isOnline, let session = app.session else { return }
        searching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            let hits = (try? await session.search.search(workspaceId: session.workspaceId, query: q)) ?? []
            guard !Task.isCancelled else { return }
            searching = false
            if !hits.isEmpty {
                let serverItems = hits.map { PaletteItem(id: "d.\($0.id)", kind: .document($0.id), title: $0.title.isEmpty ? String(localized: "Untitled") : $0.title,
                                                         subtitle: $0.snippet, icon: $0.icon ?? "📄", section: String(localized: "Documents")) }
                var seen = Set(serverItems.map(\.id))
                let extraLocal = local.filter { seen.insert($0.id).inserted }
                results = serverItems + extraLocal + matchingActions
            }
        }
    }

    private func localResults(_ q: String) -> [PaletteItem] {
        let docs = app.documents
        var out: [PaletteItem] = []
        let normalized = SearchText.normalize(q)
        // Titles first.
        for d in docs where d.deletedAt == nil && SearchText.normalize(d.title).contains(normalized) {
            out.append(PaletteItem(id: "d.\(d.id)", kind: .document(d.id), title: d.displayTitle, subtitle: d.excerpt, icon: d.icon ?? "📄", section: String(localized: "Documents")))
        }
        let ids = Set(out.map(\.id))
        for d in docs where d.deletedAt == nil && !ids.contains("d.\(d.id)") && SearchText.normalize(d.excerpt).contains(normalized) {
            out.append(PaletteItem(id: "d.\(d.id)", kind: .document(d.id), title: d.displayTitle, subtitle: d.excerpt, icon: d.icon ?? "📄", section: String(localized: "Documents")))
        }
        return Array(out.prefix(20))
    }

    private func activate(_ index: Int) {
        guard results.indices.contains(index) else { return }
        let item = results[index]
        app.showCommandPalette = false
        switch item.kind {
        case .document(let id):
            openDocument(id, NSEvent.modifierFlags.contains(.option))
        case .action(let a):
            switch a {
            case "new": Task { if let id = await app.createDocument() { nav.open(id) } }
            case "today": Task { if let id = await app.dailyNoteId(for: TaskLogic.localDate()) { nav.open(id) } }
            case "tasks": nav.selection = .tasks
            case "calendar": nav.selection = .calendar
            case "quickadd": NotificationCenter.default.post(name: .foleviQuickAdd, object: nil)
            case "appearance": app.appearance = app.appearance == .dark ? .light : .dark
            case "import": ExportService.importMarkdown(app: app) { id in if let id { nav.open(id) } }
            default: break
            }
        }
    }
}

extension Notification.Name {
    static let foleviQuickAdd = Notification.Name("FoleviQuickAdd")
}
