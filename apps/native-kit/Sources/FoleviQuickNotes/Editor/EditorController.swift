import AppKit
import Quartz
import UniformTypeIdentifiers

/// Sendable wrapper for handing an immutable attributed-string snapshot to a background task.
struct SendableAttributedString: @unchecked Sendable {
    let value: NSAttributedString
}

/// Owns the editor pages and the save pipeline (debounced 300 ms, encoded off the main thread).
@MainActor
final class EditorController: NSObject {
    weak var model: AppModel?
    let hostView = EditorHostView(frame: NSRect(x: 0, y: 0, width: 380, height: 480))
    private(set) var pages: [UUID: EditorPage] = [:]
    private(set) var activePage: EditorPage?

    var textStyle = TextStyle()
    var smartBulletsEnabled = true
    var defaultDividerStyle: DividerStyle = .thin
    var autoDetectLinks = true { didSet { pages.values.forEach { $0.textView.isAutomaticLinkDetectionEnabled = autoDetectLinks } } }
    var topInset: CGFloat = 52 { didSet { applyInsets() } }
    var bottomInset: CGFloat = 30 { didSet { applyInsets() } }

    private var countTask: Task<Void, Never>?
    private var countsPending = false
    private var typingStart: Date?
    private var lastKeystroke: Date = .distantPast
    private var quickLookURLs: [URL] = []

    // MARK: Pages

    var activeTextView: QuickNoteTextView? { activePage?.textView }

    func page(for dotID: UUID) -> EditorPage? {
        if let page = pages[dotID] { return page }
        guard let model, let dot = model.dotModel(dotID) else { return nil }
        let page = EditorPage(dotID: dotID, isRichText: dot.isRichText, controller: self)
        page.setInsets(top: topInset, bottom: bottomInset)
        page.textView.isAutomaticLinkDetectionEnabled = autoDetectLinks
        load(page, from: dot)
        pages[dotID] = page
        return page
    }

    private func load(_ page: EditorPage, from dot: Dot) {
        let note = dot.note
        page.isRichText = dot.isRichText
        page.setContents(attributedContents(markdown: note?.plainText ?? "", rtf: note?.rtfData, rich: dot.isRichText))
        page.lastSavedMarkdown = note?.plainText ?? ""
        page.baseUpdatedAt = note?.updatedAt ?? .distantPast
        page.isDirty = false
    }

    func attributedContents(markdown: String, rtf: Data?, rich: Bool) -> NSAttributedString {
        if rich {
            if let rtf, !rtf.isEmpty {
                return RichTextCodec.decode(rtf, style: textStyle, imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
            }
            return AttributedMarkdown.attributedString(fromMarkdown: markdown, style: textStyle,
                                                       imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
        }
        return NSAttributedString(string: markdown, attributes: TextStyler.plainAttributes(style: textStyle))
    }

    func show(dotID: UUID, animated: Bool, focus: Bool = true) {
        guard let page = page(for: dotID) else { return }
        if let previous = activePage, previous !== page { saveNow(previous) }
        activePage = page
        hostView.show(page.scrollView, animated: animated && Motion.isEnabled)
        if focus { focusEditor() }
        scheduleCounts()
    }

    func focusEditor() {
        guard let tv = activePage?.textView, let window = hostView.window else { return }
        window.makeFirstResponder(tv)
    }

    func discardPage(_ dotID: UUID) {
        if let page = pages.removeValue(forKey: dotID) {
            page.saveTask?.cancel()
            page.scrollView.removeFromSuperview()
        }
    }

    /// Pages that can be discarded without losing anything: not shown, saved, nothing to undo.
    func discardReloadablePages() {
        for (id, page) in pages where page !== activePage && !page.isDirty
            && !page.undoManager.canUndo && !page.undoManager.canRedo && !page.textView.hasMarkedText() {
            discardPage(id)
        }
    }

    private func applyInsets() {
        pages.values.forEach { $0.setInsets(top: topInset, bottom: bottomInset) }
    }

    /// Re-applies fonts/line height/bullet glyphs after a settings change.
    func applyStyle(_ style: TextStyle) {
        let old = textStyle
        textStyle = style
        guard old != style else { return }
        for page in pages.values {
            guard let storage = page.textView.textStorage else { continue }
            page.isLoading = true
            if page.isRichText {
                if old.bulletGlyph != style.bulletGlyph { replaceBulletGlyphs(in: storage, with: style.bulletGlyph) }
                TextStyler.restyle(storage, style: style)
            } else {
                TextStyler.applyPlain(storage, style: style)
            }
            page.textView.refreshTypingAttributes()
            page.isLoading = false
            if old.bulletGlyph != style.bulletGlyph && page.isRichText { markDirty(page) }
        }
    }

    private func replaceBulletGlyphs(in storage: NSTextStorage, with glyph: String) {
        let ns = storage.string as NSString
        var ranges: [NSRange] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.byParagraphs]) { sub, range, _, _ in
            guard let sub, let first = sub.first, SmartBullets.bulletGlyphs.contains(first), sub.dropFirst().first == " " else { return }
            ranges.append(NSRange(location: range.location, length: (String(first) as NSString).length))
        }
        for r in ranges.reversed() { storage.replaceCharacters(in: r, with: glyph) }
    }

