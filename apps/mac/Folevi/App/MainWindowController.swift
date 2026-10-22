// One main window: a seamless title bar (the page draws its own top bar, the window buttons sit over it) and one
// web view on the built-in interface. WM2 takes over the window's chrome (TitleBar.swift: the buttons where the
// page asks, drag areas, full screen) and its restoration; this keeps the basics Electron had: 1280 x 820 to
// start, 800 x 480 at least, the size and place remembered.
import AppKit
import WebKit

@MainActor
final class MainWindowController: NSWindowController, NSWindowDelegate {
    private(set) var view: FoleviWebView
    private(set) var place: String?

    init(place: String?, path: String) {
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
        view = WebViewFactory.make(place: place, role: .main, bootstrap: boot, frame: window.contentView?.bounds ?? .zero, window: { [weak window] in window })
        super.init(window: window)
        window.delegate = self
        install(view)
        if WindowManager.shared.mains.isEmpty {
            if !window.setFrameUsingName("FoleviMain") { window.center() }
            window.setFrameAutosaveName("FoleviMain")
        } else if let front = WindowManager.shared.frontMain?.window {
            window.setFrame(front.frame.offsetBy(dx: 24, dy: -24), display: false)
        } else {
            window.center()
        }
        view.load(URLRequest(url: Links.appURL(path)))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    private func install(_ view: FoleviWebView) {
        guard let content = window?.contentView else { return }
        view.frame = content.bounds
        view.autoresizingMask = [.width, .height]
        content.addSubview(view)
    }

    /// The page again from a fresh bootstrap (a mode or place switch): new scripts and rules, the same path.
    func rebuild(place newPlace: String? = nil, path: String? = nil) {
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

    func windowWillClose(_ notification: Notification) {
        WindowManager.shared.closed(self)
    }
}
