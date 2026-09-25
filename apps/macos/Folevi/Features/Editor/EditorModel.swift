import AppKit
import Observation
import SwiftUI

enum Caret: Equatable {
    case start, end, selectAll
    case offset(Int)
    case range(Int, Int)
}

struct FocusRequest: Equatable {
    var blockId: String
    var caret: Caret
    var id = UUID()
}

struct EditorRow: Identifiable, Equatable {
    var id: String
    var block: Block
    var depth: Int
    var number: Int?
    var hasChildren: Bool
}

struct SlashItem: Identifiable, Equatable {
    var id: String
    var title: LocalizedStringKey
    var searchText: String
    var systemImage: String
    var shortcut: String?

    static func == (a: SlashItem, b: SlashItem) -> Bool { a.id == b.id }

    /// The title as a plain string (drag chips, announcements).
    var plainTitle: String {
        switch id {
        case "paragraph": return String(localized: "Text")
        case "heading1": return String(localized: "Heading 1")
        case "heading2": return String(localized: "Heading 2")
        case "heading3": return String(localized: "Heading 3")
        case "todo": return String(localized: "To-do")
        case "bulleted": return String(localized: "Bulleted List")
        case "numbered": return String(localized: "Numbered List")
        case "toggle": return String(localized: "Toggle")
        case "quote": return String(localized: "Quote")
        case "callout": return String(localized: "Callout")
        case "divider": return String(localized: "Divider")
        case "code": return String(localized: "Code")
        case "table": return String(localized: "Table")
        case "image": return String(localized: "Image")
        case "file": return String(localized: "File")
        case "page": return String(localized: "New Page")
        case "pagelink": return String(localized: "Link to Page")
        case "bookmark": return String(localized: "Bookmark")
        default: return String(localized: "Today's Date")
        }
    }

    static var all: [SlashItem] { [
        SlashItem(id: "paragraph", title: "Text", searchText: "text paragraph plain", systemImage: "text.alignleft", shortcut: "⌥⌘0"),
        SlashItem(id: "heading1", title: "Heading 1", searchText: "heading 1 h1 title", systemImage: "textformat.size.larger", shortcut: "#"),
        SlashItem(id: "heading2", title: "Heading 2", searchText: "heading 2 h2 subtitle", systemImage: "textformat.size", shortcut: "##"),
        SlashItem(id: "heading3", title: "Heading 3", searchText: "heading 3 h3", systemImage: "textformat.size.smaller", shortcut: "###"),
        SlashItem(id: "todo", title: "To-do", searchText: "todo task checkbox check", systemImage: "checkmark.square", shortcut: "[]"),
        SlashItem(id: "bulleted", title: "Bulleted List", searchText: "bullet bulleted list unordered", systemImage: "list.bullet", shortcut: "-"),
        SlashItem(id: "numbered", title: "Numbered List", searchText: "numbered ordered list 1.", systemImage: "list.number", shortcut: "1."),
        SlashItem(id: "toggle", title: "Toggle", searchText: "toggle disclosure collapse", systemImage: "chevron.right.square", shortcut: nil),
        SlashItem(id: "quote", title: "Quote", searchText: "quote blockquote", systemImage: "text.quote", shortcut: ">"),
        SlashItem(id: "callout", title: "Callout", searchText: "callout note info warning", systemImage: "exclamationmark.bubble", shortcut: nil),
        SlashItem(id: "divider", title: "Divider", searchText: "divider line separator rule hr", systemImage: "minus", shortcut: "---"),
        SlashItem(id: "code", title: "Code", searchText: "code snippet pre", systemImage: "chevron.left.forwardslash.chevron.right", shortcut: "```"),
        SlashItem(id: "table", title: "Table", searchText: "table grid rows columns", systemImage: "tablecells", shortcut: nil),
        SlashItem(id: "image", title: "Image", searchText: "image picture photo", systemImage: "photo", shortcut: nil),
        SlashItem(id: "file", title: "File", searchText: "file attachment pdf", systemImage: "paperclip", shortcut: nil),
        SlashItem(id: "page", title: "New Page", searchText: "page subpage nested document", systemImage: "doc.badge.plus", shortcut: nil),
        SlashItem(id: "pagelink", title: "Link to Page", searchText: "link page mention [[", systemImage: "link", shortcut: "[["),
        SlashItem(id: "bookmark", title: "Bookmark", searchText: "bookmark url web link embed", systemImage: "bookmark", shortcut: nil),
        SlashItem(id: "date", title: "Today's Date", searchText: "date today", systemImage: "calendar", shortcut: nil),
    ] }
}

struct PopupState: Equatable {
    enum Kind { case slash, pageLink }
    var kind: Kind
    var blockId: String
    var anchor: Int
    var query = ""
    var selectedIndex = 0
}

struct PageChoice: Identifiable, Equatable {
    var id: String
    var title: String
    var icon: String?
    var isCreate: Bool
}

/// State and operations for one open document. Every edit updates the local model immediately, then
/// flows through a serial queue into the SyncEngine (SQLite + reducer + durable op log).
@MainActor
@Observable
final class EditorModel {
    enum LoadState: Equatable { case loading, ready, unavailable(String) }

    let documentId: String
    let app: AppModel

    var document: DocumentSummary?
    var detail: DocumentDetail?
    var blocks: [String: Block] = [:]
    var rows: [EditorRow] = []
    var loadState: LoadState = .loading
    var focus: FocusRequest?
    var focusedBlockId: String?
    var selectedBlockIds: Set<String> = []
    var selectionAnchor: String?
    var popup: PopupState?
    var activeMarks: Set<String> = []
    var findQuery = "" { didSet { updateFind() } }
    var findMatches: [String] = []
    var findIndex = 0
    var titleDraft = ""
    var pendingBookmarkBlock: String?
    var showLinkPrompt = false
    var linkDraft = ""
    var containerFocusToken = UUID()
    /// True once the editor holds the document's real content. No edit (and no diff) is ever sent
    /// before this — an unhydrated editor must never be mistaken for an empty document.
    private(set) var isHydrated = false
    /// Pointer-driven block drag and drop (and Insert-tile drags) for this document.
    @ObservationIgnored let drag = BlockDragController()

    @ObservationIgnored var undoManager: UndoManager?
    @ObservationIgnored var openDocumentHandler: ((String, Bool) -> Void)?
    @ObservationIgnored private var textViews: [String: WeakBox<BlockTextView>] = [:]
    @ObservationIgnored private var editContinuation: AsyncStream<EditBatch>.Continuation?
    @ObservationIgnored private var editTask: Task<Void, Never>?
    @ObservationIgnored private var inFlightLocal: [String: Int] = [:]
    /// Incremented for every local edit batch; a reload that raced with a local edit is discarded.
    @ObservationIgnored private var editSequence = 0
    /// The block state last handed to the sync engine. Structural operations mutate `blocks` while
    /// computing ranks, so diffs (changed fields) and Undo snapshots are taken against this instead.
    @ObservationIgnored private var committed: [String: Block] = [:]
    @ObservationIgnored private var titleTask: Task<Void, Never>?
    /// A local title not yet reflected in the document list; stale list updates must not revert it.
    @ObservationIgnored private var pendingTitle: String?
    @ObservationIgnored private var snapshotTask: Task<Void, Never>?
    @ObservationIgnored private var ackObserver: NSObjectProtocol?
    @ObservationIgnored private var hadAckedEdits = false
    @ObservationIgnored private var reloadTask: Task<Void, Never>?

    struct EditBatch: Sendable {
        var upserts: [(WireBlock, [ChangedField])]
        var deletes: [String]
        var restores: [WireBlock]
    }

