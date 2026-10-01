import SwiftUI

/// Drag payload for documents (browser cards → sidebar folders).
struct DocumentDragPayload: Codable, Transferable {
    var documentId: String
    /// A whole selection being dragged (it includes `documentId`); nil for one note.
    var documentIds: [String]? = nil
    var ids: [String] { documentIds ?? [documentId] }
    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .foleviDocument)
    }
}

/// The sidebar, as on the web (Sidebar.tsx): the top row (the Folevi logo, sync status, notifications and the
/// sidebar menu), a search well with ⌘K, Home / Starred (with its first pages) / Drafts / All notes / Tasks /
/// Shared with Me / Templates, Folders and Tags (collapsible and remembered; the first few listed, the rest a
/// click away), Archive and Trash, and at the bottom the plan pill and the workspace menu. On a note it shows
/// the note's tools instead, unless the sidebar menu says to show the folders.
struct SidebarView: View {
    @Bindable var nav: NavigationModel
    /// The open note: the sidebar then shows its tools (NoteSidebarContent) instead of navigation, as on the web.
    var editor: EditorModel? = nil
    /// Opens a note (starred pages, sync details).
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    /// Sidebar width, remembered on this Mac (the web: 248 to 320, 272 by default).
    @AppStorage("sidebar.width") private var width: Double = 272

    static let minWidth: CGFloat = 248
    static let maxWidth: CGFloat = 320

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The title bar band: the traffic lights sit here; the empty space moves the window.
            Color.clear
                .frame(height: FoleviLayout.toolbarHeight)
                .titlebarDragArea()
            SidebarTopBar(nav: nav, editor: editor, openDocument: openDocument)
            if let editor, nav.docSidebarMode == .document {
                NoteSidebarContent(model: editor, nav: nav)
                    .frame(maxHeight: .infinity, alignment: .top)
            } else {
                SidebarNavigation(nav: nav, openDocument: openDocument)
            }
        }
        .frame(width: CGFloat(width))
        .padding(.leading, 8)
        .padding(.bottom, 8)
        .overlay(alignment: .trailing) { resizeHandle }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Folio"))
    }

    /// The web's resize separator: a 4pt strip just outside the sidebar's edge; drag (or ←/→) to resize.
    private var resizeHandle: some View {
        SidebarResizeHandle(width: Binding(get: { CGFloat(width) }, set: { width = Double($0) }),
                            range: Self.minWidth...Self.maxWidth)
            .padding(.vertical, 12)
            .offset(x: 6)
    }
}

/// The top of either sidebar (the web's SidebarTopBar): the Folevi logo (goes Home), save state,
/// notifications and the sidebar menu. The same row in both, so it never jumps when you switch.
struct SidebarTopBar: View {
    @Bindable var nav: NavigationModel
    var editor: EditorModel?
    var openDocument: (String) -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button {
                nav.show(.all)
            } label: {
                HStack {
                    FoleviLogo(height: 26).foregroundStyle(FoleviColor.heading)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 4)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.chrome)
            .help(Text("Go to Home"))
            .accessibilityLabel(Text("Folevi"))
            .accessibilityIdentifier("sidebar.logo")
            SyncStatusButton(documentId: nav.openDocumentId, openDocument: openDocument)
            NotificationsBell(nav: nav, editor: editor)
            SidebarMenu(nav: nav)
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
    }
}

