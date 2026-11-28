import AppKit

/// One dot's editor: its own scroll view, text view and undo manager, created lazily and kept
/// alive so switching dots is instant and undo history survives switching.
@MainActor
final class EditorPage: NSObject, NSTextViewDelegate {
    let dotID: UUID
    let scrollView: NSScrollView
    let textView: QuickNoteTextView
    let undoManager = UndoManager()
    weak var controller: EditorController?

    var isRichText: Bool
    /// True while there are edits not yet written to the store.
    var isDirty = false
    /// Incremented on every edit; used to tell whether a save captured the latest text.
    var editGeneration = 0
    /// Markdown of the last version written to / read from the store.
    var lastSavedMarkdown = ""
    /// `Note.updatedAt` of the version the editor is based on (for conflict detection).
    var baseUpdatedAt: Date = .distantPast
    var saveTask: Task<Void, Never>?
    /// Suppresses change callbacks while the controller replaces the text programmatically.
    var isLoading = false

    init(dotID: UUID, isRichText: Bool, controller: EditorController) {
        self.dotID = dotID
        self.isRichText = isRichText
        self.controller = controller
        textView = QuickNoteTextView.make()
        scrollView = NSScrollView()
        super.init()
        undoManager.levelsOfUndo = 0 // unlimited
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.findBarPosition = .aboveContent
        scrollView.documentView = textView
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.page = self
        textView.delegate = self
    }

    func setInsets(top: CGFloat, bottom: CGFloat) {
        scrollView.contentInsets = NSEdgeInsets(top: top, left: 0, bottom: bottom, right: 0)
        scrollView.scrollerInsets = NSEdgeInsets(top: top - 6, left: 0, bottom: bottom - 6, right: 2)
    }

    /// Replaces the whole text without registering undo (initial load, sync updates, restores).
    func setContents(_ attributed: NSAttributedString) {
        guard let storage = textView.textStorage else { return }
        isLoading = true
        storage.setAttributedString(attributed)
        textView.refreshTypingAttributes()
        isLoading = false
    }

    private static let visibleCharacters = CharacterSet.whitespacesAndNewlines.inverted

    var isEmpty: Bool {
        guard let s = textView.textStorage?.mutableString, s.length > 0 else { return true }
        let r = s.rangeOfCharacter(from: Self.visibleCharacters)
        return r.location == NSNotFound
    }

    // MARK: NSTextViewDelegate

    func undoManager(for view: NSTextView) -> UndoManager? { undoManager }

    func textDidChange(_ notification: Notification) {
        guard !isLoading else { return }
        editGeneration += 1
        controller?.pageDidChange(self)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        guard !isLoading else { return }
        controller?.selectionDidChange(self)
    }

    func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
        let url: URL? = (link as? URL) ?? (link as? String).flatMap(URL.init(string:))
        guard let url else { return false }
        if url.scheme == QuickNoteLink.attachment, let id = QuickNoteLink.attachmentID(from: url.absoluteString) {
            controller?.quickLook(attachmentID: id)
            return true
        }
        NSWorkspace.shared.open(url)
        return true
    }

}

/// Hosts the active page's scroll view and cross-fades between dots.
final class EditorHostView: NSView {
    private(set) var current: NSView?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show(_ view: NSView, animated: Bool) {
        guard view !== current else { return }
        let old = current
        current = view
        view.frame = bounds
        view.autoresizingMask = [.width, .height]
        if animated, let old {
            view.alphaValue = 0
            addSubview(view)
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = Motion.dotSwitchDuration
                ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                view.animator().alphaValue = 1
                old.animator().alphaValue = 0
            } completionHandler: {
                MainActor.assumeIsolated {
                    if self.current !== old { old.removeFromSuperview() }
                    old.alphaValue = 1
                }
            }
        } else {
            view.alphaValue = 1
            addSubview(view)
            old?.removeFromSuperview()
        }
    }

    override var isFlipped: Bool { true }
}
