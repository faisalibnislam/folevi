// Settings in a window of its own for ⌘, (decision M2, docs/MAC_POLISH_PLAN.md §3.10): the system's preferences
// toolbar, one item per section (SF Symbols: native chrome), and the section's page below, from the open place
// (/settings/<section>?window=1; the page draws the section alone there, WM4). 720 wide, as tall as needed,
// remembers its last section and its place on screen; Escape or ⌘W closes it.
import AppKit
import WebKit

final class SettingsNSWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) {
        performClose(sender)
    }
}

@MainActor
final class SettingsWindow: NSObject, NSWindowDelegate, NSToolbarDelegate {
    static let shared = SettingsWindow()

    struct Section: Equatable {
        var id: String
        var title: String
        var symbol: String
    }

    /// The sections for a mode (and Foli AI on or off). Pure (ChromeTests).
    nonisolated static func sections(mode: String, ai: Bool) -> [Section] {
        let general = Section(id: "desktop", title: "General", symbol: "gearshape")
        let appearance = Section(id: "appearance", title: "Appearance", symbol: "paintpalette")
        let foli = Section(id: "ai", title: "Foli AI", symbol: "sparkles")
        let data = Section(id: "data", title: "Import & Export", symbol: "arrow.up.arrow.down")
        var out: [Section]
        if mode == "account" {
            out = [
                general,
                Section(id: "account", title: "Account", symbol: "person.crop.circle"),
                appearance,
                Section(id: "notifications", title: "Notifications", symbol: "bell"),
                foli,
                Section(id: "security", title: "Security", symbol: "lock.shield"),
                Section(id: "privacy", title: "Privacy", symbol: "hand.raised"),
                Section(id: "devices", title: "Devices", symbol: "laptopcomputer.and.iphone"),
                Section(id: "sync", title: "Offline & Sync", symbol: "arrow.triangle.2.circlepath"),
                data,
            ]
        } else {
            out = [general, appearance, Section(id: "library", title: "Library", symbol: "books.vertical"), foli, data]
        }
        if !ai { out.removeAll { $0.id == "ai" } }
        return out
    }

    private(set) var window: SettingsNSWindow?
    private(set) var view: FoleviWebView?
    private var sections: [Section] = []
    private var urlObservation: NSKeyValueObservation?
    private static let sectionKey = "folevi.settings.section"

    var current: String {
        get { Paths.defaults.string(forKey: Self.sectionKey) ?? "desktop" }
        set { Paths.defaults.set(newValue, forKey: Self.sectionKey) }
    }

    /// Opens Settings (or brings it forward), at `section` when given.
    func show(section: String? = nil) {
        let window = self.window ?? make()
        let place = WindowManager.shared.currentPlace()
        let mode = WindowManager.shared.modeOf(place)
        let ai = view.flatMap { Chrome.states[ObjectIdentifier($0)]?.ai } ?? (Chrome.keyMainView.flatMap { Chrome.states[ObjectIdentifier($0)]?.ai } ?? true)
        sections = Self.sections(mode: mode, ai: ai)
        if let section { current = section }
        if !sections.contains(where: { $0.id == current }) { current = sections.first?.id ?? "desktop" }
        rebuildToolbar()
        if view == nil || view?.place != place {
            load(place: place)
        } else {
            go(to: current)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func make() -> SettingsNSWindow {
        let window = SettingsNSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 600), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 720, height: 480)
        window.maxSize = NSSize(width: 720, height: 1400)
        window.toolbarStyle = .preference
        window.collectionBehavior.insert(.fullScreenNone)
        window.delegate = self
        let toolbar = NSToolbar(identifier: "FoleviSettings")
        toolbar.delegate = self
        toolbar.displayMode = .iconAndLabel
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        if !window.setFrameUsingName("FoleviSettings") { window.center() }
        window.setFrameAutosaveName("FoleviSettings")
        self.window = window
        return window
    }

    private func load(place: String?) {
        guard let window, let content = window.contentView else { return }
        let old = view
        let next = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: content.bounds, window: { [weak window] in window })
        next.setValue(true, forKey: "drawsBackground")
        next.autoresizingMask = [.width, .height]
        old?.load(URLRequest(url: URL(string: "about:blank")!))
        old?.removeFromSuperview()
        content.addSubview(next)
        view = next
        urlObservation = next.observe(\.url, options: [.new]) { view, _ in
            MainActor.assumeIsolated { SettingsWindow.shared.urlChanged(view.url) }
        }
        next.load(URLRequest(url: Links.appURL(Self.path(current))))
    }

    nonisolated static func path(_ section: String) -> String { "/settings/\(section)?window=1" }

    private func go(to section: String) {
        current = section
        window?.toolbar?.selectedItemIdentifier = NSToolbarItem.Identifier(section)
        window?.title = sections.first { $0.id == section }?.title ?? "Settings"
        guard let view else { return }
        if view.url.map(WindowRestore.restorablePath) == Self.path(section) { return }
        WindowManager.shared.navigate(view, to: Self.path(section))
    }

    /// The page moved to another section itself (its own links): the toolbar follows.
    private func urlChanged(_ url: URL?) {
        guard let url, Links.isAppUrl(url) else { return }
        let parts = url.path.split(separator: "/")
        guard parts.first == "settings", parts.count >= 2 else { return }
        let id = String(parts[1])
        current = id
        if sections.contains(where: { $0.id == id }) { window?.toolbar?.selectedItemIdentifier = NSToolbarItem.Identifier(id) }
        window?.title = sections.first { $0.id == id }?.title ?? "Settings"
    }

    /// The page said whether Foli AI is on: its item comes or goes.
    func pageStateChanged() {
        guard let view, let ai = Chrome.states[ObjectIdentifier(view)]?.ai else { return }
        let next = Self.sections(mode: WindowManager.shared.modeOf(view.place), ai: ai)
        guard next != sections else { return }
        sections = next
        rebuildToolbar()
    }

    private func rebuildToolbar() {
        guard let toolbar = window?.toolbar else { return }
        while !toolbar.items.isEmpty { toolbar.removeItem(at: 0) }
        for (i, s) in sections.enumerated() { toolbar.insertItem(withItemIdentifier: NSToolbarItem.Identifier(s.id), at: i) }
        toolbar.selectedItemIdentifier = NSToolbarItem.Identifier(current)
        window?.title = sections.first { $0.id == current }?.title ?? "Settings"
    }

    @objc private func pick(_ sender: NSToolbarItem) {
        go(to: sender.itemIdentifier.rawValue)
    }

    // MARK: NSToolbarDelegate

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard let s = sections.first(where: { $0.id == id.rawValue }) else { return nil }
        let item = NSToolbarItem(itemIdentifier: id)
        item.label = s.title
        item.paletteLabel = s.title
        item.toolTip = s.title
        item.image = NSImage(systemSymbolName: s.symbol, accessibilityDescription: s.title)
        item.target = self
        item.action = #selector(pick(_:))
        return item
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { sections.map { NSToolbarItem.Identifier($0.id) } }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { sections.map { NSToolbarItem.Identifier($0.id) } }
    func toolbarSelectableItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { sections.map { NSToolbarItem.Identifier($0.id) } }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        // The page goes (it would keep a second copy of the place's data open for nothing).
        if let view { Chrome.states.removeValue(forKey: ObjectIdentifier(view)) }
        view?.load(URLRequest(url: URL(string: "about:blank")!))
        view?.removeFromSuperview()
        view = nil
        urlObservation = nil
    }
}