/// The app's navigation: search, the fixed views, Folders, Tags, Archive and Trash, then the workspace menu.
private struct SidebarNavigation: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String) -> Void
    @Environment(AppModel.self) private var app
    @State private var newFolder = false
    @State private var dropTarget: String?
    @State private var todayTasks = 0
    @State private var starredOrder: [String] = []
    @State private var hoveredFolder: String?
    @State private var hoveredTag: String?
    /// Folders the person collapsed (open by default, as on the web; not remembered).
    @State private var closedFolders: Set<String> = []
    // Remembered on this Mac; Tags starts collapsed, as on the web.
    @AppStorage("sidebar.section.folders") private var foldersOpen = true
    @AppStorage("sidebar.section.tags") private var tagsOpen = false
    @AppStorage("sidebar.starred.open") private var starredOpen = true
    @FocusState private var listFocused: Bool
    private var notes: NoteActions { .shared }

    /// Sidebar lists show a few items; the rest are one click away on the section's own page.
    private static let limit = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            searchWell
                .padding(.horizontal, 10)
                .padding(.top, 4)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    fixedItems.padding(.top, 12)
                    foldersSection
                    tagsSection
                    VStack(alignment: .leading, spacing: 2) {
                        row(.archive)
                        row(.trash)
                    }
                    .padding(.top, 20)
                }
                .padding(.horizontal, 10)
                .padding(.bottom, 16)
            }
            .scrollIndicators(.never)
            .focusable()
            .focused($listFocused)
            .focusEffectDisabled()
            .onKeyPress(.upArrow) { step(-1) }
            .onKeyPress(.downArrow) { step(1) }

            WorkspaceFooter()
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
        }
        .task(id: app.documentsRevision) { await refreshTaskCount() }
        // Every folder and tag, fresh from the server when the sidebar shows and whenever the connection returns.
        .task(id: SidebarRefreshKey(scope: app.scope.key, online: app.sync.isOnline)) { await app.refreshSidebar() }
        .onChange(of: app.blockRevision) { _, _ in Task { await refreshTaskCount() } }
        .task(id: StarredKey(scope: app.scope.key, revision: notes.revision, online: app.sync.isOnline)) { await loadStarred() }
        .sheet(isPresented: $newFolder) {
            FoleviPromptDialog(title: String(localized: "New folder"), label: String(localized: "Folder name"),
                               confirmTitle: String(localized: "Create folder")) { name in
                let scope = app.scope
                OrganizationActions.run(app) { try await $0.createFolder(scope: scope, name: name) }
            }
        }
    }

    // MARK: Search

    private var searchWell: some View {
        Button {
            app.showCommandPalette = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 12.5, weight: .medium)).accessibilityHidden(true)
                Text("Search or jump to…").font(.ui(13)).frame(maxWidth: .infinity, alignment: .leading)
                Keycap(text: "⌘K")
            }
            .foregroundStyle(FoleviColor.inkMuted)
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .frame(height: 36)
            .foleviGlassWell()
            .contentShape(Rectangle())
        }
        .buttonStyle(HoverTint())
        .accessibilityLabel(Text("Search or jump to…"))
        .accessibilityIdentifier("toolbar.search")
    }

    // MARK: Fixed items

    private var fixedItems: some View {
        VStack(alignment: .leading, spacing: 2) {
            row(.all)
            ZStack(alignment: .trailing) {
                row(.starred)
                if !starredDocs.isEmpty {
                    Button {
                        withAnimation(.easeOut(duration: FoleviMotion.fast)) { starredOpen.toggle() }
                    } label: {
                        Image(systemName: starredOpen ? "chevron.down" : "chevron.right")
                            .font(.system(size: 9.5, weight: .semibold))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(SidebarGlyphButtonStyle())
                    .padding(.trailing, 4)
                    .accessibilityLabel(Text(starredOpen ? "Collapse Starred" : "Expand Starred"))
                }
            }
            if starredOpen, !starredDocs.isEmpty {
                let shown = starredDocs.enumerated().filter { $0.offset < Self.limit || $0.element.id == nav.openDocumentId }.map(\.element)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(shown) { d in
                        SidebarRow(title: Text(d.displayTitle), isActive: nav.openDocumentId == d.id) {
                            Image(systemName: "doc.text").font(.system(size: 12.5, weight: .medium))
                        } action: {
                            openDocument(d.id)
                        }
                    }
                    moreLink(count: starredDocs.count - shown.count, target: .starred, noun: String(localized: "starred pages"))
                }
                .padding(.leading, 20)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Starred pages"))
            }
            row(.drafts, count: draftCount, dropFolderId: "")
            row(.notes)
            row(.tasks, count: todayTasks)
            row(.shared)
            row(.templates)
        }
    }

    // MARK: Folders

    private var foldersSection: some View {
        let folders = app.sidebar.folders
        let roots = folders.filter { $0.parentFolderId == nil }
        // Only the first few root folders (plus the one you're in) are listed; "+N more" opens them all.
        let activeRootId: String? = {
            guard case .folder(let id) = nav.selection, let f = folders.first(where: { $0.id == id }) else { return nil }
            return f.parentFolderId ?? f.id
        }()
        let shownRoots = roots.enumerated().filter { $0.offset < Self.limit || $0.element.id == activeRootId }.map(\.element)
        let shownCount = shownRoots.reduce(0) { n, r in n + 1 + folders.filter { $0.parentFolderId == r.id }.count }
        return SidebarSection(title: String(localized: "Folders"), target: .folders, nav: nav, isOpen: $foldersOpen) {
            IconButton(systemImage: "folder.badge.plus", label: "New folder", size: 28) { newFolder = true }
                .disabled(!app.canEditHere)
        } content: {
            if roots.isEmpty {
                Text("No folders yet").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                    .padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(shownRoots) { f in
                let children = folders.filter { $0.parentFolderId == f.id }
                let open = !closedFolders.contains(f.id)
                HStack(spacing: 0) {
                    if !children.isEmpty {
                        Button {
                            if open { closedFolders.insert(f.id) } else { closedFolders.remove(f.id) }
                        } label: {
                            Image(systemName: open ? "chevron.down" : "chevron.right")
                                .font(.system(size: 9.5, weight: .semibold))
                                .foregroundStyle(FoleviColor.inkFaint)
                                .frame(width: 20, height: 32)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(open ? "Collapse \(f.name)" : "Expand \(f.name)"))
                    } else {
                        Color.clear.frame(width: 20, height: 1)
                    }
                    folderRow(f)
                }
                if open {
                    ForEach(children) { c in
                        folderRow(c).padding(.leading, 28)
                    }
                }
            }
            moreLink(count: folders.count - shownCount, target: .folders, noun: String(localized: "folders"))
        }
    }

    private func folderRow(_ f: FolderInfo) -> some View {
        HStack(spacing: 0) {
            SidebarRow(title: Text(f.name), isActive: nav.selection == .folder(f.id) && nav.openDocumentId == nil,
                       isDropTarget: dropTarget == f.id) {
                FolderGlyph(color: f.color, size: 18)
            } action: {
                nav.show(.folder(f.id))
            }
            .dropDestination(for: DocumentDragPayload.self) { items, _ in
                // One note, or a whole selection; the toast offers Undo.
                NoteActions.shared.moveTo(items.flatMap(\.ids), FolderTarget(id: f.id, name: f.name), app: app)
                return !items.isEmpty
            } isTargeted: { targeted in
                dropTarget = targeted ? f.id : (dropTarget == f.id ? nil : dropTarget)
            }
            .accessibilityIdentifier(SidebarItem.folder(f.id).accessibilityId)
            FolderMenu(folder: MenuFolder(f), openDocument: openDocument)
                .opacity(hoveredFolder == f.id ? 1 : 0)
        }
        .onHover { on in
            if on { hoveredFolder = f.id } else if hoveredFolder == f.id { hoveredFolder = nil }
        }
    }

    // MARK: Tags

    private var tagsSection: some View {
        let tags = app.sidebar.tags
        let shown = tags.enumerated().filter { $0.offset < Self.limit || nav.selection == .tag($0.element.id) }.map(\.element)
        return SidebarSection(title: String(localized: "Tags"), target: .tags, nav: nav, isOpen: $tagsOpen) {
            EmptyView()
        } content: {
            if tags.isEmpty {
                Text("Tag documents from the inspector").font(.ui(12)).foregroundStyle(FoleviColor.inkFaint)
                    .padding(.horizontal, 8).padding(.vertical, 4)
            }
            ForEach(shown) { t in
                HStack(spacing: 0) {
                    SidebarRow(title: Text(t.name), isActive: nav.selection == .tag(t.id) && nav.openDocumentId == nil) {
                        Image(systemName: "number").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Color.folevi(tag: t.color))
                    } action: {
                        nav.show(.tag(t.id))
                    }
                    .accessibilityIdentifier(SidebarItem.tag(t.id).accessibilityId)
                    if app.canEditHere {
                        TagMenu(tag: t, nav: nav).opacity(hoveredTag == t.id ? 1 : 0)
                    }
                }
                .onHover { on in
                    if on { hoveredTag = t.id } else if hoveredTag == t.id { hoveredTag = nil }
                }
            }
            moreLink(count: tags.count - shown.count, target: .tags, noun: String(localized: "tags"))
        }
    }

    // MARK: Rows

    /// A fixed item; `dropFolderId` makes it a drop target for notes ("" for Drafts).
    @ViewBuilder
    private func row(_ item: SidebarItem, count: Int? = nil, dropFolderId: String? = nil) -> some View {
        let base = SidebarRow(title: Text(item.title), count: count, isActive: nav.selection == item && nav.openDocumentId == nil,
                              isDropTarget: dropFolderId != nil && dropTarget == dropFolderId) {
            Image(systemName: item.systemImage)
        } action: {
            nav.show(item)
        }
        .accessibilityIdentifier(item.accessibilityId)
        if let dropFolderId {
            base.dropDestination(for: DocumentDragPayload.self) { items, _ in
                NoteActions.shared.moveTo(items.flatMap(\.ids), .drafts, app: app)
                return !items.isEmpty
            } isTargeted: { targeted in
                dropTarget = targeted ? dropFolderId : (dropTarget == dropFolderId ? nil : dropTarget)
            }
        } else {
            base
        }
    }

    /// "+N more" under a list (opens the section's own page).
    @ViewBuilder
    private func moreLink(count: Int, target: SidebarItem, noun: String) -> some View {
        if count > 0 {
            SidebarMoreLink(text: String(localized: "+\(count.formatted()) more")) { nav.show(target) }
                .accessibilityLabel(Text("+\(count.formatted()) more \(noun)"))
        }
    }

    /// ↑/↓ move through the items when the list has keyboard focus.
    private func step(_ delta: Int) -> KeyPress.Result {
        var items: [SidebarItem] = [.all, .starred, .drafts, .notes, .tasks, .shared, .templates]
        items += app.sidebar.folders.map { .folder($0.id) }
        items += app.sidebar.tags.map { .tag($0.id) }
        items += [.archive, .trash]
        let current = items.firstIndex(of: nav.selection) ?? 0
        let next = max(0, min(items.count - 1, current + delta))
        nav.selection = items[next]
        return .handled
    }

    // MARK: Data

    /// Notes that aren't in a folder yet.
    private var draftCount: Int {
        app.documents.filter { $0.folderId == nil && ($0.kind == .document || $0.kind == .daily) && $0.deletedAt == nil && $0.archivedAt == nil && $0.parentDocumentId == nil }.count
    }

    private struct StarredKey: Equatable { var scope: String; var revision: Int; var online: Bool }
    private struct SidebarRefreshKey: Equatable { var scope: String; var online: Bool }

    /// Starred pages in the server's order; pages starred on this Mac since then follow.
    private var starredDocs: [DocumentSummary] {
        let live = app.documents.filter { $0.deletedAt == nil && notes.isStarred($0) }
        let byId = Dictionary(live.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let ordered = starredOrder.compactMap { byId[$0] }
        let seen = Set(ordered.map(\.id))
        return ordered + live.filter { !seen.contains($0.id) }.sorted { $0.updatedAt > $1.updatedAt }
    }

    private func loadStarred() async {
        guard let session = app.session, app.sync.isOnline else { return }
        guard let docs = try? await session.documents.list(scope: session.scope, view: "starred") else { return }
        notes.noteStarred(docs, scope: session.scope)
        starredOrder = docs.map(\.id)
    }

    private func refreshTaskCount() async {
        let today = TaskLogic.localDate()
        let viewer = app.profile?.id ?? ""
        todayTasks = await TaskStore.load(app: app).filter {
            TaskLogic.views(status: $0.checked ? .done : .open, dueDate: $0.dueDate, assigneeId: $0.assigneeId, today: today, viewerId: viewer).contains(.today)
        }.count
    }
}

