import SwiftUI

/// A list of notes (the web's DocumentBrowser): All notes, Drafts, Starred, Templates, Archive, Trash, a folder
/// or a tag. Grid, compact cards or a list; sorted by last edit, creation, title or by hand; multi-select with
/// ⌘-click, Shift-click, a selection rectangle, ⌘A and the selection bar.
struct BrowserView: View {
    @Bindable var nav: NavigationModel
    var openDocument: (String, Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var remoteDocs: [DocumentSummary]?
    /// Offline, a server list shows the copy saved on this Mac.
    @State private var remoteFromCache = false
    @State private var picked = NoteSelectionState()
    @State private var dialog: NoteDialog?
    @State private var layouts: [String: BrowserLayout] = [:]
    @State private var sorts: [String: BrowseSort] = [:]
    @State private var unsynced: Set<String> = []
    @State private var frames: [String: CGRect] = [:]
    @State private var marquee: CGRect?
    @State private var marqueeStart: (point: CGPoint, base: Set<String>)?
    @State private var dropTarget: String?
    @State private var width: CGFloat = 1000
    private var notes: NoteActions { .shared }

    private var selection: SidebarItem { nav.selection }
    private struct RemoteKey: Equatable { var selection: SidebarItem; var organized: Int; var sort: BrowseSort; var online: Bool }

    // MARK: The view, its layout and sort

    /// The web's view name (layout and sort are remembered per view, as there).
    private var viewKey: String {
        switch selection {
        case .notes: return "all"
        case .drafts: return "unsorted"
        case .templates: return "templates"
        case .starred: return "starred"
        case .archive: return "archive"
        case .trash: return "trash"
        case .folder: return "folder"
        case .tag: return "tag"
        default: return "all"
        }
    }

    private var layout: BrowserLayout {
        if let l = layouts[viewKey] { return l }
        if let raw = UserDefaults.standard.string(forKey: "folevi:layout:\(viewKey)"), let l = BrowserLayout(rawValue: raw) { return l }
        return selection == .trash || selection == .archive ? .list : .grid
    }

    private var layoutBinding: Binding<BrowserLayout> {
        Binding(get: { layout }, set: { l in
            layouts[viewKey] = l
            UserDefaults.standard.set(l.rawValue, forKey: "folevi:layout:\(viewKey)")
        })
    }

    private var sort: BrowseSort {
        if let s = sorts[viewKey] { return s }
        if let raw = UserDefaults.standard.string(forKey: "folevi:sort:\(viewKey)"), let s = BrowseSort(rawValue: raw) { return s }
        return .updated
    }

    private var sortBinding: Binding<BrowseSort> {
        Binding(get: { sort }, set: { s in
            sorts[viewKey] = s
            UserDefaults.standard.set(s.rawValue, forKey: "folevi:sort:\(viewKey)")
        })
    }

    private var canArrange: Bool { sort == .manual && selection != .trash }
    /// Templates have their own actions and aren't selectable (as on the web).
    private var selectable: Bool { selection != .templates }

    private var usesServerList: Bool {
        switch selection {
        case .starred, .tag: return true
        default: return false
        }
    }

    /// A folder or tag that isn't in this context (deleted, or from Personal while a workspace is open).
    private var missing: Bool {
        let known = !app.sidebar.folders.isEmpty || !app.sidebar.tags.isEmpty
        switch selection {
        case .folder(let id): return known && !app.sidebar.folders.contains { $0.id == id }
        case .tag(let id): return known && !app.sidebar.tags.contains { $0.id == id }
        default: return false
        }
    }

    private var documents: [DocumentSummary] {
        var docs: [DocumentSummary]
        if usesServerList {
            // Prefer local copies (fresher offline edits) for documents the server listed.
            let local = Dictionary(app.documents.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            docs = (remoteDocs ?? []).map { remote in
                guard var d = local[remote.id] else { return remote }
                d.preview = d.preview ?? remote.preview
                d.tags = d.tags ?? remote.tags
                return d
            }.filter { $0.deletedAt == nil }
            if selection == .starred { docs = docs.filter { notes.isStarred($0) } }
        } else {
            docs = app.documents.filter { d in
                let note = (d.kind == .document || d.kind == .daily) && d.deletedAt == nil && d.archivedAt == nil && d.parentDocumentId == nil
                switch selection {
                // Former Daily Notes are ordinary pages now.
                case .notes: return note
                // Drafts: notes that aren't in a folder yet.
                case .drafts: return note && d.folderId == nil
                case .folder(let id): return note && d.folderId == id
                case .templates: return d.kind == .template && d.deletedAt == nil
                case .archive: return d.archivedAt != nil && d.deletedAt == nil && d.parentDocumentId == nil
                case .trash: return d.deletedAt != nil
                default: return false
                }
            }
        }
        return BrowseOrder.sorted(docs, by: sort)
    }

    private var loading: Bool { usesServerList && remoteDocs == nil && app.sync.isOnline }

    // MARK: Body

    var body: some View {
        if missing {
            MissingContainerView(kind: { if case .folder = selection { return .folder } else { return .tag } }(), goHome: { nav.selection = .all })
        } else {
            list
        }
    }

    private var list: some View {
        let docs = documents
        let ids = docs.map(\.id)
        return GeometryReader { outer in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    toolbar(count: docs.count)
                        .padding(.bottom, 20)
                    if selection == .templates {
                        BuiltInTemplatesSection(openDocument: openDocument)
                    }
                    if loading {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 32)], spacing: 40) {
                            ForEach(0..<8, id: \.self) { _ in PulsePlaceholder(radius: 8, fill: FoleviColor.surface).frame(height: 208) }
                        }
                        .accessibilityElement()
                        .accessibilityLabel(Text("Loading"))
                    } else if docs.isEmpty {
                        DashedEmptyState(text: emptyText) {
                            if selection == .notes || { if case .folder = selection { return true } else { return false } }() {
                                Button {
                                    Task { if let id = await app.createDocument(folderId: nav.currentFolderId) { nav.open(id) } }
                                } label: { Label("New document", systemImage: "plus") }
                                .buttonStyle(.folevi(.primary, .medium))
                            }
                        }
                    } else {
                        switch layout {
                        case .list: listLayout(docs)
                        case .grid, .compact: gridLayout(docs)
                        }
                    }
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: 1180, alignment: .leading) // the max width includes the padding, as in CSS
                .padding(.top, 12)
                .padding(.bottom, 96)
                .frame(maxWidth: .infinity, minHeight: outer.size.height, alignment: .top)
                .background { marqueeSurface(ids) }
                .overlay(alignment: .topLeading) { marqueeRect }
                .coordinateSpace(.named("browse"))
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            }
            .scrollContentBackground(.hidden)
        }
        .task(id: RemoteKey(selection: selection, organized: notes.revision, sort: sort, online: app.sync.isOnline)) { await loadRemote() }
        .task(id: app.sync.pendingCount) { unsynced = await PendingDocuments.ids(app: app) }
        .onChange(of: selection) { _, _ in
            picked.clear()
            frames = [:]
        }
        .overlay(alignment: .bottom) {
            let selected = picked.selectedIds(in: ids)
            if !selected.isEmpty {
                SelectionBar(count: selected.count, total: ids.count, actions: bulkActions(selected, docs: docs),
                             onSelectAll: { picked.selectAll(ids) }, onClear: { picked.clear() })
                    .padding(.bottom, 20)
                    .padding(.horizontal, 12)
            }
        }
        .animation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.16), value: picked.isEmpty)
        .noteSelectionKeys(enabled: selectable, hasSelection: !picked.isEmpty,
                           selectAll: { if !ids.isEmpty { picked.selectAll(ids) } }, clear: { picked.clear() })
        .noteDialogs($dialog) { picked.clear() }
    }

    private var emptyText: String {
        switch selection {
        case .starred: return String(localized: "Star a document to keep it one click away.")
        case .archive: return String(localized: "Archived documents rest here, out of your lists but never lost.")
        case .trash: return String(localized: "Trash is empty. Deleted documents stay here for 30 days.")
        case .templates: return String(localized: "Save any document as a template, or start from a built-in one below.")
        case .drafts: return String(localized: "Everything has a folder. Nicely done.")
        case .folder: return String(localized: "This folder is empty. Drag documents here from the list.")
        case .tag: return String(localized: "No documents carry this tag yet.")
        default: return String(localized: "Nothing here yet. Starting a document takes one keystroke.")
        }
    }

    // MARK: Toolbar

    private func toolbar(count: Int) -> some View {
        HStack(spacing: 12) {
            Text(loading ? "" : BrowseFormat.listStatus(count: count, templates: selection == .templates,
                                                        savedOnDevice: !app.sync.isOnline && usesServerList && remoteFromCache, arranging: canArrange))
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkMuted)
                .lineLimit(1)
                .accessibilityAddTraits(.updatesFrequently)
                .accessibilityIdentifier("browser.title")
            Spacer(minLength: 12)
            SortField(selection: sortBinding, options: [
                .init(value: .updated, title: String(localized: "Last edited")),
                .init(value: .created, title: String(localized: "Created")),
                .init(value: .title, title: String(localized: "Title")),
                .init(value: .manual, title: String(localized: "Manual order")),
            ])
            IconRadioGroup(selection: layoutBinding, items: [
                .init(value: .grid, label: String(localized: "Grid"), systemImage: "square.grid.2x2"),
                .init(value: .compact, label: String(localized: "Compact cards"), systemImage: "rectangle.grid.1x2"),
                .init(value: .list, label: String(localized: "List"), systemImage: "list.bullet"),
            ], accessibilityLabel: String(localized: "Layout"))
            if selection == .trash, count > 0 {
                Button("Empty Trash") { dialog = .emptyTrash }
                    .buttonStyle(.folevi(.quiet, .small))
                    .accessibilityIdentifier("browser.emptyTrash")
            }
            if selection == .templates {
                Button { Templates.newTemplate(app: app) { nav.open($0) } } label: { Label("New template", systemImage: "plus") }
                    .buttonStyle(.folevi(.primary, .small))
            }
        }
    }

    // MARK: Layouts

    private func gridLayout(_ docs: [DocumentSummary]) -> some View {
        let compact = layout == .compact
        // The web's grid-cols-2 / sm:3 / lg:4 / xl:5 for compact cards (its breakpoints are the window's width).
        let window = width + 320
        let compactColumns = window < 640 ? 2 : window < 1024 ? 3 : window < 1280 ? 4 : 5
        let columns = compact ? Array(repeating: GridItem(.flexible(), spacing: 32, alignment: .top), count: compactColumns)
                              : [GridItem(.adaptive(minimum: 230), spacing: 32, alignment: .top)]
        return LazyVGrid(columns: columns, spacing: 40) {
            ForEach(docs) { doc in
                BrowserCard(doc: shown(doc), folder: folder(of: doc), compact: compact, inTrash: selection == .trash,
                            selected: picked.isSelected(doc.id), dropTarget: dropTarget == doc.id, unsynced: unsynced.contains(doc.id),
                            openDocument: openDocument) { menu(doc, in: docs) }
                    .onTapGesture { tap(doc, in: docs) }
                    .modifier(DocDrag(doc: doc, ids: dragIds(doc, in: docs), enabled: selection != .trash))
                    .modifier(ArrangeDrop(enabled: canArrange, id: doc.id, target: $dropTarget) { place($0, doc.id, in: docs) })
                    .contextMenu { menu(doc, in: docs) }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("browse")) } action: { frames[doc.id] = $0 }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("doc.\(doc.displayTitle)")
                    .accessibilityAction { openDocument(doc.id, false) }
            }
        }
    }

    private func listLayout(_ docs: [DocumentSummary]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(docs.enumerated()), id: \.element.id) { idx, doc in
                BrowserListRow(doc: doc, folder: folder(of: doc), selected: picked.isSelected(doc.id), inTrash: selection == .trash,
                               dropTarget: dropTarget == doc.id, unsynced: unsynced.contains(doc.id), dragIds: dragIds(doc, in: docs) ?? [doc.id],
                               openDocument: openDocument) { menu(doc, in: docs) }
                    .contentShape(Rectangle())
                    .onTapGesture { tap(doc, in: docs) }
                    .modifier(ArrangeDrop(enabled: canArrange, id: doc.id, target: $dropTarget) { place($0, doc.id, in: docs) })
                    .contextMenu { menu(doc, in: docs) }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("browse")) } action: { frames[doc.id] = $0 }
                    .accessibilityIdentifier("doc.\(doc.displayTitle)")
                if idx < docs.count - 1 { FoleviColor.line.frame(height: 1) }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .foleviCard(radius: 8)
    }

    private func shown(_ doc: DocumentSummary) -> DocumentSummary {
        var d = doc
        d.starred = notes.isStarred(doc)
        return d
    }

    private func folder(of doc: DocumentSummary) -> FolderInfo? {
        doc.folderId.flatMap { id in app.sidebar.folders.first { $0.id == id } }
    }

    private func menu(_ doc: DocumentSummary, in docs: [DocumentSummary]) -> DocumentContextMenu {
        let ids = docs.map(\.id)
        return DocumentContextMenu(document: doc, openDocument: openDocument,
                                   select: selectable ? (picked.isSelected(doc.id), { picked.toggle(doc.id) }) : nil,
                                   arrange: canArrange ? ({ nudge(doc.id, -1, ids) }, { nudge(doc.id, 1, ids) }) : nil,
                                   present: { dialog = $0 })
    }

    // MARK: Selecting

    /// ⌘-click toggles a note, Shift-click selects the range from the last one; a plain click opens it.
    private func tap(_ doc: DocumentSummary, in docs: [DocumentSummary]) {
        let flags = NSEvent.modifierFlags
        if selectable, flags.contains(.command) {
            picked.toggle(doc.id)
        } else if selectable, flags.contains(.shift) {
            picked.selectRange(to: doc.id, in: docs.map(\.id))
        } else {
            openDocument(doc.id, flags.contains(.option))
        }
    }

    /// Dragging a selected card takes the whole selection along.
    private func dragIds(_ doc: DocumentSummary, in docs: [DocumentSummary]) -> [String]? {
        guard picked.isSelected(doc.id) else { return nil }
        return picked.selectedIds(in: docs.map(\.id))
    }

    /// The empty space around the cards: a click clears the selection, a drag draws a selection rectangle
    /// (with ⌘ or Shift held it adds to the selection).
    private func marqueeSurface(_ ids: [String]) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture {
                let flags = NSEvent.modifierFlags
                if !flags.contains(.command) && !flags.contains(.shift) { picked.clear() }
            }
            .gesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .named("browse"))
                    .onChanged { value in
                        guard selectable else { return }
                        if marqueeStart == nil {
                            let flags = NSEvent.modifierFlags
                            let additive = flags.contains(.command) || flags.contains(.shift)
                            marqueeStart = (value.startLocation, additive ? Set(picked.selectedIds(in: ids)) : [])
                        }
                        guard let start = marqueeStart else { return }
                        let rect = Marquee.rect(from: start.point, to: value.location)
                        marquee = rect
                        let visible = frames.filter { ids.contains($0.key) }
                        picked.setPicked(Marquee.hits(rect, frames: visible, base: start.base))
                    }
                    .onEnded { _ in
                        marquee = nil
                        marqueeStart = nil
                    }
            )
    }

    @ViewBuilder private var marqueeRect: some View {
        if let r = marquee {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(FoleviColor.heading.opacity(0.07))
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(FoleviColor.heading.opacity(0.45), lineWidth: 1))
                .frame(width: r.width, height: r.height)
                .offset(x: r.minX, y: r.minY)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func bulkActions(_ ids: [String], docs: [DocumentSummary]) -> [SelectionBarAction] {
        let run: ([String]) -> Void = { _ in picked.clear() }
        if selection == .trash {
            return [
                SelectionBarAction(title: String(localized: "Restore"), systemImage: "arrow.uturn.backward") { run(ids); notes.restore(ids, app: app) },
                SelectionBarAction(title: String(localized: "Delete permanently…"), systemImage: "trash", danger: true) { dialog = .deleteSelection(ids: ids) },
            ]
        }
        let chosen = docs.filter { ids.contains($0.id) }
        let folders = Set(chosen.map { $0.folderId ?? "" })
        let current: String?? = folders.count == 1 ? .some(chosen.first?.folderId) : .none
        let allStarred = !chosen.isEmpty && chosen.allSatisfy { notes.isStarred($0) }
        return [
            SelectionBarAction(title: String(localized: "Move to folder…"), systemImage: "folder") {
                dialog = .move(ids: ids, title: chosen.first?.title, current: current)
            },
            allStarred
                ? SelectionBarAction(title: String(localized: "Unstar"), systemImage: "star.slash") { run(ids); notes.star(ids, false, app: app) }
                : SelectionBarAction(title: String(localized: "Star"), systemImage: "star") { run(ids); notes.star(ids, true, app: app) },
            selection == .archive
                ? SelectionBarAction(title: String(localized: "Unarchive"), systemImage: "archivebox") { run(ids); notes.archive(ids, false, app: app) }
                : SelectionBarAction(title: String(localized: "Archive"), systemImage: "archivebox") { run(ids); notes.archive(ids, true, app: app) },
            SelectionBarAction(title: String(localized: "Move to Trash"), systemImage: "trash", danger: true) { run(ids); notes.trash(ids, app: app) },
        ]
    }

    // MARK: Arranging (manual order)

    private func place(_ dragged: String, _ target: String, in docs: [DocumentSummary]) {
        guard let spot = BrowseOrder.placement(dragged: dragged, target: target, in: docs.map(\.id)) else { return }
        reorder(dragged, after: spot.after, before: spot.before)
    }

    private func nudge(_ id: String, _ delta: Int, _ ids: [String]) {
        guard let target = BrowseOrder.nudgeTarget(id, delta, in: ids), let spot = BrowseOrder.placement(dragged: id, target: target, in: ids) else { return }
        reorder(id, after: spot.after, before: spot.before)
    }

    private func reorder(_ id: String, after: String?, before: String?) {
        app.perform(String(localized: "Arranging")) { session in
            try await session.documents.reorder(id, after: after, before: before)
        }
        Task {
            // The server's new rank arrives with the next sync; Starred and tags lists are fetched again.
            try? await Task.sleep(for: .milliseconds(400))
            if usesServerList { await loadRemote() }
        }
    }

    // MARK: Loading

    private func loadRemote() async {
        if let session = app.session {
            notes.scopeChanged(session.scope)
            // Stars are kept on the server; the cards and menus need them in every list.
            if !notes.starredLoaded, selection != .starred, app.sync.isOnline,
               let starred = try? await session.documents.list(scope: session.scope, view: "starred", tagId: nil) {
                notes.noteStarred(starred, scope: session.scope)
            }
        }
        guard usesServerList, let session = app.session else {
            remoteDocs = nil
            return
        }
        let key = "browser.\(selection.accessibilityId)"
        if let cached = try? await session.store.codable([DocumentSummary].self, forKey: key) {
            remoteDocs = cached
            remoteFromCache = true
        } else if !app.sync.isOnline {
            remoteDocs = []
        }
        guard app.sync.isOnline else { return }
        let view: String
        var tagId: String?
        switch selection {
        case .starred: view = "starred"
        case .tag(let id):
            view = "tag"
            tagId = id
        default: return
        }
        if let docs = try? await session.documents.list(scope: session.scope, view: view, tagId: tagId, sort: sort) {
            if view == "starred" { notes.noteStarred(docs, scope: session.scope) }
            remoteDocs = docs
            remoteFromCache = false
            try? await session.store.setCodable(docs, forKey: key)
        } else if remoteDocs == nil {
            remoteDocs = []
        }
    }
}

