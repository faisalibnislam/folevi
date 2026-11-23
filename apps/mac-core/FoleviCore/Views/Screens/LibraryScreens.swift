// Recent, Search, Shared with Me, a shared folder, Changes, Templates, Folders, Tags, an invitation, the daily
// note and the screens that stay on the page (Reviews, the Foli DNA graph).
import FoleviDesign
import FoleviEngine
import SwiftUI

// MARK: Recent

struct RecentScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var recent = Live<Views.Recent>()
    @AppStorage("core.recent.everywhere") private var everywhere = false

    var body: some View {
        Group {
            if let rows = recent.value?.rows {
                if rows.isEmpty {
                    EmptyScreen(symbol: "clock", title: "Nothing Recent", message: "Notes you open show up here.")
                } else if window.listStyle == .cards {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 250), spacing: 20)], spacing: 22) {
                            ForEach(rows, id: \.row.id) { r in NoteCardButton(row: r.row, window: window) }
                        }
                        .padding(24)
                    }
                } else {
                    List {
                        ForEach(rows, id: \.row.id) { r in
                            NoteListRow(row: r.row)
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(r.row.id)) }
                                .contextMenu {
                                    NoteMenu(row: r.row, window: window)
                                    Divider()
                                    Button("Hide from Recent") { app.perform { _ = try await $0.command(Commands.NoteHideFromRecent(NoteIdsArgs(ids: [r.row.id]))) } }
                                }
                                .draggable(NoteDrag(id: r.row.id, title: r.row.title))
                        }
                    }
                    .listStyle(.inset)
                }
            } else {
                LoadingScreen()
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                ListStylePicker(window: window)
                if (app.places.value?.places.count ?? 0) > 1 {
                    Toggle(isOn: $everywhere) { Label("Every Place", coreSymbol: "square.stack.3d.up") }
                        .help("Show recent notes from every place on this Mac")
                }
            }
        }
        .task(id: everywhere) { recent.bind(app.client, Views.Recent(RecentArgs(scope: everywhere ? .everywhere : .place, limit: 100))) }
    }
}

// MARK: Search

/// Search: one field ("Search in <space>"), filters (folder, tag, when it was edited, archived, by meaning, every
/// place) with Clear, and before typing the recent searches and the notes opened last. Results come in sections:
/// Notes, By Meaning, Folders (matched here, 6 at most) and open Tasks (8 at most). ↑ and ↓ move through them,
/// Return opens the one picked, Esc clears the field.
struct SearchScreen: View {
    let window: WindowModel
    let initial: String
    private var app: AppModel { .shared }
    @State private var text = ""
    @State private var result: SearchValue?
    @State private var searching = false
    @State private var folder: String?
    @State private var tag: String?
    @State private var updated: Updated = .any
    @State private var archived = false
    @State private var meaning = false
    @State private var everywhere = false
    @State private var mine = false
    @State private var picked: String?
    @State private var recentNotes = Live<Views.RecentViewed>()
    @State private var openTasks: [TaskRow]?
    @State private var recents: [String] = []
    @FocusState private var focused: Bool

    enum Updated: String, CaseIterable, Identifiable {
        case any, week, month, year
        var id: String { rawValue }
        var title: String {
            switch self {
            case .any: "Any Time"
            case .week: "Past Week"
            case .month: "Past Month"
            case .year: "Past Year"
            }
        }
        /// Milliseconds since 1970.
        var after: Int? {
            let days: Double
            switch self {
            case .any: return nil
            case .week: days = 7
            case .month: days = 30
            case .year: days = 365
            }
            return Int((Date().timeIntervalSince1970 - days * 86_400) * 1000)
        }
    }

    /// Everything the list shows, in order, so the keys can move through it.
    enum Item: Identifiable, Hashable {
        case query(String)
        case recent(RecentViewedRow)
        case note(SearchHit)
        case folder(FolderNode, path: String)
        case task(TaskRow)

        var id: String {
            switch self {
            case .query(let q): "q:" + q
            case .recent(let r): "r:" + r.id
            case .note(let h): "n:" + h.id + (h.blockId ?? "") + h.matchIn
            case .folder(let f, _): "f:" + f.id
            case .task(let t): "t:" + t.id
            }
        }
    }

    private var query: String { text.trimmingCharacters(in: .whitespaces) }
    private var filtered: Bool { folder != nil || tag != nil || updated != .any || archived || meaning || everywhere || mine }

    private var noteHits: [SearchHit] { (result?.hits ?? []).filter { $0.matchIn != "meaning" } }
    private var meaningHits: [SearchHit] { (result?.hits ?? []).filter { $0.matchIn == "meaning" } }

    private var folderHits: [Item] {
        guard !query.isEmpty, !everywhere else { return [] }
        let all = app.tree.value?.folders ?? []
        let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func path(_ f: FolderNode) -> String {
            var names: [String] = []
            var p = f.parentId
            while let id = p, let parent = byId[id] { names.insert(parent.name, at: 0); p = parent.parentId }
            return names.joined(separator: " › ")
        }
        return all.filter { $0.name.localizedCaseInsensitiveContains(query) }.prefix(6).map { .folder($0, path: path($0)) }
    }

    private var taskHits: [Item] {
        guard !query.isEmpty, !everywhere, let openTasks else { return [] }
        return openTasks.filter { $0.title.localizedCaseInsensitiveContains(query) }.prefix(8).map { .task($0) }
    }

    private var items: [Item] {
        if query.isEmpty {
            return recents.map { .query($0) } + (recentNotes.value?.rows ?? []).prefix(8).map { .recent($0) }
        }
        return noteHits.map { .note($0) } + meaningHits.map { .note($0) } + folderHits + taskHits
    }

