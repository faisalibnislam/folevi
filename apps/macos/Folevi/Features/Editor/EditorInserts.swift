import AppKit
import SwiftUI

/// A "Date…" request: the date picker shows under `blockId`; the picked date goes in at `location`.
struct DatePickRequest: Identifiable, Equatable {
    let id = UUID()
    var blockId: String
    var location: Int
}

/// Inserts from the slash menu and the Insert panel that work like the web's `insertBlockAfterCurrent`
/// and its special flows (sub-pages, collections, "Date…").
extension EditorModel {
    /// Ids handled here (the rest stay with `performSlash`).
    static func isCatalogInsert(_ id: String) -> Bool {
        InsertCatalog.content(for: id) != nil || id == "divider"
            || ["page", "card", "collection", "gallery", "board", "pickdate", "unsplash", "flowchart"].contains(id)
    }

    /// Runs a catalog insert at `blockId`. Returns false when the id isn't one of them.
    @discardableResult
    func performCatalogInsert(_ id: String, blockId: String) -> Bool {
        guard Self.isCatalogInsert(id), !isReadOnly else { return false }
        switch id {
        case "page", "card":
            let display: PageDisplay = id == "card" ? .card : .link
            Task {
                guard let newId = await app.createDocument(title: "", parentDocumentId: documentId) else { return }
                insertAfterCurrent(.page(PageProps(documentId: newId, display: display, titleCache: String(localized: "Untitled"))), anchor: blockId)
                openDocumentHandler?(newId, false)
            }
        case "collection": insertCollection(view: "table", name: String(localized: "Collection"), anchor: blockId)
        case "gallery": insertCollection(view: "gallery", name: String(localized: "Gallery"), anchor: blockId)
        case "board": insertCollection(view: "board", name: String(localized: "Kanban"), anchor: blockId)
        case "unsplash":
            guard app.sync.isOnline else {
                app.showToast(String(localized: "Connect to the internet to search Unsplash."))
                return true
            }
            unsplashAnchor = blockId
        case "pickdate":
            let target = ensureTextCaret(at: blockId)
            datePick = DatePickRequest(blockId: target.blockId, location: target.location)
        case "formula":
            // A new formula opens for editing straight away (its field takes the focus).
            if let newId = insertAfterCurrent(.formula(FormulaProps(latex: "")), anchor: blockId) {
                FormulaEditing.openOnMount.insert(newId)
                focus = nil
            }
        default:
            insertAfterCurrent(BlockContent.defaultContent(for: id), anchor: blockId)
        }
        return true
    }

    /// The web's insertBlockAfterCurrent: an empty paragraph is replaced, otherwise the block goes after
    /// the current one; a non-text block keeps a paragraph after it so writing can continue.
    @discardableResult
    func insertAfterCurrent(_ content: BlockContent, anchor anchorId: String?) -> String? {
        guard !isReadOnly else { return nil }
        let anchor = anchorId.flatMap { blocks[$0] }
        var b = Block(id: ULID.make(), parentId: anchor?.parentId, rank: "V", content: content)
        var deletes: [String] = []
        if let anchor, case .paragraph = anchor.content, anchor.text.isEmpty {
            b.rank = anchor.rank
            deletes = [anchor.id]
            blocks[anchor.id] = nil
        } else {
            b.rank = catalogRank(parentId: b.parentId, after: anchor?.id)
        }
        blocks[b.id] = b
        var upserts = [b]
        var focusId: String? = b.content.carriesText || b.typeName == "code" ? b.id : nil
        if !b.content.carriesText && b.typeName != "code" {
            // The row after the new block (in document order), if any.
            let ordered = Tree.flatten(Array(blocks.values)).map(\.block)
            let idx = ordered.firstIndex { $0.id == b.id } ?? 0
            let next = idx + 1 < ordered.count ? ordered[idx + 1] : nil
            if let next, next.content.carriesText {
                focusId = next.id
            } else if next == nil {
                let p = Block(id: ULID.make(), parentId: b.parentId, rank: catalogRank(parentId: b.parentId, after: b.id), content: .paragraph(ParagraphProps()))
                blocks[p.id] = p
                upserts.append(p)
                focusId = p.id
            }
        }
        commit(upserts: upserts, deletes: deletes, focus: focusId.map { FocusRequest(blockId: $0, caret: .start) },
               actionName: String(localized: "Insert Block"), explicitDelete: true)
        if focusId == nil { select(b.id, extend: false) }
        return b.id
    }

    private func catalogRank(parentId: String?, after afterId: String?) -> String {
        (try? Tree.rankForPosition(Array(blocks.values), parentId: parentId, afterId: afterId))
            ?? Rank.betweenOrAfter(afterId.flatMap { blocks[$0]?.rank }, nil)
    }

    /// Inline inserts need a caret in a text block: otherwise a paragraph is added after `blockId`.
    func ensureTextCaret(at blockId: String) -> (blockId: String, location: Int) {
        if let block = blocks[blockId], block.content.carriesText {
            let location = textView(blockId)?.selectedRange().location ?? InlineAttributedString.length(block.text)
            return (blockId, location)
        }
        let id = insertAfterCurrent(.paragraph(ParagraphProps()), anchor: blockId) ?? blockId
        return (id, 0)
    }

    /// Puts a date mention (and a space) at the request's place.
    func insertDate(_ date: String, for request: DatePickRequest) {
        datePick = nil
        guard !isReadOnly, let block = blocks[request.blockId] else { return }
        let nodes: [InlineNode] = [.date(date: date), .text(text: " ", marks: nil)]
        if let tv = textView(request.blockId) {
            let length = (tv.string as NSString).length
            let at = min(max(0, request.location), length)
            tv.replace(range: NSRange(location: at, length: 0), with: nodes, style: currentTextStyle(for: request.blockId))
            focus = FocusRequest(blockId: request.blockId, caret: .offset(at + InlineAttributedString.length(nodes)))
        } else {
            update(block.id, actionName: String(localized: "Insert Date")) { b in
                b.text = RichText.normalizeInline(b.text + nodes)
            }
        }
    }

    /// Creates a collection on the server (the page must be there first), then its block.
    private func insertCollection(view: String, name: String, anchor: String) {
        guard let session = app.session else { return }
        guard app.sync.isOnline else {
            app.showToast(String(localized: "Connect to the internet to add a collection."))
            return
        }
        struct Created: Decodable, Sendable { var collectionId: String; var viewId: String }
        let docId = documentId
        Task { @MainActor in
            await session.engine.flushNow()
            var lastError: Error?
            for attempt in 0..<3 {
                do {
                    let r: Created = try await session.convex.mutation("collections:create", [
                        "documentId": .string(docId), "name": .string(name), "view": .string(view),
                    ])
                    insertAfterCurrent(.collection(CollectionProps(collectionId: r.collectionId, viewId: r.viewId)), anchor: anchor)
                    return
                } catch {
                    lastError = error
                    // A brand-new page may still be on its way to the server.
                    try? await Task.sleep(for: .milliseconds(600 * (attempt + 1)))
                    await session.engine.flushNow()
                }
            }
            if let lastError { app.showToast(ConvexService.mapError(lastError).localizedDescription) }
        }
    }
}
