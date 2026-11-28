import AppKit
import QuartzCore
import UniformTypeIdentifiers

/// The editor: `NSTextView` on TextKit 2 (never touches `layoutManager`, so it never falls back to
/// TextKit 1). Adds smart bullets, clickable checkboxes, inline images, dividers, and Markdown-aware
/// copy/paste on top of the system text engine (IME, spelling, find bar, undo, accessibility).
final class QuickNoteTextView: NSTextView {
    weak var page: EditorPage?

    static let markdownPasteboardType = NSPasteboard.PasteboardType("com.folevi.quicknote.markdown")

    var isRichMode: Bool { page?.isRichText ?? true }
    var style: TextStyle { page?.controller?.textStyle ?? TextStyle() }
    var smartBulletsEnabled: Bool { page?.controller?.smartBulletsEnabled ?? true }

    /// Builds a text view on a fresh TextKit 2 stack.
    static func make() -> QuickNoteTextView {
        let contentStorage = NSTextContentStorage()
        let layoutManager = NSTextLayoutManager()
        contentStorage.addTextLayoutManager(layoutManager)
        let container = NSTextContainer(size: CGSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.textContainer = container
        let view = QuickNoteTextView(frame: .zero, textContainer: container)
        view.configure()
        return view
    }

    private func configure() {
        isRichText = true
        importsGraphics = false
        allowsImageEditing = false
        allowsUndo = true
        isEditable = true
        isSelectable = true
        drawsBackground = false
        usesFindBar = true
        isIncrementalSearchingEnabled = true
        usesFontPanel = false
        usesRuler = false
        isAutomaticLinkDetectionEnabled = true
        isAutomaticDataDetectionEnabled = false
        isContinuousSpellCheckingEnabled = true
        // Follow the system's Keyboard ▸ Text settings.
        isAutomaticSpellingCorrectionEnabled = NSSpellChecker.isAutomaticSpellingCorrectionEnabled
        isAutomaticQuoteSubstitutionEnabled = NSSpellChecker.isAutomaticQuoteSubstitutionEnabled
        isAutomaticDashSubstitutionEnabled = NSSpellChecker.isAutomaticDashSubstitutionEnabled
        isAutomaticTextReplacementEnabled = NSSpellChecker.isAutomaticTextReplacementEnabled
        smartInsertDeleteEnabled = true
        isVerticallyResizable = true
        isHorizontallyResizable = false
        autoresizingMask = [.width]
        textContainerInset = NSSize(width: 11, height: 0)
        linkTextAttributes = [.foregroundColor: NSColor.linkColor, .underlineStyle: NSUnderlineStyle.single.rawValue,
                              .cursor: NSCursor.pointingHand]
        setAccessibilityLabel(String(localized: "Note"))
    }

    // MARK: - Geometry helpers

    /// The storage's own backing string. `string as NSString` bridges through a Swift `String`,
    /// copying the whole document on every access, several times per keystroke.
    private var nsString: NSString { textStorage?.mutableString ?? "" }

    func paragraphRange(at location: Int) -> NSRange {
        nsString.paragraphRange(for: NSRange(location: min(location, nsString.length), length: 0))
    }

    /// Paragraph range without its terminating newline.
    func contentRange(ofParagraph range: NSRange) -> NSRange {
        var r = range
        if r.length > 0, NSMaxRange(r) <= nsString.length {
            let last = nsString.character(at: NSMaxRange(r) - 1)
            if last == 0x0A || last == 0x2029 || last == 0x0D { r.length -= 1 }
        }
        return r
    }

    func rect(forCharacterRange range: NSRange) -> NSRect? {
        guard let tlm = textLayoutManager, let tcm = tlm.textContentManager,
              let start = tcm.location(tcm.documentRange.location, offsetBy: range.location),
              let end = tcm.location(start, offsetBy: range.length),
              let textRange = NSTextRange(location: start, end: end) else { return nil }
        var result: NSRect?
        tlm.enumerateTextSegments(in: textRange, type: .standard, options: []) { _, frame, _, _ in
            result = frame
            return false
        }
        let origin = textContainerOrigin
        return result.map { $0.offsetBy(dx: origin.x, dy: origin.y) }
    }

    private func paragraphLevel(_ range: NSRange) -> Int {
        guard range.location < nsString.length || nsString.length > 0 else { return 0 }
        let loc = min(range.location, max(0, nsString.length - 1))
        return TextStyler.level(of: textStorage?.attribute(.paragraphStyle, at: loc, effectiveRange: nil) as? NSParagraphStyle)
    }

    private func listPrefix(ofParagraph range: NSRange) -> ListPrefix? {
        let content = contentRange(ofParagraph: range)
        guard content.length > 0, let storage = textStorage else { return nil }
        let checkbox = storage.attribute(.quickNoteCheckbox, at: content.location, effectiveRange: nil) as? Bool
        return SmartBullets.detect(paragraph: nsString.substring(with: content), checkbox: checkbox)
    }

    // MARK: - Edits (always undoable)

    @discardableResult
    func replace(_ range: NSRange, with attributed: NSAttributedString, selectAfter: Bool = true) -> Bool {
        guard let storage = textStorage, shouldChangeText(in: range, replacementString: attributed.string) else { return false }
        storage.replaceCharacters(in: range, with: attributed)
        didChangeText()
        if selectAfter { setSelectedRange(NSRange(location: range.location + attributed.length, length: 0)) }
        return true
    }

    /// Applies an attribute-only change to `range` with undo support.
    func changeAttributes(in range: NSRange, _ body: (NSTextStorage) -> Void) {
        guard let storage = textStorage, range.length > 0 || storage.length == 0,
              shouldChangeText(in: range, replacementString: nil) else { return }
        storage.beginEditing()
        body(storage)
        storage.endEditing()
        didChangeText()
    }

    func restyleParagraphs(_ range: NSRange) {
        guard isRichMode, let storage = textStorage else { return }
        let target = nsString.paragraphRange(for: NSRange(location: min(range.location, nsString.length),
                                                          length: min(range.length, nsString.length - min(range.location, nsString.length))))
        changeAttributes(in: target.length > 0 ? target : NSRange(location: 0, length: storage.length)) { storage in
            TextStyler.restyle(storage, range: target, style: style)
        }
        refreshTypingAttributes()
    }

    func baseAttributes(level: Int = 0) -> [NSAttributedString.Key: Any] {
        var attrs = TextStyler.plainAttributes(style: style)
        attrs[.paragraphStyle] = TextStyler.paragraphStyle(level: level, markerWidth: 0, heading: 0, style: style)
        return attrs
    }

    func refreshTypingAttributes() {
        let loc = min(selectedRange().location, nsString.length)
        guard let storage = textStorage else { return }
        if storage.length == 0 {
            typingAttributes = baseAttributes()
            return
        }
        let para = paragraphRange(at: loc)
        let content = contentRange(ofParagraph: para)
        if content.length == 0 {
            // Empty paragraph: plain body text at the paragraph's indent level.
            typingAttributes = baseAttributes(level: paragraphLevel(para))
            return
        }
        let probe = loc > content.location ? loc - 1 : content.location
        var attrs = storage.attributes(at: min(probe, storage.length - 1), effectiveRange: nil)
        attrs.removeValue(forKey: .attachment)
        attrs.removeValue(forKey: .quickNoteCheckbox)
        attrs.removeValue(forKey: .link)
        if attrs[.font] == nil { attrs[.font] = style.baseFont }
        typingAttributes = attrs
    }

    // MARK: - Smart bullets

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        super.insertText(insertString, replacementRange: replacementRange)
        guard smartBulletsEnabled, isRichMode, !hasMarkedText() else { return }
        let text = (insertString as? String) ?? (insertString as? NSAttributedString)?.string
        if text == " " { handleSpaceTrigger() }
    }