    var body: some View {
        VStack(spacing: 0) {
            field
            filters
            Divider()
            if app.sync.value?.online == false {
                Label("Showing what's on this Mac. Folevi searches everything when it's back online.", coreSymbol: "wifi.slash")
                    .font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 24).padding(.vertical, 8).background(.fill.quinary)
            }
            content
        }
        .onAppear {
            text = initial
            recents = RecentSearches.list()
            focused = true
            if !initial.isEmpty { run() }
        }
        .task { recentNotes.bind(app.client, Views.RecentViewed(RecentViewedArgs(space: nil, limit: 8))) }
        .onChange(of: initial) { text = initial; focused = true }
        .onChange(of: text) { schedule() }
        .onChange(of: folder) { run() }
        .onChange(of: tag) { run() }
        .onChange(of: updated) { run() }
        .onChange(of: archived) { run() }
        .onChange(of: meaning) { run() }
        .onChange(of: everywhere) { run() }
        .onChange(of: mine) { run() }
    }

    private var field: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(everywhere ? "Search Everywhere" : "Search in \(app.spaceName)", text: $text)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($focused)
                .onSubmit { openPicked() }
                .onKeyPress(.downArrow) { move(1); return .handled }
                .onKeyPress(.upArrow) { move(-1); return .handled }
                .onKeyPress(.escape) {
                    if text.isEmpty { return .ignored }
                    text = ""
                    return .handled
                }
            if searching { ProgressView().controlSize(.small) }
            if !text.isEmpty {
                Button { text = ""; focused = true } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain).foregroundStyle(.secondary).help("Clear")
            }
        }
        .padding(12)
        .background(.fill.quinary, in: .rect(cornerRadius: 10))
        .padding(.horizontal, 24)
        .padding(.top, 16)
    }

    private var filters: some View {
        HStack(spacing: 12) {
            Picker("Folder", selection: $folder) {
                Text("Any Folder").tag(String?.none)
                ForEach(FolderOrder.nested(app.tree.value?.folders ?? []), id: \.id) { f in
                    Text(String(repeating: "    ", count: f.depth) + f.name).tag(Optional(f.id))
                }
            }
            .labelsHidden().fixedSize()
            Picker("Tag", selection: $tag) {
                Text("Any Tag").tag(String?.none)
                ForEach(app.tree.value?.tags ?? [], id: \.id) { Text("#" + $0.name).tag(Optional($0.id)) }
            }
            .labelsHidden().fixedSize()
            Picker("Updated", selection: $updated) {
                ForEach(Updated.allCases) { Text($0.title).tag($0) }
            }
            .labelsHidden().fixedSize()
            Toggle("Archived", isOn: $archived).toggleStyle(.checkbox).help("Include archived notes")
            if app.session.value?.mode != .local, app.currentSpace?.kind == .workspace {
                Toggle("Created by Me", isOn: $mine).toggleStyle(.checkbox).help("Only notes you created")
            }
            if result?.meaningAvailable == true { Toggle("By Meaning", isOn: $meaning).toggleStyle(.checkbox).help("Find notes about the same thing, even in other words") }
            if (app.session.value?.spaces.count ?? 0) > 1 { Toggle("Every Space", isOn: $everywhere).toggleStyle(.checkbox) }
            Spacer()
            if filtered {
                Button("Clear", action: clearFilters).help("Clear the filters")
            }
        }
        .controlSize(.regular)
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
    }

    @ViewBuilder private var content: some View {
        if query.isEmpty {
            if items.isEmpty {
                EmptyScreen(symbol: "magnifyingglass", title: "Search Your Notes", message: "Type a word or phrase. Press ⌘K anywhere to jump to a note or run a command.")
            } else {
                list {
                    if !recents.isEmpty {
                        HStack {
                            header("Recent Searches")
                            Spacer()
                            Button("Clear") { RecentSearches.clear(); recents = [] }.buttonStyle(.borderless).font(.caption).padding(.top, 12)
                        }
                        ForEach(recents, id: \.self) { q in
                            row(.query(q)) { Label(q, coreSymbol: "clock.arrow.circlepath") }
                        }
                    }
                    if let rows = recentNotes.value?.rows, !rows.isEmpty {
                        header("Recent Notes")
                        ForEach(rows.prefix(8), id: \.id) { r in
                            row(.recent(r)) {
                                HStack(spacing: 10) {
                                    NoteMark(icon: r.icon, size: 15).frame(width: 18)
                                    Text(r.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15)).lineLimit(1)
                                    Spacer()
                                    Text(CoreDates.short(r.updatedAt)).font(.caption).foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                }
            }
        } else if let r = result, r.hits.isEmpty, folderHits.isEmpty, taskHits.isEmpty, !searching {
            EmptyScreen(symbol: "magnifyingglass", title: "No Results", message: filtered ? "Nothing matches “\(r.text)” with these filters." : "Nothing matches “\(r.text)”.", actionTitle: filtered ? "Clear Filters" : nil) {
                clearFilters()
            }
        } else {
            list {
                if !noteHits.isEmpty {
                    header("Notes")
                    ForEach(noteHits, id: \.self) { h in row(.note(h)) { SearchHitRow(hit: h, query: query) } }
                }
                if !meaningHits.isEmpty {
                    header("By Meaning")
                    ForEach(meaningHits, id: \.self) { h in row(.note(h)) { SearchHitRow(hit: h, query: query) } }
                }
                if !folderHits.isEmpty {
                    header("Folders")
                    ForEach(folderHits) { item in
                        if case .folder(let f, let path) = item {
                            row(item) {
                                HStack(spacing: 10) {
                                    FolderMark(colorId: f.color, size: 15).frame(width: 18)
                                    Text(f.name)
                                    if !path.isEmpty { Text("in \(path)").font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    }
                }
                if !taskHits.isEmpty {
                    header("Tasks")
                    ForEach(taskHits) { item in
                        if case .task(let t) = item {
                            row(item) {
                                HStack(spacing: 10) {
                                    Image(systemName: "circle").foregroundStyle(.secondary).frame(width: 18)
                                    Text(t.title).lineLimit(1)
                                    Text(t.noteTitle.nonEmpty ?? "Untitled").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer()
                                    if let d = t.dueDate { Text(d).font(.caption).foregroundStyle(.tertiary) }
                                }
                            }
                        }
                    }
                }
                if searching && (result?.hits.isEmpty ?? true) {
                    HStack { ProgressView().controlSize(.small); Text("Searching…").foregroundStyle(.secondary) }.padding(10)
                }
            }
        }
    }

    private func clearFilters() {
        folder = nil; tag = nil; updated = .any; archived = false; meaning = false; everywhere = false; mine = false
    }

    private func list<C: View>(@ViewBuilder _ rows: () -> C) -> some View {
        let content = rows()
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) { content }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
            }
            .onChange(of: picked) { if let picked { Motion.run(Motion.scroll) { proxy.scrollTo(picked) } } }
        }
    }

    /// A result: picked by a click or the arrow keys, opened by a double click or Return.
    private func row<C: View>(_ item: Item, @ViewBuilder _ label: () -> C) -> some View {
        label()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(picked == item.id ? AnyShapeStyle(.selection) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 8))
            .contentShape(.rect)
            .onTapGesture(count: 2) { open(item) }
            .onTapGesture { picked = item.id }
            .contextMenu {
                Button("Open") { open(item) }
                if case .note(let h) = item { Button("Open in New Tab") { AppModel.shared.open(.note(h.id), newTab: true) } }
                if case .recent(let r) = item { Button("Open in New Tab") { AppModel.shared.open(.note(r.id), newTab: true) } }
                if case .query(let q) = item { Button("Remove") { RecentSearches.remove(q); recents = RecentSearches.list() } }
            }
            .id(item.id)
    }

    private func header(_ title: String) -> some View {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, 12).padding(.bottom, 2)
    }

    private func move(_ by: Int) {
        let ids = items.map(\.id)
        guard !ids.isEmpty else { return }
        let i = picked.flatMap { ids.firstIndex(of: $0) }
        let next = i.map { min(max($0 + by, 0), ids.count - 1) } ?? (by > 0 ? 0 : ids.count - 1)
        picked = ids[next]
    }

    private func openPicked() {
        let all = items
        if let picked, let item = all.first(where: { $0.id == picked }) { open(item) } else if let first = all.first, !query.isEmpty { open(first) }
    }

    private func open(_ item: Item) {
        if !query.isEmpty { RecentSearches.add(query); recents = RecentSearches.list() }
        switch item {
        case .query(let q):
            text = q
            run()
        case .recent(let r):
            window.go(.note(r.id))
        case .note(let h):
            window.go(.note(h.id))
            if let block = h.blockId { jump(block) }
        case .folder(let f, _):
            window.go(.folder(f.id))
        case .task(let t):
            window.go(.note(t.noteId))
            jump(t.id)
        }
    }

    private func jump(_ block: String) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            window.editor(EditorCommands.BlockJump(BlockJumpArgs(blockId: block)))
        }
    }

    @State private var pending: Task<Void, Never>?

    private func schedule() {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            run()
        }
    }

    private func run() {
        let q = query
        picked = nil
        guard !q.isEmpty, let client = app.client else { result = nil; return }
        searching = true
        let args = SearchArgs(text: q, scope: everywhere ? .everywhere : .place, space: nil, folderId: folder, tagId: tag, updatedAfter: updated.after, includeArchived: archived, creatorId: mine && !everywhere ? app.session.value?.profile.id : nil, meaning: meaning, limit: 40)
        Task { @MainActor in
            let r = try? await client.query(Views.Search(args))
            if q == query { result = r }
            searching = false
        }
        // Open tasks load once, the first time a search runs.
        if openTasks == nil {
            openTasks = []
            Task { @MainActor in
                let v = try? await client.query(Views.TasksList(TasksListArgs(space: nil, view: .all)))
                openTasks = (v?.groups ?? []).flatMap(\.tasks).filter { $0.status != "done" && $0.completedAt == nil }
            }
        }
    }
}

