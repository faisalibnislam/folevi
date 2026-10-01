import AppKit
import SwiftUI

// Editor behaviours that follow the web's EditorMenus.tsx, plugins.ts and Editor.tsx: the "@" menu,
// the block menu, the "+" line, block links, date chips, ⌘↩, the formatting toolbar's state and paste.

/// One row of the "@" menu: a person, a date, or "Pick a date…".
struct MentionChoice: Identifiable, Equatable {
    enum Kind: Equatable {
        case person(String)
        case date(String)
        case pickDate
    }
    var id: String
    var kind: Kind
    var label: String
    var hint: String?

    /// A date as the web's `formatDate` shows it ("Thu, Oct 1").
    static func dateLabel(_ date: String) -> String {
        guard let d = TaskLogic.parseLocalDate(date) else { return date }
        return d.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }
}

/// The floating formatting toolbar over selected text (EditorMenus.tsx `SelectionBubble`).
struct BubbleState: Equatable {
    enum Mode: Equatable { case marks, link, colors }
    var blockId: String
    /// The selection's box, in the block row's coordinates.
    var rect: CGRect
    var mode: Mode = .marks
    /// Opened from the keyboard (⌘⇧K) with no text selected: stays until dismissed.
    var forced = false
}

extension EditorModel {
    // MARK: Block menu

    func openBlockMenu(_ ids: [String], anchor: String) {
        guard !ids.isEmpty else { return }
        bubble = nil
        blockMenu = BlockMenuRequest(ids: ids, anchorId: anchor)
    }

    func closeBlockMenu() {
        blockMenu = nil
    }

    /// ⌘. : the block menu for the block with the caret (or every selected block).
    func openBlockMenuForCurrent() {
        let ids = commandTargets
        guard let first = ids.first else { return }
        openBlockMenu(ids, anchor: first)
    }

    // MARK: Block selection

    /// Leaves the block selection for the text: the caret at the end of the last block (or the start of the
    /// first), as the web does for ↑/↓, Return, Escape and typing.
    func leaveSelection(atEnd: Bool) {
        let ids = orderedByRows(Array(selectedBlockIds))
        selectedBlockIds = []
        guard let id = atEnd ? ids.last : ids.first, let block = blocks[id] else { return }
        if block.content.carriesText || block.typeName == "code" {
            focus = FocusRequest(blockId: id, caret: atEnd ? .end : .start)
        } else if let row = rows.firstIndex(where: { $0.id == id }) {
            // An object: the nearest text line in that direction.
            let range = atEnd ? Array(rows[(row + 1)...]) : Array(rows[..<row].reversed())
            if let next = range.first(where: { $0.block.content.carriesText }) {
                focus = FocusRequest(blockId: next.id, caret: atEnd ? .start : .end)
            }
        }
    }

    /// ⌘A while blocks are selected: every block.
    func selectAllBlocks() {
        guard let first = rows.first, let last = rows.last else { return }
        selectionAnchor = first.id
        selectedBlockIds = Set(rows.map(\.id))
        _ = last
    }

    /// ⌘C on selected blocks: their Markdown (pasting it back rebuilds the blocks).
    func copySelectedBlocks() -> [NSItemProvider] {
        let ids = orderedByRows(Array(selectedBlockIds))
        var all: [String] = []
        for id in ids {
            all.append(id)
            all += Tree.descendantIds(allNodes(), rootId: id)
        }
        var seen = Set<String>()
        let wires = all.filter { seen.insert($0).inserted }.compactMap { blocks[$0]?.wire }
        let markdown = MarkdownCodec.blocksToMarkdown(wires)
        return [NSItemProvider(object: markdown as NSString)]
    }

    /// ⌘X on selected blocks: copy, then delete them.
    func cutSelectedBlocks() -> [NSItemProvider] {
        let items = copySelectedBlocks()
        delete(commandTargets)
        return items
    }

    // MARK: "+" in the gutter