    init(documentId: String, app: AppModel) {
        self.documentId = documentId
        self.app = app
        startEditQueue()
        ackObserver = NotificationCenter.default.addObserver(forName: .foleviAcknowledged, object: nil, queue: .main) { [weak self] note in
            let docs = note.userInfo?["documents"] as? [String] ?? []
            MainActor.assumeIsolated {
                guard let self, docs.contains(self.documentId) else { return }
                self.hadAckedEdits = true
                self.scheduleIdleSnapshot()
            }
        }
    }

    // MARK: Derived

    var isReadOnly: Bool {
        if app.readOnlyMode { return true }
        if case .unavailable = loadState { return true }
        if let detail, !detail.canWrite { return true }
        if document?.deletedAt != nil { return true }
        return false
    }

    var style: DocumentStyle { document?.style ?? defaultDocumentStyle }

    var conflicts: [ConflictRecord] { app.sync.conflicts.filter { $0.documentId == documentId } }

    var liveWire: [WireBlock] { blocks.values.map(\.wire) }

    // MARK: Loading

    func load() async {
        guard let session = app.session else {
            loadState = .unavailable(String(localized: "Sign in to open this document."))
            return
        }
        document = app.document(documentId)
        if document == nil { document = await session.engine.document(documentId) }
        titleDraft = document?.title ?? ""
        var wires = await session.engine.blocks(documentId: documentId)
        if wires.isEmpty, !(await session.engine.hasLocalBlocks(documentId: documentId)) {
            if app.sync.isOnline, let remote: BlocksListResponse = try? await session.convex.query("blocks:list", ["documentId": .string(documentId)]) {
                await session.engine.ingestRemote(documentId: documentId, blocks: remote.blocks)
                wires = await session.engine.blocks(documentId: documentId)
            } else if document == nil {
                loadState = .unavailable(String(localized: "This document isn't on this Mac yet. Connect to the internet to open it."))
                return
            }
        }
        setBlocks(wires)
        isHydrated = true
        loadState = .ready
        if rows.isEmpty == false, focus == nil, document?.title.isEmpty == true {
            focus = FocusRequest(blockId: "__title__", caret: .end)
        }
        Task { await loadDetail() }
    }

    func loadDetail() async {
        guard let session = app.session, app.sync.isOnline else { return }
        if let d = try? await session.documents.get(documentId) {
            detail = d
            if document == nil { document = d.document }
        }
        try? await session.documents.recordView(documentId)
    }