/// The searches made here last (8 at most), per space, newest first.
@MainActor
enum RecentSearches {
    private static var key: String { "recentSearches." + AppModel.shared.spaceName }

    static func list() -> [String] { UserDefaults.standard.stringArray(forKey: key) ?? [] }

    static func add(_ q: String) {
        var all = list().filter { $0.caseInsensitiveCompare(q) != .orderedSame }
        all.insert(q, at: 0)
        UserDefaults.standard.set(Array(all.prefix(8)), forKey: key)
    }

    static func remove(_ q: String) { UserDefaults.standard.set(list().filter { $0 != q }, forKey: key) }

    static func clear() { UserDefaults.standard.removeObject(forKey: key) }
}

/// Folders in tree order (parents before their children, siblings by rank), for indented pickers.
enum FolderOrder {
    static func nested(_ all: [FolderNode]) -> [FolderNode] {
        var out: [FolderNode] = []
        func walk(_ parent: String?) {
            for f in all.filter({ $0.parentId == parent }).sorted(by: { $0.rank < $1.rank }) {
                out.append(f)
                walk(f.id)
            }
        }
        walk(nil)
        return out
    }
}

struct SearchHitRow: View {
    let hit: SearchHit
    let query: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NoteMark(icon: hit.icon, size: 15).frame(width: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(hit.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15)).lineLimit(1)
                if !hit.snippet.isEmpty { Text(highlighted(hit.snippet)).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                HStack(spacing: 8) {
                    Text(CoreDates.short(hit.updatedAt))
                    if let f = hit.folder { Label { Text(f.name) } icon: { FolderMark(colorId: f.color, size: 10) } }
                    if let s = hit.spaceName { Text(s) }
                    if hit.archived { Text("Archived") }
                }
                .font(.caption).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
    }

    private func highlighted(_ s: String) -> AttributedString {
        var a = AttributedString(s)
        for word in query.split(separator: " ") where word.count > 1 {
            var search = a.startIndex..<a.endIndex
            while let r = a[search].range(of: String(word), options: .caseInsensitive) {
                a[r].foregroundColor = .primary
                a[r].inlinePresentationIntent = .stronglyEmphasized
                search = r.upperBound..<a.endIndex
            }
        }
        return a
    }
}

// MARK: Shared with me

struct SharedScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var notes = Live<Views.SharedList>()
    @State private var folders = Live<Views.SharedFolders>()

    var body: some View {
        Group {
            if app.session.value?.mode == .local {
                EmptyScreen(symbol: "person.2", title: "Sign In to Folevi to Share and Collaborate", message: "This library lives on this Mac. With a Folevi account, people can share notes and folders with you, and they show up here.", actionTitle: "Sign In to Folevi…") { AccountActions.addAccount() }
            } else if notes.value == nil && folders.value == nil {
                SkeletonRows()
            } else if (notes.value?.rows ?? []).isEmpty && (folders.value?.rows ?? []).isEmpty {
                EmptyScreen(symbol: "person.2", title: "Nothing Shared Yet", message: "Notes and folders people share with you show up here.")
            } else {
                List {
                    if let f = folders.value?.rows, !f.isEmpty {
                        Section("Folders") {
                            ForEach(f, id: \.id) { row in
                                HStack(spacing: 10) {
                                    FolderMark(colorId: row.color, size: 18)
                                    VStack(alignment: .leading) {
                                        Text(row.name).font(CoreType.noteTitle(15))
                                        Text("\(row.sharedBy) · \(row.role.capitalized)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text("\(row.noteCount) notes").font(.caption).foregroundStyle(.secondary)
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.sharedFolder(row.id)) }
                            }
                        }
                    }
                    if let n = notes.value?.rows, !n.isEmpty {
                        Section("Notes") {
                            ForEach(n, id: \.id) { row in
                                HStack(alignment: .top, spacing: 10) {
                                    NoteMark(icon: row.icon, size: 15).frame(width: 18)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(row.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                        if !row.excerpt.isEmpty { Text(row.excerpt).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                                        Text("Shared by \(row.sharedBy) · \(row.role.capitalized) · \(CoreDates.short(row.sharedAt))").font(.caption).foregroundStyle(.tertiary)
                                    }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(row.id)) }
                                .contextMenu {
                                    Button("Open") { window.go(.note(row.id)) }
                                    Button("Open in New Tab") { app.open(.note(row.id), newTab: true) }
                                }
                            }
                        }
                    }
                }
                .listStyle(.inset)
            }
        }
        .navigationSubtitle(facts)
        .task(id: app.client.map(ObjectIdentifier.init)) {
            notes.bind(app.client, Views.SharedList())
            folders.bind(app.client, Views.SharedFolders())
        }
    }
}

extension SharedScreen {
    /// "2 folders · 5 notes · from anyone".
    var facts: String {
        let f = folders.value?.rows.count ?? 0, n = notes.value?.rows.count ?? 0
        guard f + n > 0 else { return "" }
        return "\(f == 1 ? "1 folder" : "\(f) folders") · \(n == 1 ? "1 note" : "\(n) notes") · from anyone"
    }
}

struct SharedFolderScreen: View {
    let window: WindowModel
    let id: String
    private var app: AppModel { .shared }
    @State private var folder = Live<Views.SharedFolderOpen>()

