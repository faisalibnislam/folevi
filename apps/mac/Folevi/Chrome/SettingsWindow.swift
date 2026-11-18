// Settings in a window of its own for ⌘, (decision M2, docs/MAC_POLISH_PLAN.md §3.10), in the Mac's native look
// since 18 November 2026 (docs/MAC_NATIVE_LOOK.md; FoleviMac MacSettingsWindow.swift): real traffic lights, the
// categories down the left on the window's translucent material with a working search field under the traffic
// lights, the open category's compact title in line with the traffic lights, and its grouped native controls in a
// readable column. Every way in lands here: Folevi > Settings… (⌘,), the menu bar icon's Settings…, the account
// menu, the command palette, File > Import, Invite people…, Foli AI's links, the notifications' gear, and any
// /settings link in a main window (FrameModel.open sends those here). It remembers its last category, its place
// and its size; Escape (on an empty search) or ⌘W closes it.
//
// The page is native (FoleviMac's sections on the front main window's engine). While no main window has the native
// frame (all closed, or the web frame on), the page is the web's (/settings/<section>?window=1) under the same list.
import AppKit
import SwiftUI
import WebKit
import FoleviEngine
import FoleviMac
import FoleviDesign

final class SettingsNSWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) {
        performClose(sender)
    }
}

@MainActor
final class SettingsWindow: NSObject, NSWindowDelegate {
    static let shared = SettingsWindow()

    struct Section: Equatable {
        var id: String
        var title: String
        var icon: WebIcon
    }

    /// The web page's sections for a mode (and Foli AI on or off): the list while the page is the web's. Pure
    /// (ChromeTests).
    nonisolated static func sections(mode: String, ai: Bool) -> [Section] {
        let general = Section(id: "desktop", title: "General", icon: .settings)
        let appearance = Section(id: "appearance", title: "Appearance", icon: .palette)
        let foli = Section(id: "ai", title: "Foli AI", icon: .messageCircle)
        let data = Section(id: "data", title: "Import & Export", icon: .arrowDownUp)
        var out: [Section]
        if mode == "account" {
            out = [
                general,
                Section(id: "account", title: "Account", icon: .userRound),
                appearance,
                Section(id: "notifications", title: "Notifications", icon: .bell),
                foli,
                Section(id: "security", title: "Security", icon: .shieldCheck),
                Section(id: "privacy", title: "Privacy", icon: .lockKeyhole),
                Section(id: "devices", title: "Devices", icon: .monitorSmartphone),
                Section(id: "sync", title: "Offline & Sync", icon: .refreshCw),
                data,
            ]
        } else {
            out = [general, appearance, Section(id: "library", title: "Library", icon: .libraryBig), foli, data]
        }
        if !ai { out.removeAll { $0.id == "ai" } }
        return out
    }

    /// The window's first size: 880 by 640, or less on a smaller screen (its room above the Dock, less a margin).
    /// It can be resized from there, down to MacSettingsWindowStyle.minSize.
    nonisolated static func size(room: NSSize) -> NSSize {
        NSSize(width: min(880, room.width - 40), height: min(640, room.height - 40))
    }

    private(set) var window: SettingsNSWindow?
    /// The web page, while the page is the web's.
    private(set) var view: FoleviWebView?
    /// The list, the search and the open category (FoleviMac MacSettingsShell draws them).
    private let state = MacSettingsState()
    private var host: ClickThroughHostingView<AnyView>?
    private var macModel: MacSettingsModel?
    private var sections: [Section] = []
    private var urlObservation: NSKeyValueObservation?
    private static let sectionKey = "folevi.settings.section"

    var current: String {
        get { Paths.defaults.string(forKey: Self.sectionKey) ?? "desktop" }
        set { Paths.defaults.set(newValue, forKey: Self.sectionKey) }
    }

    override init() {
        super.init()
        state.onSelect = { [weak self] id in self?.selected(id) }
        state.onAction = { [weak self] id in self?.action(id) }
    }