/// A collapsible sidebar section (the web's Section): a chevron that folds it (remembered), the title as a
/// link to the section's own page, and an optional action on the right.
private struct SidebarSection<Action: View, Content: View>: View {
    var title: String
    var target: SidebarItem
    @Bindable var nav: NavigationModel
    @Binding var isOpen: Bool
    @ViewBuilder var action: Action
    @ViewBuilder var content: Content
    @State private var hoverTitle = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 2) {
                Button {
                    withAnimation(.easeOut(duration: FoleviMotion.fast)) { isOpen.toggle() }
                } label: {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9.5, weight: .semibold))
                        .frame(width: 24, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(SidebarGlyphButtonStyle())
                .accessibilityLabel(Text(isOpen ? "Collapse \(title)" : "Expand \(title)"))
                let active = nav.selection == target && nav.openDocumentId == nil
                Button { nav.show(target) } label: {
                    Text(title)
                        .foleviCapsLabel(hoverTitle || active ? FoleviColor.heading : FoleviColor.inkFaint)
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                        .background(hoverTitle || active ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hoverTitle = $0 }
                .help(Text("All \(title.lowercased())"))
                .accessibilityAddTraits(active ? [.isHeader, .isSelected] : .isHeader)
                action
            }
            .frame(height: 28)
            .padding(.horizontal, 10)
            if isOpen {
                VStack(alignment: .leading, spacing: 2) { content }
                    .padding(.top, 4)
            }
        }
        .padding(.top, 20)
    }
}