    var body: some View {
        Group {
            if let f = folder.value {
                if !f.found {
                    EmptyScreen(symbol: "folder.badge.questionmark", title: "Folder Not Available", message: "It may have been unshared or deleted.")
                } else {
                    List {
                        Section {
                            HStack(spacing: 12) {
                                FolderMark(colorId: f.color, size: 30)
                                VStack(alignment: .leading) {
                                    Text(f.name).font(CoreType.screenTitle(22))
                                    Text([f.workspaceName ?? f.ownerName, f.roleLabel].compactMap { $0 }.joined(separator: " · ")).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button { window.sharingFolder = f.sharedFolderId ?? f.id } label: { Label("People", coreSymbol: "person.2") }
                                    .help("Who has this folder")
                            }
                            .padding(.vertical, 6)
                            // Shared with Me › path › name
                            HStack(spacing: 4) {
                                Button("Shared with Me") { window.go(.shared) }.buttonStyle(.link)
                                ForEach(f.path, id: \.id) { p in
                                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                                    Button(p.name) { window.go(.sharedFolder(p.id)) }.buttonStyle(.link)
                                }
                                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                                Text(f.name).foregroundStyle(.secondary)
                            }
                            .font(.caption)
                            if let by = f.sharedBy {
                                Text("Shared with you by \(by)\(f.roleLabel.map { " (\($0.lowercased()))" } ?? ""). Notes added to this folder later show up here too.")
                                    .font(.callout).foregroundStyle(.secondary)
                            }
                        }
                        if !f.subfolders.isEmpty {
                            Section("Folders") {
                                ForEach(f.subfolders, id: \.id) { s in
                                    Label { Text(s.name) } icon: { FolderMark(colorId: s.color, size: 15) }
                                        .contentShape(Rectangle())
                                        .onTapGesture(count: 2) { window.go(.sharedFolder(s.id)) }
                                }
                            }
                        }
                        Section("Notes") {
                            ForEach(f.notes, id: \.id) { n in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(n.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                    if !n.excerpt.isEmpty { Text(n.excerpt).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2) }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture(count: 2) { window.go(.note(n.id)) }
                            }
                        }
                    }
                    .listStyle(.inset)
                }
            } else {
                LoadingScreen()
            }
        }
        .task(id: id) { folder.bind(app.client, Views.SharedFolderOpen(NoteIdArgs(id: id))) }
        .sheet(isPresented: Binding(get: { window.sharingFolder != nil }, set: { if !$0 { window.sharingFolder = nil } })) {
            if let s = window.sharingFolder { FolderSharingSheet(folderId: s) }
        }
    }
}

// MARK: Changes

/// What others changed in your notes since you last looked, and suggestions waiting for your answer.
struct ChangesScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var diffNote: String?

    var body: some View {
        Group {
            if app.session.value?.mode == .local {
                EmptyScreen(symbol: "person.2", title: "Sign In to Folevi to Share and Collaborate", message: "Changes other people make to notes you share show up here. This library lives on this Mac.", actionTitle: "Sign In to Folevi…") { AccountActions.addAccount() }
            } else if let c = app.changes.value {
                if c.notes.isEmpty && c.proposals.isEmpty {
                    EmptyScreen(symbol: "checkmark.circle", title: "You're Up to Date", message: "When people change notes you share, the changes show up here.")
                } else {
                    List {
                        if !c.proposals.isEmpty {
                            Section {
                                ForEach(c.proposals, id: \.id) { p in
                                    VStack(alignment: .leading, spacing: 6) {
                                        if let note = p.noteId {
                                            Button(p.title.nonEmpty ?? "Untitled") { window.go(.note(note)) }.buttonStyle(.hoverPlain).font(CoreType.noteTitle(15))
                                        } else {
                                            Text(p.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                        }
                                        Text("\(p.sourceName) proposed this \(CoreDates.short(p.createdAt))").font(.caption).foregroundStyle(.secondary)
                                        if let problem = p.problem {
                                            Label(problem, coreSymbol: "exclamationmark.triangle").font(.callout).foregroundStyle(.red)
                                        } else if p.noteId == nil {
                                            Text("You can't open this note, so its proposal isn't shown.").font(.callout).foregroundStyle(.secondary)
                                        } else {
                                            Text(p.summary).font(.callout)
                                                .padding(.leading, 8)
                                                .overlay(alignment: .leading) { Rectangle().fill(Color.folevi("moss")).frame(width: 3) }
                                        }
                                        HStack {
                                            if p.problem == nil {
                                                Button("Accept") {
                                                    app.perform { client in
                                                        _ = try await client.command(Commands.ProposalAccept(ProposalIdArgs(id: p.id)))
                                                        app.toast("Added to “\(p.title.nonEmpty ?? "Untitled")”")
                                                    }
                                                }
                                                .buttonStyle(InkPillStyle())
                                            }
                                            Button("Reject") {
                                                app.perform { client in
                                                    _ = try await client.command(Commands.ProposalReject(ProposalIdArgs(id: p.id)))
                                                    app.toast("Proposal rejected")
                                                }
                                            }
                                            if let note = p.noteId { Button("Open Note") { window.go(.note(note)) }.buttonStyle(InkLinkStyle()) }
                                        }
                                        .controlSize(.regular)
                                    }
                                    .padding(.vertical, 4)
                                }
                            } header: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Proposed")
                                    Text("Changes connected apps want to make to your notes. Nothing changes until you accept.").font(.caption).foregroundStyle(.secondary).textCase(nil)
                                }
                            }
                        }
                        if !c.notes.isEmpty {
                            Section("Changed Notes") {
                                ForEach(c.notes, id: \.id) { n in
                                    HStack(alignment: .top) {
                                        NoteMark(icon: n.icon, size: 15).frame(width: 18)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(n.title.nonEmpty ?? "Untitled").font(CoreType.noteTitle(15))
                                            Text("\(n.who) · \(n.counts)").font(.callout).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text(CoreDates.short(n.changedAt)).font(.caption).foregroundStyle(.tertiary)
                                    }
                                    InlineDiff(noteId: n.id)
                                    .contentShape(Rectangle())
                                    .onTapGesture(count: 2) {
                                        window.go(.note(n.id))
                                        app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: [n.id]))) }
                                    }
                                    .contextMenu {
                                        Button("Open") { window.go(.note(n.id)) }
                                        Button("Show What Changed…") { diffNote = n.id }
                                        Button("Mark as Seen") { app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: [n.id]))) } }
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.inset)
                    .sheet(isPresented: Binding(get: { diffNote != nil }, set: { if !$0 { diffNote = nil } })) {
                        if let id = diffNote { ChangeDiffSheet(noteId: id, window: window) }
                    }
                    .navigationSubtitle(c.proposals.isEmpty && c.notes.isEmpty ? "Nothing new" : "\(c.proposals.count) proposed · \(c.notes.count) \(c.notes.count == 1 ? "note" : "notes") changed since you last looked")
                    .toolbar {
                        ToolbarItem(placement: .secondaryAction) {
                            Button("Mark All as Seen") {
                                let ids = c.notes.map(\.id)
                                app.perform { _ = try await $0.command(Commands.ChangesMarkSeen(NoteIdsArgs(ids: ids))) }
                            }
                            .disabled(c.notes.isEmpty)
                        }
                    }
                }
            } else {
                LoadingScreen()
            }
        }
    }
}

// MARK: Templates