// MARK: - Cards and rows

/// Drags a note (or the selection it's part of) to a folder in the sidebar, or to arrange it.
private struct DocDrag: ViewModifier {
    let doc: DocumentSummary
    let ids: [String]?
    var enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content.draggable(DocumentDragPayload(documentId: doc.id, documentIds: ids)) {
                Text(ids.map { Organize.notes($0.count) } ?? doc.displayTitle).font(.ui(13, .semibold)).foregroundStyle(FoleviColor.heading)
                    .padding(.horizontal, 16).frame(height: 36).foleviSurface(.color(FoleviColor.surface), shape: .capsule, shadow: FoleviShadow.lift)
            }
        } else {
            content
        }
    }
}

/// In manual order a note dropped on another takes its place.
private struct ArrangeDrop: ViewModifier {
    var enabled: Bool
    let id: String
    @Binding var target: String?
    var drop: (String) -> Void

    func body(content: Content) -> some View {
        if enabled {
            content.dropDestination(for: DocumentDragPayload.self) { items, _ in
                target = nil
                guard let dragged = items.first?.documentId, dragged != id else { return false }
                drop(dragged)
                return true
            } isTargeted: { on in
                if on { target = id } else if target == id { target = nil }
            }
        } else {
            content
        }
    }
}

/// A note in the grid (a notebook card, or a compact card), with its "Use" and "…" buttons on hover.
private struct BrowserCard<MenuItems: View>: View {
    let doc: DocumentSummary
    var folder: FolderInfo?
    var compact: Bool
    var inTrash: Bool
    var selected: Bool
    var dropTarget: Bool
    var unsynced: Bool
    var openDocument: (String, Bool) -> Void
    @ViewBuilder var menu: () -> MenuItems
    @State private var hovering = false

