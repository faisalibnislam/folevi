// Float Note (2026-11-03): a note in its own small window, as Apple Notes' floating note. The note tab's menu
// (Float note) and Window > Float Note open it. It stays on top of other apps, on every Space and over full-screen
// apps, until the pin in its bar is turned off (then it's an ordinary window). Each window is its own Page View in
// native chrome mode (the note page with its bottom bar, nothing else) with its own EngineClient, so edits reach the
// main windows as they do between two main windows. The note's tab stays and shows that it floats; closing the
// window is all it takes to put it back. Several notes float at once, one window each; they come back after a
// relaunch with their pins, each where it was (a frame saved per note).
import AppKit
import WebKit
import SwiftUI
import FoleviEngine
import FoleviMac
import FoleviScreens

@MainActor
enum FloatingNotes {
    struct Saved: Codable, Equatable {
        var id: String
        var place: String?
        var onTop: Bool
    }

    private static let key = "folevi.floatingNotes"
    private(set) static var open: [FloatingNoteController] = []
    /// The app is quitting: its windows aren't closed by the person, so they stay saved.
    private static var quitting = false
    private static var installed = false

    /// The floating windows (the app lock covers them too).
    static var windows: [NSWindow] { open.compactMap(\.window) }

    static func controller(for window: NSWindow?) -> FloatingNoteController? {
        guard let window else { return nil }
        return open.first { $0.window === window }
    }

    /// Floats a note of a place, or brings its window forward.
    static func float(_ id: String, place: String?) {
        install()
        if let c = open.first(where: { $0.noteId == id && $0.place == place }) {
            c.showWindow(nil)
            c.window?.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let c = FloatingNoteController(noteId: id, place: place, onTop: true, after: open.last?.window)
        open.append(c)
        c.showWindow(nil)
        c.window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        changed()
    }

    /// The floating notes saved at the last quit open again (after the main windows).
    static func restore() {
        install()
        for s in load() where !open.contains(where: { $0.noteId == s.id && $0.place == s.place }) {
            if let place = s.place, !ShellPlaces.has(place) { continue }
            let c = FloatingNoteController(noteId: s.id, place: s.place, onTop: s.onTop, after: open.last?.window)
            open.append(c)
            c.window?.orderFront(nil)
        }
        changed()
    }

    static func closed(_ c: FloatingNoteController) {
        guard !quitting else { return }
        open.removeAll { $0 === c }
        changed()
    }

    /// The windows changed (opened, closed, pinned): saved, and the main windows' tabs say which notes float.
    static func changed() {
        save()
        for main in WindowManager.shared.mains {
            guard let model = main.frame?.model else { continue }
            let ids = ids(place: main.place)
            if model.floatingNotes != ids { model.floatingNotes = ids }
        }
    }

    /// The notes of a place floating now.
    static func ids(place: String?) -> Set<String> {
        Set(open.filter { $0.place == place }.map(\.noteId))
    }

    private static func save() {
        guard !quitting else { return }
        let all = open.map { Saved(id: $0.noteId, place: $0.place, onTop: $0.state.onTop) }
        if let data = try? JSONEncoder().encode(all) { Paths.defaults.set(data, forKey: key) }
    }

    static func load() -> [Saved] {
        guard let data = Paths.defaults.data(forKey: key), let all = try? JSONDecoder().decode([Saved].self, from: data) else { return [] }
        return Array(all.filter { !$0.id.isEmpty && $0.id.count <= 64 }.prefix(20))
    }

    private static func install() {
        guard !installed else { return }
        installed = true
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                FloatingNotes.save()
                FloatingNotes.quitting = true
            }
        }
    }
}

/// A floating note's window: the bar (FloatingNoteBar) over the note's Page View.
@MainActor
final class FloatingNoteController: NSWindowController, NSWindowDelegate, FrameHost {
    let noteId: String
    let place: String?
    let view: FoleviWebView
    let model: FrameModel
    let state: FloatingNoteState
    private let transport: MacEngineTransport?
    private var observers: [Observer] = []

    /// Apple Notes' floating note is about this size.
    static let defaultSize = NSSize(width: 380, height: 480)