struct TemplatesScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var builtIn = Live<Views.TemplatesBuiltIn>()
    @State private var generating = false

    /// The ten soft tints of the template tiles.
    static let tints = ["cocoa", "moss", "marigold", "plum", "coral", "gray", "sky", "teal", "rose", "olive"]

    private var canGenerate: Bool { app.session.value?.capabilities.ai != false && app.sync.value?.online != false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let t = builtIn.value?.templates, !t.isEmpty {
                Text("Built In · \(t.count)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding([.horizontal, .top], 24)
                ScrollView(.horizontal) {
                    HStack(spacing: 12) {
                        ForEach(Array(t.enumerated()), id: \.element.key) { i, tmpl in
                            Button {
                                NoteActions.newNote(app: app, window: window, template: tmpl.key)
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Group {
                                        if let icon = WebIcon(rawValue: tmpl.icon) { icon.image(size: 16) } else { Image(systemName: "doc.text") }
                                    }
                                    .foregroundStyle(Color.folevi(Self.tints[i % Self.tints.count]))
                                    .frame(width: 30, height: 30)
                                    .background(Color.folevi(Self.tints[i % Self.tints.count]).opacity(0.15), in: .rect(cornerRadius: 8))
                                    Text(tmpl.name).font(CoreType.noteTitle(14))
                                    Text(tmpl.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                                .frame(width: 170, alignment: .leading)
                                .padding(12)
                                .background(.fill.quinary, in: .rect(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .hoverEffectCompat()
                            .help("New note from \(tmpl.name)")
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                }
                .scrollIndicators(.never)
                Divider()
            }
            Text("Your Templates").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).padding([.horizontal, .top], 24).padding(.bottom, 4)
            NoteListScreen(window: window, kind: .templates)
        }
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                if canGenerate {
                    Button { generating = true } label: { Label { Text("Generate with Foli AI…") } icon: { AiMarkGlyph(size: 15) } }
                        .help("Generate a template with Foli AI")
                }
                Button {
                    app.perform { client in
                        let r = try await client.command(Commands.TemplateCreate(TemplateCreateArgs(space: nil, title: nil, open: false)))
                        window.go(.note(r.id))
                    }
                } label: { Label("New Template", coreSymbol: "plus.square.on.square") }
            }
        }
        .sheet(isPresented: $generating) { GenerateTemplateSheet(window: window) }
        .task(id: app.client.map(ObjectIdentifier.init)) { builtIn.bind(app.client, Views.TemplatesBuiltIn()) }
    }
}

/// Generate a template with Foli AI: what it's for, a draft to look at, then save it as a template.
struct GenerateTemplateSheet: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var instruction = ""
    @State private var draft: AiGenerateResult?
    @State private var working = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Generate a Template").font(.headline)
            TextField("What's the template for?", text: $instruction, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            HStack {
                ForEach(["Weekly team meeting", "Project kickoff", "Book notes", "Trip planner"], id: \.self) { e in
                    Button(e) { instruction = e }.buttonStyle(.bordered).controlSize(.regular)
                }
            }
            if let d = draft {
                VStack(alignment: .leading, spacing: 6) {
                    Text(d.title).font(CoreType.noteTitle(16))
                    ScrollView { Text(d.text).font(CoreType.noteText(13)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(height: 200)
                }
                .padding(10).background(.fill.quinary, in: .rect(cornerRadius: 8))
            }
            if working { HStack { ProgressView().controlSize(.small); Text("Writing it…").foregroundStyle(.secondary) } }
            if let problem { Text(problem).font(.caption).foregroundStyle(.red) }
            HStack {
                Text("Foli AI can make mistakes. Look it over before you use it.").font(.caption).foregroundStyle(.tertiary)
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                if let d = draft {
                    Button("Try Again", action: generate).disabled(working)
                    Button("Save Template") { save(d) }.buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                } else {
                    Button("Generate", action: generate).buttonStyle(InkPillStyle()).keyboardShortcut(.defaultAction)
                        .disabled(instruction.trimmingCharacters(in: .whitespaces).isEmpty || working)
                }
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func generate() {
        let text = instruction.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        working = true
        problem = nil
        Task { @MainActor in
            defer { working = false }
            do {
                guard let client = app.client else { return }
                draft = try await client.command(Commands.AiGenerate(AiGenerateArgs(kind: .template, instruction: text, space: nil)))
            } catch let f as EngineFailure { problem = f.message } catch { problem = "Foli AI couldn't write it. Try again." }
        }
    }

    private func save(_ d: AiGenerateResult) {
        app.perform { client in
            let r = try await client.command(Commands.AiSaveDraft(AiSaveDraftArgs(kind: .template, title: d.title, text: d.text, space: nil, folderId: nil)))
            app.toast("Template saved", tone: .success, action: "Open") { window.go(.note(r.id)) }
        }
        dismiss()
    }
}

// MARK: Folders and tags

/// Folders: every folder of the space (nested ones too, with their path), as cards or rows; filter, sort
/// (manually, by name, by recent change), several selected for Open in New Tabs, Colour or Delete.
struct FoldersScreen: View {
    let window: WindowModel
    let parent: String?
    private var app: AppModel { .shared }
    @State private var cards = Live<Views.FoldersCards>()
    @State private var newFolder = false
    @State private var filter = ""
    @State private var selection: Set<String> = []
    /// While a folder is dragged over the cards: where it will land among the others (the cards slide aside).
    @State private var gap: FolderGap?
    @State private var leaveTick = 0
    @AppStorage("core.folders.sort") private var sort = "manual"
    @AppStorage("core.folders.layout") private var layout = "grid"
    @FocusState private var filterFocused: Bool

    private var shown: [FolderCard] {
        var all = cards.value?.folders ?? []
        let q = filter.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { all = all.filter { $0.name.localizedCaseInsensitiveContains(q) } }
        switch sort {
        case "name": return all.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        case "recent": return all.sorted { $0.updatedAt > $1.updatedAt }
        default: return all
        }
    }

    var body: some View {
        Group {
            if let all = cards.value?.folders {
                if all.isEmpty {
                    EmptyScreen(symbol: "folder", title: "No Folders", message: "Folders keep related notes together.", actionTitle: "New Folder") { newFolder = true }
                } else if shown.isEmpty {
                    EmptyScreen(symbol: "magnifyingglass", title: "No Results", message: "No folder matches “\(filter)”.")
                } else if layout == "list" {
                    list
                } else if layout == "tree" {
                    tree
                } else {
                    grid
                }
            } else {
                SkeletonGrid()
            }
        }
        .searchable(text: $filter, placement: .toolbar, prompt: "Filter Folders")
        .searchFocused($filterFocused)
        .onChange(of: window.filterFocus) { filterFocused = true }
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItemGroup(placement: .secondaryAction) {
                Picker("View", selection: $layout) {
                    Label("Cards", coreSymbol: "square.grid.2x2").tag("grid")
                    Label("List", coreSymbol: "list.bullet").tag("list")
                    Label("Tree", coreSymbol: "list.bullet.indent").tag("tree")
                }
                .pickerStyle(.segmented).labelsHidden().help("View as Cards or List")
                Menu {
                    Picker("Sort By", selection: $sort) {
                        Text("Manually").tag("manual")
                        Text("Name").tag("name")
                        Text("Recently Changed").tag("recent")
                    }
                    .pickerStyle(.inline)
                } label: { Label("Sort", coreSymbol: "arrow.up.arrow.down") }
                .help("Sort Folders")
                Button { newFolder = true } label: { Label("New Folder", coreSymbol: "folder.badge.plus") }.help("New Folder (⌃⌘N)")
            }
        }
        .overlay(alignment: .bottom) { GlassEffectContainer { ZStack { selectionBar } }.coreAnimation(Motion.bar, value: selection.isEmpty) }
        .sheet(isPresented: $newFolder) {
            NameSheet(title: "New Folder", initial: "", action: "Create") { name in
                app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: parent, color: nil))) }
            }
        }
        .task(id: parent) { cards.bind(app.client, Views.FoldersCards(FolderCardsArgs(space: nil, parentId: parent, all: parent == nil ? true : nil))) }
    }

    private var subtitle: String {
        let total = cards.value?.folders.count ?? 0
        let n = shown.count
        return filter.isEmpty ? (total == 1 ? "1 folder" : "\(total) folders") : "\(n) of \(total) folders"
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: CoreCards.folderWidth - 16, maximum: CoreCards.folderWidth), spacing: CoreCards.gap)], spacing: CoreCards.gap + 2) {
                let byId = Dictionary(shown.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                ForEach(drawn, id: \.self) { id in
                    if let folder = byId[id] {
                        HomeFolderCard(folder: folder, window: window, reorder: hooks(for: folder))
                            .overlay(alignment: .topTrailing) {
                                if selection.contains(folder.id) {
                                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Color.foleviInk).padding(6)
                                }
                            }
                            .simultaneousGesture(TapGesture().modifiers(.command).onEnded { toggle(folder.id) })
                    } else {
                        // A folder dragged in from the sidebar: an empty spot where it will land.
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.secondary.opacity(0.6), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                            .frame(minHeight: 120)
                    }
                }
            }
            .coreAnimation(.smooth(duration: 0.24), value: drawn)
            .padding(24)
            // The spaces between cards keep the gap and take the drop there too.
            .onDrop(of: [FolderDrag.type], delegate: FolderGapDrop(keep: { keepGap() }, leave: { leaveGap() }, drop: { dropInGap() }))
        }
        .focusable()
        .focusEffectDisabled()
        .onKeyPress(characters: ["a"], phases: .down) { press in
            guard press.modifiers.contains(.command) else { return .ignored }
            selection = Set(shown.map(\.id))
            return .handled
        }
        .onKeyPress(.escape) { if selection.isEmpty { return .ignored }; selection.removeAll(); return .handled }
    }

    private var list: some View {
        List(selection: $selection) {
            ForEach(shown, id: \.id) { f in
                HStack(spacing: 10) {
                    FolderMark(colorId: f.color, size: 18, kind: f.childCount > 0 ? .stack : (f.noteCount > 0 ? .notes : .empty))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(f.name)
                        if let path = f.path, !path.isEmpty { Text("in \(path)").font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Text(f.noteCount == 1 ? "1 note" : "\(f.noteCount) notes").font(.caption).foregroundStyle(.secondary)
                    Text(CoreDates.short(f.updatedAt)).font(.caption).foregroundStyle(.tertiary).frame(width: 90, alignment: .trailing)
                }
                .padding(.vertical, 3)
                .tag(f.id)
            }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let node = app.tree.value?.folders.first(where: { $0.id == id }) {
                FolderMenu(folder: node, window: window, rename: { _ in }, newSubfolder: { _ in })
            } else if ids.count > 1 {
                bulkItems(Array(ids))
            }
        } primaryAction: { ids in
            if let id = ids.first { window.go(.folder(id)) }
        }
    }

    @ViewBuilder private func bulkItems(_ ids: [String]) -> some View {
        Button("Open \(ids.count) Folders in New Tabs") { openInTabs(ids) }
        Button("Change Colour…") { window.colorPick = ColorPickTarget(ids: ids, current: nil) }
        Divider()
        Button("Delete \(ids.count) Folders…", role: .destructive) { FolderActions.delete(ids, app: app); selection.removeAll() }
    }

    @ViewBuilder private var selectionBar: some View {
        if selection.count > 1 {
            let ids = Array(selection)
            HStack(spacing: 14) {
                Text("\(ids.count) selected").font(.callout.weight(.medium))
                if ids.count < shown.count { Button("Select All") { selection = Set(shown.map(\.id)) } }
                Divider().frame(height: 16)
                Button { openInTabs(ids) } label: { Label("Open in Tabs", coreSymbol: "plus.square.on.square") }
                Button { window.colorPick = ColorPickTarget(ids: ids, current: nil) } label: { Label("Colour", coreSymbol: "paintpalette") }
                Button(role: .destructive) { FolderActions.delete(ids, app: app); selection.removeAll() } label: { Label("Delete", coreSymbol: "trash") }
                Button { selection.removeAll() } label: { Image(systemName: "xmark") }.help("Clear Selection (Esc)").keyboardShortcut(.cancelAction)
            }
            .labelStyle(.titleAndIcon)
            .buttonStyle(.borderless)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .glassArrival(from: .bottom)
            .padding(.bottom, 16)
        }
    }

    /// The cards in the order to draw them: the dragged folder moved to its gap while there is one.
    private var drawn: [String] {
        let ids = shown.map(\.id)
        guard let gap, filter.isEmpty else { return ids }
        var others = ids.filter { $0 != gap.id }
        others.insert(gap.id, at: min(gap.at, others.count))
        return others
    }

    private func hooks(for folder: FolderCard) -> FolderReorderHooks? {
        guard filter.isEmpty else { return nil }
        return FolderReorderHooks(
            hover: { zone in hover(folder, zone) },
            drop: { zone in drop(on: folder, zone) },
            landing: gap?.id == folder.id
        )
    }

    /// A dragged folder over a card: its left or right quarter opens the gap before or after it; over a card's
    /// middle the gap stays where it is (so the cards don't jump back under the pointer); over the dragged folder
    /// itself, the gap is where it already is.
    private func hover(_ target: FolderCard, _ zone: FolderDropZone?) {
        guard let dragged = FolderDrag.current else { return }
        guard let zone else { leaveGap(); return }
        keepGap()
        let ids = shown.map(\.id)
        let others = ids.filter { $0 != dragged }
        var at: Int?
        if target.id == dragged {
            if gap?.id != dragged { at = ids.firstIndex(of: dragged) }
        } else if let i = others.firstIndex(of: target.id) {
            switch zone {
            case .before: at = i
            case .after: at = i + 1
            case .inside: break
            }
        }
        if let at, gap != FolderGap(id: dragged, at: at) { gap = FolderGap(id: dragged, at: at) }
    }

    /// A folder dropped on a card: on another card's middle it goes inside (false: the card moves it); anywhere
    /// else it lands in the gap.
    private func drop(on target: FolderCard, _ zone: FolderDropZone) -> Bool {
        guard let moving = FolderDrag.current else { return false }
        if zone == .inside, target.id != moving {
            gap = nil
            FolderDrag.current = nil
            return false
        }
        return dropInGap()
    }

    @discardableResult
    private func dropInGap() -> Bool {
        defer { gap = nil; FolderDrag.current = nil }
        guard let g = gap, let moving = FolderDrag.current, g.id == moving else { return false }
        let ids = shown.map(\.id)
        if ids.firstIndex(of: moving) == g.at { return true }   // back where it was
        // The folder stays at this page's level (as on the web: one dragged in from deeper comes up to it), after
        // the nearest card before the gap at that level.
        let others = ids.filter { $0 != moving }
        let level = Set(shown.filter { $0.parentId == parent }.map(\.id))
        let after = others.prefix(min(g.at, others.count)).last { level.contains($0) }
        place(moving, after: after)
        return true
    }

    /// The drag is still over the cards (cancels a pending close of the gap).
    private func keepGap() { leaveTick &+= 1 }

    /// The drag left a card or the grid: the gap closes unless it comes back over the cards within a moment
    /// (moving from one card to the next passes through here).
    private func leaveGap() {
        leaveTick &+= 1
        let tick = leaveTick
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            if leaveTick == tick { gap = nil }
        }
    }

    /// A folder put in its place on this page: at the page's level, after `after` (nil: first). The sort turns
    /// Manual so the new order shows.
    private func place(_ moving: String, after: String?) {
        if let parent, let why = FolderActions.refusal(moving: moving, into: parent) { app.toast(why, tone: .error); return }
        let name = shown.first { $0.id == moving }?.name ?? "the folder"
        let wasManual = sort == "manual"
        sort = "manual"
        app.perform { _ = try await $0.command(Commands.FolderMove(FolderMoveArgs(id: moving, parentId: parent, afterId: after))) }
        app.toast(wasManual ? "Moved “\(name)”" : "Moved “\(name)”. Folders are now in manual order.")
    }

    /// Every folder in its place in the tree, opened and closed by disclosure.
    private var tree: some View {
        let all = cards.value?.folders ?? []
        func kids(_ parent: String?) -> [FolderCard] {
            let ids = Set(all.map(\.id))
            return all.filter { parent == nil ? ($0.parentId == nil || !ids.contains($0.parentId!)) : $0.parentId == parent }
        }
        return List(selection: $selection) {
            ForEach(kids(nil), id: \.id) { f in FolderTreeRow(folder: f, children: kids, window: window) }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: String.self) { ids in
            if ids.count == 1, let id = ids.first, let node = app.tree.value?.folders.first(where: { $0.id == id }) {
                FolderMenu(folder: node, window: window, rename: { _ in }, newSubfolder: { _ in })
            } else if ids.count > 1 { bulkItems(Array(ids)) }
        } primaryAction: { ids in if let id = ids.first { window.go(.folder(id)) } }
    }

    private func toggle(_ id: String) { if selection.contains(id) { selection.remove(id) } else { selection.insert(id) } }

    private func openInTabs(_ ids: [String]) {
        for id in ids { app.open(.folder(id), newTab: true, background: true) }
        app.toast(ids.count == 1 ? "Opened 1 new tab" : "Opened \(ids.count) new tabs")
        selection.removeAll()
    }
}

