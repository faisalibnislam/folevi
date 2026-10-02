import SwiftUI

/// ⌘K command palette (the web's CommandPalette): recent pages, full-text search with highlighted matches
/// and filters (folder, tag, who created it, when it was updated), Ask AI, and actions. Fully keyboard
/// navigable: ↑/↓ move, Return opens, Escape closes.
struct CommandPaletteHost: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        if app.showCommandPalette {
            GeometryReader { geo in
                ZStack(alignment: .top) {
                    // The web's dialog backdrop is transparent: a click outside closes it.
                    Color.black.opacity(0.001)
                        .ignoresSafeArea()
                        .onTapGesture { app.showCommandPalette = false }
                        .accessibilityHidden(true)
                    CommandPalette(nav: nav, openDocument: openDocument, maxListHeight: geo.size.height * 0.55)
                        .padding(.top, geo.size.height * 0.12)
                        .padding(.horizontal, 16)
                }
            }
            // 12vh and 55vh of the whole window, as on the web (the title bar's safe area pushed it 46pt down).
            .ignoresSafeArea()
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
    /// A matching passage (search) for a page.
    var snippet: String?
    /// When the page was last edited (shown when there's no snippet).
    var updatedAt: Double?
    var systemImage: String?
    var hint: String?
    var isAi = false

    var isDocument: Bool { if case .document = kind { return true } else { return false } }
}