    // MARK: Change tracking & saving

    func pageDidChange(_ page: EditorPage) {
        markDirty(page)
        noteTyping()
        model?.updateFillState(dotID: page.dotID, isEmpty: page.isEmpty)
        if page === activePage { scheduleCounts() }
    }

    func selectionDidChange(_ page: EditorPage) {
        if page === activePage { scheduleCounts() }
    }

    private func markDirty(_ page: EditorPage) {
        page.isDirty = true
        page.saveTask?.cancel()
        page.saveTask = Task { @MainActor [weak self, weak page] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled, let self, let page else { return }
            await self.save(page)
        }
    }

    private func noteTyping() {
        let now = Date.now
        if now.timeIntervalSince(lastKeystroke) > 1.5 { typingStart = now }
        lastKeystroke = now
        if let start = typingStart, now.timeIntervalSince(start) >= 3 { model?.typingDidContinue() }
    }

    func mouseMoved() {
        typingStart = nil
        model?.revealFooter()
    }

    /// Encodes and stores a page off the main thread. Skips while IME composition is in progress.
    func save(_ page: EditorPage) async {
        guard page.isDirty, let storage = page.textView.textStorage else { return }
        if page.textView.hasMarkedText() { markDirty(page); return }
        let snapshot = SendableAttributedString(value: NSAttributedString(attributedString: storage))
        let rich = page.isRichText
        let generation = page.editGeneration
        let encoded = await Task.detached(priority: .userInitiated) { () -> (Data, String) in
            Self.encode(snapshot.value, rich: rich)
        }.value
        commit(page, rtf: encoded.0, markdown: encoded.1, generation: generation)
    }

    /// Synchronous save (dot switch, panel hide, app deactivate/terminate).
    func saveNow(_ page: EditorPage) {
        guard page.isDirty, let storage = page.textView.textStorage else { return }
        page.saveTask?.cancel()
        let encoded = Self.encode(NSAttributedString(attributedString: storage), rich: page.isRichText)
        commit(page, rtf: encoded.0, markdown: encoded.1, generation: page.editGeneration)
    }

    func flushAll() {
        for page in pages.values { saveNow(page) }
    }

