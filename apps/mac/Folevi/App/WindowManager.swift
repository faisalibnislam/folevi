// The app's windows and every web view it made (docs/MAC_WEBKIT_PLAN.md §3): main windows (one page each), and
// later the places' runners (WM1) and Quick Add (WM2). It knows each view's place and mode, so the scheme
// handler, the routers and events reach the right pages. WM2 adds restoration of every window (polish §3.5), WM1
// the places' modes and reloads (`modeOf`, `bootstrapOf`, `reload`).
import AppKit
import WebKit

@MainActor
final class WindowManager {
    static let shared = WindowManager()

    private(set) var mains: [MainWindowController] = []
    private let views = NSHashTable<FoleviWebView>.weakObjects()

    /// Every web view still open (main windows, runners, Quick Add).
    var allViews: [FoleviWebView] { views.allObjects }

    /// The place main windows open in (WM1: ShellPlaces' open place).
    var currentPlace: () -> String? = { ShellPlaces.state.current }

    /// The mode a view's page runs in, by its place (WM1 answers per place; until then the one saved mode).
    var modeOf: (String?) -> String = { _ in ShellMode.current }

    /// What a new view's page starts with.
    var bootstrapOf: (String?, ViewRole) -> Bootstrap = { place, role in
        Bootstrap(mode: WindowManager.shared.modeOf(place), place: place, background: role == .runner)
    }

    /// Opens Quick Add (WM2); until then a folevi://quick-add link shows the main window.
    var quickAdd: (() -> Void)?

    /// Runs for every view as it's made (WM2's title bar: drag areas, the window's title, zoom).
    static var viewMade: [(FoleviWebView) -> Void] = []

    /// Whether a main window may close (WM2: the last one hides instead); true without a hook.
    var shouldClose: ((MainWindowController) -> Bool)?

    /// Opens the first windows at launch (WM2 restores every window); one main window without a hook.
    var openFirst: (() -> Void)?

    /// Paths waiting for a view's first load (a link that arrived while it was loading).
    private var pending: [ObjectIdentifier: [String]] = [:]

    func register(_ view: FoleviWebView) {
        views.add(view)
        for hook in Self.viewMade { hook(view) }
    }

    /// The front main window, or the first one.
    var frontMain: MainWindowController? {
        mains.first { $0.window?.isKeyWindow == true } ?? mains.first { $0.window?.isVisible == true } ?? mains.first
    }

    /// A new main window on `path` of the open place.
    @discardableResult
    func openMain(path: String = "/") -> MainWindowController {
        let controller = MainWindowController(place: currentPlace(), path: path)
        mains.append(controller)
        controller.showWindow(nil)
        return controller
    }

    /// Brings a main window forward (opening one if none is left), on `path` if given.
    func showMain(path: String? = nil) {
        guard let main = frontMain else {
            openMain(path: path ?? "/")
            NSApp.activate()
            return
        }
        main.showWindow(nil)
        main.window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        if let path { navigate(main.view, to: path) }
    }

    /// Sends a view to a path: as a command once its page is up (the page's router moves, nothing reloads),
    /// else when it is.
    func navigate(_ view: FoleviWebView, to path: String) {
        guard view.loaded else {
            pending[ObjectIdentifier(view), default: []].append(path)
            return
        }
        Events.command(["type": "navigate", "path": path], to: view)
    }

    /// A view's first page finished loading: what waited for it goes now.
    func loaded(_ view: FoleviWebView) {
        for path in pending.removeValue(forKey: ObjectIdentifier(view)) ?? [] { Events.command(["type": "navigate", "path": path], to: view) }
    }

    /// The window closed: it's forgotten (WM2 decides which windows hide instead).
    func closed(_ controller: MainWindowController) {
        mains.removeAll { $0 === controller }
        pending.removeValue(forKey: ObjectIdentifier(controller.view))
    }

    /// Loads every view that passes `filter` again with a fresh bootstrap (a mode or place switch, WM1).
    func reload(where filter: (FoleviWebView) -> Bool) {
        for main in mains where filter(main.view) { main.rebuild() }
    }
}
