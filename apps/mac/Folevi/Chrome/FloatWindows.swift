// "Float this note" (the owner, 2026-11-25; the web side is apps/web/src/lib/app/float.ts): a note in a small panel
// of its own that stays on top of other apps, with full editing. The panel holds one web view on the built-in
// interface's /float/<id> page, which draws the note's title and text under a slim bar (the note's name, Always on
// top, Open in main window, Close); the panel has no buttons or title of its own, and moves by the bar (its .ui-drag
// area, TitleBar.swift). One panel per note: floating a note that's already floating brings its panel forward.
// Each note's size and place are remembered (the frame's autosave name), and so is its pin (on until turned off).
//
// The panel stays in front of other apps' windows (the floating level, shown on every Space and over full-screen
// apps) while pinned, and keeps showing when Folevi isn't the active app (hidesOnDeactivate off). Unpinned, it's an
// ordinary window. Edits sync with the main window and other devices as between any two windows.
import AppKit
import WebKit

/// The panel: it takes the keyboard (the note is edited in it) and stays when Folevi goes to the background.
final class FloatPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class FloatWindowController: NSWindowController, NSWindowDelegate {
    let noteId: String
    private(set) var view: FoleviWebView
    private var titleObservation: NSKeyValueObservation?

    static let defaultSize = NSSize(width: 380, height: 480)
    static let minSize = NSSize(width: 260, height: 200)

    /// The autosave name that keeps a note's panel size and place.
    nonisolated static func frameName(_ id: String) -> String { "FoleviFloat-\(id)" }

    init(noteId: String, title: String, place: String?, makeView: (String?, NSRect, @escaping () -> NSWindow?) -> FoleviWebView) {
        self.noteId = noteId
        let panel = FloatPanel(
            contentRect: NSRect(origin: .zero, size: Self.defaultSize),
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.title = title.isEmpty ? "Untitled" : title
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { panel.standardWindowButton(button)?.isHidden = true }
        panel.minSize = Self.minSize
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.tabbingMode = .disallowed
        panel.isMovableByWindowBackground = false
        panel.animationBehavior = .utilityWindow
        view = makeView(place, panel.contentView?.bounds ?? .zero, { [weak panel] in panel })
        super.init(window: panel)
        panel.delegate = self
        if let content = panel.contentView {
            view.frame = content.bounds
            view.autoresizingMask = [.width, .height]
            content.addSubview(view)
        }
        // Its size and place from last time, else beside the front window's corner.
        if !panel.setFrameUsingName(Self.frameName(noteId)) { Self.placeNew(panel) }
        panel.setFrameAutosaveName(Self.frameName(noteId))
        applyOnTop(FloatWindows.onTop(noteId))
        titleObservation = view.observe(\.title, options: [.new]) { [weak panel] view, _ in
            MainActor.assumeIsolated { panel?.title = TitleBar.cleanTitle(view.title) }
        }
        view.load(URLRequest(url: Links.appURL("/float/\(noteId)")))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// A new note's panel: near the top right of the front window, or of the screen.
    private static func placeNew(_ panel: NSWindow) {
        let count = CGFloat(FloatWindows.shared.open.count)
        if let front = WindowManager.shared.frontMain?.window, front.isVisible {
            let f = front.frame
            panel.setFrameTopLeftPoint(NSPoint(x: f.maxX - defaultSize.width - 40 - count * 24, y: f.maxY - 60 - count * 24))
        } else if let screen = NSScreen.main?.visibleFrame {
            panel.setFrameTopLeftPoint(NSPoint(x: screen.maxX - defaultSize.width - 40 - count * 24, y: screen.maxY - 40 - count * 24))
        } else {
            panel.center()
        }
    }

    /// Whether the panel stays on top of other apps.
    var isOnTop: Bool { window?.level == .floating }

    func applyOnTop(_ on: Bool) {
        guard let window else { return }
        window.level = on ? .floating : .normal
        // Pinned, it follows to every Space and over full-screen apps; unpinned, it's a window like the others.
        window.collectionBehavior = on ? [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle] : [.managed, .participatesInCycle, .fullScreenNone]
    }

    func bringForward() {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func windowWillClose(_ notification: Notification) {
        // What was typed a moment ago is saved before the page goes (as a main window's is).
        PageClosing.flush(view)
        titleObservation = nil
        FloatWindows.shared.closed(self)
    }
}

/// Every floating note's panel, by note.
@MainActor
final class FloatWindows {
    static let shared = FloatWindows()

    private(set) var open: [String: FloatWindowController] = [:]

    /// Makes a panel's web view (tests make one that loads nothing).
    var makeView: (String?, NSRect, @escaping () -> NSWindow?) -> FoleviWebView = { place, frame, window in
        WebViewFactory.make(place: place, role: .float, bootstrap: WindowManager.shared.bootstrapOf(place, .float), frame: frame, window: window)
    }

    /// Whether panels go on the screen (off in tests: nothing appears on the owner's desktop).
    var showsWindows = !Paths.testing

    nonisolated static let defaults = UserDefaults.standard
    nonisolated static func onTopKey(_ id: String) -> String { "folevi.float.onTop.\(id)" }

    /// A note's pin: on until turned off.
    nonisolated static func onTop(_ id: String, defaults: UserDefaults = defaults) -> Bool {
        defaults.object(forKey: onTopKey(id)) as? Bool ?? true
    }

    /// A note id the page may ask to float (Folevi's ids: letters and digits).
    nonisolated static func isNoteId(_ s: String) -> Bool {
        (1...64).contains(s.count) && s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    /// Floats a note: a new panel, or the note's panel brought forward. Returns its controller.
    @discardableResult
    func float(noteId: String, title: String, place: String?) -> FloatWindowController? {
        guard Self.isNoteId(noteId) else { return nil }
        if let existing = open[noteId] {
            if showsWindows { existing.bringForward() }
            return existing
        }
        let controller = FloatWindowController(noteId: noteId, title: String(title.prefix(200)), place: place, makeView: makeView)
        open[noteId] = controller
        if showsWindows {
            controller.showWindow(nil)
            controller.bringForward()
        }
        return controller
    }

    /// The pin of the panel `view` is in: set to `on` when given; answers what it is now (nil outside a panel).
    func onTop(of view: FoleviWebView?, set on: Bool?) -> Bool? {
        guard let view, let controller = open.values.first(where: { $0.view === view }) else { return nil }
        if let on {
            controller.applyOnTop(on)
            Self.defaults.set(on, forKey: Self.onTopKey(controller.noteId))
        }
        return controller.isOnTop
    }

    func closed(_ controller: FloatWindowController) {
        if open[controller.noteId] === controller { open[controller.noteId] = nil }
    }

    /// Registers the calls (from AppDelegate, before the first view): foleviDesktop.floatNote and floatOnTop.
    static func install() {
        DesktopRouter.features.formUnion(["floatNote", "floatOnTop"])
        DesktopRouter.extraHandlers["floatNote"] = { router, options in
            let id = DesktopRouter.text(options["id"], 64)
            FloatWindows.shared.float(noteId: id, title: DesktopRouter.text(options["title"], 200), place: router.context.place())
            return [:]
        }
        DesktopRouter.extraHandlers["floatOnTop"] = { router, options in
            let on = options["on"] as? Bool
            return ["value": FloatWindows.shared.onTop(of: router.view, set: on).map { $0 as Any } ?? NSNull()]
        }
    }
}