/// Tags: filter (a leading # is ignored), sort by name, use or age, edit and delete.
struct TagsScreen: View {
    let window: WindowModel
    private var app: AppModel { .shared }
    @State private var tags = Live<Views.TagsIndex>()
    @State private var editing: TagIndexRow?
    @State private var filter = ""
    @FocusState private var filterFocused: Bool
    /// Column sorting (click a header); the Sort menu sets it too.
    @State private var order: [KeyPathComparator<TagIndexRow>] = [KeyPathComparator(\.name)]
    @AppStorage("core.tags.sort") private var sort = "name"

    private func shown(_ rows: [TagIndexRow]) -> [TagIndexRow] {
        var q = filter.trimmingCharacters(in: .whitespaces)
        if q.hasPrefix("#") { q.removeFirst() }
        let f = q.isEmpty ? rows : rows.filter { $0.name.localizedCaseInsensitiveContains(q) }
        switch sort {
        case "used": return f.sorted { $0.documentCount > $1.documentCount }
        case "newest": return f.sorted { $0.createdAt > $1.createdAt }
        default: return f.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        }
    }

    var body: some View {
        Group {
            if let all = tags.value?.tags {
                let rows = shown(all)
                if all.isEmpty {
                    EmptyScreen(symbol: "number", title: "No Tags", message: "Type # in a note, or add tags from its Info panel (⌥⌘I).")
                } else if rows.isEmpty {
                    EmptyScreen(symbol: "magnifyingglass", title: "No Results", message: "No tag matches “\(filter)”.")
                } else {
                    Table(rows.sorted(using: order), sortOrder: $order) {
                        TableColumn("Tag", value: \.name) { t in
                            Label { Text(t.name) } icon: { WebIcon.hash.image(size: 14).foregroundStyle(Color.folevi(t.color)) }
                        }
                        TableColumn("Notes", value: \.documentCount) { t in Text(t.documentCount.formatted()).monospacedDigit() }.width(80)
                        TableColumn("Created", value: \.createdAt) { t in Text(CoreDates.short(t.createdAt)) }.width(120)
                    }
                    .contextMenu(forSelectionType: TagIndexRow.ID.self) { ids in
                        if let id = ids.first, let t = all.first(where: { $0.id == id }) {
                            Button("Open") { window.go(.tag(t.id)) }
                            Button("Open in New Tab") { app.open(.tag(t.id), newTab: true) }
                            Button("Edit Tag…") { editing = t }
                            ForEach(TagColors.all.filter { $0.id != t.color }, id: \.id) { c in
                                Button("Colour: \(c.name)") { app.perform { _ = try await $0.command(Commands.TagUpdate(TagUpdateArgs(id: t.id, name: nil, color: c.id))) } }
                            }
                            Divider()
                            Button("Delete Tag…", role: .destructive) { TagActions.delete(id: t.id, name: t.name, window: window) }
                        }
                    } primaryAction: { ids in
                        if let id = ids.first { window.go(.tag(id)) }
                    }
                }
            } else {
                LoadingScreen()
            }
        }
        .searchable(text: $filter, placement: .toolbar, prompt: "Filter Tags")
        .navigationSubtitle(subtitle)
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Menu {
                    Picker("Sort By", selection: $sort) {
                        Text("Name").tag("name")
                        Text("Most Used").tag("used")
                        Text("Newest").tag("newest")
                    }
                    .pickerStyle(.inline)
                } label: { Label("Sort", coreSymbol: "arrow.up.arrow.down") }
                .help("Sort Tags")
            }
        }
        .sheet(item: $editing) { t in TagEditSheet(id: t.id, initialName: t.name, initialColor: t.color) }
        .onChange(of: sort, initial: true) {
            switch sort {
            case "used": order = [KeyPathComparator(\.documentCount, order: .reverse)]
            case "newest": order = [KeyPathComparator(\.createdAt, order: .reverse)]
            default: order = [KeyPathComparator(\.name)]
            }
        }
        .searchFocused($filterFocused)
        .onChange(of: window.filterFocus) { filterFocused = true }
        .task(id: app.client.map(ObjectIdentifier.init)) { tags.bind(app.client, Views.TagsIndex(TagsIndexArgs(space: nil))) }
    }

    private var subtitle: String {
        let all = tags.value?.tags ?? []
        let n = shown(all).count
        if filter.isEmpty { return all.count == 1 ? "1 tag" : "\(all.count) tags" }
        return "\(n) of \(all.count) tags"
    }
}