    /// A new line right after `blockId` with "/" typed in it, so the block menu opens there.
    func insertSlashLine(after blockId: String) {
        guard !isReadOnly, let anchor = blocks[blockId] else { return }
        clearSelection()
        let b = Block(id: ULID.make(), parentId: anchor.parentId, rank: rank(parentId: anchor.parentId, after: blockId),
                      text: [.text(text: "/", marks: nil)], content: .paragraph(ParagraphProps()))
        commit(upserts: [b], focus: FocusRequest(blockId: b.id, caret: .offset(1)), actionName: String(localized: "Insert Block"))
        popup = PopupState(kind: .slash, blockId: b.id, anchor: 0)
    }

    // MARK: Copy link to block

    func copyLink(toBlock blockId: String) {
        let path = "d/\(documentId)"
        let link: String
        if let origin = AppConfig.current.appOrigin {
            link = origin.appendingPathComponent(path).absoluteString + "#block-\(blockId)"
        } else {
            link = "https://app.folevi.com/\(path)#block-\(blockId)"
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        app.showToast(String(localized: "Link copied"))
    }

    // MARK: ⌘↩

    /// ⌘↩ (the web's Mod-Enter): checks or unchecks a to-do, opens or closes a toggle, and leaves a code
    /// block for a new line of text below it. Returns whether it applied.
    @discardableResult
    func modEnter(_ blockId: String) -> Bool {
        guard !isReadOnly, let block = blocks[blockId] else { return false }
        switch block.content {
        case .todo:
            toggleTodo(blockId)
            return true
        case .toggle:
            toggleCollapsed(blockId)
            return true
        case .code:
            var p = Block(id: ULID.make(), parentId: block.parentId, rank: "V", content: .paragraph(ParagraphProps()))
            p.rank = rank(parentId: block.parentId, after: blockId)
            commit(upserts: [p], focus: FocusRequest(blockId: p.id, caret: .start), actionName: String(localized: "New Block"))
            return true
        default:
            return false
        }
    }

    // MARK: Task details (⌘⇧D)

    /// Opens the task details of the to-do with the caret.
    @discardableResult
    func openTaskDetails(_ blockId: String) -> Bool {
        guard let block = blocks[blockId], case .todo = block.content else { return false }
        taskDetailsFor = blockId
        return true
    }

    // MARK: Dates in the text

    /// A click on a date chip: the date popover, to change or remove it.
    func editDate(blockId: String, range: NSRange, date: String) {
        guard !isReadOnly else { return }
        datePick = DatePickRequest(blockId: blockId, location: range.location, editing: DatePickRequest.Editing(date: date, range: range))
    }

    func removeDate(for request: DatePickRequest) {
        datePick = nil
        guard let editing = request.editing, let tv = textView(request.blockId) else { return }
        tv.replace(range: editing.range, with: [], style: currentTextStyle(for: request.blockId))
        focus = FocusRequest(blockId: request.blockId, caret: .offset(editing.range.location))
    }

    // MARK: Page links in the text

    /// A click on a [[page link]]: opens the page (Option, ⌘ or Shift opens a new window, as the web's
    /// modifier-click opens a new tab).
    func openPageLink(_ documentId: String, newWindow: Bool) {
        openDocumentHandler?(documentId, newWindow)
    }

    // MARK: Formatting toolbar

    /// Follows the text selection (the web's SelectionBubble `update`): shown for selected text outside
    /// code, kept while the link field has the keyboard.
    func updateBubble(blockId: String, view: BlockTextView) {
        guard !isReadOnly, blockId != "__title__", !view.isCode else {
            if bubble?.blockId == blockId { bubble = nil }
            return
        }
        let sel = view.selectedRange()
        if sel.length == 0 {
            if let b = bubble, b.blockId == blockId, !b.forced, b.mode != .link { bubble = nil }
            return
        }
        guard let rect = bubbleRect(view: view, blockId: blockId, range: sel) else { return }
        var next = BubbleState(blockId: blockId, rect: rect)
        if let b = bubble, b.blockId == blockId { next.mode = b.mode == .link ? .marks : b.mode }
        if next != bubble { bubble = next }
    }

    /// The selection's box (or the caret's) in the row's coordinates.
    func bubbleRect(view: BlockTextView, blockId: String, range: NSRange) -> CGRect? {
        guard let anchor = drag.anchor, let rowFrame = drag.rowFrames[blockId],
              let layout = view.layoutManager, let container = view.textContainer else { return nil }
        let length = (view.string as NSString).length
        var rect: CGRect
        if length == 0 {
            rect = CGRect(x: 0, y: 0, width: 1, height: layout.defaultLineHeight(for: view.font ?? NSFont.systemFont(ofSize: 16)))
        } else {
            let start = min(range.location, max(0, length - 1))
            let end = max(start, min(NSMaxRange(range), length) - (range.length > 0 ? 1 : 0))
            let g1 = layout.glyphRange(forCharacterRange: NSRange(location: start, length: 1), actualCharacterRange: nil)
            let g2 = layout.glyphRange(forCharacterRange: NSRange(location: end, length: 1), actualCharacterRange: nil)
            let r1 = layout.boundingRect(forGlyphRange: g1, in: container)
            let r2 = layout.boundingRect(forGlyphRange: g2, in: container)
            let left = range.length > 0 ? r1.minX : r1.minX
            let right = range.length > 0 ? r2.maxX : r1.minX
            rect = CGRect(x: (left + right) / 2, y: min(r1.minY, r2.minY), width: 0, height: max(r1.maxY, r2.maxY) - min(r1.minY, r2.minY))
        }
        let inAnchor = anchor.convert(rect, from: view)
        return inAnchor.offsetBy(dx: -rowFrame.minX, dy: -rowFrame.minY)
    }

    /// ⌘⇧K: the link field in the formatting toolbar (with no selection, the address is inserted as a link).
    func beginLink() {
        guard let id = focusedBlockId, id != "__title__", let tv = textView(id), !tv.isCode, !isReadOnly else {
            NSSound.beep()
            return
        }
        guard let rect = bubbleRect(view: tv, blockId: id, range: tv.selectedRange()) else { return }
        linkDraft = tv.linkAtSelection() ?? ""
        bubble = BubbleState(blockId: id, rect: rect, mode: .link, forced: true)
    }

    /// Applies the link field (the web's `applyLink`): links the selection or the link under the caret, or
    /// inserts the address as linked text at a bare caret. False when it isn't a safe address.
    @discardableResult
    func applyLink(_ raw: String) -> Bool {
        guard let id = bubble?.blockId ?? focusedBlockId, let tv = textView(id) else { return false }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let style = currentTextStyle(for: id)
        guard let href = RichText.sanitizeHref(text) else { return false }
        var sel = tv.selectedRange()
        if sel.length == 0, let range = tv.linkRange(at: sel.location) { sel = range }
        if sel.length == 0 {
            tv.replace(range: sel, with: [.text(text: text, marks: [.link(href: href)])], style: style)
            let end = sel.location + (text as NSString).length
            tv.typingAttributes[.foleviLink] = nil
            focus = FocusRequest(blockId: id, caret: .offset(end))
        } else {
            tv.setSelectedRange(sel)
            tv.setMark(.link(href: href), style: style)
            focus = FocusRequest(blockId: id, caret: .offset(NSMaxRange(sel)))
        }
        bubble = nil
        return true
    }

    func removeLink() {
        guard let id = bubble?.blockId ?? focusedBlockId, let tv = textView(id) else { return }
        var sel = tv.selectedRange()
        if let range = tv.linkRange(at: sel.location), sel.length == 0 { sel = range }
        tv.setSelectedRange(sel)
        tv.removeMark(.foleviLink, style: currentTextStyle(for: id))
        bubble = nil
        focus = FocusRequest(blockId: id, caret: .offset(NSMaxRange(sel)))
    }

    /// Whether the selection (or the caret) is in a link.
    var linkActive: Bool {
        guard let id = bubble?.blockId ?? focusedBlockId, let tv = textView(id) else { return false }
        return tv.linkAtSelection() != nil
    }

    func marksAtSelection() -> (color: TextColor?, highlight: HighlightColor?) {
        guard let id = bubble?.blockId ?? focusedBlockId, let tv = textView(id), let storage = tv.textStorage, storage.length > 0 else { return (nil, nil) }
        let loc = min(tv.selectedRange().location, storage.length - 1)
        let c = (storage.attribute(.foleviColor, at: loc, effectiveRange: nil) as? String).flatMap(TextColor.init(rawValue:))
        let h = (storage.attribute(.foleviHighlight, at: loc, effectiveRange: nil) as? String).flatMap(HighlightColor.init(rawValue:))
        return (c, h)
    }

    // MARK: Paste (Editor.tsx handlePaste)

    /// Paste into a text block: files become attachments; HTML from other apps and multi-line or Markdown
    /// text become blocks after the current one (replacing it when it's an empty line). Returns false to
    /// let the text view paste inline.
    func paste(into blockId: String, from pasteboard: NSPasteboard) -> Bool {
        guard !isReadOnly, let block = blocks[blockId] else { return false }
        if case .code = block.content { return false }
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            insertFiles(Array(urls.prefix(10)), after: blockId, replacing: block.content.carriesText && block.text.isEmpty && block.typeName == "paragraph")
            return true
        }
        // A copied picture with no text (a screenshot, an image from a browser): an image block.
        if pasteboard.string(forType: .string) == nil, pasteboard.string(forType: .html) == nil,
           let png = pasteboard.data(forType: .png)
            ?? pasteboard.data(forType: .tiff).flatMap({ NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }) {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Pasted image \(ULID.make().suffix(6)).png")
            if (try? png.write(to: url)) != nil {
                insertFiles([url], after: blockId, replacing: block.content.carriesText && block.text.isEmpty && block.typeName == "paragraph")
                return true
            }
        }
        var wires: [WireBlock]?
        // Our own text views put RTF on the pasteboard, never HTML, so HTML always comes from elsewhere.
        if let html = pasteboard.string(forType: .html), !html.isEmpty {
            wires = PasteHTML.blocks(html)
        } else if let text = pasteboard.string(forType: .string), !text.isEmpty,
                  text.contains("\n") || Self.test(#"(?m)^(#{1,3} |[-*+] |\d+[.)] |> |```|\[[ x]\] )"#, text) {
            wires = Self.looksLikeMarkdown(text) ? MarkdownCodec.markdownToBlocks(text, titleFromHeading: false).blocks : MarkdownCodec.plainTextToBlocks(text)
        }
        guard let wires, !wires.isEmpty else { return false }
        insertPasted(wires, at: blockId)
        return true
    }

