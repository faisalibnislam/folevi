// A note list's view model (plan 5.4; web DocumentBrowser.tsx and iphone/NoteList.tsx): All notes, Drafts,
// Starred, Archive, Trash, Templates, a folder (its subfolders above its notes) and a tag. The list is windowed
// (`notes.list` with a `ListStore`): the screen reports which positions are on screen and the store moves its
// window, so a library of thousands of notes holds a few hundred rows at a time. Sort and layout are kept per
// list, as the web keeps them; the filter field narrows what's loaded, as the web's does.
import Foundation
import Observation
import FoleviDesign
import FoleviEngine

/// Which list.
public struct NotesListKind: Hashable, Sendable {
    public var view: NotesListView
    public var folderId: String?
    public var tagId: String?
    public init(_ view: NotesListView, folderId: String? = nil, tagId: String? = nil) {
        self.view = view
        self.folderId = folderId
        self.tagId = tagId
    }
    public static func folder(_ id: String) -> NotesListKind { NotesListKind(.folder, folderId: id) }
    public static func tag(_ id: String) -> NotesListKind { NotesListKind(.tag, tagId: id) }
}

public enum NotesLayout: String, Sendable, CaseIterable { case cards, list }

/// One position of the list: a row when it's loaded, a placeholder otherwise.
public struct NoteSlot: Identifiable, Hashable, Sendable {
    public var index: Int
    public var row: NoteRow?
    public var id: String { row?.id ?? "#\(index)" }
}

/// What can be done to several notes at once (the selection bar), in the web's order.
public enum BulkAction: String, CaseIterable, Sendable, Identifiable {
    case move, copy, star, unstar, archive, unarchive, trash, restore, deleteForever
    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .move: "Move"
        case .copy: "Copy to"
        case .star: "Star"
        case .unstar: "Unstar"
        case .archive: "Archive"
        case .unarchive: "Unarchive"
        case .trash: "Trash"
        case .restore: "Restore"
        case .deleteForever: "Delete"
        }
    }

    public var symbol: String {
        switch self {
        case .move: "folder"
        case .copy: "plus.square.on.square"
        case .star: "star"
        case .unstar: "star.slash"
        case .archive: "archivebox"
        case .unarchive: "tray.and.arrow.up"
        case .trash, .deleteForever: "trash"
        case .restore: "arrow.uturn.backward"
        }
    }

    public var destructive: Bool { self == .trash || self == .deleteForever }
}

/// What a confirmation asks before a destructive step.
public enum ListConfirmation: Identifiable, Hashable, Sendable {
    case deleteForever([String])
    case emptyTrash(Int)
    public var id: String {
        switch self {
        case .deleteForever(let ids): "delete:\(ids.joined(separator: ","))"
        case .emptyTrash(let n): "empty:\(n)"
        }
    }
}

@MainActor
@Observable
public final class NotesListModel {
    public let client: EngineClient
    public let kind: NotesListKind
    public let actions: NoteActions
    public private(set) var store: ListStore<NoteRow>
    public let tree: ValueStore<FoldersTreeValue>
    public let session: ValueStore<SessionValue>
    public let places: ValueStore<PlacesValue>
    /// The folder screen's subfolder cards (with previews), once `folders.cards` answers.
    public let subfolderCards: ValueStore<FolderCardsValue>?
    /// Built-in templates (Templates only).
    public let builtIns: ValueStore<BuiltInTemplatesValue>?

    public var sort: NotesSort {
        didSet {
            guard sort != oldValue else { return }
            defaults.set(sort.rawValue, forKey: "folevi.sort.\(kind.view.rawValue)")
            restart()
        }
    }

    public var layout: NotesLayout {
        didSet { defaults.set(layout.rawValue, forKey: "folevi.layout.\(kind.view.rawValue)") }
    }