    private func handleSpaceTrigger() {
        let caret = selectedRange().location
        guard caret > 0, let storage = textStorage else { return }
        let para = paragraphRange(at: caret - 1)
        let prefixRange = NSRange(location: para.location, length: caret - para.location)
        guard prefixRange.length > 0, prefixRange.length <= 8 else { return }
        let typed = nsString.substring(with: prefixRange)
        // Typing a marker right after an existing one ("• " then "[ ] ") converts it instead of
        // stacking markers.
        if let existing = listPrefix(ofParagraph: para) {
            let afterMarker = para.location + existing.length
            guard caret > afterMarker else { return }
            let typedAfter = nsString.substring(with: NSRange(location: afterMarker, length: caret - afterMarker))
            guard let marker = SmartBullets.trigger(typedPrefix: typedAfter) else { return }
            breakUndoCoalescing()
            let level = paragraphLevel(para)
            let replacement: NSAttributedString
            if case .number = marker {
                replacement = NSAttributedString(string: typedAfter, attributes: baseAttributes(level: level))
            } else {
                replacement = markerAttributedString(marker, level: level)
            }
            guard replace(prefixRange, with: replacement) else { return }
            restyleParagraphs(NSRange(location: prefixRange.location, length: 0))
            return
        }
        _ = storage

        if ["# ", "## ", "### "].contains(typed) {
            let level = typed.count - 1
            breakUndoCoalescing()
            guard replace(prefixRange, with: NSAttributedString(string: "", attributes: typingAttributes)) else { return }
            let content = contentRange(ofParagraph: paragraphRange(at: prefixRange.location))
            changeAttributes(in: paragraphRange(at: prefixRange.location)) { s in
                if content.length > 0 { s.addAttribute(.quickNoteHeading, value: level, range: content) }
            }
            restyleParagraphs(NSRange(location: prefixRange.location, length: 0))
            var attrs = typingAttributes
            attrs[.quickNoteHeading] = level
            attrs[.font] = Typography.font(base: style.baseFont, bold: false, italic: false, heading: level, code: false)
            typingAttributes = attrs
            return
        }

        guard let marker = SmartBullets.trigger(typedPrefix: typed) else { return }
        breakUndoCoalescing()
        let level = paragraphLevel(para)
        let markerString: NSAttributedString
        switch marker {
        case .number:
            markerString = NSAttributedString(string: typed, attributes: baseAttributes(level: level))
        default:
            markerString = markerAttributedString(marker, level: level)
        }
        guard replace(prefixRange, with: markerString) else { return }
        restyleParagraphs(NSRange(location: prefixRange.location, length: 0))
        typingAttributes = baseAttributes(level: level).merging([.paragraphStyle: currentParagraphStyle()]) { $1 }
    }

    private func currentParagraphStyle() -> NSParagraphStyle {
        let loc = max(0, min(selectedRange().location, nsString.length) - 1)
        return (textStorage?.length ?? 0) > 0
            ? (textStorage?.attribute(.paragraphStyle, at: loc, effectiveRange: nil) as? NSParagraphStyle ?? .default) : .default
    }