    /// `after`: the floating window opened last (a new one cascades from it).
    init(noteId: String, place: String?, onTop: Bool, after: NSWindow?) {
        self.noteId = noteId
        self.place = place
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: Self.defaultSize), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        panel.isExcludedFromWindowsMenu = false
        panel.tabbingMode = .disallowed
        panel.minSize = NSSize(width: 280, height: 220)
        // Every Space and over full-screen apps (on top or not, as the owner chose).
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
        }
        view = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: .zero, nativeFrame: true, window: { [weak panel] in panel })
        view.configuration.userContentController.addUserScript(FrameController.markerScript(place: place))
        let client: EngineClient
        if NativeFrame.demo {
            client = DemoEngine().client()
            transport = nil
        } else {
            let t = MacEngineTransport(view: view)
            transport = t
            client = EngineClient(transport: t, place: place ?? "", app: AppInfo(platform: .macos, version: Paths.version, build: Paths.build, protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash))
        }
        model = FrameModel(client: client)
        state = FloatingNoteState(onTop: onTop)
        super.init(window: panel)
        panel.delegate = self
        model.host = self
        layOut(panel)
        position(panel, after: after)
        applyOnTop()
        model.open(.note(noteId))
        watch()
        view.load(URLRequest(url: Links.appURL("/native")))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// The bar at the top (on the title bar, its height), the page under it.
    private func layOut(_ panel: NSPanel) {
        let content = NSView(frame: NSRect(origin: .zero, size: Self.defaultSize))
        panel.contentView = content
        state.barHeight = max(28, panel.frame.height - panel.contentLayoutRect.height)
        if let zoom = panel.standardWindowButton(.zoomButton) { state.buttonsWidth = zoom.frame.maxX + 4 }
        let bar = NSHostingView(rootView: FloatingNoteBar(model: model, state: state) { [weak self] in self?.toggleOnTop() })
        bar.safeAreaRegions = []
        bar.sizingOptions = []
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(view)
        content.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: content.topAnchor),
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: state.barHeight),
            view.topAnchor.constraint(equalTo: bar.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
    }

    /// Where it was last time (per note), else near the top right of the screen, after the last floating window.
    private func position(_ panel: NSPanel, after: NSWindow?) {
        let name = "FoleviFloat-\(noteId)"
        if panel.setFrameUsingName(name) {
            panel.setFrame(WindowRestore.onScreen(panel.frame), display: false)
        } else if let after {
            panel.setFrame(WindowRestore.onScreen(after.frame.offsetBy(dx: -24, dy: -24)), display: false)
        } else if let screen = (NSApp.keyWindow?.screen ?? NSScreen.main)?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: screen.maxX - Self.defaultSize.width - 24, y: screen.maxY - Self.defaultSize.height - 24))
        }
        panel.setFrameAutosaveName(name)
    }

    private func watch() {
        // The title for the Window menu and Mission Control.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let title = FloatingNoteBar.title(self.model)
            if self.window?.title != title { self.window?.title = title }
        })
        // The place's Light or Dark, as in its main windows.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let pinned = FrameController.appearance(self.model.session.value?.appearance)
            if self.window?.appearance?.name != pinned?.name { self.window?.appearance = pinned }
        })
        // The window shows its note only: a link to anything else opens in a main window.
        observers.append(Observer { [weak self] in
            guard let self else { return }
            let route = self.model.route
            guard route.noteId != self.noteId else { return }
            DispatchQueue.main.async { [weak self] in self?.sendAway(route) }
        })
    }

    private func sendAway(_ route: FrameRoute) {
        guard model.route.noteId != noteId else { return }
        if route != .home { WindowManager.shared.showMain(path: route.path) }
        model.open(.note(noteId))
        model.closeOtherTabs(model.tabs.activeID)
    }

    private func toggleOnTop() {
        state.onTop.toggle()
        applyOnTop()
        FloatingNotes.changed()
    }

    /// On top: above other apps' windows (the floating level). Off: an ordinary window.
    private func applyOnTop() {
        guard let panel = window as? NSPanel else { return }
        panel.isFloatingPanel = state.onTop
        panel.level = state.onTop ? .floating : .normal
    }

    func windowDidBecomeKey(_ notification: Notification) {
        if window?.firstResponder === window { window?.makeFirstResponder(view) }
    }

    func windowWillClose(_ notification: Notification) {
        model.stop()
        transport?.detach()
        FloatingNotes.closed(self)
    }

    // MARK: FrameHost (what belongs to a main window goes to one)

    private var main: FrameController? {
        WindowManager.shared.showMain()
        return NativeFrame.controller(for: WindowManager.shared.frontMain?.view)
    }

    func frameOpenSettings(section: String?) { SettingsWindow.shared.show(section: section) }
    func frameSwitchPlace(_ place: String, space: String?) { main?.frameSwitchPlace(place, space: space) }
    func frameSignInAnotherAccount() { main?.frameSignInAnotherAccount() }
    func frameSignOut(place: String) { main?.frameSignOut(place: place) }
    func frameSignOutConfirmed(place: String) { main?.frameSignOutConfirmed(place: place) }
    func frameDownloadFile(_ id: String) { model.toast("Open Folevi on the web to download this file for now.") }
    func frameMoveOrCopy() { main?.frameMoveOrCopy() }
    func frameOpenHelp() { WindowManager.shared.showMain(path: "/help") }

    func frameOpenExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
        switch Links.target(url) {
        case .app(let path): WindowManager.shared.showMain(path: path)
        case .browser: Navigation.shared.openExternally(url)
        case .ignore: break
        }
    }

    func frameOpenInNewWindow(_ route: FrameRoute) {
        WindowManager.shared.openMain(path: route.path)
        NSApp.activate()
    }

    func frameStateChanged() {}
}
