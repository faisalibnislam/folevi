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
    /// The sort, kept per list (core.list.sort.<list>).
    @State private var sortRaw = NotesSort.updated.rawValue
    @State private var renamingFolder: FolderNode?
    @State private var newSubfolderOf: FolderNode?
    @State private var filter = ""
    @State private var subfolders = Live<Views.FoldersCards>()
    @State private var trash = Live<Views.TrashSummary>()

    private var sort: NotesSort { NotesSort(rawValue: sortRaw) ?? .updated }

    private var spec: ListViews.NotesList {
        ListViews.NotesList(NotesListArgs(space: nil, view: kind, folderId: folderId, tagId: tagId, sort: sort, filter: filter.isEmpty ? nil : filter))
    }

    var body: some View {
        content
            .searchable(text: $filter, placement: .toolbar, prompt: "Filter \(title)")
            .toolbar { toolbar }
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
            .navigationSubtitle(subtitle)
            .sheet(isPresented: Binding(get: { window.sharingFolder != nil && window.sharingFolder == folderId }, set: { if !$0 { window.sharingFolder = nil } })) {
                if let folderId { FolderSharingSheet(folderId: folderId) }
            }
    }

    @ViewBuilder private var content: some View {
        if list.isLoading && list.rows.isEmpty {
            if window.listStyle == .cards { SkeletonGrid() } else { SkeletonRows() }
        } else if list.rows.isEmpty && (subfolders.value?.folders ?? []).isEmpty {
            empty
        } else if window.listStyle == .cards {
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
                    }
                }
            }
            Section {
                ForEach(Array(list.rows.enumerated()), id: \.element.id) { i, row in
                    NoteListRow(row: row, showFolder: kind != .folder)
                        .overlay(alignment: .trailing) {
                            if kind == .templates {
                                Button("Use") { NoteActions.newNote(app: app, window: window, template: row.id) }
                                    .controlSize(.small).help("New note from this template")
                            }
                        }
                        .tag(row.id)
                        .draggable(NoteDrag(id: row.id, title: row.title))
                        .contextMenu {
                            NoteMenu(row: row, window: window,
                                     moveUp: sort == .manual && i > 0 ? { move(row.id, after: i >= 2 ? list.rows[i - 2].id : nil) } : nil,
                                     moveDown: sort == .manual && i < list.rows.count - 1 ? { move(row.id, after: list.rows[i + 1].id) } : nil)
                        }
                        .onAppear { if row.id == list.rows.last?.id { more() } }
                }
                .onMove(perform: sort == .manual ? reorder : nil)
            } header: {
                if kind == .folder, !(subfolders.value?.folders ?? []).isEmpty { Text("Notes") }
            }
        }
        .listStyle(.inset)
        .alternatingRowBackgrounds(.disabled)
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
        .overlay(alignment: .bottom) { selectionBar }
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
                    Button("Restore") { app.perform { _ = try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: notes))) }; selection.removeAll() }
                    Button("Delete…", role: .destructive) { NoteActions.deleteForever(notes, app: app); selection.removeAll() }
                } else {
                    let allStarred = notes.allSatisfy { id in list.rows.first { $0.id == id }?.starred == true }
                    Button { app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: notes, starred: !allStarred))) } } label: { Label(allStarred ? "Unstar" : "Star", systemImage: allStarred ? "bookmark.slash" : "bookmark") }
                    Button { window.pickFolder(.moveNotes, notes) } label: { Label("Move", systemImage: "folder") }
                    Button { window.pickFolder(.copyNotes, notes) } label: { Label("Copy To", systemImage: "doc.on.doc") }
                    Button {
                        app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: notes, archived: kind != .archive))) }
                        selection.removeAll()
                    } label: { Label(kind == .archive ? "Unarchive" : "Archive", systemImage: "archivebox") }
                    Button(role: .destructive) { trashSelection() } label: { Label("Trash", systemImage: "trash") }
                }
                Button { selection.removeAll() } label: { Image(systemName: "xmark") }.help("Clear Selection (Esc)").keyboardShortcut(.cancelAction)
            }
            .labelStyle(.titleAndIcon)
            .buttonStyle(.borderless)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .glassEffect(.regular, in: .capsule)
            .padding(.bottom, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // MARK: cards

    private var cards: some View {
        ScrollView {
            if kind == .folder, let folders = subfolders.value?.folders, !folders.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180, maximum: 240), spacing: 20)], spacing: 20) {
                    ForEach(folders, id: \.id) { f in
                        Button { window.go(.folder(f.id)) } label: { WebFolderCard(Cards.folder(f)) }
                            .buttonStyle(CardPressStyle())
                    }
                }
                .padding([.horizontal, .top], 24)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190, maximum: 250), spacing: 20)], spacing: 22) {
                ForEach(list.rows) { row in
                    NoteCardButton(row: row, window: window, inTrash: kind == .trash)
                        .onAppear { if row.id == list.rows.last?.id { more() } }
                }
            }
            .padding(24)
        }
    }

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

    @ViewBuilder private func selectionMenu(_ ids: Set<String>) -> some View {
        let notes = Array(ids.filter { !$0.hasPrefix("folder:") })
        if notes.count > 1 {
            Button("Open \(notes.count) Notes in New Tabs") { openInTabs(notes) }
            Divider()
            if kind == .trash {
                Button("Restore \(notes.count) Notes") { app.perform { _ = try await $0.command(Commands.NoteRestore(NoteIdsArgs(ids: notes))) } }
                Button("Delete \(notes.count) Notes Immediately…", role: .destructive) { NoteActions.deleteForever(notes, app: app) }
            } else {
                Button("Star") { app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: notes, starred: true))) } }
                Button("Remove Star") { app.perform { _ = try await $0.command(Commands.NoteStar(NoteStarArgs(ids: notes, starred: false))) } }
                Menu("Move To") { MoveTargets(ids: notes) }
                Button("Move To Folder…") { window.pickFolder(.moveNotes, notes) }
                Button("Copy To…") { window.pickFolder(.copyNotes, notes) }
                Button(kind == .archive ? "Unarchive" : "Archive") {
                    app.perform { _ = try await $0.command(Commands.NoteArchive(NoteArchiveArgs(ids: notes, archived: kind != .archive))) }
                }
                Button("Move \(notes.count) Notes to Trash", role: .destructive) { app.trash(notes) }
            }
        } else if let id = notes.first, let row = list.rows.first(where: { $0.id == id }) {
            NoteMenu(row: row, window: window)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .secondaryAction) {
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
                Label("Sort", systemImage: "arrow.up.arrow.down")
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
                            if f.id == node.id { Label(f.name, systemImage: "checkmark") } else { Text(f.name) }
                        }
                    }
                    Divider()
                    Button("All Folders") { window.go(.folders) }
                } label: { Label("Enclosing Folders", systemImage: "folder.badge.gearshape") }
                .help("Enclosing Folders")
                Menu {
                    FolderMenu(folder: node, window: window, rename: { renamingFolder = $0 }, newSubfolder: { newSubfolderOf = $0 })
                } label: { Label("Folder Options", systemImage: "ellipsis.circle") }
                .help("Folder Options")
            }
            if kind == .folder, app.session.value?.mode != .local {
                Button { window.sharingFolder = folderId } label: { Label("Share Folder", systemImage: "person.crop.circle.badge.plus") }
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
        CoreAlerts.cancelIsDefault(alert)
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
        Picker("View", selection: $window.listStyle) {
            Label("List", systemImage: "list.bullet").tag(WindowModel.ListStyleChoice.list)
            Label("Cards", systemImage: "square.grid.2x2").tag(WindowModel.ListStyleChoice.cards)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .help("View as List or Cards")
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
                        .font(CoreType.noteTitle(15))
                        .foregroundStyle(row.title.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                    if row.starred { Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow) }
                    if row.encrypted { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
                    if row.sync != .saved { Image(systemName: row.sync == .failed || row.sync == .conflict ? "exclamationmark.icloud" : "icloud.and.arrow.up").font(.caption2).foregroundStyle(.secondary) }
                }
                if !row.excerpt.isEmpty {
                    Text(row.excerpt).font(CoreType.noteText(13)).foregroundStyle(.secondary).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Text(CoreDates.short(row.inTrash ? (row.deletedAt ?? row.updatedAt) : row.updatedAt))
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
            Text(folder.name).font(CoreType.noteTitle(15))
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
        .buttonStyle(CardPressStyle())
        .onHover { hovered = $0 }
        .draggable(NoteDrag(id: row.id, title: row.title))
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
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.25, bounce: 0.3), value: configuration.isPressed)
    }
}