    func markerAttributedString(_ marker: ListMarker, level: Int) -> NSAttributedString {
        let attrs = baseAttributes(level: level)
        switch marker {
        case .checkbox(let checked):
            var boxAttrs = attrs
            boxAttrs[.attachment] = CheckboxAttachment(checked: checked)
            boxAttrs[.quickNoteCheckbox] = checked
            let s = NSMutableAttributedString(string: AttachmentChar.string, attributes: boxAttrs)
            s.append(NSAttributedString(string: " ", attributes: attrs))
            return s
        default:
            return NSAttributedString(string: SmartBullets.markerText(marker, glyph: style.bulletGlyph), attributes: attrs)
        }
    }

    override func insertNewline(_ sender: Any?) {
        guard smartBulletsEnabled, !hasMarkedText(), selectedRange().length == 0 else {
            super.insertNewline(sender)
            return
        }
        isRichMode ? richNewline(sender) : plainNewline(sender)
    }

    private func richNewline(_ sender: Any?) {
        let caret = selectedRange().location
        let para = paragraphRange(at: caret)
        let content = contentRange(ofParagraph: para)
        let prefix = listPrefix(ofParagraph: para)
        let level = paragraphLevel(para)
        // Caret inside the marker itself: behave like a normal Return.
        if let prefix, caret < content.location + prefix.length {
            super.insertNewline(sender); return
        }
        let wasHeading = content.length > 0 && textStorage?.attribute(.quickNoteHeading, at: content.location, effectiveRange: nil) != nil
        switch SmartBullets.returnAction(prefix: prefix, paragraph: nsString.substring(with: content), level: level) {
        case .plainNewline:
            super.insertNewline(sender)
            if wasHeading {
                var attrs = typingAttributes
                attrs.removeValue(forKey: .quickNoteHeading)
                attrs[.font] = style.baseFont
                attrs[.paragraphStyle] = TextStyler.paragraphStyle(level: 0, markerWidth: 0, heading: 0, style: style)
                typingAttributes = attrs
                let newPara = paragraphRange(at: selectedRange().location)
                let newContent = contentRange(ofParagraph: newPara)
                if newContent.length > 0 {
                    changeAttributes(in: newContent) { s in s.removeAttribute(.quickNoteHeading, range: newContent) }
                }
                restyleParagraphs(newPara)
            }
        case .continueList(let marker):
            breakUndoCoalescing()
            let insertion = NSMutableAttributedString(string: "\n", attributes: baseAttributes(level: level))
            insertion.append(markerAttributedString(marker, level: level))
            replace(NSRange(location: caret, length: 0), with: insertion)
            restyleParagraphs(NSRange(location: selectedRange().location, length: 0))
            typingAttributes = baseAttributes(level: level).merging([.paragraphStyle: currentParagraphStyle()]) { $1 }
        case .endList:
            guard let prefix else { return }
            replace(NSRange(location: content.location, length: prefix.length), with: NSAttributedString(string: "", attributes: baseAttributes()))
            restyleParagraphs(NSRange(location: content.location, length: 0))
        case .outdent:
            setLevel(level - 1, forParagraphAt: caret)
        }
    }

    private func plainNewline(_ sender: Any?) {
        let caret = selectedRange().location
        let para = paragraphRange(at: caret)
        let content = contentRange(ofParagraph: para)
        let line = nsString.substring(with: content)
        guard let prefix = SmartBullets.plainPrefix(line: line), caret >= content.location + prefix.totalLength else {
            super.insertNewline(sender); return
        }
        breakUndoCoalescing()
        if SmartBullets.plainIsEmptyItem(line: line, prefix: prefix) {
            replace(NSRange(location: content.location, length: prefix.totalLength), with: NSAttributedString(string: "", attributes: typingAttributes))
        } else {
            replace(NSRange(location: caret, length: 0),
                    with: NSAttributedString(string: "\n" + SmartBullets.plainContinuation(of: prefix), attributes: typingAttributes))
        }
    }

    override func insertTab(_ sender: Any?) {
        guard smartBulletsEnabled, !hasMarkedText() else { super.insertTab(sender); return }
        let caret = selectedRange().location
        let para = paragraphRange(at: caret)
        if isRichMode {
            if listPrefix(ofParagraph: para) != nil || selectedRange().length > 0 && isMultiParagraphSelection {
                indentSelectedParagraphs(by: 1)
                return
            }
        } else {
            let content = contentRange(ofParagraph: para)
            if SmartBullets.plainPrefix(line: nsString.substring(with: content)) != nil {
                replace(NSRange(location: content.location, length: 0),
                        with: NSAttributedString(string: MarkdownSerializer.indentUnit, attributes: typingAttributes), selectAfter: false)
                setSelectedRange(NSRange(location: caret + MarkdownSerializer.indentUnit.count, length: 0))
                return
            }
        }
        super.insertTab(sender)
    }

    override func insertBacktab(_ sender: Any?) {
        guard smartBulletsEnabled else { super.insertBacktab(sender); return }
        let caret = selectedRange().location
        let para = paragraphRange(at: caret)
        if isRichMode {
            if paragraphLevel(para) > 0 || isMultiParagraphSelection { indentSelectedParagraphs(by: -1) }
            return
        }
        let content = contentRange(ofParagraph: para)
        let line = nsString.substring(with: content)
        let removable = line.hasPrefix("\t") ? 1 : min(4, line.prefix(while: { $0 == " " }).count)
        guard removable > 0 else { return }
        replace(NSRange(location: content.location, length: removable), with: NSAttributedString(string: "", attributes: typingAttributes), selectAfter: false)
        setSelectedRange(NSRange(location: max(content.location, caret - removable), length: 0))
    }

