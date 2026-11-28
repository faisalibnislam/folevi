import AppKit

/// The popover window: a borderless, non-activating, resizable panel. Non-activating means the
/// app you were using stays frontmost; typing still reaches Notlet while the panel is key.
final class QuickNotesPanel: NSPanel {
    var onCancel: (() -> Void)?
    /// The panel's own shortcuts (⌘1 to ⌘9, ⇧⌘T, ⇧⌘5, ⇧⌘P, ⌥⌘D, ⌘S...), before Folevi's menus see the key.
    var keyHandler: ((NSEvent) -> Bool)?

    init(size: CGSize) {
        super.init(contentRect: NSRect(origin: .zero, size: size),
                   styleMask: [.borderless, .nonactivatingPanel, .resizable, .fullSizeContentView],
                   backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isMovableByWindowBackground = false
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = false
        isFloatingPanel = true
        minSize = QuickNotesSettings.minimumPanelSize
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        level = Self.popoverLevel
        title = "Quick Notes"
        setAccessibilityLabel("Folevi quick notes")
    }

    /// Just below menus, so menus opened from the panel appear above it.
    static let popoverLevel = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue - 1)

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) { onCancel?() }

    /// Menu shortcuts work even though the app itself is not active.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if keyHandler?(event) == true { return true }
        if super.performKeyEquivalent(with: event) { return true }
        // Folevi's menus act on its windows' pages (⌘W closes a tab, ⌘T opens one): only the editing commands go
        // on, straight to the text, so a key typed here never changes a window behind.
        return QuickNotesPanel.performEditKey(event)
    }
}

/// Edge/corner resize handles for the borderless panel (with proper resize cursors).
final class ResizeHandleView: NSView {
    struct Edge: OptionSet {
        let rawValue: Int
        static let left = Edge(rawValue: 1), right = Edge(rawValue: 2), top = Edge(rawValue: 4), bottom = Edge(rawValue: 8)
    }

    let edge: Edge
    var onResizeEnded: (() -> Void)?
    private var startFrame = NSRect.zero
    private var startMouse = NSPoint.zero

    init(edge: Edge) {
        self.edge = edge
        super.init(frame: .zero)
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: cursor)
    }

    private var cursor: NSCursor {
        let position: NSCursor.FrameResizePosition
        switch edge {
        case [.top, .left]: position = .topLeft
        case [.top, .right]: position = .topRight
        case [.bottom, .left]: position = .bottomLeft
        case [.bottom, .right]: position = .bottomRight
        case .left: position = .left
        case .right: position = .right
        case .top: position = .top
        default: position = .bottom
        }
        return NSCursor.frameResize(position: position, directions: .all)
    }

    override func mouseDown(with event: NSEvent) {
        startFrame = window?.frame ?? .zero
        startMouse = NSEvent.mouseLocation
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - startMouse.x, dy = now.y - startMouse.y
        var f = startFrame
        let minSize = window.minSize
        if edge.contains(.right) { f.size.width = max(minSize.width, startFrame.width + dx) }
        if edge.contains(.left) {
            let w = max(minSize.width, startFrame.width - dx)
            f.origin.x = startFrame.maxX - w
            f.size.width = w
        }
        if edge.contains(.bottom) {
            let h = max(minSize.height, startFrame.height - dy)
            f.origin.y = startFrame.maxY - h
            f.size.height = h
        }
        if edge.contains(.top) { f.size.height = max(minSize.height, startFrame.height + dy) }
        if let screen = window.screen {
            f = f.intersection(screen.visibleFrame.insetBy(dx: -1, dy: -1))
        }
        window.setFrame(f, display: true)
    }

    override func mouseUp(with event: NSEvent) { onResizeEnded?() }
}

extension QuickNotesPanel {
    /// Cut, Copy, Paste, Select All, Undo and Redo, and ⌘W to hide: sent to the panel's text (true: handled).
    @MainActor
    static func performEditKey(_ event: NSEvent) -> Bool {
        let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard f.contains(.command), !f.contains(.control), !f.contains(.option) else { return false }
        let key = (event.charactersIgnoringModifiers ?? "").lowercased()
        let action: Selector?
        switch (key, f.contains(.shift)) {
        case ("x", false): action = #selector(NSText.cut(_:))
        case ("c", false): action = #selector(NSText.copy(_:))
        case ("v", false): action = #selector(NSText.paste(_:))
        case ("v", true): action = #selector(NSTextView.pasteAsPlainText(_:))
        case ("a", false): action = #selector(NSText.selectAll(_:))
        case ("z", false): action = Selector(("undo:"))
        case ("z", true): action = Selector(("redo:"))
        case ("f", false): action = #selector(NSTextView.performFindPanelAction(_:))
        case ("w", false):
            if let panel = event.window as? QuickNotesPanel { panel.onCancel?() } else { event.window?.performClose(nil) }
            return true
        default: action = nil
        }
        guard let action else { return false }
        if action == #selector(NSTextView.performFindPanelAction(_:)) {
            let item = NSMenuItem()
            item.tag = Int(NSFindPanelAction.showFindPanel.rawValue)
            return NSApp.sendAction(action, to: nil, from: item)
        }
        return NSApp.sendAction(action, to: nil, from: nil)
    }
}

/// The panel as a window of its own (⌥⌘D): a normal titled window, with the panel's shortcuts first.
final class QuickNotesWindow: NSWindow {
    var keyHandler: ((NSEvent) -> Bool)?
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if keyHandler?(event) == true { return true }
        if super.performKeyEquivalent(with: event) { return true }
        if QuickNotesPanel.performEditKey(event) { return true }
        // Quit, Hide, Minimize and Settings go to Folevi's menus; the page commands (New Tab, Close Tab) don't,
        // they'd act on a window behind this one.
        let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let key = (event.charactersIgnoringModifiers ?? "").lowercased()
        if f.contains(.command), !["q", "h", "m", ","].contains(key) || f.contains(.shift) { return true }
        return false
    }
}
