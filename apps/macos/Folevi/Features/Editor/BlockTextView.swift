import AppKit
import SwiftUI

/// Key commands a text block forwards to the editor model.
enum BlockKeyCommand {
    case split(left: [InlineNode], right: [InlineNode], atStart: Bool)
    case backspaceAtStart
    case deleteForwardAtEnd
    case indent
    case outdent
    case focusPrevious(caretAtEnd: Bool)
    case focusNext(caretAtStart: Bool)
    case moveBlock(up: Bool)
    case escape
    case selectBlockExtending(up: Bool)
}

/// NSTextView subclass for one block: TextKit 1 stack, marked text/IME, spelling, services,
/// per-block undo (typing bursts), key routing to the editor, placeholder drawing.
final class BlockTextView: NSTextView {
    var blockId = ""
    var placeholder = ""
    var showsPlaceholderWhenUnfocused = false
    var onCommand: ((BlockKeyCommand) -> Bool)?
    var onFocusChange: ((Bool) -> Void)?
    var forwardUndo: (() -> Void)?
    var forwardRedo: (() -> Void)?
    var canForwardUndo: (() -> Bool)?
    var canForwardRedo: (() -> Bool)?
    let privateUndo = UndoManager()
    var menuInterceptsArrows: (() -> Bool)?
    var onMenuKey: ((MenuKey) -> Bool)?
    var accessibilityBlockLabel = ""
    /// Code blocks: Return inserts a newline, Tab inserts spaces, no Markdown shortcuts.
    var isCode = false
    /// Plain single-field mode (document title): Return submits.
    var isPlain = false
    /// AI on the selected text: a task (nil opens the composer), a language for Translate, the range and
    /// the text. Nil hides the AI menu.
    var onAiTask: ((_ task: String?, _ language: String?, _ range: NSRange, _ text: String) -> Void)?
    /// ⌘J: the AI composer (or, in the title, the title's AI). Returns whether it was handled.
    var onAiShortcut: (() -> Bool)?
    /// Whether AI writing is offered right now (the AI menu shows only then).
    var aiOffered: (() -> Bool)?

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let range = selectedRange()
        guard aiOffered?() == true else { return menu }
        if isPlain, let onAiShortcut {
            // The title: "Edit with AI" (the selected words, or the whole title).
            menu.insertItem(ClosureMenuItem(String(localized: "Edit with AI"), key: "j", modifiers: [.command], enabled: true) { _ = onAiShortcut() }, at: 0)
            menu.insertItem(.separator(), at: 1)
            return menu
        }
        guard let onAiTask, range.length > 0, !isCode else { return menu }
        let text = (string as NSString).substring(with: range)
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return menu }
        // The same actions as the web's AI menu on selected text.
        let ai = NSMenu(title: String(localized: "AI"))
        ai.addItem(ClosureMenuItem(String(localized: "Ask AI…"), key: "j", modifiers: [.command], enabled: true) { onAiTask(nil, nil, range, text) })
        ai.addItem(.separator())
        for s in AiCatalog.edit {
            if s.languages {
                let languages = NSMenu(title: s.label)
                for language in AiCatalog.languages {
                    languages.addItem(ClosureMenuItem(language, enabled: true) { onAiTask("translate", language, range, text) })
                }
                let item = NSMenuItem(title: s.label.replacingOccurrences(of: "…", with: ""), action: nil, keyEquivalent: "")
                item.submenu = languages
                ai.addItem(item)
            } else if let task = s.task {
                ai.addItem(ClosureMenuItem(s.label, enabled: true) { onAiTask(task, nil, range, text) })
            }
        }
        let item = NSMenuItem(title: String(localized: "AI"), action: nil, keyEquivalent: "")
        item.submenu = ai
        menu.insertItem(item, at: 0)
        menu.insertItem(.separator(), at: 1)
        return menu
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        if flags == .command, event.charactersIgnoringModifiers?.lowercased() == "j", window?.firstResponder === self,
           let onAiShortcut, onAiShortcut() {
            return true
        }
        if window?.firstResponder === self, shortcutHandled(event) { return true }
        return super.performKeyEquivalent(with: event)
    }

    enum MenuKey { case up, down, commit, cancel }

    static func make() -> BlockTextView {
        let storage = NSTextStorage()
        let layout = NSLayoutManager()
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 600, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        let view = BlockTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 24), textContainer: container)
        view.isRichText = true
        view.importsGraphics = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.isVerticallyResizable = false
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainerInset = .zero
        view.isContinuousSpellCheckingEnabled = true
        view.isGrammarCheckingEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isAutomaticQuoteSubstitutionEnabled = true
        view.isAutomaticDashSubstitutionEnabled = true
        view.isAutomaticLinkDetectionEnabled = false
        view.usesFindBar = false
        view.usesFontPanel = false
        // No system Writing Tools orb floating beside the caret: Folevi has its own AI (⌘J), as on the web.
        view.writingToolsBehavior = .none
        view.focusRingType = .none
        view.linkTextAttributes = [.cursor: NSCursor.pointingHand]
        view.selectedTextAttributes = [.backgroundColor: NSColor.foleviSelection]
        view.insertionPointColor = NSColor.foleviInk
        return view
    }

    override var acceptsFirstResponder: Bool { true }

    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok { onFocusChange?(true) }
        needsDisplay = true
        return ok
    }

    override func resignFirstResponder() -> Bool {
        let ok = super.resignFirstResponder()
        if ok { onFocusChange?(false) }
        needsDisplay = true
        return ok
    }

    // MARK: Sizing

    func height(forWidth width: CGFloat) -> CGFloat {
        guard let container = textContainer, let layout = layoutManager else { return 22 }
        let measureWidth = max(20, width)
        let original = container.containerSize
        if container.containerSize.width != measureWidth {
            container.containerSize = NSSize(width: measureWidth, height: .greatestFiniteMagnitude)
        }
        layout.ensureLayout(for: container)
        var h = layout.usedRect(for: container).height
        let font = (typingAttributes[.font] as? NSFont) ?? FoleviFont.nsFont(.sans, size: 16)
        let lineHeight = layout.defaultLineHeight(for: font)
        if string.isEmpty || h < lineHeight { h = max(h, lineHeight) }
        // Measuring must not change how the view currently wraps.
        if bounds.width > 0, abs(bounds.width - measureWidth) > 0.5 {
            container.containerSize = NSSize(width: bounds.width, height: original.height)
        }
        return ceil(h + textContainerInset.height * 2)
    }

    /// Called instead of AppKit's ancestor scrolling (SwiftUI's ScrollView is not an NSClipView, so the
    /// default implementation would scroll the whole window).
    var onRevealRequest: (() -> Void)?

    override func scrollToVisible(_ rect: NSRect) -> Bool {
        onRevealRequest?()
        return true
    }

    override func scrollRangeToVisible(_ range: NSRange) {
        onRevealRequest?()
    }

    override func setFrameSize(_ newSize: NSSize) {
        let widthChanged = abs(newSize.width - frame.width) > 0.5
        super.setFrameSize(newSize)
        if widthChanged { invalidateIntrinsicContentSize() }
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: height(forWidth: bounds.width > 0 ? bounds.width : 600))
    }

    override func didChangeText() {
        super.didChangeText()
        invalidateIntrinsicContentSize()
    }

    // MARK: Placeholder

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty, !hasMarkedText() else { return }
        let focused = window?.firstResponder === self
        guard focused || showsPlaceholderWhenUnfocused else { return }
        let font = (typingAttributes[.font] as? NSFont) ?? FoleviFont.nsFont(.sans, size: 16)
        let kern = (typingAttributes[.kern] as? CGFloat) ?? 0
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.foleviInkFaint, .kern: kern]
        (placeholder as NSString).draw(at: NSPoint(x: textContainerInset.width, y: textContainerInset.height), withAttributes: attrs)
    }

    // MARK: Caret geometry

    private func lineRect(at charIndex: Int) -> NSRect? {
        guard let layout = layoutManager, let container = textContainer else { return nil }
        if string.isEmpty { return .zero }
        let glyphCount = layout.numberOfGlyphs
        if charIndex >= (string as NSString).length {
            let extra = layout.extraLineFragmentRect
            if extra != .zero { return extra }
            if glyphCount == 0 { return .zero }
            return layout.lineFragmentRect(forGlyphAt: glyphCount - 1, effectiveRange: nil)
        }
        let glyph = layout.glyphIndexForCharacter(at: charIndex)
        _ = container
        return layout.lineFragmentRect(forGlyphAt: min(glyph, max(0, glyphCount - 1)), effectiveRange: nil)
    }

    var caretOnFirstLine: Bool {
        guard let r = lineRect(at: selectedRange().location), let first = lineRect(at: 0) else { return true }
        return abs(r.minY - first.minY) < 1
    }

    func lineIsLast(_ location: Int) -> Bool {
        guard let r = lineRect(at: location), let last = lineRect(at: (string as NSString).length) else { return true }
        return abs(r.minY - last.minY) < 1
    }

    var caretOnLastLine: Bool {
        guard let r = lineRect(at: selectedRange().location), let last = lineRect(at: (string as NSString).length) else { return true }
        return abs(r.minY - last.minY) < 1
    }

    // MARK: Undo (per-block typing undo, falling back to the editor's structural undo)

    override var undoManager: UndoManager? { privateUndo }

    @objc func undo(_ sender: Any?) {
        if privateUndo.canUndo { privateUndo.undo() } else { forwardUndo?() }
    }

    @objc func redo(_ sender: Any?) {
        if privateUndo.canRedo { privateUndo.redo() } else { forwardRedo?() }
    }

    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        if item.action == #selector(undo(_:)) { return privateUndo.canUndo || (canForwardUndo?() ?? false) }
        if item.action == #selector(redo(_:)) { return privateUndo.canRedo || (canForwardRedo?() ?? false) }
        return super.validateUserInterfaceItem(item)
    }

    func resetUndo() {
        privateUndo.removeAllActions()
    }

    // MARK: Keys

    /// ⌘↩, ⌘. and ⌘⇧D (the web's Mod-Enter, block menu and task details shortcuts).
    var onShortcut: ((Shortcut) -> Bool)?
    enum Shortcut { case modEnter, blockMenu, taskDetails, highlight }
    /// A click on an inline object (a date chip or a page link). Returns whether it was handled.
    var onInlineClick: ((InlineNode, NSRange, NSEvent) -> Bool)?
    /// Paste: lets the editor turn pasted files, HTML or Markdown into blocks. Returns whether it did.
    var onPaste: ((NSPasteboard) -> Bool)?

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.option) && flags.contains(.shift) && !flags.contains(.command) {
            if event.keyCode == 126, onCommand?(.moveBlock(up: true)) == true { return }
            if event.keyCode == 125, onCommand?(.moveBlock(up: false)) == true { return }
        }
        if shortcutHandled(event) { return }
        super.keyDown(with: event)
    }

    private func shortcutHandled(_ event: NSEvent) -> Bool {
        let mods = event.modifierFlags.intersection([.command, .shift, .option, .control])
        if mods == .command, event.keyCode == 36 || event.keyCode == 76 { return onShortcut?(.modEnter) == true }
        if mods == .command, event.charactersIgnoringModifiers == "." { return onShortcut?(.blockMenu) == true }
        if mods == [.command, .shift], event.keyCode == 2 { return onShortcut?(.taskDetails) == true }
        if mods == [.command, .shift], event.keyCode == 4 { return onShortcut?(.highlight) == true }
        return false
    }

    override func paste(_ sender: Any?) {
        if !isCode, !isPlain, onPaste?(NSPasteboard.general) == true { return }
        super.paste(sender)
    }

    override func mouseDown(with event: NSEvent) {
        if let (node, range) = inlineObject(at: event), onInlineClick?(node, range, event) == true { return }
        super.mouseDown(with: event)
    }

    /// The inline object (mention, date, page link) under the pointer, with its range.
    private func inlineObject(at event: NSEvent) -> (InlineNode, NSRange)? {
        guard let layout = layoutManager, let container = textContainer, let storage = textStorage, storage.length > 0 else { return nil }
        let point = convert(event.locationInWindow, from: nil)
        let p = NSPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
        let glyph = layout.glyphIndex(for: p, in: container)
        guard layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(p) else { return nil }
        let index = layout.characterIndexForGlyph(at: glyph)
        guard index < storage.length else { return nil }
        var range = NSRange()
        guard let json = storage.attribute(.foleviInline, at: index, longestEffectiveRange: &range, in: NSRange(location: 0, length: storage.length)) as? String,
              let node = try? JSONValue(jsonString: json).decode(InlineNode.self) else { return nil }
        return (node, range)
    }

    override func doCommand(by selector: Selector) {
        if handle(selector) { return }
        super.doCommand(by: selector)
    }

    private func handle(_ selector: Selector) -> Bool {
        if menuInterceptsArrows?() == true {
            switch selector {
            case #selector(moveUp(_:)): return onMenuKey?(.up) ?? false
            case #selector(moveDown(_:)): return onMenuKey?(.down) ?? false
            case #selector(insertNewline(_:)), #selector(insertTab(_:)): return onMenuKey?(.commit) ?? false
            case #selector(cancelOperation(_:)): return onMenuKey?(.cancel) ?? false
            default: break
            }
        }
        let sel = selectedRange()
        let length = (string as NSString).length
        if isCode {
            switch selector {
            case #selector(insertNewline(_:)):
                // A plain new line, as the web's code blocks do.
                insertText("\n", replacementRange: sel)
                return true
            case #selector(insertTab(_:)):
                insertText("  ", replacementRange: sel)
                return true
            case #selector(insertBacktab(_:)):
                // ⇧Tab outdents the block (the web's Shift-Tab).
                return onCommand?(.outdent) ?? true
            default:
                break
            }
        }
        switch selector {
        case #selector(insertNewline(_:)):
            if hasMarkedText() { return false }
            let storage = textStorage ?? NSTextStorage()
            // Delete the selection first, then split at the caret.
            if sel.length > 0 { insertText("", replacementRange: sel) }
            let loc = selectedRange().location
            let (left, right) = InlineAttributedString.split(storage, at: loc)
            return onCommand?(.split(left: left, right: right, atStart: loc == 0 && length > 0)) ?? false
        case #selector(insertLineBreak(_:)), #selector(insertNewlineIgnoringFieldEditor(_:)):
            if isPlain { return true }
            insertText("\n", replacementRange: sel)
            return true
        case #selector(deleteBackward(_:)):
            if sel.location == 0 && sel.length == 0 { return onCommand?(.backspaceAtStart) ?? false }
            return false
        case #selector(deleteForward(_:)):
            if sel.location == length && sel.length == 0 { return onCommand?(.deleteForwardAtEnd) ?? false }
            return false
        case #selector(insertTab(_:)):
            return onCommand?(.indent) ?? false
        case #selector(insertBacktab(_:)):
            return onCommand?(.outdent) ?? false
        case #selector(moveUp(_:)):
            if caretOnFirstLine { return onCommand?(.focusPrevious(caretAtEnd: true)) ?? false }
            return false
        case #selector(moveDown(_:)):
            if caretOnLastLine { return onCommand?(.focusNext(caretAtStart: true)) ?? false }
            return false
        case #selector(moveLeft(_:)):
            if sel.location == 0 && sel.length == 0 { return onCommand?(.focusPrevious(caretAtEnd: true)) ?? false }
            return false
        case #selector(moveRight(_:)):
            if sel.location == length && sel.length == 0 { return onCommand?(.focusNext(caretAtStart: true)) ?? false }
            return false
        case #selector(moveUpAndModifySelection(_:)):
            // The web's block selection: ⇧↑ on the first line (⇧↓ on the last) selects whole blocks.
            if caretOnFirstLine { return onCommand?(.selectBlockExtending(up: true)) ?? false }
            return false
        case #selector(moveDownAndModifySelection(_:)):
            if lineIsLast(NSMaxRange(sel)) { return onCommand?(.selectBlockExtending(up: false)) ?? false }
            return false
        case #selector(cancelOperation(_:)):
            return onCommand?(.escape) ?? false
        default:
            return false
        }
    }

    // MARK: Accessibility

    override func accessibilityLabel() -> String? {
        accessibilityBlockLabel.isEmpty ? super.accessibilityLabel() : accessibilityBlockLabel
    }

    override func accessibilityRoleDescription() -> String? {
        accessibilityBlockLabel.isEmpty ? super.accessibilityRoleDescription() : accessibilityBlockLabel
    }
}