    var body: some View {
        let template = doc.kind == .template
        Group {
            if compact {
                CompactNoteCard(document: doc, folder: folder, showFolder: !template, unsynced: unsynced)
            } else {
                NoteCard(document: doc, folder: folder,
                         time: inTrash ? doc.deletedAt.map { "Deleted \(BrowseFormat.ageText($0).lowercased())" } : nil,
                         showFolder: !template, unsynced: unsynced)
            }
        }
        .selectedCard(selected || dropTarget)
        .overlay(alignment: .topTrailing) {
            GeometryReader { geo in
                HStack(spacing: 4) {
                    if template && !inTrash { UseTemplateButton(document: doc, raised: true, openDocument: openDocument) }
                    NoteMenuButton(title: doc.displayTitle, raised: true, items: menu)
                }
                .padding(.top, 8)
                .padding(.trailing, doc.starred == true && !compact ? geo.size.width * 0.12 + 8 : 8)
                .frame(maxWidth: .infinity, alignment: .topTrailing)
                .opacity(hovering ? 1 : 0)
            }
        }
        .onHover { hovering = $0 }
    }
}

/// A note in the List layout (the web's list row).
private struct BrowserListRow<MenuItems: View>: View {
    var doc: DocumentSummary
    var folder: FolderInfo?
    var selected = false
    var inTrash = false
    var dropTarget = false
    var unsynced = false
    var dragIds: [String]
    var openDocument: (String, Bool) -> Void
    @ViewBuilder var menu: () -> MenuItems
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            // The drag handle (⋮⋮), shown on hover.
            Text("⋮⋮")
                .font(.ui(13))
                .foregroundStyle(FoleviColor.inkFaint)
                .opacity(hovering ? 1 : 0)
                .draggable(DocumentDragPayload(documentId: doc.id, documentIds: dragIds.count > 1 ? dragIds : nil))
                .onHover { inside in if inside { NSCursor.openHand.set() } else { NSCursor.arrow.set() } }
                .accessibilityHidden(true)
            Group {
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundStyle(FoleviColor.canvas)
                        .frame(width: 16, height: 16)
                        .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(FoleviColor.heading))
                } else {
                    Image(systemName: "doc.text")
                        .font(.system(size: 14))
                        .foregroundStyle(FoleviColor.inkMuted)
                        .frame(width: 16, height: 16)
                }
            }
            .accessibilityHidden(true)
            Text(doc.displayTitle)
                .font(.ui(16, .medium))
                .foregroundStyle(FoleviColor.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(selected ? "\(doc.displayTitle) (selected)" : doc.displayTitle))
            if unsynced { UnsyncedMarker() }
            if doc.kind != .template { FolderBadge(folder: folder) }
            // Always there, as on the web (an empty slot still takes its gap), so the dates line up.
            Text((doc.tags ?? []).map { "#" + $0.name }.joined(separator: " ")).font(.ui(12)).foregroundStyle(FoleviColor.inkMuted).lineLimit(1)
            Text(inTrash && doc.deletedAt != nil ? "Deleted \(CollabTime.relative(doc.deletedAt ?? 0))" : CollabTime.relative(doc.updatedAt))
                .font(.ui(12))
                .foregroundStyle(FoleviColor.inkFaint)
                .lineLimit(1)
                .frame(width: 112, alignment: .trailing)
            if doc.kind == .template && !inTrash { UseTemplateButton(document: doc, openDocument: openDocument) }
            NoteMenuButton(title: doc.displayTitle, items: menu)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(minHeight: 52)
        .background(selected ? FoleviGlass.active : hovering ? FoleviColor.surface : .clear)
        .overlay(alignment: .top) { if dropTarget { FoleviColor.heading.frame(height: 2) } }
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
        .accessibilityAction { openDocument(doc.id, false) }
    }
}

/// A folder or tag link that doesn't open here (the web's MissingContainer).
private struct MissingContainerView: View {
    enum Kind { case folder, tag }
    var kind: Kind
    var goHome: () -> Void
    @Environment(AppModel.self) private var app

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text(kind == .folder ? "This folder isn’t here" : "This tag isn’t here")
                    .font(FoleviType.display(36))
                    .tracking(FoleviType.displayTracking(36))
                    .foregroundStyle(FoleviColor.heading)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Text(message)
                    .font(.ui(16))
                    .foregroundStyle(FoleviColor.inkMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                Button("Go to Home", action: goHome)
                    .buttonStyle(.folevi(.primary, .medium))
                    .padding(.top, 24)
            }
            .frame(maxWidth: 512)
            .padding(.horizontal, 24)
            .padding(.vertical, 96)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
    }

    private var message: String {
        let elsewhere = app.workspaces.isEmpty ? "" : ", or it belongs somewhere other than \(app.scopeName)"
        let things = kind == .folder ? "folders" : "tags"
        return "It may have been deleted\(elsewhere). Links to \(things) only work in their own Personal or workspace. Switch there from the menu at the bottom of the sidebar."
    }
}
