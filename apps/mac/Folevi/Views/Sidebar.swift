// The window's sidebar: a source list in the system's sidebar material (Liquid Glass on macOS 26), SF Pro,
// SF Symbols tinted by the person's accent color, and Folevi's folder glyph for folders. Two levels at most
// (folders nest by disclosure). The space and account menu sits at the top (nothing critical at the bottom).
import FoleviDesign
import CoreTransferable
import FoleviEngine
import SwiftUI
import UniformTypeIdentifiers

struct Sidebar: View {
    @Bindable var window: WindowModel
    private var app: AppModel { .shared }
    @State private var expanded: Set<String> = []
    @State private var renaming: FolderNode?
    @State private var renamingTag: TagRow?
    @State private var newFolderParent: String?? = nil
    @State private var foldersOpen = true
    @State private var tagsOpen = true
    /// Manual (the sidebar's own order) or by name, kept on this Mac.
    @AppStorage("sidebar.folderSort") private var folderSort = "manual"
    /// The folders left open, kept on this Mac.
    @AppStorage("sidebar.openFolders") private var openFolders = ""
    /// When each folder last changed (the Recent sort).
    @State private var cards = Live<Views.FoldersCards>()
    /// The first starred notes (under Starred) and the Drafts count.
    @State private var starred = LiveList<ListViews.NotesList>()
    @State private var drafts = LiveList<ListViews.NotesList>()
    @State private var starredOpen = false
    /// Foli DNA's saved views, under its row.
    @State private var graphViews = Live<Views.GraphViews>()
    @State private var graphOpen = false