    private static func test(_ pattern: String, _ s: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    static func looksLikeMarkdown(_ text: String) -> Bool {
        test(#"(?m)^(#{1,6} |[-*+] |\d+[.)] |> |```|\[[ x]\] |\|.*\|)"#, text) || test(#"\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)"#, text)
    }

    /// Puts pasted blocks after `anchorId` (keeping their nesting), replacing it when it's an empty line.
    func insertPasted(_ wires: [WireBlock], at anchorId: String) {
        guard let anchor = blocks[anchorId] else { return }
        let replacing = anchor.content.carriesText && anchor.text.isEmpty
        // Fresh ids, the same shape.
        var idMap: [String: String] = [:]
        for w in wires { idMap[w.id] = ULID.make() }
        let roots = Tree.flatten(wires.map { Block(wire: $0) }).filter { $0.depth == 0 }.map(\.block.id)
        var upserts: [Block] = []
        var after: String? = replacing ? nil : anchorId
        if replacing {
            let sibs = siblings(of: anchor)
            let idx = sibs.firstIndex { $0.id == anchorId } ?? 0
            after = idx > 0 ? sibs[idx - 1].id : nil
            blocks[anchorId] = nil
        }
        var lastFocus: String?
        for w in wires {
            var b = Block(wire: w)
            b.id = idMap[w.id] ?? ULID.make()
            b.revision = nil
            if roots.contains(w.id) {
                b.parentId = anchor.parentId
                b.rank = rank(parentId: anchor.parentId, after: after)
                after = b.id
            } else {
                b.parentId = w.parentId.flatMap { idMap[$0] }
            }
            blocks[b.id] = b
            upserts.append(b)
            if b.content.carriesText || b.typeName == "code" { lastFocus = b.id }
        }
        let focusId = upserts.last.flatMap { $0.content.carriesText ? $0.id : nil } ?? lastFocus
        commit(upserts: upserts, deletes: replacing ? [anchorId] : [],
               focus: focusId.map { FocusRequest(blockId: $0, caret: .end) }, actionName: String(localized: "Paste"), explicitDelete: true)
    }
}