/// Card shapes while a grid loads.
struct SkeletonGrid: View {
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 22)], spacing: 22) {
                ForEach(0..<8, id: \.self) { _ in RoundedRectangle(cornerRadius: 10).fill(.fill.tertiary).frame(height: 170) }
            }
            .padding(24)
        }
        .accessibilityLabel("Loading")
    }
}

/// Row shapes while a list loads.
struct SkeletonRows: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(0..<9, id: \.self) { i in
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 3).fill(.fill.tertiary).frame(width: 16, height: 16)
                    VStack(alignment: .leading, spacing: 6) {
                        RoundedRectangle(cornerRadius: 3).fill(.fill.tertiary).frame(width: CGFloat(160 + (i * 37) % 140), height: 12)
                        RoundedRectangle(cornerRadius: 3).fill(.fill.quaternary).frame(width: CGFloat(260 + (i * 53) % 200), height: 9)
                    }
                }
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel("Loading")
    }
}

extension TagIndexRow: Identifiable {}
extension FolderNode: Identifiable {}

// MARK: Pages that stay on the page

/// Reviews (flashcards) and the Foli DNA graph are drawn by the page (canvas content), in Core's window with
/// native bars, as a note is.
struct WebScreen: View {
    let window: WindowModel
    let page: WebPage
    private var app: AppModel { .shared }
    @State private var host: Page?
    @State private var shown: WebPage?

    /// Foli DNA of a note: the map around it (/graph?note=<id>, the engine's `center`); a saved view: /graph?view=<id>.
    private var request: String? { page == .graph ? window.graphQuery ?? window.graphCenter.map({ "note=\($0)" }) : nil }

