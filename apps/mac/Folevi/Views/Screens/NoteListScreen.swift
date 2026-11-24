// The note lists: All Notes, Starred, Drafts, a folder, a tag, Archive, Trash and Templates. Rows (the Mac's
// list: title in Spectral, a line of the note, the folder and the date) or cards (Folevi's note cards), sorted as
// the person picks, filtered by the toolbar's search field, with multi-selection, context menus, drag to folders
// and to Trash, and Return or a double-click to open.
import FoleviDesign
import FoleviEngine
import SwiftUI

struct NoteListScreen: View {
    let window: WindowModel
    let kind: NotesListView
    var folderId: String?
    var tagId: String?
    private var app: AppModel { .shared }
    @State private var list = LiveList<ListViews.NotesList>()
    @State private var selection: Set<String> = []
    /// The card the keyboard is on in the grid, and the grid's width (for its columns).
    @State private var keyCard: String?
    @State private var gridWidth: CGFloat = 800
    @FocusState private var gridFocused: Bool
    /// The sort, kept per list (core.list.sort.<list>).
    @State private var sortRaw = NotesSort.updated.rawValue
    @State private var renamingFolder: FolderNode?
    @FocusState private var filterFocused: Bool
    @State private var newSubfolderOf: FolderNode?
    @State private var filter = ""
    @State private var subfolders = Live<Views.FoldersCards>()
    @State private var trash = Live<Views.TrashSummary>()

    private var sort: NotesSort { NotesSort(rawValue: sortRaw) ?? .updated }

    /// The rows as shown: without notes leaving the list, with stars changed but not confirmed yet.
    private var shownRows: [NoteRow] {
        list.rows.compactMap { r in
            guard !app.hiddenNotes.contains(r.id) else { return nil }
            guard let star = app.starOverrides[r.id] else { return r }
            var copy = r
            copy.starred = star
            return copy
        }
    }