/// The small chevrons in the sidebar: faint, a glass hover square.
private struct SidebarGlyphButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        GlyphBody(configuration: configuration)
    }

    private struct GlyphBody: View {
        let configuration: ButtonStyle.Configuration
        @State private var hover = false
        var body: some View {
            configuration.label
                .foregroundStyle(hover ? FoleviColor.heading : FoleviColor.inkFaint)
                .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .onHover { hover = $0 }
        }
    }
}

/// "+N more": 32pt, indented under the icons, 12.5pt muted; glass hover.
private struct SidebarMoreLink: View {
    var text: String
    var action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.ui(12.5))
                .foregroundStyle(hover ? FoleviColor.heading : FoleviColor.inkMuted)
                .padding(.leading, 32)
                .padding(.trailing, 10)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                .background(hover ? FoleviGlass.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// A tag's "…" menu (the web's TagMenu): edit its name and colour, pick another colour, or delete it.
private struct TagMenu: View {
    var tag: TagInfo
    @Bindable var nav: NavigationModel
    @Environment(AppModel.self) private var app
    @State private var editing = false
    @State private var deleting = false

    static let colors: [(id: String, label: String)] = [
        ("accent", String(localized: "Cocoa")), ("moss", String(localized: "Moss")), ("marigold", String(localized: "Marigold")),
        ("plum", String(localized: "Plum")), ("coral", String(localized: "Coral")), ("muted", String(localized: "Gray")),
    ]

    var body: some View {
        FoleviMenuButton(label: String(localized: "Tag options for \(tag.name)"), entries: entries) { open in
            FoleviMenuTrigger(systemImage: "ellipsis", size: 32, open: open)
        }
        .sheet(isPresented: $editing) { TagEditDialog(tag: tag).environment(app) }
        .sheet(isPresented: $deleting) {
            FoleviDialog(title: String(localized: "Delete #\(tag.name)?"),
                         message: String(localized: "The tag is removed from every document. The documents themselves are not affected."),
                         confirmTitle: String(localized: "Delete tag")) {
                deleting = false
                let id = tag.id
                let name = tag.name
                OrganizationActions.run(app, success: String(localized: "Deleted #\(name)")) { try await $0.deleteTag(id) }
                if nav.selection == .tag(id) { nav.show(.all) }
            }
        }
    }

    private func entries() -> [FoleviMenuEntry] {
        var out: [FoleviMenuEntry] = [.item(FoleviMenuItem(String(localized: "Edit tag…")) { editing = true })]
        for c in Self.colors where c.id != tag.color {
            out.append(.item(FoleviMenuItem(String(localized: "Color: \(c.label)"), icon: Circle().fill(Color.folevi(tag: c.id)).frame(width: 10, height: 10)) {
                let id = tag.id
                OrganizationActions.run(app) { try await $0.updateTag(id, color: c.id) }
            }))
        }
        out.append(.separator)
        out.append(.item(FoleviMenuItem(String(localized: "Delete tag…"), danger: true) { deleting = true }))
        return out
    }
}

/// "Edit tag": its name (up to 40 characters) and colour.
private struct TagEditDialog: View {
    var tag: TagInfo
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var color = ""
    @State private var error: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        FoleviDialogShell(title: String(localized: "Edit tag"), size: .sm, onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Name").font(.ui(14, .medium))
                TextField("", text: $name)
                    .textFieldStyle(.plain)
                    .font(.ui(14))
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .foleviInputSurface(focused: focused)
                    .padding(.top, 8)
                    .onChange(of: name) { _, v in
                        error = nil
                        if v.count > 40 { name = String(v.prefix(40)) }
                    }
                    .onSubmit(save)
                    .accessibilityLabel(Text("Name"))
                Text("Color").font(.ui(14, .medium)).padding(.top, 16)
                FlowRow(spacing: 8) {
                    ForEach(TagMenu.colors, id: \.id) { c in
                        Button { color = c.id } label: {
                            HStack(spacing: 6) {
                                Circle().fill(Color.folevi(tag: c.id)).frame(width: 12, height: 12)
                                Text(c.label).font(.ui(14)).foregroundStyle(FoleviColor.ink)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(color == c.id ? FoleviColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(color == c.id ? .isSelected : [])
                    }
                }
                .padding(.top, 8)
                if let error {
                    Text(error).font(.ui(14)).foregroundStyle(FoleviColor.destructive).padding(.top, 12)
                }
                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.folevi(.secondary, .medium)).keyboardShortcut(.cancelAction)
                    Button("Save", action: save).buttonStyle(.folevi(.primary, .medium)).keyboardShortcut(.defaultAction).disabled(saving)
                }
                .padding(.top, 20)
            }
        }
        .onAppear {
            name = tag.name
            color = tag.color
        }
        .claimsFocus($focused)
    }

    private func save() {
        guard let session = app.session, !saving else { return }
        guard app.sync.isOnline else {
            error = String(localized: "This needs a connection. Try again when you're back online.")
            return
        }
        saving = true
        let id = tag.id, newName = name, newColor = color
        Task {
            defer { saving = false }
            do {
                try await session.organization.updateTag(id, name: newName, color: newColor)
                dismiss()
                app.showToast(String(localized: "Tag updated"), tone: .success)
            } catch {
                self.error = ConvexService.mapError(error).localizedDescription
            }
        }
    }
}