    /// The filter field ("Search" on the screen). The engine filters the list (up to 5,000 notes, so matches
    /// outside the window are found) a moment after typing stops; the loaded rows narrow at once meanwhile.
    public var filter = "" {
        didSet {
            guard filter != oldValue else { return }
            filterTask?.cancel()
            let wanted = filter.trimmingCharacters(in: .whitespacesAndNewlines)
            filterTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled, let self, wanted != self.serverFilter else { return }
                self.serverFilter = wanted
                self.restart()
            }
        }
    }
    @ObservationIgnored private var filterTask: Task<Void, Never>?
    @ObservationIgnored private var serverFilter = ""
    public var selecting = false {
        didSet { if !selecting { selection.removeAll() } }
    }
    public var selection: Set<String> = []
    /// Notes the move sheet is open for.
    public var moving: [String]?
    public var confirmation: ListConfirmation?
    /// The folder menu's open dialog (a folder's screen: its own menu and its subfolders' menus).
    public let dialogs = FolderDialogState()
    public private(set) var refreshing = false

    @ObservationIgnored private var visible = Set<Int>()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let space: SpaceRef?

    public init(client: EngineClient, kind: NotesListKind, feedback: ScreenFeedback = ScreenFeedback(), space: SpaceRef? = nil, defaults: UserDefaults = .standard) {
        self.client = client
        self.kind = kind
        self.space = space
        self.defaults = defaults
        self.actions = NoteActions(client: client, feedback: feedback, space: space)
        let savedSort = defaults.string(forKey: "folevi.sort.\(kind.view.rawValue)").flatMap(NotesSort.init(rawValue:))
        let sort: NotesSort = (kind.view == .trash && savedSort == .manual) ? .updated : (savedSort ?? .updated)
        self.sort = sort
        self.layout = defaults.string(forKey: "folevi.layout.\(kind.view.rawValue)").flatMap(NotesLayout.init(rawValue:)) ?? ((kind.view == .trash || kind.view == .archive) ? .list : .cards)
        self.store = client.watchList(.notesList(space: space, view: kind.view, folderId: kind.folderId, tagId: kind.tagId, sort: sort), snapshotKey: Self.snapshotKey(client: client, space: space, kind: kind, sort: sort))
        self.tree = client.watch(.foldersTree(space: space))
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.places = client.watch(.placesList)
        self.subfolderCards = kind.view == .folder ? client.watch(.foldersCards(space: space, parentId: kind.folderId)) : nil
        self.builtIns = kind.view == .templates ? client.watch(.templatesBuiltIn) : nil
    }

    private func restart() {
        visible.removeAll()
        let filter = serverFilter.isEmpty ? nil : serverFilter
        // A filtered list isn't what launch draws: only the plain list keeps a snapshot.
        store = client.watchList(.notesList(space: space, view: kind.view, folderId: kind.folderId, tagId: kind.tagId, sort: sort, filter: filter), snapshotKey: filter == nil ? Self.snapshotKey(client: client, space: space, kind: kind, sort: sort) : nil)
    }

    /// The list's key in the launch snapshot (plan 4.6: the top of each list that was on screen).
    static func snapshotKey(client: EngineClient, space: SpaceRef?, kind: NotesListKind, sort: NotesSort) -> String {
        "list.\(client.place).\(space ?? "current").\(kind.view.rawValue).\(kind.folderId ?? kind.tagId ?? "-").\(sort.rawValue)"
    }

    // MARK: Title and state

    public var folder: FolderNode? {
        guard let id = kind.folderId else { return nil }
        return tree.value?.folders.first { $0.id == id }
    }

    public var title: String {
        switch kind.view {
        case .all: "All notes"
        case .unsorted: "Drafts"
        case .starred: "Starred"
        case .archive: "Archive"
        case .trash: "Trash"
        case .templates: "Templates"
        case .folder: folder?.name ?? "Folder"
        case .tag: tree.value?.tags.first { $0.id == kind.tagId }?.name ?? "Tag"
        }
    }

    public var isTrash: Bool { kind.view == .trash }
    public var selectable: Bool { kind.view != .templates }
    public var isLoading: Bool { store.status == .loading && store.total == 0 }
    public var total: Int { store.total }

    public var currentSpace: SpaceInfo? {
        guard let s = session.value else { return nil }
        return s.spaces.first { $0.id == s.space }
    }

    public var canEdit: Bool { currentSpace?.canEdit ?? true }
    /// Other spaces notes can be copied to ("Copy to…").
    public var copyTargets: [SpaceInfo] {
        guard let s = session.value else { return [] }
        return s.spaces.filter { $0.id != s.space && $0.canEdit && !$0.locked }
    }

    /// Manual order is offered where the web offers it, and rows move by drag only in it.
    public var canArrange: Bool { sort == .manual && canEdit && [.all, .unsorted, .folder].contains(kind.view) }

    public var sortOptions: [(NotesSort, String)] {
        let all: [(NotesSort, String)] = [(.updated, "Last edited"), (.created, "Created"), (.title, "Title"), (.manual, "Manual order")]
        return isTrash ? all.filter { $0.0 != .manual } : all
    }

    // MARK: Rows

    /// Every position of the list (placeholders where the window hasn't loaded), or the loaded rows that match
    /// the filter. Notes that just left the list are skipped until the engine's update arrives.
    public var slots: [NoteSlot] {
        let state = store.state
        let q = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !q.isEmpty {
            var out: [NoteSlot] = []
            for (i, row) in state.rows.enumerated() where !actions.isHidden(row.id) {
                if (row.title.isEmpty ? "untitled" : row.title.lowercased()).contains(q) || row.excerpt.lowercased().contains(q) {
                    out.append(NoteSlot(index: state.start + i, row: row))
                }
            }
            return out
        }
        var out: [NoteSlot] = []
        out.reserveCapacity(state.total)
        for i in 0..<state.total {
            let row = state.row(at: i)
            if let row, actions.isHidden(row.id) { continue }
            out.append(NoteSlot(index: i, row: row))
        }
        return out
    }

    /// The filter field has words in it (the screen shows `slots`, the matches, instead of every position).
    public var isFiltering: Bool { !filter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The slot at a position of the whole list, without building the whole list (what the screen draws).
    /// Every position is one view, so a list of thousands never has to count its rows; a note that just left
    /// the list shows faded until the engine's update takes it out.
    public func slot(at index: Int) -> NoteSlot {
        NoteSlot(index: index, row: store.state.row(at: index))
    }

    public var loadedRows: [NoteRow] { store.rows.filter { !actions.isHidden($0.id) } }

    public func card(_ row: NoteRow) -> NoteCardModel { CardMapping.noteCard(row, starred: actions.isStarred(row), inTrash: isTrash) }

    public func isStarred(_ row: NoteRow) -> Bool { actions.isStarred(row) }

    /// The row's second line: "5 mins ago · Trips", "Deleted 2 days ago", "· Not synced".
    public func subtitle(_ row: NoteRow) -> String {
        var s = CardMapping.timeText(row, inTrash: isTrash)
        if row.kind != "template" { s += row.folder.map { " · \($0.name)" } ?? " · Draft" }
        if row.sync != .saved { s += row.sync == .conflict ? " · Conflict" : " · Not synced" }
        return s
    }

    /// The screen saw a position appear or disappear: the window follows.
    public func slotAppeared(_ index: Int) {
        visible.insert(index)
        updateWindow()
    }

    public func slotDisappeared(_ index: Int) {
        visible.remove(index)
    }

    private func updateWindow() {
        guard let lo = visible.min(), let hi = visible.max() else { return }
        store.setVisibleRange(lo..<(hi + 1))
    }

    public func setVisible(_ on: Bool) {
        store.setVisible(on)
        tree.setVisible(on)
    }

    public func refresh() async {
        refreshing = true
        defer { refreshing = false }
        do { try await client.command(.engineRefresh) } catch { actions.report(error) }
    }

    // MARK: Subfolders (a folder's screen)

    public var subfolders: [FolderCardModel] {
        guard kind.view == .folder else { return [] }
        if let cards = subfolderCards?.value?.folders, subfolderCards?.error == nil { return cards.map { CardMapping.folderCard($0) } }
        return (tree.value?.folders ?? []).filter { $0.parentId == kind.folderId }.map(CardMapping.folderCard)
    }

    public var folderLinks: [FolderRules.Link] { FolderRules.links(tree.value?.folders ?? []) }

    public var folderContext: FolderMenuContext {
        FolderMenuContext(session: session.value, places: places.value, links: folderLinks)
    }

    public func menuFolder(_ id: String) -> MenuFolder? {
        if let node = tree.value?.folders.first(where: { $0.id == id }) { return MenuFolder(node) }
        if let card = subfolderCards?.value?.folders.first(where: { $0.id == id }) { return MenuFolder(card) }
        return nil
    }

    /// The parent of this folder (for the "up" drop target that un-nests a folder), when it has one.
    public var parentFolder: FolderNode? {
        guard let parent = folder?.parentId else { return nil }
        return tree.value?.folders.first { $0.id == parent }
    }

    /// Notes dropped on a subfolder card move into it (and leave this folder's list).
    public func dropNotes(_ items: [NoteDragItem], into folderId: String) async {
        guard let target = menuFolder(folderId) else { return }
        var from: [String: String?] = [:]
        for item in items { from[item.id] = item.folderId }
        await actions.move(items.map(\.id), to: FolderTarget(id: target.id, name: target.name), from: from, leavesList: kind.view == .folder || kind.view == .unsorted)
    }

    /// A folder dropped on a subfolder card (before, inside or after it), or on the screen's "up" target
    /// (`targetId` nil with `toParent`: into this folder's parent; nil otherwise: the top level).
    public func dropFolder(_ item: FolderDragItem, on targetId: String?, zone: FolderRules.Zone) async {
        await FolderDrops.drop(item, targetId: targetId, targetName: targetId.flatMap { menuFolder($0)?.name }, zone: zone, links: folderLinks, actions: actions)
    }

    /// Where Move can put notes: Drafts, then every folder in tree order (indented by depth).
    public var moveTargets: [(target: FolderTarget, depth: Int, color: String?)] {
        [(FolderTarget.drafts, 0, nil)] + (tree.value?.folders ?? []).map { (FolderTarget(id: $0.id, name: $0.name), $0.depth, $0.color) }
    }

    // MARK: Actions on rows

    public enum RowAction: Hashable, Sendable {
        case open, openInNewTab, star, unstar, move, duplicate, copyTo(SpaceRef), archive, unarchive, select, deselect, moveUp, moveDown, trash, restore, deleteForever, useTemplate, editTemplate
    }

    /// The long-press menu of a note (web NoteContextMenu), in the web's order.
    public func menu(for row: NoteRow, wide: Bool) -> [[RowAction]] {
        let selected = selection.contains(row.id)
        if isTrash {
            return [[.restore, selected ? .deselect : .select], [.deleteForever]]
        }
        var first: [RowAction] = []
        if row.kind == "template" {
            first.append(.useTemplate)
            first.append(.editTemplate)
        } else {
            first.append(.open)
            if wide { first.append(.openInNewTab) }
        }
        var second: [RowAction] = [actions.isStarred(row) ? .unstar : .star]
        if row.kind != "template" && canEdit { second.append(.move) }
        second.append(.duplicate)
        for space in copyTargets { second.append(.copyTo(space.id)) }
        second.append(row.archived ? .unarchive : .archive)
        if selectable { second.append(selected ? .deselect : .select) }
        var groups = [first, second]
        if canArrange { groups.append([.moveUp, .moveDown]) }
        groups.append([.trash])
        return groups
    }

    public func title(of action: RowAction) -> String {
        switch action {
        case .open: "Open"
        case .openInNewTab: "Open in new tab"
        case .star: "Star"
        case .unstar: "Unstar"
        case .move: "Move to folder…"
        case .duplicate: "Duplicate"
        case .copyTo(let space): "Copy to \(copyTargets.first { $0.id == space }?.name ?? "…")"
        case .archive: "Archive"
        case .unarchive: "Unarchive"
        case .select: "Select"
        case .deselect: "Deselect"
        case .moveUp: "Move up"
        case .moveDown: "Move down"
        case .trash: "Move to Trash"
        case .restore: "Restore"
        case .deleteForever: "Delete permanently…"
        case .useTemplate: "New page from template"
        case .editTemplate: "Edit template"
        }
    }

    public func symbol(of action: RowAction) -> String {
        switch action {
        case .open, .editTemplate: "arrow.up.forward.square"
        case .openInNewTab: "plus.rectangle.on.rectangle"
        case .star: "star"
        case .unstar: "star.slash"
        case .move: "folder"
        case .duplicate: "plus.square.on.square"
        case .copyTo: "square.on.square.dashed"
        case .archive: "archivebox"
        case .unarchive: "tray.and.arrow.up"
        case .select, .deselect: "checkmark.circle"
        case .moveUp: "arrow.up"
        case .moveDown: "arrow.down"
        case .trash, .deleteForever: "trash"
        case .restore: "arrow.uturn.backward"
        case .useTemplate: "doc.badge.plus"
        }
    }

    public func isDestructive(_ action: RowAction) -> Bool { action == .trash || action == .deleteForever }

    /// Runs a row action. Opening is the screen's job (it knows the card's frame); everything else is here.
    public func run(_ action: RowAction, on row: NoteRow) async {
        let ids = [row.id]
        switch action {
        case .open, .openInNewTab, .editTemplate: break
        case .star: await actions.star(ids, true)
        case .unstar: await actions.star(ids, false)
        case .move: moving = ids
        case .duplicate: await actions.duplicate(row.id)
        case .copyTo(let space):
            if let s = copyTargets.first(where: { $0.id == space }) { await actions.copy(ids, to: s) }
        case .archive: await actions.archive(ids, true)
        case .unarchive: await actions.archive(ids, false, leavesList: kind.view == .archive)
        case .select:
            selecting = true
            selection.insert(row.id)
        case .deselect: selection.remove(row.id)
        case .moveUp: await nudge(row.id, -1)
        case .moveDown: await nudge(row.id, 1)
        case .trash: await actions.trash(ids)
        case .restore: await actions.restore(ids)
        case .deleteForever: confirmation = .deleteForever(ids)
        case .useTemplate: _ = await actions.create(folderId: nil, templateId: row.id, title: row.title)
        }
    }

    // MARK: Swipes (list rows): right to star, left to trash, archive or move; Trash: restore, delete.

    public func leadingSwipes(_ row: NoteRow) -> [RowAction] {
        if isTrash { return [.restore] }
        if row.kind == "template" { return [] }
        return [actions.isStarred(row) ? .unstar : .star]
    }

    public func trailingSwipes(_ row: NoteRow) -> [RowAction] {
        if isTrash { return [.deleteForever] }
        var out: [RowAction] = [.trash, row.archived ? .unarchive : .archive]
        if canEdit && row.kind != "template" { out.append(.move) }
        return out
    }

    // MARK: Select mode

    public var selectedIds: [String] {
        // In list order, so moves and Undo keep it.
        let order = store.state.order
        let picked = order.filter { selection.contains($0) }
        return picked + selection.subtracting(picked).sorted()
    }

    public var allSelected: Bool {
        let shown = slots.compactMap(\.row?.id)
        return !shown.isEmpty && shown.allSatisfy { selection.contains($0) }
    }

    public func toggleSelectAll() {
        if allSelected { selection.removeAll() } else { selection = Set(slots.compactMap(\.row?.id)) }
    }

    public func toggle(_ id: String) {
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    public var bulkActions: [BulkAction] {
        if isTrash { return [.restore, .deleteForever] }
        let rows = loadedRows.filter { selection.contains($0.id) }
        let allStarred = !rows.isEmpty && rows.allSatisfy { actions.isStarred($0) }
        let allArchived = !rows.isEmpty && rows.allSatisfy(\.archived)
        var out: [BulkAction] = []
        if canEdit { out.append(.move) }
        if !copyTargets.isEmpty { out.append(.copy) }
        out.append(allStarred ? .unstar : .star)
        out.append(allArchived ? .unarchive : .archive)
        out.append(.trash)
        return out
    }

    public var selectionStatus: String {
        selection.isEmpty ? "Select notes" : "\(selection.count.formatted()) selected"
    }

    public func runBulk(_ action: BulkAction, copyTo space: SpaceInfo? = nil) async {
        let ids = selectedIds
        guard !ids.isEmpty else { return }
        switch action {
        case .move:
            moving = ids
            return
        case .copy:
            if let space { await actions.copy(ids, to: space) }
        case .star: await actions.star(ids, true)
        case .unstar: await actions.star(ids, false)
        case .archive: await actions.archive(ids, true)
        case .unarchive: await actions.archive(ids, false, leavesList: kind.view == .archive)
        case .trash: await actions.trash(ids)
        case .restore: await actions.restore(ids)
        case .deleteForever:
            confirmation = .deleteForever(ids)
            return
        }
        selecting = false
    }

    /// The move sheet picked a folder.
    public func move(_ ids: [String], to target: FolderTarget) async {
        moving = nil
        var from: [String: String?] = [:]
        for row in store.rows where ids.contains(row.id) { from[row.id] = row.folder?.id }
        let leaves = (kind.view == .folder && target.id != kind.folderId) || (kind.view == .unsorted && target.id != nil)
        selecting = false
        await actions.move(ids, to: target, from: from, leavesList: leaves)
    }

    public func confirm(_ c: ListConfirmation) async {
        confirmation = nil
        switch c {
        case .deleteForever(let ids):
            selecting = false
            await actions.deleteForever(ids)
        case .emptyTrash:
            await actions.emptyTrash()
        }
    }

    public func confirmationText(_ c: ListConfirmation) -> (title: String, message: String, button: String) {
        switch c {
        case .deleteForever(let ids):
            return (ids.count == 1 ? "Delete permanently?" : "Delete \(notesText(ids.count)) permanently?",
                    "They’ll be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone. Notes you don’t have permission to delete stay in Trash.",
                    "Delete permanently")
        case .emptyTrash(let n):
            return ("Empty Trash?",
                    "\(notesText(n)) will be deleted for everyone, with their nested pages, attachments and version history. This can’t be undone.",
                    "Delete permanently")
        }
    }

    // MARK: Manual order

    private func nudge(_ id: String, _ delta: Int) async {
        let order = store.state.order
        guard let i = order.firstIndex(of: id) else { return }
        let j = i + delta
        guard j >= 0, j < order.count else { return }
        var next = order
        next.remove(at: i)
        next.insert(id, at: j)
        await actions.reorder(id, after: j > 0 ? next[j - 1] : nil, view: kind.view, folderId: kind.folderId)
    }

    /// A drag in manual order moved rows (positions in `slots`) to `destination`.
    public func reorder(from source: IndexSet, to destination: Int) async {
        let ids = slots.map(\.id)
        guard let first = source.first, first < ids.count else { return }
        var next = ids
        let moved = source.map { ids[$0] }
        for i in source.sorted(by: >) { next.remove(at: i) }
        let insertAt = destination - source.filter { $0 < destination }.count
        next.insert(contentsOf: moved, at: max(0, min(insertAt, next.count)))
        for id in moved where !id.hasPrefix("#") {
            guard let at = next.firstIndex(of: id) else { continue }
            await actions.reorder(id, after: at > 0 ? next[at - 1] : nil, view: kind.view, folderId: kind.folderId)
        }
    }

    // MARK: The screen's "…" menu

    public enum ScreenAction: Hashable, Sendable { case newNote, newFolderInside, newTemplate, generateTemplate, emptyTrash, refresh }

    public var screenActions: [ScreenAction] {
        var out: [ScreenAction] = []
        if kind.view == .folder && canEdit {
            out.append(.newNote)
            if let id = kind.folderId, FolderRules.canNest(folderLinks, in: id) { out.append(.newFolderInside) }
        }
        if kind.view == .all && canEdit { out.append(.newNote) }
        if kind.view == .templates && canEdit {
            out.append(.newTemplate)
            if session.value?.capabilities.ai == true && session.value?.online != false { out.append(.generateTemplate) }
        }
        if isTrash && total > 0 { out.append(.emptyTrash) }
        return out
    }

    // MARK: Empty states (the web's EMPTY table)

    public var empty: (symbol: String, title: String, message: String) {
        switch kind.view {
        case .all: ("doc.on.doc", "Nothing here yet", "Starting a document takes one keystroke.")
        case .starred: ("star", "Nothing starred yet", "Star a note to keep it close at hand.")
        case .archive: ("archivebox", "Archive is empty", "Archived notes rest here, out of your lists but never lost.")
        case .trash: ("trash", "Trash is empty", "Deleted notes stay here for 30 days.")
        case .templates: ("rectangle.on.rectangle", "No templates of your own yet", (builtIns?.value?.templates.isEmpty == false) ? "Save any note as a template from its menu, or start from a built-in one above." : "Save any document as a template from its menu.")
        case .unsorted: ("tray", "No drafts", "Everything has a folder. Nicely done.")
        case .folder:
            subfolders.isEmpty
                ? ("folder", "This folder is empty", "Start a document here, or move one in with Move to folder.")
                : ("folder", "No notes directly in this folder yet", "The folders above hold the rest.")
        case .tag: ("number", "No documents carry this tag yet", "Add tags to a document from its Info panel.")
        }
    }

    public var emptyOffersNewNote: Bool { (kind.view == .all || kind.view == .folder) && canEdit }

    public var filterEmptyTitle: String { "No notes match “\(filter.trimmingCharacters(in: .whitespacesAndNewlines))”" }
}