    var body: some View {
        List(selection: Binding(get: { window.sidebarSelection }, set: { window.pickInSidebar($0) })) {
            Section {
                row(.home)
                row(.search(""), title: "Search")
                if app.session.value?.capabilities.ai != false { row(.foliAI(nil)) }
                row(.notifications, badge: app.unread)
                row(.inbox)
                row(.tasks(.today), badge: app.taskCounts.value?.today ?? 0)
                row(.calendar(nil))
            }

            Section("Notes") {
                row(.allNotes)
                row(.recent)
                if starred.rows.isEmpty {
                    row(.starred)
                } else {
                DisclosureGroup(isExpanded: $starredOpen) {
                    ForEach(starred.rows.prefix(5)) { n in
                        // A button, so the keyboard and VoiceOver reach it (a tap gesture is neither).
                        Button { app.open(.note(n.id), newTab: true) } label: {
                            Label { Text(n.title.nonEmpty ?? "Untitled").lineLimit(1) } icon: { NoteMark(icon: n.icon, size: 13).frame(width: 18) }
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Open in a new tab")
                        .accessibilityHint("Opens in a new tab")
                    }
                } label: {
                    row(.starred)
                }
                }
                row(.shared)
                row(.drafts, badge: drafts.total)
                if app.session.value?.capabilities.changes != false || app.session.value?.mode == .local {
                    row(.changes, badge: app.changes.value?.notes.count ?? 0)
                }
                row(.templates)
            }

            Section(isExpanded: $foldersOpen) {
                // Every folder's subfolders, grouped and sorted once for the whole tree (not once per row).
                let children = childrenByParent
                ForEach(rootFolders, id: \.id) { folder in
                    FolderRow(folder: folder, all: folders, children: children, expanded: $expanded, window: window, rename: { renaming = $0 }, newSubfolder: { newFolderParent = .some($0.id) })
                }
                .onMove(perform: folderSort != "manual" ? nil : { from, to in
                    // The sidebar's own order of top-level folders (folder.setSidebarOrder).
                    var ids = rootFolders.map(\.id)
                    ids.move(fromOffsets: from, toOffset: to)
                    app.perform { _ = try await $0.command(Commands.FolderSetSidebarOrder(FolderSidebarOrderArgs(ids: ids))) }
                })
                if folders.isEmpty, app.tree.value != nil {
                    Text("No folders yet").foregroundStyle(.secondary).font(.callout)
                }
            } header: {
                SectionHeaderWithAdd(title: "Folders", help: "New Folder (⇧⌘N)", open: { window.pickInSidebar(.folders) }) {
                    newFolderParent = .some(nil)
                } menu: {
                    Picker("Sort Folders", selection: $folderSort) {
                        Text("Manually").tag("manual")
                        Text("By Name").tag("name")
                        Text("Recently Changed").tag("recent")
                    }
                    .pickerStyle(.inline)
                }
                    .dropDestination(for: FolderDrag.self) { items, _ in
                        for f in items { app.perform { _ = try await $0.command(Commands.FolderMove(FolderMoveArgs(id: f.id, parentId: nil))) } }
                        return true
                    }
            }

            Section(isExpanded: $tagsOpen) {
                let tags = app.tree.value?.tags ?? []
                ForEach(tags.prefix(5), id: \.id) { tag in
                    Label {
                        Text(tag.name)
                    } icon: {
                        WebIcon.hash.image(size: 16).foregroundStyle(Color.folevi(tag.color))
                    }
                    .tag(Destination.tag(tag.id))
                    .contextMenu {
                        Button("Open in New Tab") { app.open(.tag(tag.id), newTab: true) }
                        Button("Edit Tag…") { renamingTag = tag }
                        Menu("Color") {
                            Picker("Color", selection: Binding(get: { tag.color }, set: { c in
                                app.perform { _ = try await $0.command(Commands.TagUpdate(TagUpdateArgs(id: tag.id, color: c))) }
                            })) {
                                ForEach(TagColors.all, id: \.id) { c in Text(c.name).tag(c.id) }
                            }
                            .pickerStyle(.inline)
                            .labelsHidden()
                        }
                        Divider()
                        Button("Delete Tag…", role: .destructive) { TagActions.delete(id: tag.id, name: tag.name, window: window) }
                    }
                }
                if tags.count > 5 {
                    Label { Text("\(tags.count - 5) More") } icon: { WebIcon.ellipsis.image(size: 16) }
                        .foregroundStyle(.secondary)
                        .tag(Destination.tags)
                }
                if tags.isEmpty, app.tree.value != nil {
                    Text("Type # in a note to tag it.").foregroundStyle(.secondary).font(.callout)
                }
            } header: {
                SectionHeaderWithAdd(title: "Tags", help: nil, open: { window.pickInSidebar(.tags) })
            }

            Section("More") {
                if app.session.value?.mode != .local, app.vault.value?.state != VaultState.none { row(.vault) }
                if app.reviews.value?.hasCards == true || window.current == .reviews {
                    row(.reviews, badge: (app.reviews.value?.due ?? 0) + (app.reviews.value?.new ?? 0))
                }
                if app.session.value?.capabilities.graph != false {
                    if graphViews.value?.views.isEmpty ?? true {
                        row(.graph)
                    } else {
                        DisclosureGroup(isExpanded: $graphOpen) {
                            ForEach(graphViews.value?.views ?? [], id: \.id) { v in
                                Button { window.graphQuery = "view=\(v.id)"; window.pickInSidebar(.graph) } label: {
                                    Label { Text(v.name).lineLimit(1) } icon: { WebIcon.bookmark.image(size: 13).frame(width: 18) }
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        } label: { row(.graph) }
                    }
                }
                row(.archive)
                row(.trash)
            }
        }
        .listStyle(.sidebar)
        // (More breathing room than the system's rows: the rows' own padding, about 32 pt as the owner's polish pass.)
        .safeAreaInset(edge: .top, spacing: 0) {
            PlaceMenu()
                .padding(.horizontal, 10)
                .padding(.top, 4)
                .padding(.bottom, 6)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SyncFooter()
        }
        .onAppear {
            expanded = Set(openFolders.split(separator: ",").map(String.init))
            revealCurrent()
        }
        .onChange(of: expanded) { openFolders = expanded.sorted().joined(separator: ",") }
        .task(id: app.client.map(ObjectIdentifier.init)) {
            starred.bind(app.client, ListViews.NotesList(NotesListArgs(space: nil, view: .starred, folderId: nil, tagId: nil, sort: .updated, filter: nil)))
            drafts.bind(app.client, ListViews.NotesList(NotesListArgs(space: nil, view: .unsorted, folderId: nil, tagId: nil, sort: .updated, filter: nil)))
            graphViews.bind(app.client, Views.GraphViews(SpaceArgs()))
        }
        .task(id: "\(folderSort)\(app.client.map { ObjectIdentifier($0).hashValue } ?? 0)") {
            if folderSort == "recent" { cards.bind(app.client, Views.FoldersCards(FolderCardsArgs(space: nil, parentId: nil, all: true))) }
        }
        .onChange(of: window.current) { revealCurrent() }
        .onChange(of: window.newFolderRequested) {
            guard window.newFolderRequested else { return }
            window.newFolderRequested = false
            // On a folder's page the new folder goes inside it.
            if case .folder(let id) = window.current { newFolderParent = .some(id) } else { newFolderParent = .some(nil) }
        }
        .sheet(item: $renamingTag) { tag in TagEditSheet(id: tag.id, initialName: tag.name, initialColor: tag.color) }
        .sheet(item: $renaming) { folder in
            NameSheet(title: "Rename Folder", initial: folder.name, action: "Rename") { name in
                app.perform { _ = try await $0.command(Commands.FolderRename(FolderRenameArgs(id: folder.id, name: name))) }
            }
        }
        .sheet(isPresented: Binding(get: { newFolderParent != nil }, set: { if !$0 { newFolderParent = nil } })) {
            NameSheet(title: "New Folder", initial: "", action: "Create") { name in
                let parent = newFolderParent ?? nil
                app.perform { _ = try await $0.command(Commands.FolderCreate(FolderCreateArgs(space: nil, name: name, parentId: parent, color: nil))) }
            }
        }
    }

    private var folders: [FolderNode] { app.tree.value?.folders ?? [] }

    /// Each folder's subfolders in the sidebar's order (by name, or by rank).
    private var childrenByParent: [String: [FolderNode]] {
        let byName = folderSort == "name"
        return Dictionary(grouping: folders.filter { $0.parentId != nil }, by: { $0.parentId! }).mapValues { c in
            byName ? c.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } : c.sorted { $0.rank < $1.rank }
        }
    }

    /// Opens the folders above the one on screen, so it shows in the sidebar.
    private func revealCurrent() {
        guard case .folder(let id) = window.current else { return }
        let byId = Dictionary(folders.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var p = byId[id]?.parentId
        while let parent = p, let f = byId[parent] {
            expanded.insert(parent)
            p = f.parentId
        }
    }

    private var rootFolders: [FolderNode] {
        let all = folders
        let order = app.tree.value?.sidebarOrder ?? []
        let ids = Set(all.map(\.id))
        // A subfolder whose parent isn't here (moved, or not synced yet) shows at the top level.
        let roots = all.filter { $0.parentId == nil || !ids.contains($0.parentId!) }
        if folderSort == "name" { return roots.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
        if folderSort == "recent" {
            let at = Dictionary((cards.value?.folders ?? []).map { ($0.id, $0.updatedAt) }, uniquingKeysWith: { a, _ in a })
            return roots.sorted { (at[$0.id] ?? 0) > (at[$1.id] ?? 0) }
        }
        guard !order.isEmpty else { return roots.sorted { $0.rank < $1.rank } }
        let at = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
        return roots.sorted { (at[$0.id] ?? Int.max, $0.rank) < (at[$1.id] ?? Int.max, $1.rank) }
    }

    private func row(_ dest: Destination, title: String? = nil, badge: Int = 0) -> some View {
        Label {
            Text(title ?? dest.title)
        } icon: {
            PlaceIcon(dest: dest, size: 14).frame(width: 18)
        }
        .padding(.vertical, 2.5)
        .badge(badge)
        .tag(dest)
        .onMiddleClick { app.open(dest, newTab: true, background: true) }
    }
}

/// A place's icon: the main app's icon in the sidebar's tint; Foli AI keeps its colored mark.
struct PlaceIcon: View {
    let dest: Destination
    var size: CGFloat = 16

    var body: some View {
        if case .foliAI = dest {
            AiMarkGlyph(size: size)
        } else {
            dest.webIcon.image(size: size)
        }
    }
}

/// A folder in the sidebar, with its subfolders by disclosure and a drop target for notes.
struct FolderRow: View {
    let folder: FolderNode
    let all: [FolderNode]
    /// Every folder's subfolders, sorted (the sidebar builds it once per pass).
    let children: [String: [FolderNode]]
    @Binding var expanded: Set<String>
    let window: WindowModel
    let rename: (FolderNode) -> Void
    let newSubfolder: (FolderNode) -> Void
    private var app: AppModel { .shared }
    @State private var zone: FolderDropZone?
    @State private var rowHeight: CGFloat = 24

    /// A folder dropped on this row: before it, inside it, or after it among its siblings.
    private func place(_ moving: String, _ z: FolderDropZone) {
        guard moving != folder.id else { return }
        if z == .inside { _ = FolderActions.move(moving, into: folder.id); return }
        let parent = folder.parentId
        if let parent, let why = FolderActions.refusal(moving: moving, into: parent) { app.toast(why, tone: .error); return }
        let siblings = all.filter { $0.parentId == parent && $0.id != moving }.sorted { $0.rank < $1.rank }
        let after: String? = {
            if z == .after { return folder.id }
            guard let i = siblings.firstIndex(where: { $0.id == folder.id }) else { return nil }
            return i > 0 ? siblings[i - 1].id : nil
        }()
        app.perform { _ = try await $0.command(Commands.FolderMove(FolderMoveArgs(id: moving, parentId: parent, afterId: after))) }
    }

    var body: some View {
        let mine = children[folder.id] ?? []
        if mine.isEmpty {
            label
        } else {
            DisclosureGroup(isExpanded: Binding(get: { expanded.contains(folder.id) }, set: { if $0 { expanded.insert(folder.id) } else { expanded.remove(folder.id) } })) {
                ForEach(mine, id: \.id) { child in
                    FolderRow(folder: child, all: all, children: children, expanded: $expanded, window: window, rename: rename, newSubfolder: newSubfolder)
                }
            } label: {
                label
            }
        }
    }

    private var label: some View {
        Label {
            HStack {
                Text(folder.name)
                if folder.locked { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary) }
            }
        } icon: {
            FolderMark(colorId: folder.color, size: 14, kind: folder.childCount > 0 ? .stack : ((folder.noteCount ?? 0) > 0 ? .notes : .empty))
        }
        .padding(.vertical, 2.5)
        .badge(folder.noteCount ?? 0)
        .tag(Destination.folder(folder.id))
        .onMiddleClick { app.open(.folder(folder.id), newTab: true, background: true) }
        .draggable(FolderDrag.begin(id: folder.id, name: folder.name))
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowHeight = $0 }
        .onDrop(of: [FolderDrag.type, NoteDrag.type], delegate: FolderCardDrop(width: rowHeight, zones: true, vertical: true, zone: $zone) { z, providers in
            for p in providers {
                if p.hasItemConformingToTypeIdentifier(FolderDrag.type.identifier) {
                    _ = p.loadTransferable(type: FolderDrag.self) { r in
                        guard case .success(let f) = r else { return }
                        Task { @MainActor in place(f.id, z) }
                    }
                } else {
                    _ = p.loadTransferable(type: NoteDrag.self) { r in
                        guard case .success(let n) = r else { return }
                        Task { @MainActor in app.perform { _ = try await $0.command(Commands.NoteMove(NoteMoveArgs(ids: [n.id], folderId: folder.id))) } }
                    }
                }
            }
        })
        .overlay(alignment: .top) { if zone == .before { Capsule().fill(Color.foleviInk).frame(height: 2).offset(y: -2) } }
        .overlay(alignment: .bottom) { if zone == .after { Capsule().fill(Color.foleviInk).frame(height: 2).offset(y: 2) } }
        .background { if zone == .inside { RoundedRectangle(cornerRadius: 6).strokeBorder(Color.foleviInk, lineWidth: 1.5) } }
        .contextMenu { FolderMenu(folder: folder, window: window, rename: rename, newSubfolder: newSubfolder) }
    }
}

/// A section title with a + at its end (Folders).
struct SectionHeaderWithAdd<M: View>: View {
    var title: String
    var help: String?
    /// The heading opens its page (Folders, Tags).
    var open: (() -> Void)?
    var add: (() -> Void)?
    @ViewBuilder var menu: () -> M

    var body: some View {
        HStack {
            if let open {
                Button(title, action: open).buttonStyle(.hoverPlain).help("Show All \(title)")
            } else {
                Text(title)
            }
            Spacer()
            if M.self != EmptyView.self {
                Menu { menu() } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("\(title) Options")
            }
            if let add, let help {
                Button(action: add) { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help(help)
                    .accessibilityLabel(help)
            }
        }
    }
}

extension SectionHeaderWithAdd where M == EmptyView {
    init(title: String, help: String?, open: (() -> Void)? = nil, add: (() -> Void)? = nil) {
        self.init(title: title, help: help, open: open, add: add, menu: { EmptyView() })
    }
}

/// The sync state at the foot of the sidebar: quiet when saved, a word when not.
struct SyncFooter: View {
    private var app: AppModel { .shared }
    @State private var details = false

    var body: some View {
        if let s = app.sync.value, s.state != .saved || s.pending > 0 {
            Button { details.toggle() } label: { footer(s) }
                .buttonStyle(.plain)
                .popover(isPresented: $details, arrowEdge: .top) { SyncDetails(status: s) }
                .help("Sync details")
        }
    }

    private func footer(_ s: SyncStatusValue) -> some View {
            HStack(spacing: 6) {
                switch s.state {
                case .saving, .syncing: ProgressView().controlSize(.mini)
                case .offline: Image(systemName: "icloud.slash")
                case .conflict, .error: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                case .saved: Image(systemName: "checkmark.icloud")
                }
                Text(s.label.isEmpty ? s.state.rawValue.capitalized : s.label).lineLimit(1)
                Spacer()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
    }
}

/// What sync is doing: the headline, what's waiting, download progress per space, conflicts, and Retry.
struct SyncDetails: View {
    let status: SyncStatusValue
    private var app: AppModel { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(status.label.nonEmpty ?? status.state.rawValue.capitalized).font(.headline)
            if !status.online { Label("You're offline. Changes are kept on this Mac and sync when you're back.", appSymbol: "wifi.slash").font(.callout) }
            if status.pending > 0 { Text(status.pending == 1 ? "1 change waiting to sync" : "\(status.pending) changes waiting to sync").foregroundStyle(.secondary) }
            if status.conflicts > 0 { Label("\(status.conflicts) notes changed in two places", appSymbol: "exclamationmark.triangle").foregroundStyle(.orange) }
            ForEach(status.spaces, id: \.space) { sp in
                if let total = sp.total, total > 0 {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(AppModel.shared.session.value?.spaces.first { $0.id == sp.space }?.name ?? "Downloading").font(.caption)
                        ProgressView(value: Double(sp.have), total: Double(total))
                    }
                }
            }
            if status.authRequired { Button("Sign In Again…") { AccountActions.addAccount() } }
            HStack {
                Spacer()
                Button("Sync Now") { app.perform { _ = try await $0.command(Commands.EngineRefresh()) } }.buttonStyle(InkPillStyle())
            }
        }
        .padding(16)
        .frame(width: 300)
    }
}

/// A folder dragged in the sidebar (onto another folder to nest it, onto Folders to bring it to the top level).
struct FolderDrag: Codable, Transferable {
    var id: String
    var name: String

    static let type = UTType(exportedAs: "com.folevi.folder-drag")

    /// The folder being dragged now, set as its drag starts (the payload is made then), so the Folders page can
    /// open a gap for it while it's on the way, before the drop hands over the payload.
    nonisolated(unsafe) static var current: String?

    /// The payload for a folder's drag, noting it as the one being dragged.
    static func begin(id: String, name: String) -> FolderDrag {
        current = id
        return FolderDrag(id: id, name: name)
    }

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: type)
    }
}

/// What the sidebar's folders take: notes and folders.
enum SidebarDrop: Transferable {
    case note(NoteDrag)
    case folder(FolderDrag)

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation { (n: NoteDrag) in SidebarDrop.note(n) }
        ProxyRepresentation { (f: FolderDrag) in SidebarDrop.folder(f) }
    }
}

extension TagRow: Identifiable {}