/// A simple wrapping row of chips.
private struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(widest, maxWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// The web's resize separator: invisible until hovered (a thin heading/20% line), drag to resize, ←/→ by 8.
private struct SidebarResizeHandle: View {
    @Binding var width: CGFloat
    var range: ClosedRange<CGFloat>
    @State private var hover = false
    @State private var start: CGFloat?
    @FocusState private var focused: Bool

    var body: some View {
        Capsule()
            .fill(hover || start != nil ? FoleviColor.heading.opacity(0.2) : focused ? FoleviColor.heading.opacity(0.3) : .clear)
            .frame(width: 4)
            .frame(width: 10)
            .contentShape(Rectangle())
            .onHover { on in
                hover = on
                if on { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in
                        if start == nil { start = width }
                        width = min(range.upperBound, max(range.lowerBound, (start ?? width) + v.translation.width))
                    }
                    .onEnded { _ in start = nil }
            )
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .onKeyPress(.leftArrow) {
                width = max(range.lowerBound, width - 8)
                return .handled
            }
            .onKeyPress(.rightArrow) {
                width = min(range.upperBound, width + 8)
                return .handled
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Resize sidebar"))
            .accessibilityValue(Text("\(Int(width))"))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: width = min(range.upperBound, width + 8)
                case .decrement: width = max(range.lowerBound, width - 8)
                @unknown default: break
                }
            }
    }
}