    private func archive(_ ids: [String], _ on: Bool) {
        app.optimistic(ids, hide: true) { try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: ids, archived: on))) }
    }

    private func star(_ ids: [String], _ on: Bool) {
        app.optimistic(ids, star: on) { try await $0.command(Commands.NoteStar(NoteStarArgs(ids: ids, starred: on))) }
    }

    private var spec: ListViews.NotesList {
        ListViews.NotesList(NotesListArgs(space: nil, view: kind, folderId: folderId, tagId: tagId, sort: sort, filter: filter.isEmpty ? nil : filter))
    }

    var body: some View {
        content
            .screenSearch(text: $filter, prompt: "Filter \(title)")
            .screenActions { toolbar }
            .task(id: spec.args) { list.bind(app.client, spec) }
            .task(id: folderId) {
                if kind == .folder { subfolders.bind(app.client, Views.FoldersCards(FolderCardsArgs(space: nil, parentId: folderId, all: nil))) }
                if kind == .trash { trash.bind(app.client, Views.TrashSummary(SpaceArgs())) }
            }
            .onChange(of: app.client.map(ObjectIdentifier.init)) { list.bind(app.client, spec) }
            .task(id: kind) { loadPrefs() }
            .onChange(of: sortRaw) { UserDefaults.standard.set(sortRaw, forKey: "core.list.sort.\(kind.rawValue)") }
            .onChange(of: window.listStyle) { UserDefaults.standard.set(window.listStyle.rawValue, forKey: "core.list.style.\(kind.rawValue)") }
            .sheet(item: $renamingFolder) { f in
                NameSheet(title: "Rename Folder", initial: f.name, action: "Rename") { name in
                    app.perform { _ = try await $0.command(Commands.FolderRename(FolderRenameArgs(id: f.id, name: name))) }
                }
            }
            .sheet(item: $newSubfolderOf) { f in
                NameSheet(title: "New Folder in \(f.name)", initial: "", action: "Create") { name in
                    app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: f.id, color: nil))) }
                }
            }
            .screenSubtitle(subtitle)
            .sheet(isPresented: Binding(get: { window.sharingFolder != nil && window.sharingFolder == folderId }, set: { if !$0 { window.sharingFolder = nil } })) {
                if let folderId { FolderSharingSheet(folderId: folderId) }
            }
    }

    @ViewBuilder private var content: some View {
        if list.isLoading && list.rows.isEmpty {
            if window.listStyle != .list { SkeletonGrid() } else { SkeletonRows() }
        } else if list.rows.isEmpty && (subfolders.value?.folders ?? []).isEmpty {
            empty
        } else if window.listStyle == .cards || window.listStyle == .compact {
            cards
        } else {
            rows
        }
    }

    private var title: String {
        switch kind {
        case .folder: app.tree.value?.folders.first { $0.id == folderId }?.name ?? "Folder"
        case .tag: app.tree.value?.tags.first { $0.id == tagId }.map { "#" + $0.name } ?? "Tag"
        case .all: "All Notes"
        case .starred: "Starred"
        case .archive: "Archive"
        case .trash: "Trash"
        case .templates: "Templates"
        case .unsorted: "Drafts"
        }
    }

    private var subtitle: String {
        let n = list.total
        if kind == .templates { return n == 1 ? "1 custom template" : "\(n.formatted()) custom templates" }
        return n == 1 ? "1 note" : "\(n.formatted()) notes"
    }

    // MARK: rows

    private var rows: some View {
        List(selection: $selection) {
            if kind == .folder, let folders = subfolders.value?.folders, !folders.isEmpty {
                Section("Folders") {
                    ForEach(folders, id: \.id) { f in
                        FolderListRow(folder: f)
                            .tag("folder:" + f.id)
                            .onTapGesture(count: 2) { window.go(.folder(f.id)) }
                            .listRowSeparator(.hidden)
                    }
                }
            }
            Section {
                ForEach(Array(shownRows.enumerated()), id: \.element.id) { i, row in
                    NoteListRow(row: row, showFolder: kind != .folder)
                        .draggable(containerItemID: row.id)
                        .overlay(alignment: .trailing) {
                            if kind == .templates {
                                Button("Use") { NoteActions.newNote(app: app, window: window, template: row.id) }
                                    .controlSize(.regular).help("New note from this template")
                            }
                        }
                        .tag(row.id)
                        .contextMenu {
                            NoteMenu(row: row, window: window,
                                     moveUp: sort == .manual && i > 0 ? { move(row.id, after: i >= 2 ? list.rows[i - 2].id : nil) } : nil,
                                     moveDown: sort == .manual && i < list.rows.count - 1 ? { move(row.id, after: list.rows[i + 1].id) } : nil)
                        }
                        .onAppear { if row.id == list.rows.last?.id { more() } }
                        // No line between rows (the owner: spacing and the hover tell rows apart).
                        .listRowSeparator(.hidden)
                }
                .onMove(perform: sort == .manual ? reorder : nil)
            } header: {
                if kind == .folder, !(subfolders.value?.folders ?? []).isEmpty { Text("Notes") }
            }
        }
        .listStyle(.inset)
        .alternatingRowBackgrounds(.disabled)
        .onChange(of: selection) { if selection.count == 1, let id = selection.first { window.prepare(id) } }
        .onScreen(window) { list.setVisible($0) }
        // Dragging a selected note drags every selected note (to a folder, the sidebar, Finder as files).
        .dragContainer(for: NoteDrag.self, itemID: \.id) { ids in
            ids.compactMap { id in list.rows.first { $0.id == id }.map { NoteDrag(id: $0.id, title: $0.title) } }
        }
        .dragContainerSelection(Array(selection.filter { !$0.hasPrefix("folder:") }))
        .contextMenu(forSelectionType: String.self) { ids in
            selectionMenu(ids)
        } primaryAction: { ids in
            open(ids)
        }
        .onKeyPress(.return) {
            open(selection)
            return .handled
        }
        .onDeleteCommand { trashSelection() }
        .overlay(alignment: .bottom) { GlassEffectContainer { ZStack { selectionBar } }.appAnimation(Motion.bar, value: selection.isEmpty) }
    }

    /// With more than one note selected: what every one of them can take, in a glass bar at the foot.
    @ViewBuilder private var selectionBar: some View {
        let notes = Array(selection.filter { !$0.hasPrefix("folder:") })
        if notes.count > 1 {
            HStack(spacing: 14) {
                Text("\(notes.count) selected").font(.callout.weight(.medium))
                if notes.count < list.rows.count { Button("Select All") { selection = Set(list.rows.map(\.id)) } }
                Divider().frame(height: 16)
                if kind == .trash {
                    Button("Restore") { app.optimistic(notes, hide: true) { try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: notes))) }; selection.removeAll() }
                    Button("Delete…", role: .destructive) { NoteActions.deleteForever(notes, app: app); selection.removeAll() }
                } else {
                    let allStarred = notes.allSatisfy { id in list.rows.first { $0.id == id }?.starred == true }
                    Button { star(notes, !allStarred) } label: { Label(allStarred ? "Unstar" : "Star", systemImage: allStarred ? "bookmark.slash" : "bookmark") }
                    Button { window.pickFolder(.moveNotes, notes) } label: { Label("Move", appSymbol: "folder") }
                    Button { window.pickFolder(.copyNotes, notes) } label: { Label("Copy To", appSymbol: "doc.on.doc") }
                    if let tags = app.tree.value?.tags, !tags.isEmpty {
                        Menu {
                            ForEach(tags, id: \.id) { t in Button("#" + t.name) { addTag(t.id, to: notes) } }
                        } label: { Label("Add Tag", appSymbol: "number") }
                        .fixedSize()
                    }
                    Button {
                        archive(notes, kind != .archive)
                        selection.removeAll()
                    } label: { Label(kind == .archive ? "Unarchive" : "Archive", appSymbol: "archivebox") }
                    Button(role: .destructive) { trashSelection() } label: { Label("Trash", appSymbol: "trash") }
                }
                Button { selection.removeAll() } label: { Image(systemName: "xmark") }.help("Clear Selection (Esc)").keyboardShortcut(.cancelAction)
            }
            .labelStyle(.titleAndIcon)
            .buttonStyle(.borderless)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .glassArrival(from: .bottom)
            .padding(.bottom, 16)
        }
    }

    // MARK: cards

    private var cards: some View {
        ScrollViewReader { proxy in
        ScrollView {
            if kind == .folder, let folders = subfolders.value?.folders, !folders.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: AppCards.folderWidth - 16, maximum: AppCards.folderWidth), spacing: AppCards.gap)], spacing: AppCards.gap) {
                    ForEach(folders, id: \.id) { f in
                        Button { window.go(.folder(f.id)) } label: { WebFolderCard(Cards.folder(f)) }
                            .buttonStyle(CardPressStyle())
                    }
                }
                .padding([.horizontal, .top], 24)
            }
            LazyVGrid(columns: [compact ? GridItem(.adaptive(minimum: 150, maximum: 180), spacing: 14) : GridItem(.adaptive(minimum: AppCards.noteWidth - 16, maximum: AppCards.noteWidth), spacing: AppCards.gap)], spacing: compact ? 14 : AppCards.gap + 2) {
                ForEach(shownRows) { row in
                    NoteCardButton(row: row, window: window, inTrash: kind == .trash)
                        .scaleEffect(compact ? 0.8 : 1, anchor: .top)
                        .frame(height: compact ? 190 : nil, alignment: .top)
                        .overlay(alignment: .topTrailing) {
                            if selection.contains(row.id) {
                                Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(Color.foleviInk).padding(6)
                                    .accessibilityLabel("Selected")
                            }
                        }
                        .simultaneousGesture(TapGesture().modifiers(.command).onEnded {
                            if selection.contains(row.id) { selection.remove(row.id) } else { selection.insert(row.id) }
                        })
                        .overlay {
                            // The keyboard's card (arrow keys move it, Return opens it).
                            if gridFocused, keyCard == row.id {
                                RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.foleviInk, lineWidth: 2).padding(-4)
                            }
                        }
                        .id(row.id)
                        .onAppear { if row.id == list.rows.last?.id { more() } }
                }
            }
            .padding(24)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { gridWidth = $0 }
        .focusable()
        .focused($gridFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .return, .space]) { press in
            gridKey(press.key, proxy: proxy)
        }
        .onKeyPress(characters: ["a"], phases: .down) { press in
            guard press.modifiers.contains(.command) else { return .ignored }
            selection = Set(shownRows.map(\.id))
            return .handled
        }
        .overlay(alignment: .bottom) {
            // (The animation lives on a view that stays, so the bar's leaving animates too.)
            GlassEffectContainer { ZStack { selectionBar } }.appAnimation(Motion.bar, value: selection.isEmpty)
        }
        .onKeyPress(.escape) { if selection.isEmpty { return .ignored }; selection.removeAll(); return .handled }
        }
    }

    /// Arrow keys move the keyboard's card across and down the grid; Return or Space opens it.
    private func gridKey(_ key: KeyEquivalent, proxy: ScrollViewProxy) -> KeyPress.Result {
        let rows = shownRows
        guard !rows.isEmpty else { return .ignored }
        let minWidth: CGFloat = compact ? 150 : AppCards.noteWidth - 16
        let gap: CGFloat = compact ? 14 : AppCards.gap
        let columns = max(1, Int((gridWidth - 48 + gap) / (minWidth + gap)))
        let at = keyCard.flatMap { id in rows.firstIndex { $0.id == id } }
        if key == .return || key == .space {
            guard let at else { return .ignored }
            window.go(.note(rows[at].id))
            return .handled
        }
        var next = at ?? -1
        switch key {
        case .leftArrow: next = max(0, next - 1)
        case .rightArrow: next = min(rows.count - 1, next + 1)
        case .upArrow: next = at == nil ? 0 : max(0, next - columns)
        case .downArrow: next = at == nil ? 0 : min(rows.count - 1, next + columns)
        default: return .ignored
        }
        keyCard = rows[next].id
        window.prepare(rows[next].id)
        Motion.run(Motion.scroll) { proxy.scrollTo(rows[next].id) }
        return .handled
    }

    private var compact: Bool { window.listStyle == .compact }

    // MARK: actions

    private func more() {
        guard let store = list.store, store.rows.count < store.total else { return }
        store.setVisibleRange(max(0, store.rows.count - 50)..<store.rows.count)
    }

    private func open(_ ids: Set<String>) {
        let notes = ids.filter { !$0.hasPrefix("folder:") }
        if let folder = ids.first(where: { $0.hasPrefix("folder:") }) { return window.go(.folder(String(folder.dropFirst(7)))) }
        if notes.count == 1, let id = notes.first { window.go(.note(id)) } else { openInTabs(Array(notes)) }
    }

    /// Manual order: the moved note goes after the row it lands under.
    private func reorder(_ from: IndexSet, _ to: Int) {
        let rows = list.rows
        guard let i = from.first, rows.indices.contains(i) else { return }
        let id = rows[i].id
        let after = to == 0 ? nil : rows[min(to, rows.count) - 1].id
        guard after != id else { return }
        app.perform { _ = try await $0.command(Commands.NoteReorder(NoteReorderArgs(id: id, afterId: after, view: kind, folderId: folderId))) }
    }

    private func openInTabs(_ ids: [String]) {
        for id in ids { app.open(.note(id), newTab: true, background: true) }
        app.toast(ids.count == 1 ? "Opened 1 new tab" : "Opened \(ids.count) new tabs")
    }

    private func move(_ id: String, after: String?) {
        app.perform { _ = try await $0.command(Commands.NoteReorder(NoteReorderArgs(id: id, afterId: after, view: kind, folderId: folderId))) }
    }

    private func loadPrefs() {
        let d = UserDefaults.standard
        sortRaw = d.string(forKey: "core.list.sort.\(kind.rawValue)") ?? NotesSort.updated.rawValue
        // Trash, Archive and the like have no manual order: a saved one becomes Date Edited.
        if sortRaw == NotesSort.manual.rawValue, !(kind == .folder || kind == .unsorted || kind == .templates) { sortRaw = NotesSort.updated.rawValue }
        if let raw = d.string(forKey: "core.list.style.\(kind.rawValue)"), let style = WindowModel.ListStyleChoice(rawValue: raw) {
            window.listStyle = style
        } else if kind == .trash || kind == .archive {
            window.listStyle = .list
        }
    }

    private var folderNode: FolderNode? { app.tree.value?.folders.first { $0.id == folderId } }

    /// The folder and the folders above it, nearest first, then All Folders.
    private var enclosing: [FolderNode] {
        let all = app.tree.value?.folders ?? []
        var out: [FolderNode] = []
        var f = folderNode
        while let x = f { out.append(x); f = all.first { $0.id == x.parentId } }
        return out
    }

    private func trashSelection() {
        let ids = selection.filter { !$0.hasPrefix("folder:") }
        guard !ids.isEmpty else { return }
        if kind == .trash { NoteActions.deleteForever(Array(ids), app: app) } else {
            app.trash(Array(ids))
        }
        selection.removeAll()
    }

    /// Adds a tag to several notes at once (graph.tag keeps each note's other tags).
    private func addTag(_ tag: String, to notes: [String]) {
        let rows = list.rows.filter { notes.contains($0.id) }
        let args = GraphTagArgs(notes: rows.map { GraphTagNote(id: $0.id, tagIds: $0.tags.map(\.id)) }, tagId: tag)
        app.perform { client in
            let r = try await client.command(Commands.GraphTag(args))
            app.toast(r.tagged == 1 ? "Tagged 1 note" : "Tagged \(r.tagged) notes")
        }
    }

    @ViewBuilder private func addTagMenu(_ notes: [String]) -> some View {
        if let tags = app.tree.value?.tags, !tags.isEmpty {
            Menu("Add Tag") { ForEach(tags, id: \.id) { t in Button("#" + t.name) { addTag(t.id, to: notes) } } }
        }
    }

    @ViewBuilder private func selectionMenu(_ ids: Set<String>) -> some View {
        let notes = Array(ids.filter { !$0.hasPrefix("folder:") })
        let folders = ids.filter { $0.hasPrefix("folder:") }.map { String($0.dropFirst(7)) }
        if !notes.isEmpty && !folders.isEmpty && kind != .trash {
            Button("Move \(notes.count + folders.count) Items To…") { window.pickFolder(.moveNotes, notes, folders: folders) }
            Button("Open \(notes.count + folders.count) in New Tabs") {
                for f in folders { app.open(.folder(f), newTab: true, background: true) }
                openInTabs(notes)
            }
        } else if notes.count > 1 {
            Button("Open \(notes.count) Notes in New Tabs") { openInTabs(notes) }
            Divider()
            if kind == .trash {
                Button("Restore \(notes.count) Notes") { app.perform { _ = try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: notes))) } }
                Button("Delete \(notes.count) Notes Immediately…", role: .destructive) { NoteActions.deleteForever(notes, app: app) }
            } else {
                Button("Star") { star(notes, true) }
                Button("Remove Star") { star(notes, false) }
                Menu("Move To") { MoveTargets(ids: notes) }
                Button("Move To Folder…") { window.pickFolder(.moveNotes, notes) }
                Button("Copy To…") { window.pickFolder(.copyNotes, notes) }
                addTagMenu(notes)
                Button(kind == .archive ? "Unarchive" : "Archive") { archive(notes, kind != .archive) }
                Button("Move \(notes.count) Notes to Trash", role: .destructive) { app.trash(notes) }
            }
        } else if let id = notes.first, let row = list.rows.first(where: { $0.id == id }) {
            NoteMenu(row: row, window: window)
        } else if ids.isEmpty {
            AnywhereMenu(window: window)
        }
    }

    @ViewBuilder private var toolbar: some View {
        Group {
            ListStylePicker(window: window)
            Menu {
                Picker("Sort By", selection: $sortRaw) {
                    Text("Date Edited").tag(NotesSort.updated.rawValue)
                    Text("Date Created").tag(NotesSort.created.rawValue)
                    Text("Title").tag(NotesSort.title.rawValue)
                    if kind == .folder || kind == .unsorted || kind == .templates { Text("Manual").tag(NotesSort.manual.rawValue) }
                }
                .pickerStyle(.inline)
            } label: {
                Label("Sort", appSymbol: "arrow.up.arrow.down")
            }
            .help("Sort")
            if kind == .trash {
                Button("Empty Trash…") { emptyTrash() }
                    .disabled((trash.value?.deletable ?? list.total) == 0)
            }
            if kind == .folder, let node = folderNode {
                Menu {
                    ForEach(enclosing, id: \.id) { f in
                        Button { window.go(.folder(f.id)) } label: {
                            if f.id == node.id { Label(f.name, appSymbol: "checkmark") } else { Text(f.name) }
                        }
                    }
                    Divider()
                    Button("All Folders") { window.go(.folders) }
                } label: { Label("Enclosing Folders", appSymbol: "folder.badge.gearshape") }
                .help("Enclosing Folders")
                Menu {
                    FolderMenu(folder: node, window: window, rename: { renamingFolder = $0 }, newSubfolder: { newSubfolderOf = $0 })
                } label: { Label("Folder Options", appSymbol: "ellipsis.circle") }
                .help("Folder Options")
            }
            if kind == .folder, app.session.value?.mode != .local {
                Button { window.sharingFolder = folderId } label: { Label("Share Folder", appSymbol: "person.crop.circle.badge.plus") }
                    .help("Share Folder")
            }
        }
    }

    private func emptyTrash() {
        let alert = NSAlert()
        alert.messageText = "Empty the Trash?"
        alert.informativeText = "Every note in the Trash is deleted for good. You can't undo this."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Empty Trash")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        AppAlerts.cancelIsDefault(alert)
        let run = { app.perform { _ = try await $0.command(Commands.TrashEmpty(SpaceArgs())) } }
        if let w = window.window { alert.beginSheetModal(for: w) { if $0 == .alertFirstButtonReturn { run() } } } else if alert.runModal() == .alertFirstButtonReturn { run() }
    }

    @ViewBuilder private var empty: some View {
        switch kind {
        case .trash: EmptyScreen(symbol: "trash", title: "Trash Is Empty", message: "Notes you delete stay here for 30 days.")
        case .archive: EmptyScreen(symbol: "archivebox", title: "Nothing Archived", message: "Archive notes you're done with to keep them out of the way.")
        case .starred: EmptyScreen(symbol: "star", title: "No Starred Notes", message: "Star a note to keep it close.")
        case .templates: EmptyScreen(symbol: "square.on.square", title: "No Templates", message: "Save a note as a template from its menu.")
        case .folder where filter.isEmpty:
            EmptyScreen(symbol: "folder", title: "This Folder Is Empty", message: "Start a note here, or move one in with Move To Folder.", actionTitle: "New Note") {
                NoteActions.newNote(app: app, window: window, folder: folderId)
            }
        case .unsorted where filter.isEmpty:
            EmptyScreen(symbol: "tray", title: "No Drafts", message: "Everything has a folder. Nicely done.")
        case .tag where filter.isEmpty:
            EmptyScreen(symbol: "number", title: "No Notes Have This Tag Yet", message: "Add tags to a note from its Info panel (⌥⌘I).")
        default:
            EmptyScreen(symbol: "square.and.pencil", title: filter.isEmpty ? "No Notes" : "No Results", message: filter.isEmpty ? "Notes you write show up here." : "No note here matches “\(filter)”.", actionTitle: filter.isEmpty ? "New Note" : nil) {
                NoteActions.newNote(app: app, window: window, folder: folderId)
            }
        }
    }
}