// MARK: - SwiftUI bridge

/// A text-bearing block backed by `BlockTextView`.
struct BlockTextEditor: NSViewRepresentable {
    let blockId: String
    let text: [InlineNode]
    let style: TextRenderStyle
    let isEditable: Bool
    let accessibilityLabel: String
    let model: EditorModel
    var focusRequest: FocusRequest?
    var isCode = false
    var isPlain = false
    var alwaysShowPlaceholder = false

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeNSView(context: Context) -> BlockTextView {
        let view = BlockTextView.make()
        view.blockId = blockId
        view.delegate = context.coordinator
        context.coordinator.view = view
        context.coordinator.install(text: text, style: style)
        configure(view, context: context)
        model.register(view, for: blockId)
        return view
    }

    func updateNSView(_ view: BlockTextView, context: Context) {
        context.coordinator.parent = self
        configure(view, context: context)
        let c = context.coordinator
        if c.style != style {
            c.style = style
            c.restyleAll()
        }
        if text != c.lastText && !view.hasMarkedText() {
            c.install(text: text, style: style, preserveSelection: true)
            view.resetUndo()
            // New text: paint the find matches again.
            c.findTextVersion = -1
        }
        model.register(view, for: blockId)
        let highlights = model.findHighlights(for: blockId)
        if highlights.all != c.findHighlights || highlights.current != c.findCurrent || c.findTextVersion != c.lastText.count {
            c.findHighlights = highlights.all
            c.findCurrent = highlights.current
            c.findTextVersion = c.lastText.count
            view.showFindHighlights(highlights.all, current: highlights.current)
        }
        if let request = focusRequest, request.blockId == blockId, c.handledFocus != request.id {
            c.handledFocus = request.id
            c.applyFocus(request, attempt: 0)
        }
    }