    private var isMultiParagraphSelection: Bool {
        let sel = selectedRange()
        return sel.length > 0 && nsString.substring(with: sel).contains("\n")
    }

    func indentSelectedParagraphs(by delta: Int) {
        let sel = selectedRange()
        let range = nsString.paragraphRange(for: sel)
        changeAttributes(in: range) { storage in
            self.nsString.enumerateSubstrings(in: range, options: [.byParagraphs, .substringNotRequired]) { _, _, enclosing, _ in
                let ps = storage.attribute(.paragraphStyle, at: enclosing.location, effectiveRange: nil) as? NSParagraphStyle
                let level = max(0, min(SmartBullets.maxLevel, TextStyler.level(of: ps) + delta))
                let newPS = TextStyler.paragraphStyle(level: level, markerWidth: 0, heading: 0, style: self.style)
                storage.addAttribute(.paragraphStyle, value: newPS, range: enclosing)
            }
            TextStyler.restyle(storage, range: range, style: self.style)
        }
        setSelectedRange(sel)
        refreshTypingAttributes()
    }

    private func setLevel(_ level: Int, forParagraphAt location: Int) {
        let para = paragraphRange(at: location)
        changeAttributes(in: para) { storage in
            let ps = TextStyler.paragraphStyle(level: max(0, level), markerWidth: 0, heading: 0, style: self.style)
            storage.addAttribute(.paragraphStyle, value: ps, range: para)
            TextStyler.restyle(storage, range: para, style: self.style)
        }
        refreshTypingAttributes()
    }

    // MARK: - Checkboxes, images, cursor

    func checkboxIndex(at point: NSPoint) -> Int? {
        guard isRichMode, let storage = textStorage, storage.length > 0 else { return nil }
        let i = characterIndexForInsertion(at: point)
        for candidate in [i, i - 1] where candidate >= 0 && candidate < storage.length {
            guard storage.attribute(.quickNoteCheckbox, at: candidate, effectiveRange: nil) != nil,
                  let rect = rect(forCharacterRange: NSRange(location: candidate, length: 1)) else { continue }
            if rect.insetBy(dx: -4, dy: -3).contains(point) { return candidate }
        }
        return nil
    }

    func imageAttachment(at point: NSPoint) -> (Int, ImageAttachment)? {
        guard let storage = textStorage, storage.length > 0 else { return nil }
        let i = characterIndexForInsertion(at: point)
        for candidate in [i, i - 1] where candidate >= 0 && candidate < storage.length {
            guard let image = storage.attribute(.attachment, at: candidate, effectiveRange: nil) as? ImageAttachment,
                  let rect = rect(forCharacterRange: NSRange(location: candidate, length: 1)), rect.contains(point) else { continue }
            return (candidate, image)
        }
        return nil
    }

    func toggleCheckbox(at index: Int) {
        guard let storage = textStorage, let checked = storage.attribute(.quickNoteCheckbox, at: index, effectiveRange: nil) as? Bool else { return }
        let range = NSRange(location: index, length: 1)
        breakUndoCoalescing()
        changeAttributes(in: range) { s in
            s.addAttribute(.attachment, value: CheckboxAttachment(checked: !checked), range: range)
            s.addAttribute(.quickNoteCheckbox, value: !checked, range: range)
        }
        restyleParagraphs(range)
        breakUndoCoalescing()
        if !checked { animateCheck(at: range) }
        NSAccessibility.post(element: self, notification: .valueChanged)
    }