    nonisolated static func encode(_ text: NSAttributedString, rich: Bool) -> (Data, String) {
        if rich {
            return (RichTextCodec.encode(text), AttributedMarkdown.markdown(from: text))
        }
        let plain = NSAttributedString(string: text.string)
        let rtf = (try? plain.data(from: NSRange(location: 0, length: plain.length),
                                   documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf])) ?? Data()
        return (rtf, text.string)
    }

    private func commit(_ page: EditorPage, rtf: Data, markdown: String, generation: Int) {
        guard let model, let dot = model.dotModel(page.dotID) else { return }
        model.store.updateNote(of: dot, rtf: rtf, markdown: markdown)
        page.lastSavedMarkdown = markdown
        page.baseUpdatedAt = dot.note?.updatedAt ?? .now
        if page.editGeneration == generation { page.isDirty = false }
        model.noteDidSave(dotID: page.dotID, markdown: markdown, rtf: page.isRichText ? rtf : nil)
    }

    // MARK: Counts (background, throttled to 10 Hz)

    func scheduleCounts() {
        guard countTask == nil else { countsPending = true; return }
        guard let page = activePage else { model?.counts = TextCounts(); return }
        let tv = page.textView, dotID = page.dotID
        let text = tv.string
        let sel = tv.selectedRange()
        let selection = sel.length > 0 ? (text as NSString).substring(with: sel) : nil
        countTask = Task { @MainActor [weak self] in
            let counts = await Task.detached(priority: .utility) { TextCounter.counts(for: text, selection: selection) }.value
            guard let self else { return }
            self.model?.activeCountsDidChange(counts, dotID: dotID)
            try? await Task.sleep(for: .milliseconds(100))
            self.countTask = nil
            if self.countsPending {
                self.countsPending = false
                self.scheduleCounts()
            }
        }
    }

    // MARK: Programmatic content changes (intents, services, sync, restore)

    /// Replaces a dot's whole text. `undoable` edits go through the text view (⌘Z works).
    func replaceContents(of dotID: UUID, with attributed: NSAttributedString, undoable: Bool, actionName: String? = nil) {
        guard let page = page(for: dotID), let storage = page.textView.textStorage else { return }
        let full = NSRange(location: 0, length: storage.length)
        if undoable {
            page.textView.breakUndoCoalescing()
            page.textView.replace(full, with: attributed, selectAfter: false)
            if let actionName { page.undoManager.setActionName(actionName) }
            page.textView.breakUndoCoalescing()
        } else {
            page.setContents(attributed)
            page.editGeneration += 1
        }
        markDirty(page)
        model?.updateFillState(dotID: dotID, isEmpty: page.isEmpty)
        if page === activePage { scheduleCounts() }
    }

    /// Inserts Markdown/plain text at the start or end of a dot (Shortcuts, Services, drops).
    func insert(markdown: String, into dotID: UUID, atEnd: Bool) {
        guard let page = page(for: dotID) else { return }
        let fragment: NSAttributedString = page.isRichText
            ? AttributedMarkdown.attributedString(fromMarkdown: markdown, style: textStyle, imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
            : NSAttributedString(string: markdown, attributes: TextStyler.plainAttributes(style: textStyle))
        insert(fragment: fragment, into: dotID, atEnd: atEnd)
    }

    func insert(fragment: NSAttributedString, into dotID: UUID, atEnd: Bool) {
        guard let page = page(for: dotID), let storage = page.textView.textStorage, fragment.length > 0 else { return }
        let separator = NSAttributedString(string: "\n", attributes: page.textView.baseAttributes())
        let piece = NSMutableAttributedString()
        let location: Int
        if atEnd {
            location = storage.length
            if storage.length > 0, !storage.string.hasSuffix("\n") { piece.append(separator) }
            piece.append(fragment)
        } else {
            location = 0
            piece.append(fragment)
            if storage.length > 0 { piece.append(separator) }
        }
        page.textView.breakUndoCoalescing()
        page.textView.replace(NSRange(location: location, length: 0), with: piece, selectAfter: false)
        page.textView.breakUndoCoalescing()
        if page.isRichText { page.textView.restyleParagraphs(NSRange(location: location, length: piece.length)) }
        markDirty(page)
        model?.updateFillState(dotID: dotID, isEmpty: page.isEmpty)
    }

    func insertAtCursor(_ fragment: NSAttributedString) {
        guard let tv = activeTextView else { return }
        tv.breakUndoCoalescing()
        tv.replace(tv.selectedRange(), with: fragment)
        if tv.isRichMode { tv.restyleParagraphs(NSRange(location: tv.selectedRange().location, length: 0)) }
        tv.breakUndoCoalescing()
    }

    func markdown(of dotID: UUID) -> String {
        guard let page = pages[dotID], let storage = page.textView.textStorage else {
            return model?.dotModel(dotID)?.note?.plainText ?? ""
        }
        return page.isRichText ? AttributedMarkdown.markdown(from: storage) : storage.string
    }

    func readableText(of dotID: UUID) -> String {
        guard let page = pages[dotID] ?? self.page(for: dotID), let storage = page.textView.textStorage else { return "" }
        return page.isRichText ? AttributedMarkdown.readableText(from: storage) : storage.string
    }

    func attributedText(of dotID: UUID) -> NSAttributedString? {
        guard let page = page(for: dotID), let storage = page.textView.textStorage else { return nil }
        if page.isRichText { return NSAttributedString(attributedString: storage) }
        return AttributedMarkdown.attributedString(fromMarkdown: storage.string, style: textStyle,
                                                   imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
    }

    /// Converts a dot between rich text and plain Markdown source.
    func setRichText(_ rich: Bool, for dotID: UUID) {
        guard let page = page(for: dotID), page.isRichText != rich, let storage = page.textView.textStorage else { return }
        let converted: NSAttributedString
        if rich {
            converted = AttributedMarkdown.attributedString(fromMarkdown: storage.string, style: textStyle,
                                                            imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
        } else {
            converted = NSAttributedString(string: AttributedMarkdown.markdown(from: storage),
                                           attributes: TextStyler.plainAttributes(style: textStyle))
        }
        page.isRichText = rich
        page.setContents(converted)
        page.undoManager.removeAllActions()
        page.editGeneration += 1
        markDirty(page)
        saveNow(page)
    }

    // MARK: Attachments

    func imageAttachment(id: UUID) -> NSTextAttachment? { model?.attachments.textAttachment(for: id) }

    /// Swaps placeholder image attachments for the thumbnail that just finished loading. A plain
    /// attribute change on the storage: not an edit (no undo entry, no save).
    func thumbnailDidLoad(id: UUID, image: NSImage, pixelSize: CGSize) {
        for page in pages.values {
            guard let storage = page.textView.textStorage, storage.length > 0 else { continue }
            var ranges: [NSRange] = []
            storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
                if let a = value as? ImageAttachment, a.attachmentID == id, a.thumbnail == nil { ranges.append(range) }
            }
            guard !ranges.isEmpty else { continue }
            page.isLoading = true
            storage.beginEditing()
            for range in ranges {
                storage.addAttribute(.attachment, value: ImageAttachment(id: id, thumbnail: image, pixelSize: pixelSize), range: range)
            }
            storage.endEditing()
            page.isLoading = false
        }
    }
    func attachmentData(id: UUID) -> Data? { model?.attachments.data(for: id) }

    /// Stores image data as an attachment of the active dot and returns the text to insert.
    func imageFragment(data: Data, suggestedName: String, rich: Bool, dotID: UUID? = nil) -> NSAttributedString? {
        guard let model, let targetID = dotID ?? activePage?.dotID, let dot = model.dotModel(targetID),
              let encoded = ImageEncoder.normalize(data) else { return nil }
        let ext = encoded.type.preferredFilenameExtension ?? "png"
        let id = model.store.addAttachment(to: dot, data: encoded.data, utType: encoded.type.identifier, filename: "\(suggestedName).\(ext)")
        return fragment(forAttachment: id, data: encoded.data, pixelSize: encoded.pixelSize, name: suggestedName, rich: rich)
    }

    func fragment(forAttachment id: UUID, data: Data, pixelSize: CGSize, name: String, rich: Bool) -> NSAttributedString {
        let (thumb, pixels) = AttachmentStore.thumbnail(from: data, maxPointWidth: ImageAttachment.maxDisplayWidth)
        if let thumb { model?.attachments.register(thumbnail: thumb, pixelSize: pixels, for: id) }
        let base = activeTextView?.baseAttributes() ?? TextStyler.plainAttributes(style: textStyle)
        if rich {
            var attrs = base
            attrs[.attachment] = ImageAttachment(id: id, thumbnail: thumb, pixelSize: pixelSize)
            return NSAttributedString(string: AttachmentChar.string, attributes: attrs)
        }
        let alt = name.replacingOccurrences(of: "]", with: "")
        return NSAttributedString(string: "![\(alt)](\(QuickNoteLink.attachmentURL(id)))", attributes: base)
    }

    /// Content for a dropped/pasted file: images become attachments, text files are imported.
    func fragment(forFile url: URL, rich: Bool, dotID: UUID? = nil) -> NSAttributedString? {
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        if type.conforms(to: .image), let data = try? Data(contentsOf: url) {
            return imageFragment(data: data, suggestedName: url.deletingPathExtension().lastPathComponent, rich: rich, dotID: dotID)
        }
        if let imported = FileImporter.read(url) {
            switch imported {
            case .markdown(let md):
                return rich ? AttributedMarkdown.attributedString(fromMarkdown: md, style: textStyle,
                                                                  imageProvider: { [weak self] in self?.imageAttachment(id: $0) })
                    : NSAttributedString(string: md, attributes: TextStyler.plainAttributes(style: textStyle))
            case .rich(let attributed):
                return rich ? RichTextCodec.sanitizeForeign(attributed, style: textStyle)
                    : NSAttributedString(string: AttributedMarkdown.markdown(from: attributed, source: .foreign),
                                         attributes: TextStyler.plainAttributes(style: textStyle))
            }
        }
        var attrs = activeTextView?.baseAttributes() ?? TextStyler.plainAttributes(style: textStyle)
        attrs[.link] = url
        return NSAttributedString(string: url.lastPathComponent, attributes: attrs)
    }

    func quickLook(attachmentID: UUID) {
        guard let url = model?.attachments.fileURL(for: attachmentID) else { return }
        quickLookURLs = [url]
        NSApp.activate()
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    func copyImage(attachmentID: UUID) {
        guard let data = attachmentData(id: attachmentID), let image = NSImage(data: data) else { return }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.writeObjects([image])
        model?.showToast(String(localized: "Image copied"), symbol: "photo.on.rectangle")
    }

    func saveImage(attachmentID: UUID) {
        guard let url = model?.attachments.fileURL(for: attachmentID), let data = try? Data(contentsOf: url) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = url.lastPathComponent
        panel.allowedContentTypes = [UTType(filenameExtension: url.pathExtension) ?? .png]
        model?.runModalPanel {
            if panel.runModal() == .OK, let dest = panel.url { try? data.write(to: dest, options: .atomic) }
        }
    }
}

extension EditorController: QLPreviewPanelDataSource {
    nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        MainActor.assumeIsolated { quickLookURLs.count }
    }

    nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> (any QLPreviewItem)! {
        MainActor.assumeIsolated { quickLookURLs[index] as NSURL }
    }
}