func withSidebarAnimation(_ body: () -> Void) {
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
        body()
    } else {
        withAnimation(.timingCurve(0.2, 0.7, 0.2, 1, duration: FoleviMotion.slow), body)
    }
}

/// One sidebar row, as the web's NavItem: 32pt, radius 6, 13.5pt. Hover = glass hover; active = the glass
/// "active" fill with its edge, heading semibold text and icon; counts in a small pill (inverted when active);
/// a note dragged over a folder rings it.
struct SidebarRow<Icon: View>: View {
    var title: Text
    var count: Int?
    var isActive: Bool
    var isDropTarget = false
    @ViewBuilder var icon: Icon
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                icon
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(isActive || hovering || isDropTarget ? FoleviColor.heading : FoleviColor.inkMuted)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                title
                    .font(.ui(13.5, isActive ? .semibold : .regular))
                    .foregroundStyle(isActive || hovering || isDropTarget ? FoleviColor.heading : FoleviColor.ink.opacity(0.9))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.ui(11, .semibold))
                        .monospacedDigit()
                        .foregroundStyle(isActive ? FoleviColor.canvas : FoleviColor.inkMuted)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(isActive ? FoleviColor.heading : FoleviGlass.hover))
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background {
                if isActive || isDropTarget {
                    Color.clear.foleviSurface(.color(FoleviGlass.active), shape: .rounded(6),
                                              shadow: FoleviGlassDepth.edge + [FoleviShadowLayer(x: 0, y: 1, blur: 3, spread: 0, color: .black.opacity(0.06), inset: false)])
                } else {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? FoleviGlass.hover : .clear)
                }
            }
            .overlay {
                if isDropTarget {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(FoleviColor.heading, lineWidth: 2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
        .accessibilityValue(count.map { $0 > 0 ? Text("\($0)") : Text("") } ?? Text(""))
    }
}

/// Plain button that brightens its label on hover.
struct HoverTint: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        HoverTintBody(configuration: configuration)
    }

    private struct HoverTintBody: View {
        let configuration: ButtonStyle.Configuration
        @State private var hovering = false
        var body: some View {
            configuration.label
                .brightness(hovering ? -0.02 : 0)
                .opacity(configuration.isPressed ? 0.85 : 1)
                .onHover { hovering = $0 }
        }
    }
}