    private func animateCheck(at range: NSRange) {
        guard Motion.isEnabled, let rect = rect(forCharacterRange: range), let layer else { return }
        let pop = CALayer()
        pop.frame = rect
        pop.contentsGravity = .resizeAspect
        pop.contents = CheckboxAttachment.image(checked: true, size: rect.size)
        pop.contentsScale = window?.backingScaleFactor ?? 2
        layer.addSublayer(pop)
        let anim = CAKeyframeAnimation(keyPath: "transform.scale")
        anim.values = [0.7, 1.14, 1.0]
        anim.keyTimes = [0, 0.6, 1]
        anim.duration = 0.18
        anim.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeInEaseOut)]
        CATransaction.begin()
        CATransaction.setCompletionBlock { pop.removeFromSuperlayer() }
        pop.add(anim, forKey: "pop")
        CATransaction.commit()
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if let index = checkboxIndex(at: point) {
            window?.makeFirstResponder(self)
            toggleCheckbox(at: index)
            return
        }
        if event.clickCount == 2, let (_, image) = imageAttachment(at: point) {
            page?.controller?.quickLook(attachmentID: image.attachmentID)
            return
        }
        super.mouseDown(with: event)
    }

    // MARK: - Context menu

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let point = convert(event.locationInWindow, from: nil)
        if let (index, image) = imageAttachment(at: point) {
            setSelectedRange(NSRange(location: index, length: 1))
            let items: [NSMenuItem] = [
                item(String(localized: "Quick Look"), #selector(quickLookImage(_:)), image.attachmentID),
                item(String(localized: "Copy Image"), #selector(copyImage(_:)), image.attachmentID),
                item(String(localized: "Save Image As…"), #selector(saveImage(_:)), image.attachmentID),
                item(String(localized: "Remove Image"), #selector(removeImage(_:)), index),
                .separator(),
            ]
            for (i, it) in items.enumerated() { menu.insertItem(it, at: i) }
        }
        menu.addItem(.separator())
        let divider = NSMenuItem(title: String(localized: "Insert Divider"), action: nil, keyEquivalent: "")
        divider.submenu = DividerMenu.make()
        menu.addItem(divider)
        menu.addItem(withTitle: String(localized: "Insert Checkbox"), action: #selector(quickNoteInsertCheckbox(_:)), keyEquivalent: "")
        menu.addItem(withTitle: String(localized: "Copy as Markdown"), action: #selector(copyAsMarkdown(_:)), keyEquivalent: "")
        let shot = NSMenuItem(title: "Screenshot into This Note…", action: #selector(captureScreenshot(_:)), keyEquivalent: "")
        shot.target = self
        menu.addItem(shot)
        if menu.items.first(where: { $0.action == #selector(NSApplication.orderFrontCharacterPalette(_:)) }) == nil {
            menu.addItem(withTitle: String(localized: "Emoji & Symbols"), action: #selector(NSApplication.orderFrontCharacterPalette(_:)), keyEquivalent: "")
        }
        return menu
    }

    private func item(_ title: String, _ action: Selector, _ represented: Any) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        i.representedObject = represented
        return i
    }

    @objc func captureScreenshot(_ sender: Any?) { page?.controller?.model?.capture(.region) }

    @objc func quickLookImage(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? UUID { page?.controller?.quickLook(attachmentID: id) }
    }

    @objc func copyImage(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? UUID { page?.controller?.copyImage(attachmentID: id) }
    }

    @objc func saveImage(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? UUID { page?.controller?.saveImage(attachmentID: id) }
    }

    @objc func removeImage(_ sender: NSMenuItem) {
        guard let index = sender.representedObject as? Int, index < (textStorage?.length ?? 0) else { return }
        replace(NSRange(location: index, length: 1), with: NSAttributedString(string: ""))
    }

    // MARK: - Formatting commands

    private func semantics(of attrs: [NSAttributedString.Key: Any]) -> (bold: Bool, italic: Bool, heading: Int, code: Bool) {
        let font = attrs[.font] as? NSFont ?? style.baseFont
        let t = Typography.traits(of: font)
        let heading = attrs[.quickNoteHeading] as? Int ?? 0
        return (t.bold && heading == 0, t.italic, heading, (attrs[.quickNoteCode] as? Bool) ?? false)
    }

    private enum Trait { case bold, italic }

    private func toggle(_ trait: Trait) {
        if !isRichMode {
            wrapPlainSelection(trait == .bold ? "**" : "*")
            return
        }
        let sel = selectedRange()
        guard let storage = textStorage else { return }
        if sel.length == 0 {
            var attrs = typingAttributes
            var s = semantics(of: attrs)
            if trait == .bold { s.bold.toggle() } else { s.italic.toggle() }
            attrs[.font] = Typography.font(base: style.baseFont, bold: s.bold, italic: s.italic, heading: s.heading, code: s.code)
            typingAttributes = attrs
            return
        }
        var allHave = true
        storage.enumerateAttributes(in: sel) { attrs, _, stop in
            let s = self.semantics(of: attrs)
            if (trait == .bold ? !s.bold : !s.italic) { allHave = false; stop.pointee = true }
        }
        changeAttributes(in: sel) { storage in
            storage.enumerateAttributes(in: sel) { attrs, range, _ in
                var s = self.semantics(of: attrs)
                if trait == .bold { s.bold = !allHave } else { s.italic = !allHave }
                storage.addAttribute(.font, value: Typography.font(base: self.style.baseFont, bold: s.bold, italic: s.italic,
                                                                    heading: s.heading, code: s.code), range: range)
            }
        }
        setSelectedRange(sel)
    }

    private func wrapPlainSelection(_ marker: String, closing: String? = nil) {
        let sel = selectedRange()
        let close = closing ?? marker
        let selected = nsString.substring(with: sel)
        if selected.hasPrefix(marker), selected.hasSuffix(close), selected.count >= marker.count + close.count {
            let inner = String(selected.dropFirst(marker.count).dropLast(close.count))
            replace(sel, with: NSAttributedString(string: inner, attributes: typingAttributes), selectAfter: false)
            setSelectedRange(NSRange(location: sel.location, length: (inner as NSString).length))
        } else {
            replace(sel, with: NSAttributedString(string: marker + selected + close, attributes: typingAttributes), selectAfter: false)
            setSelectedRange(NSRange(location: sel.location + (marker as NSString).length, length: sel.length))
        }
    }

    @objc func quickNoteToggleBold(_ sender: Any?) { toggle(.bold) }
    @objc func quickNoteToggleItalic(_ sender: Any?) { toggle(.italic) }

    override func underline(_ sender: Any?) {
        if isRichMode { toggleAttribute(.underlineStyle) } else { wrapPlainSelection("<u>", closing: "</u>") }
    }

    @objc func quickNoteToggleStrikethrough(_ sender: Any?) {
        if isRichMode { toggleAttribute(.strikethroughStyle) } else { wrapPlainSelection("~~") }
    }

    private func toggleAttribute(_ key: NSAttributedString.Key) {
        let sel = selectedRange()
        guard let storage = textStorage else { return }
        if sel.length == 0 {
            var attrs = typingAttributes
            let on = (attrs[key] as? Int ?? 0) != 0
            attrs[key] = on ? nil : NSUnderlineStyle.single.rawValue
            typingAttributes = attrs
            return
        }
        var allHave = true
        storage.enumerateAttribute(key, in: sel) { v, _, stop in
            if (v as? Int ?? 0) == 0 { allHave = false; stop.pointee = true }
        }
        changeAttributes(in: sel) { s in
            if allHave { s.removeAttribute(key, range: sel) } else { s.addAttribute(key, value: NSUnderlineStyle.single.rawValue, range: sel) }
        }
        setSelectedRange(sel)
    }

    @objc func quickNoteToggleCode(_ sender: Any?) {
        guard isRichMode else { wrapPlainSelection("`"); return }
        let sel = selectedRange()
        guard sel.length > 0, let storage = textStorage else { return }
        var allHave = true
        storage.enumerateAttribute(.quickNoteCode, in: sel) { v, _, stop in
            if (v as? Bool) != true { allHave = false; stop.pointee = true }
        }
        changeAttributes(in: sel) { s in
            if allHave { s.removeAttribute(.quickNoteCode, range: sel) } else { s.addAttribute(.quickNoteCode, value: true, range: sel) }
            TextStyler.restyle(s, range: sel, style: self.style)
        }
        setSelectedRange(sel)
    }

    /// Menu item tag = heading level (0 = body text).
    @objc func quickNoteSetHeading(_ sender: Any?) {
        let level = (sender as? NSMenuItem)?.tag ?? 0
        let sel = selectedRange()
        let range = nsString.paragraphRange(for: sel)
        if !isRichMode {
            let content = contentRange(ofParagraph: range)
            let line = nsString.substring(with: content)
            let stripped = line.drop(while: { $0 == "#" }).drop(while: { $0 == " " })
            let newLine = (level > 0 ? String(repeating: "#", count: level) + " " : "") + stripped
            replace(content, with: NSAttributedString(string: newLine, attributes: typingAttributes))
            return
        }
        changeAttributes(in: range) { s in
            self.nsString.enumerateSubstrings(in: range, options: [.byParagraphs, .substringNotRequired]) { _, pRange, _, _ in
                guard pRange.length > 0 else { return }
                if level == 0 { s.removeAttribute(.quickNoteHeading, range: pRange) } else { s.addAttribute(.quickNoteHeading, value: level, range: pRange) }
            }
            TextStyler.restyle(s, range: range, style: self.style)
        }
        setSelectedRange(sel)
        refreshTypingAttributes()
    }

    @objc func quickNoteInsertCheckbox(_ sender: Any?) {
        let caret = selectedRange().location
        let para = paragraphRange(at: caret)
        let content = contentRange(ofParagraph: para)
        if !isRichMode {
            let line = nsString.substring(with: content)
            if SmartBullets.plainPrefix(line: line)?.isTask == true { return }
            replace(NSRange(location: content.location, length: 0), with: NSAttributedString(string: "- [ ] ", attributes: typingAttributes), selectAfter: false)
            setSelectedRange(NSRange(location: caret + 6, length: 0))
            return
        }
        if let prefix = listPrefix(ofParagraph: para) {
            if prefix.marker.isCheckbox { return }
            // Replace an existing bullet/number with a checkbox.
            replace(NSRange(location: content.location, length: prefix.length), with: markerAttributedString(.checkbox(checked: false), level: paragraphLevel(para)), selectAfter: false)
        } else {
            replace(NSRange(location: content.location, length: 0), with: markerAttributedString(.checkbox(checked: false), level: paragraphLevel(para)), selectAfter: false)
            setSelectedRange(NSRange(location: caret + 2, length: 0))
        }
        restyleParagraphs(NSRange(location: content.location, length: 0))
    }

    /// Menu item tag = index into `DividerStyle.allCases`; -1 = the default style from Settings.
    @objc func quickNoteInsertDivider(_ sender: Any?) {
        let tag = (sender as? NSMenuItem)?.tag ?? -1
        let dividerStyle = DividerStyle.allCases.indices.contains(tag) ? DividerStyle.allCases[tag] : (page?.controller?.defaultDividerStyle ?? .thin)
        let sel = selectedRange()
        let before = sel.location > 0 ? nsString.character(at: sel.location - 1) : 0x0A
        if !isRichMode {
            let s = (before == 0x0A ? "" : "\n") + "---\n"
            replace(sel, with: NSAttributedString(string: s, attributes: typingAttributes))
            return
        }
        let out = NSMutableAttributedString()
        let attrs = baseAttributes()
        if before != 0x0A { out.append(NSAttributedString(string: "\n", attributes: attrs)) }
        var dAttrs = attrs
        dAttrs[.attachment] = DividerAttachment(style: dividerStyle)
        out.append(NSAttributedString(string: AttachmentChar.string, attributes: dAttrs))
        out.append(NSAttributedString(string: "\n", attributes: attrs))
        breakUndoCoalescing()
        replace(sel, with: out)
        typingAttributes = attrs
    }

    @objc func copyAsMarkdown(_ sender: Any?) {
        let sel = selectedRange()
        let range = sel.length > 0 ? sel : NSRange(location: 0, length: nsString.length)
        guard let storage = textStorage else { return }
        let md = isRichMode ? AttributedMarkdown.markdown(from: storage.attributedSubstring(from: range)) : nsString.substring(with: range)
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(md, forType: .string)
        page?.controller?.model?.showToast(String(localized: "Copied as Markdown"), symbol: "doc.on.clipboard")
    }

    @objc func editLink(_ sender: Any?) {
        var sel = selectedRange()
        var existing: String?
        if let storage = textStorage, storage.length > 0 {
            let probe = min(sel.location, storage.length - 1)
            var effective = NSRange()
            if let link = storage.attribute(.link, at: probe, longestEffectiveRange: &effective, in: NSRange(location: 0, length: storage.length)) {
                existing = AttributedMarkdown.linkString(link)
                if sel.length == 0 { sel = effective }
            }
        }
        page?.controller?.model?.presentLinkEditor(range: sel, url: existing, text: nsString.substring(with: sel))
    }

    func applyLink(_ url: String?, text: String?, to range: NSRange) {
        guard let storage = textStorage, NSMaxRange(range) <= storage.length else { return }
        var target = range
        if let text, !text.isEmpty, text != nsString.substring(with: range) {
            replace(range, with: NSAttributedString(string: text, attributes: typingAttributes), selectAfter: false)
            target = NSRange(location: range.location, length: (text as NSString).length)
        }
        guard target.length > 0 else { return }
        if !isRichMode, let url, !url.isEmpty {
            let md = "[\(nsString.substring(with: target))](\(url))"
            replace(target, with: NSAttributedString(string: md, attributes: typingAttributes))
            return
        }
        changeAttributes(in: target) { s in
            if let url, !url.isEmpty {
                s.addAttribute(.link, value: URL(string: url) ?? url, range: target)
            } else {
                s.removeAttribute(.link, range: target)
            }
        }
        setSelectedRange(NSRange(location: NSMaxRange(target), length: 0))
    }

    override func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        let attrs: [NSAttributedString.Key: Any] = {
            let sel = selectedRange()
            guard let storage = textStorage, storage.length > 0, sel.length > 0 else { return typingAttributes }
            return storage.attributes(at: sel.location, effectiveRange: nil)
        }()
        switch menuItem.action {
        case #selector(quickNoteToggleBold(_:)):
            menuItem.state = isRichMode && semantics(of: attrs).bold ? .on : .off
        case #selector(quickNoteToggleItalic(_:)):
            menuItem.state = isRichMode && semantics(of: attrs).italic ? .on : .off
        case #selector(quickNoteToggleStrikethrough(_:)):
            menuItem.state = isRichMode && (attrs[.strikethroughStyle] as? Int ?? 0) != 0 ? .on : .off
        case #selector(underline(_:)):
            menuItem.state = isRichMode && (attrs[.underlineStyle] as? Int ?? 0) != 0 ? .on : .off
        case #selector(quickNoteToggleCode(_:)):
            menuItem.state = isRichMode && (attrs[.quickNoteCode] as? Bool ?? false) ? .on : .off
            return selectedRange().length > 0 || !isRichMode
        case #selector(quickNoteSetHeading(_:)):
            menuItem.state = isRichMode && (attrs[.quickNoteHeading] as? Int ?? 0) == menuItem.tag ? .on : .off
        default:
            break
        }
        return super.validateMenuItem(menuItem)
    }

    // MARK: - Pasteboard

    override var writablePasteboardTypes: [NSPasteboard.PasteboardType] {
        [Self.markdownPasteboardType, .rtf, .string, .png]
    }

    override func writeSelection(to pboard: NSPasteboard, types: [NSPasteboard.PasteboardType]) -> Bool {
        let sel = selectedRange()
        guard sel.length > 0, let storage = textStorage else { return false }
        let fragment = storage.attributedSubstring(from: sel)
        var declared: [NSPasteboard.PasteboardType] = [Self.markdownPasteboardType, .string]
        if isRichMode { declared.insert(.rtf, at: 1) }
        var imageData: Data?
        if sel.length == 1, let image = fragment.attribute(.attachment, at: 0, effectiveRange: nil) as? ImageAttachment,
           let data = page?.controller?.attachmentData(id: image.attachmentID) {
            imageData = data
            declared.append(.png)
        }
        pboard.declareTypes(declared, owner: nil)
        if isRichMode {
            pboard.setString(AttributedMarkdown.markdown(from: fragment), forType: Self.markdownPasteboardType)
            pboard.setData(RichTextCodec.displayRTF(fragment), forType: .rtf)
            pboard.setString(AttributedMarkdown.readableText(from: fragment), forType: .string)
        } else {
            pboard.setString(fragment.string, forType: Self.markdownPasteboardType)
            pboard.setString(fragment.string, forType: .string)
        }
        if let imageData {
            if let rep = NSBitmapImageRep(data: imageData), let png = rep.representation(using: .png, properties: [:]) {
                pboard.setData(png, forType: .png)
            }
        }
        return true
    }

    override var readablePasteboardTypes: [NSPasteboard.PasteboardType] {
        [Self.markdownPasteboardType, .fileURL, .png, .tiff, NSPasteboard.PasteboardType(UTType.heic.identifier),
         NSPasteboard.PasteboardType(UTType.jpeg.identifier), .rtfd, .rtf, .string, .URL]
    }

    override func readSelection(from pboard: NSPasteboard, type: NSPasteboard.PasteboardType) -> Bool {
        insertContents(of: pboard, preferPlain: false)
    }

    override func readSelection(from pboard: NSPasteboard) -> Bool {
        insertContents(of: pboard, preferPlain: false)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        _ = insertContents(of: .general, preferPlain: true)
    }

    override func paste(_ sender: Any?) {
        if !insertContents(of: .general, preferPlain: false) { super.paste(sender) }
    }

    /// The one entry point for paste and drop.
    @discardableResult
    func insertContents(of pboard: NSPasteboard, preferPlain: Bool) -> Bool {
        let sel = selectedRange()
        guard let controller = page?.controller else { return false }
        let style = self.style
        let provider: AttributedMarkdown.ImageProvider = { [weak controller] id in controller?.imageAttachment(id: id) }

        func insertMarkdown(_ md: String) -> Bool {
            if isRichMode {
                let rich = AttributedMarkdown.attributedString(fromMarkdown: md, style: style, imageProvider: provider)
                return insertFragment(rich, at: sel)
            }
            return replace(sel, with: NSAttributedString(string: md, attributes: typingAttributes))
        }

        if preferPlain, let s = pboard.string(forType: .string) {
            return replace(sel, with: NSAttributedString(string: s, attributes: typingAttributes))
        }
        if let md = pboard.string(forType: Self.markdownPasteboardType) {
            return insertMarkdown(md)
        }
        if let urls = pboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            let fragment = NSMutableAttributedString()
            for url in urls {
                if let piece = controller.fragment(forFile: url, rich: isRichMode) {
                    if fragment.length > 0 { fragment.append(NSAttributedString(string: "\n", attributes: baseAttributes())) }
                    fragment.append(piece)
                }
            }
            return fragment.length > 0 ? insertFragment(fragment, at: sel) : false
        }
        for type in [NSPasteboard.PasteboardType.png, .tiff, NSPasteboard.PasteboardType(UTType.heic.identifier),
                     NSPasteboard.PasteboardType(UTType.jpeg.identifier)] {
            if let data = pboard.data(forType: type), pboard.string(forType: .string) == nil || type == .png {
                if let piece = controller.imageFragment(data: data, suggestedName: String(localized: "Pasted Image"), rich: isRichMode) {
                    return insertFragment(piece, at: sel)
                }
            }
        }
        if let rtf = pboard.data(forType: .rtf) ?? pboard.data(forType: .rtfd),
           let foreign = NSAttributedString(rtf: rtf, documentAttributes: nil) ?? NSAttributedString(rtfd: rtf, documentAttributes: nil) {
            if isRichMode {
                return insertFragment(RichTextCodec.sanitizeForeign(foreign, style: style, imageProvider: provider), at: sel)
            }
            return replace(sel, with: NSAttributedString(string: AttributedMarkdown.markdown(from: foreign, source: .foreign), attributes: typingAttributes))
        }
        if let s = pboard.string(forType: .string) {
            if isRichMode && MarkdownDetector.looksLikeMarkdown(s) { return insertMarkdown(s) }
            let normalized = s.replacingOccurrences(of: "\r\n", with: "\n")
            if isRichMode {
                return insertFragment(NSAttributedString(string: normalized, attributes: baseAttributes(level: paragraphLevel(paragraphRange(at: sel.location)))), at: sel)
            }
            return replace(sel, with: NSAttributedString(string: normalized, attributes: typingAttributes))
        }
        if let url = pboard.readObjects(forClasses: [NSURL.self], options: nil)?.first as? URL {
            var attrs = typingAttributes
            attrs[.link] = url
            return replace(sel, with: NSAttributedString(string: url.absoluteString, attributes: attrs))
        }
        return false
    }

    private func insertFragment(_ fragment: NSAttributedString, at range: NSRange) -> Bool {
        breakUndoCoalescing()
        guard replace(range, with: fragment) else { return false }
        if isRichMode { restyleParagraphs(NSRange(location: range.location, length: fragment.length)) }
        breakUndoCoalescing()
        return true
    }

    // MARK: - Keyboard

    override func keyDown(with event: NSEvent) {
        // ⌃Tab / ⌃⇧Tab switch dots even while typing.
        if event.keyCode == 48, event.modifierFlags.contains(.control) {
            if event.modifierFlags.contains(.shift) { page?.controller?.model?.selectPreviousDot() } else { page?.controller?.model?.selectNextDot() }
            return
        }
        super.keyDown(with: event)
    }

    override func cancelOperation(_ sender: Any?) {
        // Esc with the find bar open closes the find bar first; otherwise hides Notlet.
        if let scroll = enclosingScrollView, scroll.isFindBarVisible {
            scroll.isFindBarVisible = false
            return
        }
        page?.controller?.model?.hidePanel()
    }

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok { refreshTypingAttributes() }
        return ok
    }
}

enum MarkdownDetector {
    private static let patterns: [NSRegularExpression] = [
        #"(?m)^#{1,6} \S"#, #"(?m)^\s*[-*+] \[[ xX]\] "#, #"(?m)^\s*[-*+] \S"#, #"(?m)^\s*\d{1,3}[.)] \S"#,
        #"\*\*[^*\n]+\*\*"#, #"__[^_\n]+__"#, #"~~[^~\n]+~~"#, #"`[^`\n]+`"#, #"\[[^\]\n]+\]\([^)\s]+\)"#,
        #"(?m)^(-{3,}|\*{3,}|_{3,})\s*$"#, #"<u>.+</u>"#,
    ].compactMap { try? NSRegularExpression(pattern: $0) }

    static func looksLikeMarkdown(_ s: String) -> Bool {
        let range = NSRange(location: 0, length: min((s as NSString).length, 20_000))
        return patterns.contains { $0.firstMatch(in: s, range: range) != nil }
    }
}

enum DividerMenu {
    @MainActor
    static func make() -> NSMenu {
        let menu = NSMenu()
        for (i, style) in DividerStyle.allCases.enumerated() {
            let item = NSMenuItem(title: style.title, action: #selector(QuickNoteTextView.quickNoteInsertDivider(_:)), keyEquivalent: "")
            item.tag = i
            item.image = DividerMenu.preview(style)
            menu.addItem(item)
        }
        return menu
    }

    @MainActor
    static func preview(_ style: DividerStyle) -> NSImage {
        NSImage(size: NSSize(width: 44, height: 12), flipped: false) { rect in
            style.draw(in: rect, scale: 2)
            return true
        }
    }
}