struct CommandPalette: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    var maxListHeight: CGFloat = 440
    @Environment(AppModel.self) private var app
    @Environment(\.openFoleviSettings) private var openSettings
    @State private var query = ""
    @State private var debounced = ""
    @State private var results: [PaletteItem]?
    @State private var recent: [PaletteItem] = []
    @State private var selected = 0
    @State private var pendingEnter = false
    @State private var searchTask: Task<Void, Never>?
    @State private var members: [WorkspaceMembers.Member] = []
    @State private var folderId = ""
    @State private var tagId = ""
    @State private var creatorId = ""
    @State private var updated = ""
    @FocusState private var fieldFocused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium)).foregroundStyle(FoleviColor.heading).accessibilityHidden(true)
                TextField("Search documents or type a command…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.ui(15))
                    .focused($fieldFocused)
                    .onSubmit(enter)
                    .onKeyPress(.downArrow) {
                        selected = min(items.count - 1, selected + 1)
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        selected = max(0, selected - 1)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        app.showCommandPalette = false
                        return .handled
                    }
                    .accessibilityLabel(Text("Search documents or type a command"))
                    .accessibilityIdentifier("palette.field")
                Keycap(text: "Esc")
            }
            .padding(.horizontal, 20)
            .frame(height: 56)
            .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
            filters
            list
        }
        .frame(maxWidth: 576)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foleviSurface(.color(FoleviColor.surfaceRaised), shape: .rounded(14),
                       shadow: FoleviGlassDepth.edge + [FoleviShadowLayer(x: 0, y: 16, blur: 48, spread: 0, color: .black.opacity(0.1), inset: false),
                                                        FoleviShadowLayer(x: 0, y: 2, blur: 8, spread: 0, color: .black.opacity(0.1), inset: false)])
        .claimsFocus($fieldFocused)
        .onAppear { loadRecent() }
        .task { await loadMembers() }
        .onChange(of: query) { _, _ in schedule() }
        .onChange(of: FilterKey(folder: folderId, tag: tagId, creator: creatorId, updated: updated)) { _, _ in search() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Search and commands"))
        .accessibilityAddTraits(.isModal)
    }

    private struct FilterKey: Equatable { var folder, tag, creator, updated: String }

    // MARK: Filters

    private var filters: some View {
        HStack(spacing: 6) {
            FoleviSelect(selection: $folderId, options: [.init(value: "", title: String(localized: "Any folder"))]
                         + app.sidebar.folders.map { .init(value: $0.id, title: $0.name) },
                         accessibilityLabel: String(localized: "Folder"), height: 28, look: .well, fontSize: 12)
            FoleviSelect(selection: $tagId, options: [.init(value: "", title: String(localized: "Any tag"))]
                         + app.sidebar.tags.map { .init(value: $0.id, title: "#" + $0.name) },
                         accessibilityLabel: String(localized: "Tag"), height: 28, look: .well, fontSize: 12)
            // Personal has no members: everything in it is yours, so "Created by" is for workspaces.
            if app.workspace != nil {
                FoleviSelect(selection: $creatorId, options: [.init(value: "", title: String(localized: "Anyone"))]
                             + members.map { .init(value: $0.profileId, title: $0.isYou ? String(localized: "Me") : $0.displayName) },
                             accessibilityLabel: String(localized: "Created by"), height: 28, look: .well, fontSize: 12)
            }
            FoleviSelect(selection: $updated, options: [
                .init(value: "", title: String(localized: "Any time")), .init(value: "7", title: String(localized: "Past week")),
                .init(value: "30", title: String(localized: "Past month")), .init(value: "365", title: String(localized: "Past year")),
            ], accessibilityLabel: String(localized: "Updated"), height: 28, look: .well, fontSize: 12)
            Spacer(minLength: 4)
            Text(app.scopeName).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint).lineLimit(1)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { FoleviColor.line.frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Search filters"))
    }

    // MARK: List

    private var list: some View {
        let shown = items
        let docCount = shown.filter(\.isDocument).count
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !debounced.isEmpty && results == nil {
                        Text("Searching…").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted).padding(.horizontal, 12).padding(.vertical, 8)
                    }
                    if !debounced.isEmpty, let results, results.isEmpty {
                        Text("No documents match “\(debounced)”.").font(.ui(13)).foregroundStyle(FoleviColor.inkMuted)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                    }
                    Text(debounced.isEmpty ? String(localized: "Recent") : String(localized: "Documents"))
                        .foleviCapsLabel().padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 6)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(shown.enumerated()), id: \.element.id) { idx, item in
                        if idx == docCount && !item.isDocument {
                            Text("Actions").foleviCapsLabel().padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 6)
                                .accessibilityAddTraits(.isHeader)
                        }
                        PaletteRow(item: item, query: debounced, selected: idx == selected)
                            .id(idx)
                            .onHover { if $0 { selected = idx } }
                            .onTapGesture { activate(item) }
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: maxListHeight)
            .fixedSize(horizontal: false, vertical: true)
            .onChange(of: selected) { _, s in proxy.scrollTo(s) }
        }
    }

    // MARK: Items

    private var actions: [PaletteItem] {
        let dark = app.appearance == .dark
        return [
            PaletteItem(id: "a.new", kind: .action("new"), title: String(localized: "New document"), systemImage: "plus", hint: "⌘⌥N"),
            PaletteItem(id: "a.tasks", kind: .action("tasks"), title: String(localized: "Go to Tasks · Today"), systemImage: "checkmark.square"),
            PaletteItem(id: "a.calendar", kind: .action("calendar"), title: String(localized: "Go to Calendar"), systemImage: "calendar"),
            PaletteItem(id: "a.home", kind: .action("home"), title: String(localized: "Go to Home"), systemImage: "house"),
            PaletteItem(id: "a.trash", kind: .action("trash"), title: String(localized: "Open Trash"), systemImage: "trash"),
            PaletteItem(id: "a.settings", kind: .action("settings"), title: String(localized: "Open Settings"), systemImage: "gearshape"),
            PaletteItem(id: "a.theme", kind: .action("theme"),
                        title: dark ? String(localized: "Switch to light appearance") : String(localized: "Switch to dark appearance"),
                        systemImage: dark ? "sun.max" : "moon"),
        ]
    }

    private var items: [PaletteItem] {
        let q = trimmed.lowercased()
        let matching = q.isEmpty ? Array(actions.prefix(4)) : actions.filter { $0.title.lowercased().contains(q) }
        let docs = debounced.isEmpty ? recent : (results ?? [])
        var ai: [PaletteItem] = []
        if app.aiAvailable {
            ai = [PaletteItem(id: "a.ai", kind: .action("ai"),
                              title: trimmed.isEmpty ? String(localized: "Ask AI about your notes") : String(localized: "Ask AI: “\(trimmed)”"),
                              hint: "⌘J", isAi: true)]
        }
        return docs + ai + matching
    }

    // MARK: Data

    private func loadRecent() {
        let local = app.documents.filter { $0.deletedAt == nil && $0.kind != .collectionRow }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(8)
            .map(docItem)
        recent = Array(local)
        guard let session = app.session, app.sync.isOnline else { return }
        Task {
            if let docs = try? await session.documents.recent(scope: session.scope, limit: 8) { recent = docs.map(docItem) }
        }
    }

    private func docItem(_ d: DocumentSummary) -> PaletteItem {
        PaletteItem(id: "d.\(d.id)", kind: .document(d.id), title: d.title, updatedAt: d.updatedAt)
    }

    private func loadMembers() async {
        guard let w = app.workspace, let session = app.session, app.sync.isOnline else { return }
        members = (try? await session.workspacesRepo.members(w.id).members) ?? []
    }

    /// Searches 120ms after typing stops.
    private func schedule() {
        searchTask?.cancel()
        let q = trimmed
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            debounced = q
            selected = 0
            search()
        }
    }

    private func search() {
        let q = debounced
        guard !q.isEmpty else {
            results = nil
            return
        }
        results = nil
        let folder = folderId.isEmpty ? nil : folderId
        let tag = tagId.isEmpty ? nil : tagId
        let creator = creatorId.isEmpty ? nil : creatorId
        // Coarse "updated after" (to the hour) so the query stays cacheable.
        let after: Double? = Double(updated).map { days in ((Date().timeIntervalSince1970 * 1000 - days * 86_400_000) / 3_600_000).rounded(.down) * 3_600_000 }
        guard app.sync.isOnline, let session = app.session else {
            results = localResults(q, folderId: folder, tagId: tag, creatorId: creator, updatedAfter: after)
            settle()
            return
        }
        Task {
            let hits = try? await session.search.search(scope: session.scope, query: q, limit: 20, folderId: folder, tagId: tag,
                                                        creatorId: creator, updatedAfter: after)
            guard debounced == q else { return }
            if let hits {
                results = hits.map { PaletteItem(id: "d.\($0.id)", kind: .document($0.id), title: $0.title, snippet: $0.snippet, updatedAt: $0.updatedAt) }
            } else {
                results = localResults(q, folderId: folder, tagId: tag, creatorId: creator, updatedAfter: after)
            }
            settle()
        }
    }

    /// Offline: titles first, then opening text, from this Mac's copy.
    private func localResults(_ q: String, folderId: String?, tagId: String?, creatorId: String?, updatedAfter: Double?) -> [PaletteItem] {
        let normalized = SearchText.normalize(q)
        let docs = app.documents.filter { d in
            d.deletedAt == nil && d.kind != .collectionRow
                && (folderId == nil || d.folderId == folderId)
                && (tagId == nil || (d.tags ?? []).contains { $0.id == tagId })
                && (creatorId == nil || d.createdBy == creatorId)
                && (updatedAfter == nil || d.updatedAt >= updatedAfter!)
        }
        let byTitle = docs.filter { SearchText.normalize($0.title).contains(normalized) }
        let ids = Set(byTitle.map(\.id))
        let byText = docs.filter { !ids.contains($0.id) && SearchText.normalize($0.excerpt).contains(normalized) }
        return (byTitle + byText).prefix(20).map {
            PaletteItem(id: "d.\($0.id)", kind: .document($0.id), title: $0.title, snippet: $0.excerpt.isEmpty ? nil : $0.excerpt, updatedAt: $0.updatedAt)
        }
    }

    /// Return pressed while the search for what was typed is still in flight opens the top result once it
    /// arrives (fast typists shouldn't get a stale recent page or nothing).
    private var settled: Bool { trimmed.isEmpty || (debounced == trimmed && results != nil) }

    private func enter() {
        if !settled {
            pendingEnter = true
            return
        }
        let list = items
        if list.indices.contains(selected) { activate(list[selected]) }
    }

    private func settle() {
        guard pendingEnter, settled else { return }
        pendingEnter = false
        if let first = items.first { activate(first) }
    }

    private func activate(_ item: PaletteItem) {
        app.showCommandPalette = false
        switch item.kind {
        case .document(let id):
            // ⌥ opens it in its own window; otherwise in a new tab, as on the web.
            if NSEvent.modifierFlags.contains(.option) { openDocument(id, true) } else { nav.open(id, newTab: true) }
        case .action(let a):
            switch a {
            case "new": Task { if let id = await app.createDocument(folderId: nav.currentFolderId) { nav.open(id, newTab: true) } }
            case "tasks": nav.show(.tasks)
            case "calendar": nav.show(.calendar)
            case "home": nav.show(.all)
            case "trash": nav.show(.trash)
            case "settings":
                SettingsRouter.shared.section = .account
                openSettings()
            case "theme": app.appearance = app.appearance == .dark ? .light : .dark
            case "ai": app.askAi(question: trimmed.isEmpty ? nil : trimmed)
            default: break
            }
        }
    }
}