    /// Opens Settings (or brings it forward), at `section` when given.
    func show(section: String? = nil) {
        let window = self.window ?? make()
        if let section { current = section }
        if let frame = nativeFrame() {
            showNative(frame)
        } else {
            showPage()
        }
        window.title = state.title
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func make() -> SettingsNSWindow {
        let room = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.size ?? NSSize(width: 1440, height: 900)
        let size = Self.size(room: room)
        let window = SettingsNSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.delegate = self
        let host = ClickThroughHostingView(rootView: AnyView(EmptyView()))
        // (The window's size is the person's: the page never pushes it, only the shell's least size holds.)
        host.sizingOptions = [.minSize]
        window.contentView = host
        // (After the content view: a hosting view resets the window's least size when it becomes the content.)
        MacSettingsWindowStyle.apply(window)
        self.host = host
        // Its place and size on screen are remembered, inside this screen.
        if !window.setFrameUsingName("FoleviSettings") {
            window.setContentSize(size)
            window.center()
        }
        if let screen = (window.screen ?? NSScreen.main)?.visibleFrame {
            var frame = window.frame
            frame.size.width = min(max(frame.width, MacSettingsWindowStyle.minSize.width), screen.width)
            frame.size.height = min(max(frame.height, MacSettingsWindowStyle.minSize.height), screen.height)
            frame.origin.x = min(max(frame.origin.x, screen.minX), screen.maxX - frame.width)
            frame.origin.y = min(max(frame.origin.y, screen.minY), screen.maxY - frame.height)
            window.setFrame(frame, display: false)
        }
        window.setFrameAutosaveName("FoleviSettings")
        self.window = window
        return window
    }

    // MARK: The native page

    private func showNative(_ frame: FrameModel) {
        if macModel?.frame !== frame { macModel = MacSettingsModel(frame: frame) }
        guard let model = macModel else { return }
        dropPage()
        state.groups = MacSettingsCategories.groups(model)
        state.local = MacSettingsCategories.isLocal(model)
        // A section this place lacks shows the nearest it has (MacSettingsModel.shown: a library's Library).
        let shown = MacSettingsCategories.resolve(current, model: model)
        // (Opened at a section: the page starts at its top, nothing lit from an earlier search.)
        state.select(shown)
        host?.rootView = AnyView(MacSettingsShell(state: state) {
            MacSettingsNativePane(model: model, state: state)
        }.macClickThrough())
    }

    // MARK: The web page (no main window with the native frame)

    private func showPage() {
        macModel = nil
        let place = WindowManager.shared.currentPlace()
        let ai = view.flatMap { Chrome.states[ObjectIdentifier($0)]?.ai } ?? (Chrome.keyMainView.flatMap { Chrome.states[ObjectIdentifier($0)]?.ai } ?? true)
        sections = Self.sections(mode: WindowManager.shared.modeOf(place), ai: ai)
        if !sections.contains(where: { $0.id == Self.toolbarID(current) }) { current = sections.first?.id ?? "desktop" }
        rebuildList()
        state.selection = current
        if view == nil || view?.place != place {
            load(place: place)
        } else {
            navigatePage(to: current)
        }
        if let view {
            host?.rootView = AnyView(MacSettingsShell(state: state) { SettingsWebPane(view: view) }.macClickThrough())
        }
    }

    private func load(place: String?) {
        let old = view
        let next = WebViewFactory.make(place: place, role: .main, bootstrap: WindowManager.shared.bootstrapOf(place, .main), frame: NSRect(origin: .zero, size: window?.contentLayoutRect.size ?? .zero), window: { [weak self] in self?.window })
        next.setValue(true, forKey: "drawsBackground")
        next.autoresizingMask = [.width, .height]
        old?.load(URLRequest(url: URL(string: "about:blank")!))
        old?.removeFromSuperview()
        view = next
        urlObservation = next.observe(\.url, options: [.new]) { view, _ in
            MainActor.assumeIsolated { SettingsWindow.shared.urlChanged(view.url) }
        }
        next.load(URLRequest(url: Links.appURL(Self.path(current))))
    }

    /// The page goes (it would keep a second copy of the place's data open for nothing).
    private func dropPage() {
        guard let view else { return }
        Chrome.states.removeValue(forKey: ObjectIdentifier(view))
        view.load(URLRequest(url: URL(string: "about:blank")!))
        view.removeFromSuperview()
        self.view = nil
        urlObservation = nil
    }

    nonisolated static func path(_ section: String) -> String { "/settings/\(section)?window=1" }

    /// The list item a section is under: a workspace's Import & Export (File > Import in a workspace) is
    /// under Import & Export. Pure (ChromeTests).
    nonisolated static func toolbarID(_ section: String) -> String { section == "workspace-data" ? "data" : section }

    /// File > Import's section (QA F18): Import & Export for the space open in the window, so the files go where
    /// the person is working and the card names it ("Import into Personal", or "Import into <workspace>").
    /// Pure (ChromeTests).
    nonisolated static func importSection(session: SessionValue?) -> String {
        guard let s = session, s.spaces.first(where: { $0.id == s.space })?.kind == .workspace else { return "data" }
        return "workspace-data"
    }

    private func navigatePage(to section: String) {
        guard let view else { return }
        if view.url.map(WindowRestore.restorablePath) == Self.path(section) { return }
        WindowManager.shared.navigate(view, to: Self.path(section))
    }

    /// The page moved to another section itself (its own links): the list follows.
    private func urlChanged(_ url: URL?) {
        guard let url, Links.isAppUrl(url) else { return }
        let parts = url.path.split(separator: "/")
        guard parts.first == "settings", parts.count >= 2 else { return }
        let id = String(parts[1])
        current = id
        state.selection = id
        window?.title = state.title
    }

    /// The page said whether Foli AI is on: its item comes or goes.
    func pageStateChanged() {
        guard let view, let ai = Chrome.states[ObjectIdentifier(view)]?.ai else { return }
        let next = Self.sections(mode: WindowManager.shared.modeOf(view.place), ai: ai)
        guard next != sections else { return }
        sections = next
        rebuildList()
    }

    private func rebuildList() {
        state.groups = [MacSettingsGroup(label: nil, items: sections.map { MacSettingsCategory(id: $0.id, title: $0.title, symbol: MacSettingsCategories.symbol($0.id)) })]
        state.local = WindowManager.shared.modeOf(WindowManager.shared.currentPlace()) != "account"
    }

    // MARK: The list

    /// A category opened in the list, by the keyboard or from search.
    private func selected(_ id: String) {
        current = id
        window?.title = state.title
        navigatePage(to: id)
    }

    /// Help and Contact support.
    private func action(_ id: String) {
        let host = macModel?.frame.host ?? nativeFrame()?.host
        switch id {
        case MacSettingsCategories.help:
            if let host { host.frameOpenHelp() } else { WindowManager.shared.showMain(path: "/help") }
        case MacSettingsCategories.contact:
            // Without an account there's no support form: an email, as the web opens.
            if state.local { NSWorkspace.shared.open(URL(string: "mailto:support@folevi.com")!) } else if let host { host.frameOpenHelp() } else { WindowManager.shared.showMain(path: "/help") }
        default:
            break
        }
    }

    /// The front main window's frame (its engine, toasts and routes), when it has the native frame.
    private func nativeFrame() -> FrameModel? {
        guard NativeFrame.enabled else { return nil }
        let place = WindowManager.shared.currentPlace()
        return WindowManager.shared.mains.first { $0.place == place && $0.frame != nil }?.frame?.model
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        dropPage()
        host?.rootView = AnyView(EmptyView())
        macModel = nil
        state.query = ""
    }
}

/// The web page as the Settings window's page (while no main window has the native frame).
private struct SettingsWebPane: NSViewRepresentable {
    let view: NSView

    func makeNSView(context: Context) -> NSView {
        let box = NSView()
        embed(in: box)
        return box
    }

    func updateNSView(_ box: NSView, context: Context) {
        if view.superview !== box { embed(in: box) }
    }

    private func embed(in box: NSView) {
        view.removeFromSuperview()
        view.frame = box.bounds
        view.autoresizingMask = [.width, .height]
        box.addSubview(view)
    }
}
