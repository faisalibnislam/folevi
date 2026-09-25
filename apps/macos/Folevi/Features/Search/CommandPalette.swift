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
                FoleviColor.scrim.opacity(0.6)
                    .background(.ultraThinMaterial.opacity(0.5))
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
                Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .medium)).foregroundStyle(FoleviColor.ember).accessibilityHidden(true)
                TextField("Search documents or type a command", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(17))
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
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            FoleviColor.line.frame(height: 1)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.element.id) { idx, item in
                            if idx == 0 || results[idx - 1].section != item.section {
                                Text(item.section).foleviCapsLabel()
                                    .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
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
        .frame(width: 640)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .foleviPop(radius: 18)
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
                if let icon = item.icon { Text(icon).font(.system(size: 14)) } else { Image(systemName: item.systemImage ?? "doc.text").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(FoleviColor.emberInk) }
            }
            .frame(width: 28, height: 28)
            .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(8), shadow: FoleviShadow.control)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(highlight(item.title))
                    .font(.ui(13.5, .semibold))
                    .foregroundStyle(selected ? FoleviColor.heading : FoleviColor.ink)
                    .lineLimit(1)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(highlight(subtitle))
                        .font(.ui(12))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .lineLimit(2)
                }
            }
            Spacer()
            if selected { Keycap(text: "↩") }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(selected ? FoleviColor.accentSoft : Color.clear).padding(.horizontal, 6))
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
            PaletteItem(id: "a.home", kind: .action("home"), title: String(localized: "Go to Home"), systemImage: "house", section: String(localized: "Actions")),
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
            case "home":
                if nav.selection == .all { nav.closeDocument() } else { nav.selection = .all }
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