    var body: some View {
        PageHostView(page: host)
            // (Keyed by the request too: "Foli DNA of This Note" while Foli DNA is already open.)
            .task(id: "\(page)|\(request ?? "")") {
                guard let p = app.pool.editor(for: window.id) else { return }
                host = p
                let query = request
                // Clearing the request below runs this again: the page is already there.
                if query == nil, shown == page { return }
                window.graphCenter = nil
                window.graphQuery = nil
                shown = page
                await p.show(web: page, query: query)
            }
            .onDisappear {
                shown = nil
                host = nil
                app.pool.giveBack(from: window.id)
            }
    }
}

// MARK: The daily note

struct DailyNoteScreen: View {
    let window: WindowModel
    let date: String?
    private var app: AppModel { .shared }

    var body: some View {
        LoadingScreen()
            .task(id: date) {
                // The page knows the daily note of a date (or makes it): it navigates to it.
                guard let p = app.pool.engine else { return }
                Events.command(["type": "navigate", "path": Destination.daily(date).path], to: p.view)
            }
    }
}

// MARK: Invitations

struct InviteScreen: View {
    let window: WindowModel
    let kind: Destination.InviteKind
    let token: String
    private var app: AppModel { .shared }
    @State private var preview: InvitePreview?
    @State private var loaded = false

    var body: some View {
        VStack(spacing: 18) {
            if !loaded {
                ProgressView()
            } else if let p = preview, p.valid {
                Image(systemName: kind == .folder ? "folder.badge.person.crop" : kind == .page ? "doc.badge.ellipsis" : "person.3")
                    .font(.system(size: 44)).foregroundStyle(.secondary)
                Text(p.inviterName.map { "\($0) invited you" } ?? "You're invited").font(CoreType.screenTitle(26))
                if let name = p.name { Text(name).font(.title3) }
                if let role = p.roleLabel { Text(role).foregroundStyle(.secondary) }
                if !p.emailMatches { Label("This invitation was sent to a different email address.", coreSymbol: "exclamationmark.triangle").foregroundStyle(.orange) }
                HStack {
                    Button("Decline") { app.perform { _ = try await $0.command(Commands.InviteDecline(InviteDeclineArgs(kind: .init(rawValue: kind.rawValue) ?? .workspace, inviteId: nil, token: token))); window.go(.home) } }
                    Button("Accept") { accept() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
                .controlSize(.large)
            } else {
                EmptyScreen(symbol: "envelope.badge.shield.half.filled", title: "Invitation Not Valid", message: "It may have expired or been used already.")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: token) {
            preview = try? await app.client?.query(Views.InvitePreview(InviteTokenArgs(kind: .init(rawValue: kind.rawValue) ?? .workspace, token: token)))
            loaded = true
        }
    }

    private func accept() {
        app.perform { client in
            switch kind {
            case .workspace: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .workspace, token: token)))
            case .page: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .page, token: token)))
            case .folder: _ = try await client.command(Commands.InviteAcceptLink(InviteTokenArgs(kind: .folder, token: token)))
            }
            window.go(.home)
        }
    }
}

/// What changed in a note since you last looked: added, changed and removed lines, with who and when.
struct ChangeDiffSheet: View {
    let noteId: String
    let window: WindowModel
    private var app: AppModel { .shared }
    @Environment(\.dismiss) private var dismiss
    @State private var diff: ChangeDiffValue?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(diff?.title.nonEmpty ?? "Changes").font(CoreType.screenTitle(20))
                Spacer()
                Button("Open Note") { dismiss(); window.go(.note(noteId)) }.buttonStyle(InkPillStyle())
            }
            .padding(16)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let d = diff {
                        if d.encrypted { Text("This note is end to end encrypted: open it to see what changed.").foregroundStyle(.secondary) }
                        ForEach(d.blocks, id: \.id) { b in
                            HStack(alignment: .top, spacing: 8) {
                                Rectangle().fill(b.change == "added" ? Color.green : b.change == "removed" ? Color.red : Color.orange).frame(width: 3)
                                VStack(alignment: .leading, spacing: 3) {
                                    if let parts = b.parts, !parts.isEmpty {
                                        parts.reduce(Text("")) { acc, p in
                                            acc + Text(p.text)
                                                .foregroundStyle(p.kind == "added" ? Color.green : p.kind == "removed" ? Color.red : Color.primary)
                                                .strikethrough(p.kind == "removed")
                                        }
                                        .font(CoreType.noteText(14))
                                    } else {
                                        Text(b.x).font(CoreType.noteText(14)).strikethrough(b.change == "removed")
                                    }
                                    if let who = b.who { Text("\(who)\(b.at.map { " · " + CoreDates.relative($0) } ?? "")").font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                        if d.truncated { Text("More changes are in the note's version history.").font(.caption).foregroundStyle(.secondary) }
                    } else {
                        ProgressView()
                    }
                }
                .padding(16)
            }
        }
        .frame(width: 560, height: 520)
        .task { diff = try? await app.client?.query(Views.ChangesDiff(ChangeDiffArgs(id: noteId))) }
    }
}


/// What changed in a note, under its row on Changes: loaded when it appears, the first 40 blocks, added words in
/// moss and underlined, removed ones in coral and struck through.
struct InlineDiff: View {
    let noteId: String
    private var app: AppModel { .shared }
    @State private var diff: ChangeDiffValue?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let d = diff {
                if d.encrypted {
                    Text("Encrypted: open the note to see what changed.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(d.blocks.prefix(40), id: \.id) { b in
                        Group {
                            if let parts = b.parts, !parts.isEmpty {
                                parts.reduce(Text("")) { acc, p in
                                    acc + Text(p.text)
                                        .foregroundStyle(p.kind == "added" ? Color.folevi("moss") : p.kind == "removed" ? Color.folevi("coral") : Color.secondary)
                                        .strikethrough(p.kind == "removed")
                                        .underline(p.kind == "added")
                                }
                            } else {
                                Text(b.x)
                                    .foregroundStyle(b.change == "added" ? Color.folevi("moss") : b.change == "removed" ? Color.folevi("coral") : Color.secondary)
                                    .strikethrough(b.change == "removed")
                                    .underline(b.change == "added")
                            }
                        }
                        .font(CoreType.noteText(13))
                        .lineLimit(3)
                    }
                    if d.truncated || d.blocks.count > 40 { Text("More changes are in the note's version history.").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
        .padding(.leading, 28)
        .task { diff = try? await app.client?.query(Views.ChangesDiff(ChangeDiffArgs(id: noteId))) }
    }
}


struct FolderTreeRow: View {
    let folder: FolderCard
    let children: (String?) -> [FolderCard]
    let window: WindowModel
    @State private var open = false

    var body: some View {
        let kids = children(folder.id)
        if kids.isEmpty {
            label
        } else {
            DisclosureGroup(isExpanded: $open) {
                ForEach(kids, id: \.id) { FolderTreeRow(folder: $0, children: children, window: window) }
            } label: { label }
        }
    }

    private var label: some View {
        HStack(spacing: 8) {
            FolderMark(colorId: folder.color, size: 15, kind: folder.childCount > 0 ? .stack : (folder.noteCount > 0 ? .notes : .empty))
            Text(folder.name)
            Spacer()
            Text(folder.noteCount == 1 ? "1 note" : "\(folder.noteCount) notes").font(.caption).foregroundStyle(.secondary)
        }
        .tag(folder.id)
        .onMiddleClick { AppModel.shared.open(.folder(folder.id), newTab: true, background: true) }
    }
}