    /// Server/other-window changes: reload from the engine, keeping blocks we are still sending.
    func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled else { return }
            await self?.reloadFromEngine()
        }
    }

    func reloadFromEngine() async {
        guard let session = app.session, loadState == .ready else { return }
        let sequenceBefore = editSequence
        let wires = await session.engine.blocks(documentId: documentId)
        guard sequenceBefore == editSequence else {
            // A local edit happened while we were reading; read again once it has been applied.
            scheduleReload()
            return
        }
        var next: [String: Block] = [:]
        for w in wires { next[w.id] = Block(wire: w) }
        for (id, count) in inFlightLocal where count > 0 {
            next[id] = blocks[id]
        }
        let structureChanged = Set(next.keys) != Set(blocks.keys)
            || next.contains { id, b in blocks[id].map { $0.parentId != b.parentId || $0.rank != b.rank || $0.content != b.content } ?? true }
        let textChanged = next.contains { id, b in blocks[id]?.text != b.text }
        guard structureChanged || textChanged else { return }
        blocks = next.compactMapValues { $0 }
        for (id, b) in blocks where (inFlightLocal[id] ?? 0) == 0 { committed[id] = b }
        for id in committed.keys where blocks[id] == nil && (inFlightLocal[id] ?? 0) == 0 { committed[id] = nil }
        rebuildRows()
    }

    func documentChanged() {
        if let d = app.document(documentId) {
            document = d
            // Our own rename is authoritative until the document list reflects it.
            if let pending = pendingTitle {
                if d.title == pending { pendingTitle = nil }
                document?.title = pending
                return
            }
            if titleTask == nil && focusedBlockId != "__title__" { titleDraft = d.title }
        }
    }

    private func setBlocks(_ wires: [WireBlock]) {
        var map: [String: Block] = [:]
        for w in wires { map[w.id] = Block(wire: w) }
        blocks = map
        committed = map
        rebuildRows()
    }

    func rebuildRows() {
        let all = Array(blocks.values)
        let flat = Tree.flatten(all)
        let children = Tree.childrenMap(all)
        var out: [EditorRow] = []
        var hiddenDepth: Int?
        var lastNumberAtDepth: [Int: (parent: String?, n: Int)] = [:]
        var prevTypeAtDepth: [Int: String] = [:]
        for entry in flat {
            if let hd = hiddenDepth {
                if entry.depth > hd { continue }
                hiddenDepth = nil
            }
            let b = entry.block
            var number: Int?
            if case .numbered = b.content {
                if let last = lastNumberAtDepth[entry.depth], last.parent == b.parentId, prevTypeAtDepth[entry.depth] == "numbered" {
                    number = last.n + 1
                } else {
                    number = 1
                }
                lastNumberAtDepth[entry.depth] = (b.parentId, number ?? 1)
            }
            prevTypeAtDepth[entry.depth] = b.typeName
            // Deeper levels restart when we return to a shallower block.
            for d in prevTypeAtDepth.keys where d > entry.depth { prevTypeAtDepth[d] = nil }
            let hasChildren = !(children[b.id] ?? []).isEmpty
            out.append(EditorRow(id: b.id, block: b, depth: entry.depth, number: number, hasChildren: hasChildren))
            if case .toggle(let p) = b.content, p.collapsed { hiddenDepth = entry.depth }
        }
        rows = out
        updateFind()
    }

    // MARK: Text view registry

    func register(_ view: BlockTextView, for blockId: String) {
        textViews[blockId] = WeakBox(view)
    }

    func unregister(_ view: BlockTextView, for blockId: String) {
        if textViews[blockId]?.value === view { textViews[blockId] = nil }
    }

    func textView(_ blockId: String) -> BlockTextView? { textViews[blockId]?.value }

    var focusedTextView: BlockTextView? {
        guard let id = focusedBlockId else { return nil }
        return textView(id)
    }

    /// Keep the caret's block visible (coalesced; the view scrolls with ScrollViewReader).
    var revealBlockId: String?
    @ObservationIgnored private var lastReveal: (id: String, at: Date)?

    func requestReveal(_ blockId: String) {
        guard blockId != "__title__" else { return }
        if let last = lastReveal, last.id == blockId, Date().timeIntervalSince(last.at) < 0.25 { return }
        lastReveal = (blockId, Date())
        revealBlockId = blockId
    }

    func consumeFocus(_ id: UUID) {
        if focus?.id == id { focus = nil }
    }

    // MARK: Edit queue

    private func startEditQueue() {
        let (stream, continuation) = AsyncStream<EditBatch>.makeStream()
        editContinuation = continuation
        editTask = Task { [weak self] in
            for await batch in stream {
                guard let engine = self?.app.session?.engine, let documentId = self?.documentId else { continue }
                await engine.applyLocal(documentId: documentId, upserts: batch.upserts, deletes: batch.deletes, restoring: batch.restores)
                self?.batchApplied(batch)
            }
        }
    }

    private func batchApplied(_ batch: EditBatch) {
        for id in batch.upserts.map(\.0.id) + batch.deletes + batch.restores.map(\.id) {
            inFlightLocal[id, default: 1] -= 1
            if inFlightLocal[id] ?? 0 <= 0 { inFlightLocal[id] = nil }
        }
    }

    private func send(_ batch: EditBatch) {
        editSequence += 1
        for id in batch.upserts.map(\.0.id) + batch.deletes + batch.restores.map(\.id) {
            inFlightLocal[id, default: 0] += 1
        }
        editContinuation?.yield(batch)
    }

    func close() {
        editContinuation?.finish()
        if let ackObserver { NotificationCenter.default.removeObserver(ackObserver) }
        snapshotTask?.cancel()
        if hadAckedEdits, let session = app.session, app.sync.isOnline {
            let id = documentId
            Task { try? await session.documents.createSnapshot(id, reason: "close") }
        }
    }

    private func scheduleIdleSnapshot() {
        snapshotTask?.cancel()
        let id = documentId
        snapshotTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(120))
            guard !Task.isCancelled, let session = self?.app.session else { return }
            try? await session.documents.createSnapshot(id, reason: "idle")
        }
    }

    // MARK: Commit (with structural undo)

    static func fields(old: Block?, new: Block) -> [ChangedField] {
        BlockDrop.changedFields(old: old, new: new)
    }

    /// Applies a structural change locally, queues it for sync and registers the inverse with Undo.
    func commit(upserts: [Block] = [], deletes: [String] = [], restores: [Block] = [], focus: FocusRequest? = nil,
                actionName: String? = nil, undoable: Bool = true, explicitDelete: Bool = false) {
        guard !isReadOnly, isHydrated, loadState == .ready else { return }
        // Safety net: never let a non-explicit edit delete most of a document.
        if !explicitDelete, deletes.count >= 5, Double(deletes.count) > Double(blocks.count) * 0.5 {
            Log.editor.fault("refused a structural edit deleting \(deletes.count, privacy: .public) of \(self.blocks.count, privacy: .public) blocks")
            return
        }
        let before = upserts.map { ($0.id, committed[$0.id]) }
        let deleted = deletes.compactMap { committed[$0] ?? blocks[$0] }
        var wires: [(WireBlock, [ChangedField])] = []
        for b in upserts {
            wires.append((b.wire, EditorModel.fields(old: committed[b.id], new: b)))
            blocks[b.id] = b
            committed[b.id] = b
        }
        for id in deletes {
            blocks[id] = nil
            committed[id] = nil
        }
        for b in restores {
            blocks[b.id] = b
            committed[b.id] = b
        }
        rebuildRows()
        send(EditBatch(upserts: wires, deletes: deletes, restores: restores.map(\.wire)))
        for id in upserts.map(\.id) + deletes {
            textView(id)?.resetUndo()
        }
        if undoable, let undoManager {
            let inverseUpserts = before.compactMap { $0.1 }
            let inverseDeletes = before.filter { $0.1 == nil }.map(\.0) + restores.map(\.id)
            let inverseRestores = deleted
            let refocus = focusedBlockId.map { FocusRequest(blockId: $0, caret: .end) }
            undoManager.registerUndo(withTarget: self) { model in
                MainActor.assumeIsolated {
                    model.commit(upserts: inverseUpserts, deletes: inverseDeletes, restores: inverseRestores,
                                 focus: refocus.flatMap { model.blocks[$0.blockId] != nil ? $0 : nil }, actionName: actionName,
                                 explicitDelete: true)
                }
            }
            if let actionName { undoManager.setActionName(actionName) }
        }
        if let focus { self.focus = focus }
    }

    // MARK: Text

    func textChanged(blockId: String, text: [InlineNode]) {
        if blockId == "__title__" { return }
        guard isHydrated, var block = blocks[blockId], block.text != text, !isReadOnly else { return }
        block.text = text
        blocks[blockId] = block
        committed[blockId] = block
        if let i = rows.firstIndex(where: { $0.id == blockId }) { rows[i].block = block }
        send(EditBatch(upserts: [(block.wire, [.content])], deletes: [], restores: []))
        updateFind()
    }

    func codeChanged(blockId: String, code: String) {
        guard isHydrated, var block = blocks[blockId], case .code(var p) = block.content, p.code != code, !isReadOnly else { return }
        p.code = code
        block.content = .code(p)
        blocks[blockId] = block
        committed[blockId] = block
        if let i = rows.firstIndex(where: { $0.id == blockId }) { rows[i].block = block }
        send(EditBatch(upserts: [(block.wire, [.content])], deletes: [], restores: []))
    }

    func plainChanged(blockId: String, text: String) {
        if blockId == "__title__" { setTitle(text) }
    }

    func setTitle(_ title: String) {
        guard isHydrated, title != titleDraft || title != document?.title else { return }
        titleDraft = title
        guard !isReadOnly else { return }
        pendingTitle = title
        titleTask?.cancel()
        titleTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, let self else { return }
            await self.app.updateDocument(self.documentId, patch: WireDocumentPatch(title: title))
            self.document?.title = title
            if !Task.isCancelled { self.titleTask = nil }
        }
    }

    func setIcon(_ icon: String?) {
        guard !isReadOnly else { return }
        document?.icon = icon
        Task { await app.updateDocument(documentId, patch: WireDocumentPatch(icon: .some(icon))) }
    }

    func setStyle(_ style: DocumentStyle) {
        guard !isReadOnly else { return }
        document?.style = style
        Task { await app.updateDocument(documentId, patch: WireDocumentPatch(style: style)) }
    }

    func setCover(_ cover: DocumentCover) {
        guard !isReadOnly else { return }
        document?.cover = cover
        Task { await app.updateDocument(documentId, patch: WireDocumentPatch(cover: cover)) }
    }

    /// Return in the title moves into the body (creating the first block if needed).
    func titleSubmitted() {
        if let first = rows.first(where: { $0.block.content.carriesText }) {
            focus = FocusRequest(blockId: first.id, caret: .start)
        } else {
            let b = Block(id: ULID.make(), parentId: nil, rank: Rank.betweenOrAfter(nil, rows.first?.block.rank), content: .paragraph(ParagraphProps()))
            commit(upserts: [b], focus: FocusRequest(blockId: b.id, caret: .start), actionName: String(localized: "Typing"))
        }
    }

    // MARK: Focus tracking

    func blockDidFocus(_ blockId: String) {
        focusedBlockId = blockId
        if !selectedBlockIds.isEmpty { selectedBlockIds = [] }
    }

    func blockDidBlur(_ blockId: String) {
        if popup?.blockId == blockId {
            // Keep popups while clicking inside them; they close on commit/escape.
        }
    }

    func selectionChanged(blockId: String, range: NSRange, view: BlockTextView) {
        let marks = view.activeMarks()
        if marks != activeMarks { activeMarks = marks }
        if let p = popup, p.blockId == blockId, range.location < p.anchor { popup = nil }
    }

    // MARK: Helpers

    func allNodes() -> [Block] { Array(blocks.values) }

    func siblings(of block: Block) -> [Block] {
        (Tree.childrenMap(allNodes())[block.parentId] ?? [])
    }

    func children(of id: String) -> [Block] {
        Tree.childrenMap(allNodes())[id] ?? []
    }

    func depth(of id: String) -> Int {
        var d = 0
        var cur = blocks[id]?.parentId
        while let c = cur, d < 64 {
            d += 1
            cur = blocks[c]?.parentId
        }
        return d
    }

    private func rank(parentId: String?, after afterId: String?, moving: String? = nil) -> String {
        (try? Tree.rankForPosition(allNodes(), parentId: parentId, afterId: afterId, movingId: moving))
            ?? Rank.betweenOrAfter(afterId.flatMap { blocks[$0]?.rank }, nil)
    }

    private func rowIndex(_ id: String) -> Int? { rows.firstIndex { $0.id == id } }

    private func previousTextRow(before id: String) -> EditorRow? {
        guard let i = rowIndex(id), i > 0 else { return nil }
        return rows[..<i].last { $0.block.content.carriesText || $0.block.typeName == "code" }
    }

    private func nextTextRow(after id: String) -> EditorRow? {
        guard let i = rowIndex(id), i + 1 < rows.count else { return nil }
        return rows[(i + 1)...].first { $0.block.content.carriesText || $0.block.typeName == "code" }
    }

    private func inlineLength(_ nodes: [InlineNode]) -> Int {
        InlineAttributedString.length(nodes)
    }

    // MARK: Key commands

    func handle(_ command: BlockKeyCommand, blockId: String) -> Bool {
        if blockId == "__title__" {
            switch command {
            case .split, .focusNext:
                titleSubmitted()
                return true
            default:
                return false
            }
        }
        guard !isReadOnly || isNavigation(command) else { return true }
        switch command {
        case .split(let left, let right, let atStart):
            split(blockId: blockId, left: left, right: right, atStart: atStart)
            return true
        case .backspaceAtStart:
            return backspaceAtStart(blockId)
        case .deleteForwardAtEnd:
            return mergeNext(into: blockId)
        case .indent:
            indent([blockId])
            return true
        case .outdent:
            outdent([blockId])
            return true
        case .focusPrevious(let atEnd):
            if let prev = previousTextRow(before: blockId) {
                focus = FocusRequest(blockId: prev.id, caret: atEnd ? .end : .start)
                return true
            }
            focus = FocusRequest(blockId: "__title__", caret: .end)
            return true
        case .focusNext(let atStart):
            if let next = nextTextRow(after: blockId) {
                focus = FocusRequest(blockId: next.id, caret: atStart ? .start : .end)
                return true
            }
            return false
        case .moveBlock(let up):
            move([blockId], up: up)
            return true
        case .escape:
            if popup != nil {
                popup = nil
                return true
            }
            select(blockId, extend: false)
            return true
        case .selectBlockExtending(let up):
            select(blockId, extend: false)
            extendSelection(up: up)
            return true
        }
    }

    private func isNavigation(_ c: BlockKeyCommand) -> Bool {
        switch c {
        case .focusNext, .focusPrevious, .escape, .selectBlockExtending: return true
        default: return false
        }
    }

    private func split(blockId: String, left: [InlineNode], right: [InlineNode], atStart: Bool) {
        guard var block = blocks[blockId] else { return }
        let listLike: Bool = {
            switch block.content {
            case .bulleted, .numbered, .todo, .toggle, .quote, .callout: return true
            default: return false
            }
        }()
        // Return on an empty list item leaves the list (outdent first when nested).
        if left.isEmpty && right.isEmpty && listLike {
            if block.parentId != nil {
                outdent([blockId])
            } else {
                block.content = .paragraph(ParagraphProps())
                commit(upserts: [block], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "Turn Into Text"))
            }
            return
        }
        let newContent: BlockContent = {
            switch block.content {
            case .bulleted: return .bulleted(BulletedProps())
            case .numbered: return .numbered(NumberedProps())
            case .todo: return .todo(TodoProps(checked: false))
            default: return .paragraph(ParagraphProps())
            }
        }()
        if atStart {
            // Caret at the start of a non-empty block: open an empty block above.
            let siblings = self.siblings(of: block)
            let idx = siblings.firstIndex { $0.id == blockId } ?? 0
            let prevId = idx > 0 ? siblings[idx - 1].id : nil
            let newBlock = Block(id: ULID.make(), parentId: block.parentId, rank: rank(parentId: block.parentId, after: prevId), content: newContent)
            commit(upserts: [newBlock], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "New Block"))
            return
        }
        block.text = left
        var parentId = block.parentId
        var afterId: String? = blockId
        if case .toggle(let p) = block.content, !p.collapsed {
            // New block goes inside an expanded toggle, as its first child.
            parentId = blockId
            afterId = nil
        } else if !children(of: blockId).isEmpty {
            parentId = blockId
            afterId = nil
        }
        var newBlock = Block(id: ULID.make(), parentId: parentId, rank: "V", text: right, content: newContent)
        blocks[blockId] = block
        newBlock.rank = rank(parentId: parentId, after: afterId)
        commit(upserts: [block, newBlock], focus: FocusRequest(blockId: newBlock.id, caret: .start), actionName: String(localized: "New Block"))
    }

    private func backspaceAtStart(_ blockId: String) -> Bool {
        guard var block = blocks[blockId] else { return false }
        switch block.content {
        case .paragraph:
            break
        case .code:
            if case .code(let p) = block.content, p.code.isEmpty {
                block.content = .paragraph(ParagraphProps())
                commit(upserts: [block], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "Turn Into Text"))
                return true
            }
            return false
        default:
            if block.content.carriesText {
                block.content = .paragraph(ParagraphProps())
                commit(upserts: [block], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "Turn Into Text"))
                return true
            }
        }
        if block.parentId != nil {
            outdent([blockId])
            return true
        }
        guard let i = rowIndex(blockId), i > 0 else { return true }
        let prev = rows[i - 1].block
        if prev.content.carriesText {
            var merged = prev
            let offset = inlineLength(prev.text)
            merged.text = RichText.normalizeInline(prev.text + block.text)
            // Children of the removed block move under the merged block.
            var upserts = [merged]
            let lastChild = children(of: prev.id).last?.id
            var after = lastChild
            for child in children(of: blockId) {
                var c = child
                c.parentId = prev.id
                blocks[c.id] = c
                c.rank = rank(parentId: prev.id, after: after, moving: c.id)
                blocks[c.id] = c
                upserts.append(c)
                after = c.id
            }
            commit(upserts: upserts, deletes: [blockId], focus: FocusRequest(blockId: prev.id, caret: .offset(offset)), actionName: String(localized: "Merge Blocks"))
        } else if block.text.isEmpty {
            commit(deletes: [blockId], actionName: String(localized: "Delete Block"))
            select(prev.id, extend: false)
        } else {
            select(prev.id, extend: false)
        }
        return true
    }

    private func mergeNext(into blockId: String) -> Bool {
        guard let block = blocks[blockId], let i = rowIndex(blockId), i + 1 < rows.count else { return false }
        let next = rows[i + 1].block
        guard next.content.carriesText, next.parentId == block.parentId || next.parentId == blockId else { return false }
        var merged = block
        let offset = inlineLength(block.text)
        merged.text = RichText.normalizeInline(block.text + next.text)
        var upserts = [merged]
        var after = children(of: blockId).filter { $0.id != next.id }.last?.id
        for child in children(of: next.id) {
            var c = child
            c.parentId = blockId
            c.rank = rank(parentId: blockId, after: after, moving: c.id)
            blocks[c.id] = c
            upserts.append(c)
            after = c.id
        }
        commit(upserts: upserts, deletes: [next.id], focus: FocusRequest(blockId: blockId, caret: .offset(offset)), actionName: String(localized: "Merge Blocks"))
        return true
    }

    // MARK: Structure

    func indent(_ ids: [String]) {
        var upserts: [Block] = []
        for id in orderedByRows(ids) {
            guard var block = blocks[id] else { continue }
            let sibs = siblings(of: block)
            guard let idx = sibs.firstIndex(where: { $0.id == id }), idx > 0 else { continue }
            let newParent = sibs[idx - 1]
            guard depth(of: newParent.id) + 1 <= FoleviLimits.maxDepth else { continue }
            let lastChild = children(of: newParent.id).last?.id
            block.parentId = newParent.id
            block.rank = rank(parentId: newParent.id, after: lastChild, moving: id)
            blocks[id] = block
            upserts.append(block)
            if case .toggle(var p) = newParent.content, p.collapsed {
                p.collapsed = false
                var np = newParent
                np.content = .toggle(p)
                blocks[np.id] = np
                upserts.append(np)
            }
        }
        guard !upserts.isEmpty else {
            NSSound.beep()
            return
        }
        commit(upserts: upserts, focus: focusedBlockId.map { FocusRequest(blockId: $0, caret: .end) }, actionName: String(localized: "Indent"))
        restoreCaretAfterStructure()
    }

    func outdent(_ ids: [String]) {
        var upserts: [Block] = []
        for id in orderedByRows(ids).reversed() {
            guard var block = blocks[id], let parentId = block.parentId, let parent = blocks[parentId] else { continue }
            // Following siblings become this block's children (outliner behavior).
            let sibs = siblings(of: block)
            let idx = sibs.firstIndex { $0.id == id } ?? 0
            let following = Array(sibs.dropFirst(idx + 1))
            block.parentId = parent.parentId
            block.rank = rank(parentId: parent.parentId, after: parent.id, moving: id)
            blocks[id] = block
            upserts.append(block)
            var after = children(of: id).last?.id
            for f in following {
                var c = f
                c.parentId = id
                c.rank = rank(parentId: id, after: after, moving: c.id)
                blocks[c.id] = c
                upserts.append(c)
                after = c.id
            }
        }
        guard !upserts.isEmpty else {
            NSSound.beep()
            return
        }
        commit(upserts: upserts, actionName: String(localized: "Outdent"))
        restoreCaretAfterStructure()
    }

    private func restoreCaretAfterStructure() {
        if let id = focusedBlockId, let tv = textView(id) {
            focus = FocusRequest(blockId: id, caret: .offset(tv.selectedRange().location))
        }
    }

    func move(_ ids: [String], up: Bool) {
        let ordered = orderedByRows(ids)
        guard let first = ordered.first, let block = blocks[first] else { return }
        let sibs = siblings(of: block).filter { !ordered.contains($0.id) || $0.id == first }
        guard let idx = sibs.firstIndex(where: { $0.id == first }) else { return }
        var targetParent = block.parentId
        var afterId: String?
        if up {
            if idx > 0 {
                afterId = idx >= 2 ? sibs[idx - 2].id : nil
            } else if let parentId = block.parentId, let parent = blocks[parentId] {
                targetParent = parent.parentId
                let psibs = siblings(of: parent)
                let pidx = psibs.firstIndex { $0.id == parentId } ?? 0
                afterId = pidx > 0 ? psibs[pidx - 1].id : nil
            } else {
                NSSound.beep()
                return
            }
        } else {
            let lastId = ordered.last ?? first
            let lastIdx = sibs.firstIndex { $0.id == lastId } ?? idx
            if lastIdx + 1 < sibs.count {
                afterId = sibs[lastIdx + 1].id
            } else if let parentId = block.parentId, let parent = blocks[parentId] {
                targetParent = parent.parentId
                afterId = parent.id
            } else {
                NSSound.beep()
                return
            }
        }
        place(ordered, parentId: targetParent, after: afterId, actionName: up ? String(localized: "Move Up") : String(localized: "Move Down"))
    }

    /// Moves blocks (keeping their subtrees) under `parentId` after `afterId`, as one undo step. The
    /// moved blocks change parent/rank only, so they sync as position changes.
    @discardableResult
    func place(_ ids: [String], parentId: String?, after afterId: String?, actionName: String) -> Bool {
        guard let positions = BlockDrop.positions(allNodes(), moving: ids, to: BlockDrop.Placement(parentId: parentId, afterId: afterId)) else {
            // Refuse to move a block into its own subtree.
            NSSound.beep()
            return false
        }
        var upserts: [Block] = []
        for id in ids {
            guard var b = blocks[id], let pos = positions[id] else { continue }
            b.parentId = pos.parentId
            b.rank = pos.rank
            upserts.append(b)
        }
        // A collapsed toggle that receives blocks opens, so the moved blocks stay visible.
        if let parentId, var parent = blocks[parentId], case .toggle(var p) = parent.content, p.collapsed {
            p.collapsed = false
            parent.content = .toggle(p)
            upserts.append(parent)
        }
        guard !upserts.isEmpty else { return false }
        commit(upserts: upserts, actionName: actionName)
        restoreCaretAfterStructure()
        return true
    }

    /// Drag and drop: move the dragged root blocks (with their children) to a drop placement.
    @discardableResult
    func dropBlocks(_ roots: [String], at placement: BlockDrop.Placement) -> Bool {
        let ordered = orderedByRows(roots)
        guard !ordered.isEmpty, !isReadOnly else { return false }
        return place(ordered, parentId: placement.parentId, after: placement.afterId, actionName: String(localized: "Move Blocks"))
    }

    /// Insert tile dropped into the page: a new block of `type` at the drop placement.
    func insertBlock(type: String, at placement: BlockDrop.Placement) -> String? {
        guard !isReadOnly else { return nil }
        switch type {
        case "image", "file", "page", "pagelink", "bookmark", "date":
            // These need a picker or a text caret: anchor on the block before the drop line.
            let anchor = placement.afterId ?? placement.parentId ?? rows.first?.id
            if let anchor { performSlashOrInsert(type, anchor: anchor) } else { insertBlock(type: type) }
            return nil
        default:
            var b = Block(id: ULID.make(), parentId: placement.parentId, rank: "V", content: BlockContent.defaultContent(for: type))
            b.rank = rank(parentId: placement.parentId, after: placement.afterId)
            var upserts = [b]
            if let parentId = placement.parentId, var parent = blocks[parentId], case .toggle(var p) = parent.content, p.collapsed {
                p.collapsed = false
                parent.content = .toggle(p)
                upserts.append(parent)
            }
            let focus = b.content.carriesText || b.typeName == "code" ? FocusRequest(blockId: b.id, caret: .start) : nil
            commit(upserts: upserts, focus: focus, actionName: String(localized: "Insert Block"))
            return b.id
        }
    }

    /// Visible rows for the drag planner.
    var dropRows: [BlockDrop.Row] {
        rows.map { BlockDrop.Row(id: $0.id, depth: $0.depth, parentId: $0.block.parentId) }
    }

    func orderedByRows(_ ids: [String]) -> [String] {
        let set = Set(ids)
        var ordered = rows.map(\.id).filter { set.contains($0) }
        for id in ids where !ordered.contains(id) { ordered.append(id) }
        return ordered
    }

    func delete(_ ids: [String]) {
        var all: [String] = []
        for id in orderedByRows(ids) {
            all.append(id)
            all += Tree.descendantIds(allNodes(), rootId: id)
        }
        var seen = Set<String>()
        all = all.filter { seen.insert($0).inserted }
        let firstIdx = rows.firstIndex { all.contains($0.id) } ?? 0
        commit(deletes: all, actionName: String(localized: "Delete"), explicitDelete: true)
        selectedBlockIds = []
        let remaining = rows
        if let target = remaining.indices.contains(firstIdx - 1) ? remaining[firstIdx - 1] : remaining.first {
            if target.block.content.carriesText {
                focus = FocusRequest(blockId: target.id, caret: .end)
            } else {
                select(target.id, extend: false)
            }
        }
    }

    func duplicate(_ ids: [String]) {
        var upserts: [Block] = []
        var lastInserted: String?
        for id in orderedByRows(ids) {
            guard let original = blocks[id] else { continue }
            let subtree = [id] + Tree.descendantIds(allNodes(), rootId: id)
            var idMap: [String: String] = [:]
            for sid in subtree { idMap[sid] = ULID.make() }
            for sid in subtree {
                guard var copy = blocks[sid] else { continue }
                copy.id = idMap[sid] ?? ULID.make()
                copy.revision = nil
                if sid == id {
                    copy.parentId = original.parentId
                    copy.rank = rank(parentId: original.parentId, after: lastInserted ?? id)
                    lastInserted = copy.id
                } else {
                    copy.parentId = copy.parentId.flatMap { idMap[$0] }
                }
                blocks[copy.id] = copy
                upserts.append(copy)
            }
        }
        guard !upserts.isEmpty else { return }
        commit(upserts: upserts, actionName: String(localized: "Duplicate"))
    }

    // MARK: Conversion

    /// Turn Into: keeps text where possible.
    func turnInto(_ type: String, ids: [String]? = nil) {
        let targets = ids ?? (selectedBlockIds.isEmpty ? focusedBlockId.map { [$0] } ?? [] : Array(selectedBlockIds))
        var upserts: [Block] = []
        var extra: [Block] = []
        for id in orderedByRows(targets) {
            guard var b = blocks[id], !b.isUnknown else { continue }
            let plain = RichText.plainText(b.text)
            if case .code(let p) = b.content { b.text = RichText.text(p.code) }
            switch type {
            case "code":
                b.content = .code(CodeProps(language: "plaintext", code: plain))
                b.text = []
            case "divider":
                if b.text.isEmpty {
                    b.content = .divider(DividerProps())
                } else {
                    let d = Block(id: ULID.make(), parentId: b.parentId, rank: rank(parentId: b.parentId, after: nil), content: .divider(DividerProps()))
                    var divider = d
                    let sibs = siblings(of: b)
                    let idx = sibs.firstIndex { $0.id == id } ?? 0
                    divider.rank = rank(parentId: b.parentId, after: idx > 0 ? sibs[idx - 1].id : nil)
                    extra.append(divider)
                    continue
                }
            default:
                if b.typeName == type || (type.hasPrefix("heading") && b.typeName == "heading" && headingKey(b) == type) { continue }
                b.content = BlockContent.defaultContent(for: type)
            }
            upserts.append(b)
        }
        guard !(upserts.isEmpty && extra.isEmpty) else { return }
        let refocus = focusedBlockId.flatMap { id in blocks[id].map { _ in FocusRequest(blockId: id, caret: .offset(textView(id)?.selectedRange().location ?? 0)) } }
        commit(upserts: upserts + extra, focus: refocus, actionName: String(localized: "Turn Into"))
    }

    private func headingKey(_ b: Block) -> String {
        if case .heading(let h) = b.content { return "heading\(h.level.rawValue)" }
        return ""
    }

    /// Markdown shortcuts typed at the start of a block ("# ", "- ", "[] ", "> ", "---", "```"…).
    func markdownShortcut(prefix: String, blockId: String, rest: [InlineNode]) -> Bool {
        guard var b = blocks[blockId], !isReadOnly else { return false }
        guard case .paragraph = b.content else {
            // Only "# " style shortcuts on plain paragraphs.
            return false
        }
        let type: String
        switch prefix {
        case "#": type = "heading1"
        case "##": type = "heading2"
        case "###": type = "heading3"
        case "-", "*", "+": type = "bulleted"
        case "1.", "1)": type = "numbered"
        case "[]", "[ ]": type = "todo"
        case "[x]", "[X]": type = "todo-checked"
        case ">": type = "quote"
        case "---": type = "divider"
        case "```": type = "code"
        default: return false
        }
        switch type {
        case "divider":
            b.content = .divider(DividerProps())
            b.text = []
            let next = Block(id: ULID.make(), parentId: b.parentId, rank: rank(parentId: b.parentId, after: blockId), content: .paragraph(ParagraphProps()))
            blocks[blockId] = b
            var n = next
            n.rank = rank(parentId: b.parentId, after: blockId)
            commit(upserts: [b, n], focus: FocusRequest(blockId: n.id, caret: .start), actionName: String(localized: "Divider"))
        case "code":
            b.content = .code(CodeProps(language: "plaintext", code: ""))
            b.text = []
            commit(upserts: [b], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "Code Block"))
        case "todo-checked":
            b.content = .todo(TodoProps(checked: true, completedAt: Date().timeIntervalSince1970 * 1000))
            b.text = rest
            commit(upserts: [b], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "To-do"))
        default:
            b.content = BlockContent.defaultContent(for: type)
            b.text = rest
            commit(upserts: [b], focus: FocusRequest(blockId: blockId, caret: .start), actionName: String(localized: "Turn Into"))
        }
        return true
    }

    // MARK: Popups (slash menu, page-link picker)

    func openSlash(blockId: String, at location: Int) {
        guard !isReadOnly else { return }
        popup = PopupState(kind: .slash, blockId: blockId, anchor: location)
    }

    func openPagePicker(blockId: String, at location: Int) {
        guard !isReadOnly else { return }
        popup = PopupState(kind: .pageLink, blockId: blockId, anchor: location)
    }

    func popupActive(for blockId: String) -> Bool {
        popup?.blockId == blockId
    }

    func popupTextChanged(blockId: String, text: String, caret: Int) {
        guard var p = popup, p.blockId == blockId else { return }
        let ns = text as NSString
        let start = p.kind == .slash ? p.anchor + 1 : p.anchor + 2
        guard caret >= start - (p.kind == .slash ? 0 : 1), p.anchor < ns.length else {
            popup = nil
            return
        }
        if p.kind == .slash, ns.substring(with: NSRange(location: p.anchor, length: 1)) != "/" {
            popup = nil
            return
        }
        let q = caret > start ? ns.substring(with: NSRange(location: start, length: caret - start)) : ""
        if p.kind == .slash && (q.contains(" ") && slashItems(for: q).isEmpty || q.count > 24) {
            popup = nil
            return
        }
        if p.kind == .pageLink && q.contains("]]") {
            popup = nil
            return
        }
        p.query = q
        p.selectedIndex = min(p.selectedIndex, max(0, popupCount(p) - 1))
        popup = p
    }

    func slashItems(for query: String) -> [SlashItem] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return SlashItem.all }
        return SlashItem.all.filter { $0.searchText.contains(q) || $0.id.contains(q) }
    }

    func pageChoices(for query: String) -> [PageChoice] {
        let q = SearchText.normalize(query)
        var out = app.documents
            .filter { $0.deletedAt == nil && $0.id != documentId && $0.kind != .collectionRow }
            .filter { q.isEmpty || SearchText.normalize($0.title).contains(q) }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(8)
            .map { PageChoice(id: $0.id, title: $0.displayTitle, icon: $0.icon, isCreate: false) }
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            out.append(PageChoice(id: "__create__", title: query, icon: nil, isCreate: true))
        }
        return out
    }

    private func popupCount(_ p: PopupState) -> Int {
        p.kind == .slash ? slashItems(for: p.query).count : pageChoices(for: p.query).count
    }

    func popupKey(_ key: BlockTextView.MenuKey) -> Bool {
        guard var p = popup else { return false }
        let count = popupCount(p)
        switch key {
        case .up:
            p.selectedIndex = count == 0 ? 0 : (p.selectedIndex - 1 + count) % count
            popup = p
        case .down:
            p.selectedIndex = count == 0 ? 0 : (p.selectedIndex + 1) % count
            popup = p
        case .cancel:
            popup = nil
        case .commit:
            if count == 0 {
                popup = nil
                return false
            }
            commitPopup(index: p.selectedIndex)
        }
        return true
    }

    func commitPopup(index: Int) {
        guard let p = popup else { return }
        popup = nil
        guard let tv = textView(p.blockId) else { return }
        let caret = tv.selectedRange().location
        let range = NSRange(location: p.anchor, length: max(0, caret - p.anchor))
        let style = currentTextStyle(for: p.blockId)
        switch p.kind {
        case .slash:
            let items = slashItems(for: p.query)
            guard items.indices.contains(index) else { return }
            tv.replace(range: range, with: [], style: style)
            performSlash(items[index].id, blockId: p.blockId, at: p.anchor)
        case .pageLink:
            let choices = pageChoices(for: p.query)
            guard choices.indices.contains(index) else { return }
            let choice = choices[index]
            if choice.isCreate {
                Task {
                    let title = choice.title
                    if let id = await app.createDocument(title: title, parentDocumentId: documentId) {
                        tv.replace(range: range, with: [.pageLink(documentId: id, label: title), .text(text: " ", marks: nil)], style: style)
                    }
                }
            } else {
                tv.replace(range: range, with: [.pageLink(documentId: choice.id, label: choice.title), .text(text: " ", marks: nil)], style: style)
            }
        }
    }

    func currentTextStyle(for blockId: String) -> BlockTextStyle {
        let scale = CGFloat(app.editorScale)
        guard let block = blocks[blockId] else { return BlockStyles.paragraph(style: style, scale: scale) }
        return BlockStyles.style(for: block, document: style, scale: scale)
    }

    func performSlash(_ id: String, blockId: String, at location: Int) {
        guard let block = blocks[blockId] else { return }
        let isEmpty = RichText.plainText(block.text).trimmingCharacters(in: .whitespaces).isEmpty
        switch id {
        case "image", "file":
            chooseFiles(kind: id, after: blockId, replace: isEmpty && block.typeName == "paragraph")
        case "page":
            Task {
                guard let newId = await app.createDocument(title: "", parentDocumentId: documentId) else { return }
                let page = Block(id: ULID.make(), parentId: block.parentId, rank: "V", content: .page(PageProps(documentId: newId, display: .card, titleCache: String(localized: "Untitled"))))
                insert(page, after: blockId, replacing: isEmpty && block.typeName == "paragraph")
                openDocumentHandler?(newId, false)
            }
        case "pagelink":
            if let tv = textView(blockId) {
                tv.insertText("[[", replacementRange: tv.selectedRange())
                popup = PopupState(kind: .pageLink, blockId: blockId, anchor: tv.selectedRange().location - 2)
            }
        case "bookmark":
            let b = Block(id: ULID.make(), parentId: block.parentId, rank: "V", content: .bookmark(BookmarkProps(url: "")))
            insert(b, after: blockId, replacing: isEmpty && block.typeName == "paragraph")
            pendingBookmarkBlock = b.id
        case "date":
            if let tv = textView(blockId) {
                tv.replace(range: tv.selectedRange(), with: [.date(date: TaskLogic.localDate()), .text(text: " ", marks: nil)], style: currentTextStyle(for: blockId))
            }
        case "table", "divider", "code":
            let content = BlockContent.defaultContent(for: id)
            if isEmpty && block.typeName == "paragraph" {
                var b = block
                b.content = content
                b.text = []
                var upserts = [b]
                var focusReq = FocusRequest(blockId: b.id, caret: .start)
                if id == "divider" || id == "table" {
                    let next = Block(id: ULID.make(), parentId: b.parentId, rank: rank(parentId: b.parentId, after: b.id), content: .paragraph(ParagraphProps()))
                    upserts.append(next)
                    focusReq = FocusRequest(blockId: next.id, caret: .start)
                }
                commit(upserts: upserts, focus: focusReq, actionName: String(localized: "Insert Block"))
            } else {
                let b = Block(id: ULID.make(), parentId: block.parentId, rank: "V", content: content)
                insert(b, after: blockId, replacing: false)
            }
        default:
            if isEmpty || block.content.carriesText {
                turnInto(id, ids: [blockId])
                focus = FocusRequest(blockId: blockId, caret: .end)
            }
        }
    }

    func insert(_ block: Block, after afterId: String?, replacing: Bool) {
        var b = block
        if replacing, let afterId, let old = blocks[afterId] {
            b.parentId = old.parentId
            b.rank = old.rank
            commit(upserts: [b], deletes: [afterId], focus: b.content.carriesText ? FocusRequest(blockId: b.id, caret: .start) : nil, actionName: String(localized: "Insert Block"))
            return
        }
        let parent = afterId.flatMap { blocks[$0]?.parentId }
        b.parentId = parent
        b.rank = rank(parentId: parent, after: afterId)
        commit(upserts: [b], focus: b.content.carriesText ? FocusRequest(blockId: b.id, caret: .start) : nil, actionName: String(localized: "Insert Block"))
    }

    /// Inserts a new block of a type after the focused block (Insert inspector / menus).
    func insertBlock(type: String) {
        let anchor = focusedBlockId.flatMap { blocks[$0] != nil ? $0 : nil } ?? selectedBlockIds.first ?? rows.last?.id
        if let anchor, let tv = textView(anchor) {
            _ = tv
        }
        if let anchor {
            performSlashOrInsert(type, anchor: anchor)
        } else {
            let b = Block(id: ULID.make(), parentId: nil, rank: "V", content: BlockContent.defaultContent(for: type))
            insert(b, after: nil, replacing: false)
        }
    }

    private func performSlashOrInsert(_ type: String, anchor: String) {
        switch type {
        case "image", "file", "page", "pagelink", "bookmark", "date":
            performSlash(type, blockId: anchor, at: 0)
        default:
            let content = BlockContent.defaultContent(for: type)
            let b = Block(id: ULID.make(), parentId: nil, rank: "V", content: content)
            insert(b, after: anchor, replacing: false)
        }
    }

    // MARK: Block props

    func update(_ blockId: String, actionName: String? = nil, undoable: Bool = true, _ change: (inout Block) -> Void) {
        guard var b = blocks[blockId] else { return }
        change(&b)
        guard b != blocks[blockId] else { return }
        commit(upserts: [b], actionName: actionName, undoable: undoable)
    }

    func toggleTodo(_ blockId: String) {
        update(blockId, actionName: String(localized: "Check Task")) { b in
            guard case .todo(var p) = b.content else { return }
            p.checked.toggle()
            p.completedAt = p.checked ? (Date().timeIntervalSince1970 * 1000).rounded() : nil
            b.content = .todo(p)
        }
    }

    func toggleCollapsed(_ blockId: String) {
        update(blockId, actionName: String(localized: "Toggle")) { b in
            guard case .toggle(var p) = b.content else { return }
            p.collapsed.toggle()
            b.content = .toggle(p)
        }
    }

    // MARK: Selection (block-level)

    func select(_ blockId: String, extend: Bool) {
        if extend, let anchor = selectionAnchor, let a = rowIndex(anchor), let b = rowIndex(blockId) {
            selectedBlockIds = Set(rows[min(a, b)...max(a, b)].map(\.id))
        } else {
            selectedBlockIds = [blockId]
            selectionAnchor = blockId
        }
        focusedBlockId = nil
        if let window = NSApp.keyWindow, window.firstResponder is BlockTextView {
            window.makeFirstResponder(nil)
        }
        containerFocusToken = UUID()
    }

    func extendSelection(up: Bool) {
        guard let anchor = selectionAnchor, let a = rowIndex(anchor) else { return }
        let indices = selectedBlockIds.compactMap(rowIndex)
        guard let lo = indices.min(), let hi = indices.max() else { return }
        var newLo = lo
        var newHi = hi
        if up {
            if hi > a { newHi = hi - 1 } else { newLo = max(0, lo - 1) }
        } else {
            if lo < a { newLo = lo + 1 } else { newHi = min(rows.count - 1, hi + 1) }
        }
        selectedBlockIds = Set(rows[newLo...newHi].map(\.id))
    }

    func moveSelection(up: Bool) {
        let indices = selectedBlockIds.compactMap(rowIndex)
        let current = up ? (indices.min() ?? 0) : (indices.max() ?? -1)
        let target = up ? max(0, current - 1) : min(rows.count - 1, current + 1)
        guard rows.indices.contains(target) else { return }
        select(rows[target].id, extend: false)
    }

    func editSelected() {
        guard let id = selectedBlockIds.first.flatMap({ orderedByRows(Array(selectedBlockIds)).first ?? $0 }) else { return }
        if blocks[id]?.content.carriesText == true || blocks[id]?.typeName == "code" {
            selectedBlockIds = []
            focus = FocusRequest(blockId: id, caret: .end)
        }
    }

    func clearSelection() {
        selectedBlockIds = []
    }

    /// Targets for Block menu commands: the block selection, or the focused block.
    var commandTargets: [String] {
        if !selectedBlockIds.isEmpty { return orderedByRows(Array(selectedBlockIds)) }
        if let f = focusedBlockId, blocks[f] != nil { return [f] }
        return []
    }

    // MARK: Formatting (menu / inspector)

    func toggleMark(_ mark: Mark) {
        guard let id = focusedBlockId, id != "__title__", let tv = textView(id), !isReadOnly, !tv.isCode else { return }
        tv.toggle(mark: mark, style: currentTextStyle(for: id))
        activeMarks = tv.activeMarks()
    }

    func setColor(_ color: TextColor?) {
        guard let id = focusedBlockId, let tv = textView(id), !isReadOnly else { return }
        if let color { tv.toggle(mark: .color(value: color), style: currentTextStyle(for: id)) } else { tv.removeMark(.foleviColor, style: currentTextStyle(for: id)) }
    }

    func setHighlight(_ color: HighlightColor?) {
        guard let id = focusedBlockId, let tv = textView(id), !isReadOnly else { return }
        if let color { tv.toggle(mark: .highlight(value: color), style: currentTextStyle(for: id)) } else { tv.removeMark(.foleviHighlight, style: currentTextStyle(for: id)) }
    }

    func clearFormatting() {
        guard let id = focusedBlockId, let tv = textView(id), !isReadOnly else { return }
        tv.clearFormatting(style: currentTextStyle(for: id))
    }

    func beginLink() {
        guard let id = focusedBlockId, let tv = textView(id), tv.selectedRange().length > 0 || tv.linkAtSelection() != nil else {
            NSSound.beep()
            return
        }
        linkDraft = tv.linkAtSelection() ?? ""
        showLinkPrompt = true
    }

    func applyLink(_ raw: String) {
        showLinkPrompt = false
        guard let id = focusedBlockId, let tv = textView(id) else { return }
        let style = currentTextStyle(for: id)
        if raw.trimmingCharacters(in: .whitespaces).isEmpty {
            tv.removeMark(.foleviLink, style: style)
        } else if let href = RichText.sanitizeHref(raw) {
            tv.toggle(mark: .link(href: href), style: style)
        } else {
            NSSound.beep()
        }
        focus = FocusRequest(blockId: id, caret: .offset(NSMaxRange(tv.selectedRange())))
    }

    // MARK: Files

    func chooseFiles(kind: String, after blockId: String?, replace: Bool) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        if kind == "image" { panel.allowedContentTypes = [.image] }
        panel.begin { [weak self] response in
            guard response == .OK else { return }
            let urls = panel.urls
            MainActor.assumeIsolated {
                self?.insertFiles(urls, after: blockId, replacing: replace)
            }
        }
    }

    /// Inserts image/file blocks for local files and queues their uploads (works offline).
    func insertFiles(_ urls: [URL], after afterId: String?, replacing: Bool = false) {
        guard let session = app.session, !isReadOnly else { return }
        var anchor = afterId ?? rows.last?.id
        var replaceId = replacing ? afterId : nil
        for url in urls {
            let isImage = UTTypeHelper.isImage(url)
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let content: BlockContent = isImage
                ? .image(ImageProps(alt: url.deletingPathExtension().lastPathComponent, caption: ""))
                : .file(FileProps(fileId: "", name: url.lastPathComponent, size: Double(size), mimeType: FilesRepository.mimeType(for: url)))
            var block = Block(id: ULID.make(), parentId: anchor.flatMap { blocks[$0]?.parentId }, rank: "V", content: content)
            if let r = replaceId, let old = blocks[r] {
                block.parentId = old.parentId
                block.rank = old.rank
                blocks[r] = nil
                commit(deletes: [r], undoable: false)
                replaceId = nil
            } else {
                block.rank = rank(parentId: block.parentId, after: anchor)
            }
            blocks[block.id] = block
            rebuildRows()
            anchor = block.id
            // The upsert is held back (blockedBy) until the file is uploaded and finalized.
            let wire = block.wire
            let docId = documentId
            let copyURL = url
            Task {
                do {
                    try await session.engine.queueUpload(fileURL: copyURL, documentId: docId, block: wire, kind: isImage ? "image" : "file")
                } catch {
                    self.app.showToast(String(localized: "That file couldn't be added."))
                }
            }
        }
    }

    // MARK: Find

    private func updateFind() {
        let q = SearchText.normalize(findQuery)
        guard !q.isEmpty else {
            if !findMatches.isEmpty { findMatches = [] }
            return
        }
        let matches = rows.filter { SearchText.normalize(SearchText.blockText($0.block.wire)).contains(q) }.map(\.id)
        if matches != findMatches {
            findMatches = matches
            findIndex = 0
        }
    }

    func findNext(backwards: Bool = false) {
        guard !findMatches.isEmpty else {
            NSSound.beep()
            return
        }
        findIndex = backwards ? (findIndex - 1 + findMatches.count) % findMatches.count : (findIndex + 1) % findMatches.count
        revealMatch()
    }

    func revealMatch() {
        guard findMatches.indices.contains(findIndex) else { return }
        let id = findMatches[findIndex]
        guard let block = blocks[id] else { return }
        let text = RichText.plainText(block.text) as NSString
        let r = text.range(of: findQuery, options: [.caseInsensitive, .diacriticInsensitive])
        if block.content.carriesText, r.location != NSNotFound {
            focus = FocusRequest(blockId: id, caret: .range(r.location, r.length))
        } else {
            select(id, extend: false)
        }
    }

    // MARK: Conflicts

    func resolve(_ conflict: ConflictRecord, _ choice: ConflictChoice) {
        guard let engine = app.session?.engine else { return }
        Task {
            await engine.resolveConflict(conflict.id, choice: choice)
            await reloadFromEngine()
        }
    }

    // MARK: Export

    func exportBlocks() -> [WireBlock] { liveWire }
}

final class WeakBox<T: AnyObject> {
    weak var value: T?
    init(_ value: T) { self.value = value }
}

enum UTTypeHelper {
    static func isImage(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp"].contains(ext)
    }
}