/// List or cards, per window (View > as List / as Cards, ⌘1 and ⌘2).
struct ListStylePicker: View {
    @Bindable var window: WindowModel

    var body: some View {
        SegmentedChoice(selection: $window.listStyle, options: [
            .init(value: .list, title: "List", symbol: "list.bullet"),
            .init(value: .cards, title: "Cards", symbol: "square.grid.2x2"),
            .init(value: .compact, title: "Compact Cards", symbol: "square.grid.3x3"),
        ])
    }
}

/// A note in a list: the title in Spectral, a line of its text in Instrument Sans, where it is and when.
struct NoteListRow: View {
    let row: NoteRow
    var showFolder = true

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NoteMark(icon: row.icon, size: 15).frame(width: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.title.nonEmpty ?? "Untitled")
                        .font(AppType.noteTitle(15))
                        .foregroundStyle(row.title.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                    if row.starred { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                    if row.encrypted { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                    if row.sync != .saved { Image(systemName: row.sync == .failed || row.sync == .conflict ? "exclamationmark.icloud" : "icloud.and.arrow.up").font(.caption2).foregroundStyle(.secondary) }
                }
                if !row.excerpt.isEmpty {
                    Text(row.excerpt).font(AppType.noteText(13)).foregroundStyle(.secondary).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Text(AppDates.short(row.inTrash ? (row.deletedAt ?? row.updatedAt) : row.updatedAt))
                    if showFolder, let f = row.folder {
                        Label { Text(f.name) } icon: { FolderMark(colorId: f.color, size: 10) }
                    }
                    ForEach(row.tags.prefix(3), id: \.id) { t in Text("#" + t.name).foregroundStyle(Color.folevi(t.color)) }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// A folder in a list (a folder page's subfolders).
struct FolderListRow: View {
    let folder: FolderCard

    var body: some View {
        HStack(spacing: 10) {
            FolderMark(colorId: folder.color, size: 18, kind: folder.childCount > 0 ? .stack : (folder.noteCount > 0 ? .notes : .empty))
            Text(folder.name).font(AppType.noteTitle(15))
            Spacer()
            Text(folder.noteCount == 1 ? "1 note" : "\(folder.noteCount) notes").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }
}

/// A note card that opens its note, with the note's menu and drag.
struct NoteCardButton: View {
    let row: NoteRow
    let window: WindowModel
    var inTrash = false
    /// On Home's Recent: the menu can take it off Recent.
    var fromRecent = false
    @State private var hovered = false

    var body: some View {
        Button { window.go(.note(row.id)) } label: {
            WebNoteCard(Cards.note(row, inTrash: inTrash), unsynced: row.sync != .saved, hovered: hovered)
        }
        .buttonStyle(CardPressStyle { window.prepare(row.id) })
        .onHover { hovered = $0 }
        .draggable(NoteDrag(id: row.id, title: row.title))
        .onMiddleClick { AppModel.shared.open(.note(row.id), newTab: true, background: true) }
        .contextMenu {
            NoteMenu(row: row, window: window)
            if fromRecent {
                Divider()
                Button("Remove from Recent") { AppModel.shared.perform { _ = try await $0.command(Commands.NoteHideFromRecent(NoteIdsArgs(ids: [row.id]))) } }
            }
        }
        .accessibilityLabel(row.title.nonEmpty ?? "Untitled")
    }
}

/// A card's press: it dips a little and springs back.
struct CardPressStyle: ButtonStyle {
    /// Runs on touch-down (a note card prepares its note).
    var onPress: (() -> Void)? = nil

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .pressFeedback(configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, down in if down { onPress?() } }
    }
}