    private func configure(_ view: BlockTextView, context: Context) {
        view.isEditable = isEditable
        view.isSelectable = true
        view.isCode = isCode
        view.isPlain = isPlain
        view.isRichText = !(isCode || isPlain)
        if isCode {
            view.isAutomaticQuoteSubstitutionEnabled = false
            view.isAutomaticDashSubstitutionEnabled = false
            view.isContinuousSpellCheckingEnabled = false
            view.isAutomaticTextReplacementEnabled = false
        }
        view.placeholder = style.placeholder
        if view.showsPlaceholderWhenUnfocused != alwaysShowPlaceholder {
            view.showsPlaceholderWhenUnfocused = alwaysShowPlaceholder
            view.needsDisplay = true
        }
        view.accessibilityBlockLabel = accessibilityLabel
        view.setAccessibilityIdentifier("block.\(blockId)")
        let coordinator = context.coordinator
        view.onCommand = { [weak coordinator] command in coordinator?.handle(command) ?? false }
        if !isPlain {
            let blockId = self.blockId
            view.onAiTask = { [weak model] task, language, range, text in
                model?.openInlineAi(blockId: blockId, range: range, text: text, task: task, language: language)
            }
        }
        view.onAiShortcut = { [weak model, weak view] in
            guard let model else { return false }
            return model.aiShortcut(from: view)
        }
        view.aiOffered = { [weak model] in model?.aiWritable ?? false }
        view.onFocusChange = { [weak coordinator] focused in coordinator?.focusChanged(focused) }
        view.forwardUndo = { [weak model] in model?.undoManager?.undo() }
        view.forwardRedo = { [weak model] in model?.undoManager?.redo() }
        view.canForwardUndo = { [weak model] in model?.undoManager?.canUndo ?? false }
        view.canForwardRedo = { [weak model] in model?.undoManager?.canRedo ?? false }
        view.menuInterceptsArrows = { [weak model] in model?.popupActive(for: view.blockId) ?? false }
        view.onMenuKey = { [weak model] key in model?.popupKey(key) ?? false }
        let id = blockId
        view.onRevealRequest = { [weak model] in model?.requestReveal(id) }
        if !isPlain {
            view.onShortcut = { [weak model] shortcut in
                guard let model else { return false }
                switch shortcut {
                case .modEnter: return model.modEnter(id)
                case .blockMenu:
                    model.openBlockMenuForCurrent()
                    return true
                case .taskDetails: return model.openTaskDetails(id)
                case .highlight:
                    // ⌘⇧H: yellow highlight on or off (the web's Mod-Shift-h).
                    let on = model.marksAtSelection().highlight != nil
                    model.setHighlight(on ? nil : .yellow)
                    return true
                }
            }
            view.onPaste = { [weak model] pasteboard in model?.paste(into: id, from: pasteboard) ?? false }
            view.onInlineClick = { [weak model] node, range, event in
                guard let model else { return false }
                switch node {
                case .pageLink(let documentId, _):
                    let flags = event.modifierFlags
                    model.openPageLink(documentId, newWindow: flags.contains(.option) || flags.contains(.command) || flags.contains(.shift))
                    return true
                case .date(let date):
                    guard !model.isReadOnly else { return false }
                    model.editDate(blockId: id, range: range, date: date)
                    return true
                default:
                    return false
                }
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: BlockTextView, context: Context) -> CGSize? {
        let width = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? max(nsView.bounds.width, 400)
        return CGSize(width: width, height: nsView.height(forWidth: width))
    }

    static func dismantleNSView(_ view: BlockTextView, coordinator: Coordinator) {
        coordinator.parent.model.unregister(view, for: view.blockId)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: BlockTextEditor
        weak var view: BlockTextView?
        var lastText: [InlineNode] = []
        var style: TextRenderStyle
        var handledFocus: UUID?
        var findHighlights: [NSRange] = []
        var findCurrent: NSRange?
        var findTextVersion = -1
        private var isInstalling = false

        init(parent: BlockTextEditor) {
            self.parent = parent
            self.style = parent.style
        }

        /// Makes this view first responder for a focus request. A freshly created view may not be in a
        /// window yet (or the window may be mid-transition), so keep trying briefly instead of dropping
        /// the request; otherwise keystrokes typed right after ⌘N land nowhere.
        func applyFocus(_ request: FocusRequest, attempt: Int) {
            DispatchQueue.main.asyncAfter(deadline: .now() + (attempt == 0 ? 0 : 0.03)) { [weak self] in
                guard let self, let view = self.view else { return }
                guard let window = view.window, window.makeFirstResponder(view) else {
                    if attempt < 40 { self.applyFocus(request, attempt: attempt + 1) }
                    return
                }
                let length = (view.string as NSString).length
                switch request.caret {
                case .start: view.setSelectedRange(NSRange(location: 0, length: 0))
                case .end: view.setSelectedRange(NSRange(location: length, length: 0))
                case .offset(let o): view.setSelectedRange(NSRange(location: max(0, min(o, length)), length: 0))
                case .range(let loc, let len):
                    let l = max(0, min(loc, length))
                    view.setSelectedRange(NSRange(location: l, length: max(0, min(len, length - l))))
                case .selectAll: view.setSelectedRange(NSRange(location: 0, length: length))
                }
                self.parent.model.consumeFocus(request.id)
            }
        }

        func install(text: [InlineNode], style: TextRenderStyle, preserveSelection: Bool = false) {
            guard let view, let storage = view.textStorage else { return }
            isInstalling = true
            let selection = view.selectedRange()
            let attributed = InlineAttributedString.make(text, style: style)
            storage.setAttributedString(attributed)
            lastText = text
            self.style = style
            view.typingAttributes = typingAttributes(at: min(selection.location, attributed.length))
            if preserveSelection {
                let length = attributed.length
                view.setSelectedRange(NSRange(location: min(selection.location, length), length: 0))
            }
            view.invalidateIntrinsicContentSize()
            isInstalling = false
        }

        func restyleAll() {
            guard let view, let storage = view.textStorage else { return }
            InlineAttributedString.applyStyle(to: storage, range: NSRange(location: 0, length: storage.length), style: style)
            view.typingAttributes = typingAttributes(at: view.selectedRange().location)
            view.invalidateIntrinsicContentSize()
            view.needsDisplay = true
        }

        /// Typing attributes: inherit marks from the previous character, never links or inline nodes.
        func typingAttributes(at location: Int) -> [NSAttributedString.Key: Any] {
            guard let storage = view?.textStorage else { return [:] }
            var marks: [NSAttributedString.Key: Any] = [:]
            if location > 0 && location <= storage.length {
                let attrs = storage.attributes(at: location - 1, effectiveRange: nil)
                for key in InlineAttributedString.markKeys where key != .foleviLink {
                    if let v = attrs[key] { marks[key] = v }
                }
            }
            let tmp = NSMutableAttributedString(string: " ", attributes: marks)
            InlineAttributedString.applyStyle(to: tmp, range: NSRange(location: 0, length: 1), style: style)
            return tmp.attributes(at: 0, effectiveRange: nil)
        }

        func handle(_ command: BlockKeyCommand) -> Bool {
            parent.model.handle(command, blockId: parent.blockId)
        }

        func focusChanged(_ focused: Bool) {
            if focused { parent.model.blockDidFocus(parent.blockId) } else { parent.model.blockDidBlur(parent.blockId) }
        }

        // NSTextViewDelegate

        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString: String?) -> Bool {
            guard let replacement = replacementString, let view = self.view, !isInstalling, !parent.isCode, !parent.isPlain else { return true }
            let current = view.string as NSString
            guard range.length == 0, range.location <= current.length else { return true }
            let before = current.substring(to: range.location)
            // Markdown shortcuts at the start of a block (the web's input rules).
            if replacement == " " {
                if parent.model.markdownShortcut(prefix: before, blockId: parent.blockId, rest: remainder(after: range.location)) {
                    return false
                }
            }
            if (replacement == "-" && before == "--") || (replacement == "*" && before == "**") {
                if parent.model.markdownShortcut(prefix: before + replacement, blockId: parent.blockId, rest: []) { return false }
            }
            // **bold**, _italic_, `code` and ~~strike~~ as the closing character is typed.
            if ["*", "_", "`", "~"].contains(replacement), applyMarkRule(before: before, typed: replacement, at: range.location) {
                return false
            }
            return true
        }

        /// The web's inline mark rules: the text between the markers becomes marked text (the markers go),
        /// and typing carries on unmarked.
        private func applyMarkRule(before: String, typed: String, at location: Int) -> Bool {
            guard let view, !parent.model.isReadOnly else { return false }
            let rules: [(String, Mark)] = [
                (#"(?:^|\s)(\*\*([^*]+)\*\*)$"#, .bold),
                (#"(?:^|\s)(_([^_]+)_)$"#, .italic),
                (#"(?:^|\s)(`([^`]+)`)$"#, .code),
                (#"(?:^|\s)(~~([^~]+)~~)$"#, .strike),
            ]
            let candidate = before + typed
            let ns = candidate as NSString
            for (pattern, mark) in rules {
                guard let re = try? NSRegularExpression(pattern: pattern),
                      let m = re.firstMatch(in: candidate, range: NSRange(location: 0, length: ns.length)) else { continue }
                let full = m.range(at: 1), inner = m.range(at: 2)
                guard full.location < location else { continue }
                let text = ns.substring(with: inner)
                let replaceRange = NSRange(location: full.location, length: location - full.location)
                // After AppKit has finished with the keystroke (the typed marker itself is dropped).
                DispatchQueue.main.async { [weak self, weak view] in
                    guard let self, let view, NSMaxRange(replaceRange) <= (view.string as NSString).length else { return }
                    view.replace(range: replaceRange, with: [.text(text: text, marks: [mark])], style: self.style)
                    let caret = full.location + (text as NSString).length
                    view.setSelectedRange(NSRange(location: caret, length: 0))
                    var attrs = self.typingAttributes(at: caret)
                    attrs[InlineAttributedString.key(for: mark)] = nil
                    let tmp = NSMutableAttributedString(string: " ", attributes: attrs.filter { InlineAttributedString.markKeys.contains($0.key) })
                    InlineAttributedString.applyStyle(to: tmp, range: NSRange(location: 0, length: 1), style: self.style)
                    view.typingAttributes = tmp.attributes(at: 0, effectiveRange: nil)
                }
                return true
            }
            return false
        }

        private func remainder(after location: Int) -> [InlineNode] {
            guard let storage = view?.textStorage else { return [] }
            return InlineAttributedString.split(storage, at: location).1
        }

        func textDidChange(_ notification: Notification) {
            guard let view, let storage = view.textStorage, !isInstalling else { return }
            // Re-derive visuals for the edited paragraph (typing attributes already carry marks).
            if parent.isCode || parent.isPlain {
                let plain = view.string
                lastText = plain.isEmpty ? [] : [.text(text: plain, marks: nil)]
                if parent.isCode { parent.model.codeChanged(blockId: parent.blockId, code: plain) } else { parent.model.plainChanged(blockId: parent.blockId, text: plain) }
                return
            }
            let inline = InlineAttributedString.inline(from: storage)
            lastText = inline
            parent.model.textChanged(blockId: parent.blockId, text: inline)
            let sel = view.selectedRange()
            parent.model.updateTrigger(blockId: parent.blockId, text: searchable(storage), caret: sel.length == 0 ? sel.location : nil)
        }

        /// The text with inline objects blanked (U+FFFC), so "@" or "/" inside a chip never opens a menu.
        private func searchable(_ storage: NSTextStorage) -> String {
            let out = NSMutableString(string: storage.string)
            storage.enumerateAttribute(.foleviInline, in: NSRange(location: 0, length: storage.length), options: []) { v, r, _ in
                if v != nil { out.replaceCharacters(in: r, with: String(repeating: "\u{FFFC}", count: r.length)) }
            }
            return out as String
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let view, !isInstalling else { return }
            let sel = view.selectedRange()
            if sel.length == 0 { view.typingAttributes = typingAttributes(at: sel.location) }
            parent.model.selectionChanged(blockId: parent.blockId, range: sel, view: view)
            guard !parent.isPlain else { return }
            if !parent.isCode, let storage = view.textStorage {
                parent.model.updateTrigger(blockId: parent.blockId, text: searchable(storage), caret: sel.length == 0 ? sel.location : nil)
            }
            if view.window?.firstResponder === view { parent.model.updateBubble(blockId: parent.blockId, view: view) }
        }

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            false
        }

        func undoManager(for view: NSTextView) -> UndoManager? {
            (view as? BlockTextView)?.privateUndo
        }
    }
}

// MARK: - Formatting operations on the focused text view

extension BlockTextView {
    /// Toggles a mark on the selection (or the typing attributes when nothing is selected).
    func toggle(mark: Mark, style: TextRenderStyle) {
        let key = InlineAttributedString.key(for: mark)
        let sel = selectedRange()
        guard let storage = textStorage else { return }
        let value: Any
        switch mark {
        case .link(let href): value = href
        case .color(let v): value = v.rawValue
        case .highlight(let v): value = v.rawValue
        default: value = true
        }
        if sel.length == 0 {
            var attrs = typingAttributes
            if attrs[key] != nil, mark.isToggle { attrs[key] = nil } else { attrs[key] = value }
            let tmp = NSMutableAttributedString(string: " ", attributes: attrs)
            InlineAttributedString.applyStyle(to: tmp, range: NSRange(location: 0, length: 1), style: style)
            typingAttributes = tmp.attributes(at: 0, effectiveRange: nil)
            return
        }
        var allHave = true
        storage.enumerateAttribute(key, in: sel, options: []) { v, _, stop in
            if v == nil {
                allHave = false
                stop.pointee = true
            }
        }
        guard shouldChangeText(in: sel, replacementString: nil) else { return }
        if allHave && mark.isToggle {
            storage.removeAttribute(key, range: sel)
        } else {
            storage.addAttribute(key, value: value, range: sel)
        }
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    func removeMark(_ key: NSAttributedString.Key, style: TextRenderStyle) {
        let sel = selectedRange()
        guard let storage = textStorage, sel.length > 0, shouldChangeText(in: sel, replacementString: nil) else { return }
        storage.removeAttribute(key, range: sel)
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    func clearFormatting(style: TextRenderStyle) {
        let sel = selectedRange()
        guard let storage = textStorage, sel.length > 0, shouldChangeText(in: sel, replacementString: nil) else { return }
        for key in InlineAttributedString.markKeys { storage.removeAttribute(key, range: sel) }
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    /// Replaces a range with inline nodes (slash/page-link commits).
    func replace(range: NSRange, with nodes: [InlineNode], style: TextRenderStyle) {
        guard let storage = textStorage, NSMaxRange(range) <= storage.length, shouldChangeText(in: range, replacementString: nil) else { return }
        let insert = InlineAttributedString.make(nodes, style: style)
        storage.replaceCharacters(in: range, with: insert)
        didChangeText()
        setSelectedRange(NSRange(location: range.location + insert.length, length: 0))
    }

    /// Marks active at the caret/selection (for the Format inspector and menu state).
    func activeMarks() -> Set<String> {
        guard let storage = textStorage else { return [] }
        let sel = selectedRange()
        let attrs: [NSAttributedString.Key: Any]
        if sel.length == 0 {
            attrs = typingAttributes
        } else if sel.location < storage.length {
            attrs = storage.attributes(at: sel.location, effectiveRange: nil)
        } else {
            attrs = [:]
        }
        var out = Set<String>()
        if attrs[.foleviBold] != nil { out.insert("bold") }
        if attrs[.foleviItalic] != nil { out.insert("italic") }
        if attrs[.foleviUnderline] != nil { out.insert("underline") }
        if attrs[.foleviStrike] != nil { out.insert("strike") }
        if attrs[.foleviCode] != nil { out.insert("code") }
        if attrs[.foleviLink] != nil { out.insert("link") }
        return out
    }

    /// Sets a mark on the selection (never toggles it off).
    func setMark(_ mark: Mark, style: TextRenderStyle) {
        let key = InlineAttributedString.key(for: mark)
        let sel = selectedRange()
        guard let storage = textStorage, sel.length > 0, shouldChangeText(in: sel, replacementString: nil) else { return }
        let value: Any
        switch mark {
        case .link(let href): value = href
        case .color(let v): value = v.rawValue
        case .highlight(let v): value = v.rawValue
        default: value = true
        }
        storage.addAttribute(key, value: value, range: sel)
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    /// The whole link around `location` (the character before or at it), if there is one.
    func linkRange(at location: Int) -> NSRange? {
        guard let storage = textStorage, storage.length > 0 else { return nil }
        for loc in [location, location - 1] where loc >= 0 && loc < storage.length {
            var range = NSRange()
            if storage.attribute(.foleviLink, at: loc, longestEffectiveRange: &range, in: NSRange(location: 0, length: storage.length)) != nil {
                return range
            }
        }
        return nil
    }

    /// Paints the find matches (the web's `.fb-find-match` / `.fb-find-current`) without touching the text.
    func showFindHighlights(_ all: [NSRange], current: NSRange?) {
        guard let layout = layoutManager else { return }
        let length = (string as NSString).length
        layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: NSRange(location: 0, length: length))
        let marigold = NSColor(FoleviColor.marigold)
        for r in all where NSMaxRange(r) <= length {
            layout.addTemporaryAttribute(.backgroundColor, value: marigold.withAlphaComponent(r == current ? 0.78 : 0.32), forCharacterRange: r)
        }
    }

    /// The link href under the caret, if any.
    func linkAtSelection() -> String? {
        guard let storage = textStorage, storage.length > 0 else { return nil }
        let loc = min(selectedRange().location, storage.length - 1)
        return storage.attribute(.foleviLink, at: loc, effectiveRange: nil) as? String
    }
}

extension Mark {
    var isToggle: Bool {
        switch self {
        case .bold, .italic, .underline, .strike, .code: return true
        default: return false
        }
    }
}