/// One palette row (the web's option): a page with its title and passage (or when it was edited), or an
/// action with its icon and shortcut. The selected row is accent-soft with a fine ring.
private struct PaletteRow: View {
    var item: PaletteItem
    var query: String
    var selected: Bool

    var body: some View {
        HStack(alignment: item.isDocument ? .top : .center, spacing: 12) {
            if item.isDocument {
                Image(systemName: "doc.text").font(.system(size: 13.5)).foregroundStyle(FoleviColor.inkMuted)
                    .frame(width: 20).padding(.top, 2).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(highlight(item.title.isEmpty ? String(localized: "Untitled") : item.title))
                        .font(.ui(13, .medium)).lineLimit(1)
                    if let snippet = item.snippet, !snippet.isEmpty {
                        Text(highlight(snippet)).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(2)
                    } else if let updated = item.updatedAt {
                        Text("Edited \(CollabTime.relative(updated))").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected {
                    Image(systemName: "arrow.right").font(.system(size: 12, weight: .medium)).padding(.top, 4).accessibilityHidden(true)
                }
            } else {
                Group {
                    if item.isAi { AiIcon(size: 16) } else { Image(systemName: item.systemImage ?? "circle").font(.system(size: 13.5)) }
                }
                .foregroundStyle(FoleviColor.inkMuted)
                .frame(width: 20)
                .accessibilityHidden(true)
                Text(item.title).font(.ui(13)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                if let hint = item.hint { Text(hint).font(.ui(12)).foregroundStyle(FoleviColor.inkFaint) }
            }
        }
        .foregroundStyle(selected ? FoleviColor.heading : FoleviColor.ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background {
            if selected {
                let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
                shape.fill(FoleviColor.accentSoft).overlay(shape.strokeBorder(FoleviColor.accent.opacity(0.18), lineWidth: 1))
            }
        }
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
            // The web's <mark>: a yellow highlight, ink text, not bold.
            attr[start..<end].backgroundColor = FoleviColor.highlightYellow
            attr[start..<end].foregroundColor = FoleviColor.ink
        }
        return attr
    }
}

extension Notification.Name {
    static let foleviQuickAdd = Notification.Name("FoleviQuickAdd")
}
