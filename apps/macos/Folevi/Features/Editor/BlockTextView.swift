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
        view.focusRingType = .none
        view.linkTextAttributes = [.cursor: NSCursor.pointingHand]
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
        if container.containerSize.width != width {
            container.containerSize = NSSize(width: max(20, width), height: .greatestFiniteMagnitude)
        }
        layout.ensureLayout(for: container)
        var h = layout.usedRect(for: container).height
        let font = (typingAttributes[.font] as? NSFont) ?? NSFont.systemFont(ofSize: 15)
        let lineHeight = layout.defaultLineHeight(for: font)
        if string.isEmpty || h < lineHeight { h = max(h, lineHeight) }
        return ceil(h + textContainerInset.height * 2)
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
        let font = (typingAttributes[.font] as? NSFont) ?? NSFont.systemFont(ofSize: 15)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.placeholderTextColor]
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

    override func keyDown(with event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.option) && flags.contains(.shift) && !flags.contains(.command) {
            if event.keyCode == 126, onCommand?(.moveBlock(up: true)) == true { return }
            if event.keyCode == 125, onCommand?(.moveBlock(up: false)) == true { return }
        }
        super.keyDown(with: event)
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
                // Keep indentation of the current line.
                let ns = string as NSString
                let lineRange = ns.lineRange(for: NSRange(location: sel.location, length: 0))
                let line = ns.substring(with: NSRange(location: lineRange.location, length: max(0, sel.location - lineRange.location)))
                let indent = String(line.prefix { $0 == " " || $0 == "\t" })
                insertText("\n" + indent, replacementRange: sel)
                return true
            case #selector(insertTab(_:)):
                insertText("  ", replacementRange: sel)
                return true
            case #selector(insertBacktab(_:)):
                return true
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
            if caretOnFirstLine && sel.location == 0 { return onCommand?(.selectBlockExtending(up: true)) ?? false }
            return false
        case #selector(moveDownAndModifySelection(_:)):
            if caretOnLastLine && NSMaxRange(sel) == length { return onCommand?(.selectBlockExtending(up: false)) ?? false }
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
    let style: BlockTextStyle
    let isEditable: Bool
    let accessibilityLabel: String
    let model: EditorModel
    var focusRequest: FocusRequest?
    var isCode = false
    var isPlain = false

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
        }
        model.register(view, for: blockId)
        if let request = focusRequest, request.blockId == blockId, c.handledFocus != request.id {
            c.handledFocus = request.id
            DispatchQueue.main.async {
                guard let window = view.window else { return }
                window.makeFirstResponder(view)
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
                view.scrollRangeToVisible(view.selectedRange())
                model.consumeFocus(request.id)
            }
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
        view.accessibilityBlockLabel = accessibilityLabel
        view.setAccessibilityIdentifier("block.\(blockId)")
        let coordinator = context.coordinator
        view.onCommand = { [weak coordinator] command in coordinator?.handle(command) ?? false }
        view.onFocusChange = { [weak coordinator] focused in coordinator?.focusChanged(focused) }
        view.forwardUndo = { [weak model] in model?.undoManager?.undo() }
        view.forwardRedo = { [weak model] in model?.undoManager?.redo() }
        view.canForwardUndo = { [weak model] in model?.undoManager?.canUndo ?? false }
        view.canForwardRedo = { [weak model] in model?.undoManager?.canRedo ?? false }
        view.menuInterceptsArrows = { [weak model] in model?.popupActive(for: view.blockId) ?? false }
        view.onMenuKey = { [weak model] key in model?.popupKey(key) ?? false }
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
        var style: BlockTextStyle
        var handledFocus: UUID?
        private var isInstalling = false

        init(parent: BlockTextEditor) {
            self.parent = parent
            self.style = parent.style
        }

        func install(text: [InlineNode], style: BlockTextStyle, preserveSelection: Bool = false) {
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
            // Markdown shortcuts at the start of a block.
            if replacement == " " && range.length == 0 {
                let prefix = current.substring(to: range.location)
                if parent.model.markdownShortcut(prefix: prefix, blockId: parent.blockId, rest: remainder(after: range.location)) {
                    return false
                }
            }
            if replacement == "-" && range.location == 2 && current.substring(to: 2) == "--" && current.length == 2 {
                if parent.model.markdownShortcut(prefix: "---", blockId: parent.blockId, rest: []) { return false }
            }
            if replacement == "`" && range.location == 2 && current.substring(to: 2) == "``" && current.length == 2 {
                if parent.model.markdownShortcut(prefix: "```", blockId: parent.blockId, rest: []) { return false }
            }
            if replacement == "/" && range.length == 0 {
                let before = range.location == 0 ? " " : current.substring(with: NSRange(location: range.location - 1, length: 1))
                if before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    parent.model.openSlash(blockId: parent.blockId, at: range.location)
                }
            }
            if replacement == "[" && range.length == 0 && range.location > 0
                && current.substring(with: NSRange(location: range.location - 1, length: 1)) == "[" {
                parent.model.openPagePicker(blockId: parent.blockId, at: range.location - 1)
            }
            return true
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
            parent.model.popupTextChanged(blockId: parent.blockId, text: view.string, caret: view.selectedRange().location)
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let view, !isInstalling else { return }
            let sel = view.selectedRange()
            if sel.length == 0 { view.typingAttributes = typingAttributes(at: sel.location) }
            parent.model.selectionChanged(blockId: parent.blockId, range: sel, view: view)
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
    func toggle(mark: Mark, style: BlockTextStyle) {
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

    func removeMark(_ key: NSAttributedString.Key, style: BlockTextStyle) {
        let sel = selectedRange()
        guard let storage = textStorage, sel.length > 0, shouldChangeText(in: sel, replacementString: nil) else { return }
        storage.removeAttribute(key, range: sel)
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    func clearFormatting(style: BlockTextStyle) {
        let sel = selectedRange()
        guard let storage = textStorage, sel.length > 0, shouldChangeText(in: sel, replacementString: nil) else { return }
        for key in InlineAttributedString.markKeys { storage.removeAttribute(key, range: sel) }
        InlineAttributedString.applyStyle(to: storage, range: sel, style: style)
        didChangeText()
    }

    /// Replaces a range with inline nodes (slash/page-link commits).
    func replace(range: NSRange, with nodes: [InlineNode], style: BlockTextStyle) {
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
