// One main window: a seamless title bar and one web view on the built-in interface. WM2 takes over the window's
// chrome (TitleBar.swift: the buttons where the page asks, drag areas, full screen) and its restoration; this
// keeps the basics Electron had: 1280 x 820 to start, 800 x 480 at least, the size and place remembered.
//
// With the native frame (N8, Frame/NativeFrame.swift, the default on this branch) the web view is the window's
// Page View: marked for native chrome mode, it runs the engine and draws only the note page, inside FoleviMac's
// frame (sidebar, tab strip, top bar, native screens). Without it (FOLEVI_WEB_FRAME=1) the page draws everything.
import AppKit
import WebKit
import FoleviMac

@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
    private(set) var view: FoleviWebView
    private(set) var place: String?
    /// The native frame (nil with the web frame).
    private(set) var frame: FrameController?

    init(place: String?, path: String, tabs: TabsModel.Saved? = nil) {
        self.place = place
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.title = "Folevi"
        window.minSize = NSSize(width: 800, height: 480)
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        let boot = WindowManager.shared.bootstrapOf(place, .main)
        view = WebViewFactory.make(place: place, role: .main, bootstrap: boot, frame: window.contentView?.bounds ?? .zero, nativeFrame: NativeFrame.enabled, window: { [weak window] in window })
        super.init(window: window)
        window.delegate = self
        if NativeFrame.enabled {
            makeFrame(start: path, tabs: tabs)
        } else {
            install(view)
        }
        if WindowManager.shared.mains.isEmpty {
            if !window.setFrameUsingName("FoleviMain") { window.center() }
            window.setFrameAutosaveName("FoleviMain")
        } else if let front = WindowManager.shared.frontMain?.window {
            window.setFrame(front.frame.offsetBy(dx: 24, dy: -24), display: false)
        } else {
            window.center()
        }
        view.load(URLRequest(url: Links.appURL(frame == nil ? path : "/native")))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    private func install(_ view: FoleviWebView) {
        guard let content = window?.contentView else { return }
        view.frame = content.bounds
        view.autoresizingMask = [.width, .height]
        content.addSubview(view)
    }

    /// The native frame around this window's page (its Page View): the marker before the first paint, then the
    /// frame as the window's content.
    private func makeFrame(start: String?, tabs: TabsModel.Saved?) {
        guard let window else { return }
        view.configuration.userContentController.addUserScript(FrameController.markerScript(place: place))
        let controller = FrameController(window: window, view: view, place: place, start: start, tabs: tabs)
        let size = window.contentRect(forFrameRect: window.frame).size
        controller.root.view.frame = NSRect(origin: .zero, size: size)
        window.contentViewController = controller.root
        window.setContentSize(size)
        frame = controller
        TitleBar.adoptNative(window)
    }

    /// The page again from a fresh bootstrap (a mode or place switch): new scripts and rules, the same path.
    /// `place: .some(nil)` binds the window to no place (the first-launch choice or the sign-in screen).
    func rebuild(place newPlace: String?? = nil, path: String? = nil) {
        if let old = frame {
            // The native frame starts again around a new Page View: the same tabs in the same place, the path's
            // tab in another.
            let samePlace = newPlace == nil || newPlace! == place
            let tabs = samePlace ? old.model.tabs.saved : nil
            if let newPlace { place = newPlace }
            old.stop()
            let previous = view
            let next = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: previous.frame, nativeFrame: true, window: { [weak self] in self?.window })
            previous.load(URLRequest(url: URL(string: "about:blank")!))
            previous.removeFromSuperview()
            view = next
            frame = nil
            makeFrame(start: samePlace ? nil : path, tabs: tabs)
            next.load(URLRequest(url: Links.appURL("/native")))
            return
        }
        if let newPlace { place = newPlace }
        let at = path ?? view.url.flatMap { Links.isAppUrl($0) ? $0 : nil }.map { u -> String in
            var s = u.path(percentEncoded: true)
            if let q = u.query(percentEncoded: true) { s += "?" + q }
            return s.isEmpty ? "/" : s
        } ?? "/"
        let old = view
        let next = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: old.frame, window: { [weak self] in self?.window })
        // The old page leaves first (its databases and locks close), then the new one takes its spot.
        old.load(URLRequest(url: URL(string: "about:blank")!))
        install(next)
        old.removeFromSuperview()
        view = next
        next.load(URLRequest(url: Links.appURL(at)))
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        WindowManager.shared.shouldClose?(self) ?? true
    }

    func windowWillClose(_ notification: Notification) {
        frame?.stop()
        WindowManager.shared.closed(self)
    }

    /// What window restoration saves: the page's path (the route on screen in a framed window) and its tabs.
    var restorePath: String {
        if let frame { return frame.model.route.path }
        return WindowRestore.restorablePath(view.url)
    }
}
