// Settings in a window of its own for ⌘, (decision M2, docs/MAC_POLISH_PLAN.md §3.10): the system's preferences
// toolbar, one item per section (Folevi's own icons, the web's Settings list's), and the section's page below, from the open place
// (/settings/<section>?window=1; the page draws the section alone there, WM4). 720 wide and as tall as the
// section (native panes fit the window to their page, up to the screen; a longer one scrolls), remembers its last
// section and its place on screen; Escape or ⌘W closes it.
//
// With the native frame (NativeFrame.enabled) the common sections are native (N13, FoleviScreens'
// SettingsSectionScreen on the front main window's engine client): Account, Appearance, Notifications, Foli AI,
// Security and Devices. General (the Mac's own settings), Privacy (encryption), Offline & Sync, Library and Import &
// Export stay the page's until the bridge has them.
import AppKit
import SwiftUI
import WebKit
import FoleviEngine
import FoleviScreens
import FoleviMac
import FoleviDesign

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
        var icon: WebIcon
    }

    /// The sections for a mode (and Foli AI on or off). Pure (ChromeTests).
    nonisolated static func sections(mode: String, ai: Bool) -> [Section] {
        let general = Section(id: "desktop", title: "General", icon: .settings)
        let appearance = Section(id: "appearance", title: "Appearance", icon: .palette)
        let foli = Section(id: "ai", title: "Foli AI", icon: .sparkles)
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

    private(set) var window: SettingsNSWindow?
    private(set) var view: FoleviWebView?
    private var native: NSHostingView<AnyView>?
    private var nativeModel: SettingsModel?
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
            updateNative()
        } else {
            go(to: current)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func make() -> SettingsNSWindow {
        let window = SettingsNSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 600), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 720, height: 240)
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
        updateNative()
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

    // MARK: Native sections

    /// The Mac's section ids drawn natively (SettingsSection(macId:) maps them).
    nonisolated static let nativeSections: Set<String> = ["account", "appearance", "notifications", "ai", "security", "devices"]

    /// The front main window's engine client for the open place, when its window has the native frame.
    private func nativeClient() -> EngineClient? {
        guard NativeFrame.enabled else { return nil }
        let place = WindowManager.shared.currentPlace()
        return WindowManager.shared.mains.first { $0.place == place && $0.frame != nil }?.frame?.model.client
    }

    /// The front main window's frame (its engine, toasts and routes), when it has the native frame.
    private func nativeFrame() -> FrameModel? {
        guard NativeFrame.enabled else { return nil }
        let place = WindowManager.shared.currentPlace()
        return WindowManager.shared.mains.first { $0.place == place && $0.frame != nil }?.frame?.model
    }
    private var macModel: MacSettingsModel?

    /// Shows the native section over the page, or the page. With the native frame every section is native and
    /// drawn as the web's (FoleviMac SettingsScreen, the section alone as at /settings/<section>?window=1).
    private func updateNative() {
        if let content = window?.contentView, let frame = nativeFrame(), let section = MacSettingsSection(rawValue: current) {
            if macModel?.frame !== frame { macModel = MacSettingsModel(frame: frame) }
            // (After the layout pass that measured it: resizing inside it would lay the page out again mid-pass.)
            let root = AnyView(SettingsScreen(model: macModel!, section: section, windowed: true) { h in DispatchQueue.main.async { SettingsWindow.shared.fit(contentHeight: h) } }
                .frame(maxWidth: .infinity, maxHeight: .infinity))
            if let native {
                native.rootView = root
            } else {
                let host = NSHostingView(rootView: root)
                host.frame = content.bounds
                host.autoresizingMask = [.width, .height]
                content.addSubview(host)
                native = host
            }
            native?.isHidden = false
            view?.isHidden = true
            return
        }
        guard let content = window?.contentView, Self.nativeSections.contains(current), let section = SettingsSection(macId: current), let client = nativeClient() else {
            native?.isHidden = true
            view?.isHidden = false
            return
        }
        if nativeModel?.client !== client {
            nativeModel = SettingsModel(client: client, host: SettingsHost(
                version: Paths.version,
                openURL: { NSWorkspace.shared.open($0) },
                pickAvatar: { await SettingsWindow.pickImage() }
            ), feedback: ScreenFeedback(toast: { t in
                guard t.tone == .error, let w = SettingsWindow.shared.window else { return }
                let alert = NSAlert()
                alert.messageText = t.message
                alert.beginSheetModal(for: w)
            }), platform: .mac)
        }
        guard let model = nativeModel else { return }
        let root = AnyView(SettingsSectionScreen(model: model, section: section).frame(maxWidth: .infinity, maxHeight: .infinity))
        if let native {
            native.rootView = root
        } else {
            let host = NSHostingView(rootView: root)
            host.frame = content.bounds
            host.autoresizingMask = [.width, .height]
            content.addSubview(host)
            native = host
        }
        native?.isHidden = false
        view?.isHidden = true
    }

    /// The window as tall as the pane's page (its top edge stays put), never taller than the screen has room for:
    /// no empty space under a short pane, and a long one scrolls.
    private func fit(contentHeight: CGFloat) {
        guard let window, contentHeight > 0 else { return }
        let room = (window.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let height = min(max(contentHeight.rounded(.up), window.minSize.height), room.height - 40)
        // The title bar and the toolbar on top of the content.
        let chrome = window.frame.height - (window.contentView?.frame.height ?? window.frame.height)
        var frame = window.frame
        frame.size.height = height + chrome
        guard abs(frame.height - window.frame.height) > 0.5 else { return }
        frame.origin.y = window.frame.maxY - frame.height
        // Kept on screen when it grows past the bottom.
        if frame.minY < room.minY { frame.origin.y = room.minY }
        window.setFrame(frame, display: true, animate: window.isVisible)
    }

    /// A profile picture from disk: JPEG, PNG, WebP or GIF.
    static func pickImage() async -> (data: Data, mimeType: String)? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.jpeg, .png, .webP, .gif]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return nil }
        let types = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"]
        return (data, types[url.pathExtension.lowercased()] ?? "image/jpeg")
    }

    // MARK: NSToolbarDelegate

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard let s = sections.first(where: { $0.id == id.rawValue }) else { return nil }
        let item = NSToolbarItem(itemIdentifier: id)
        item.label = s.title
        item.paletteLabel = s.title
        item.image = Self.image(s.icon, label: s.title)
        item.target = self
        item.action = #selector(pick(_:))
        return item
    }

    /// A Folevi icon as a toolbar image: stroked as lucide draws it, a template so the toolbar tints it (the
    /// selected item's accent, the others' grey) as it does a symbol.
    nonisolated static func image(_ icon: WebIcon, label: String) -> NSImage {
        // The toolbar draws its images at 32 pt: the icon at 22 pt in the middle, its stroke 1.5 pt, as heavy as a
        // symbol beside the labels.
        let canvas: CGFloat = 32, glyph: CGFloat = 22
        let image = NSImage(size: NSSize(width: canvas, height: canvas), flipped: true) { rect in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            let scale = glyph / 24 * rect.width / canvas
            ctx.translateBy(x: (rect.width - glyph * rect.width / canvas) / 2, y: (rect.height - glyph * rect.height / canvas) / 2)
            ctx.scaleBy(x: scale, y: scale)
            ctx.addPath(icon.cgPath)
            ctx.setLineWidth(1.5 / scale)
            ctx.setLineCap(.round)
            ctx.setLineJoin(.round)
            ctx.setStrokeColor(NSColor.black.cgColor)
            ctx.strokePath()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = label
        return image
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
        native?.removeFromSuperview()
        native = nil
        nativeModel = nil
        macModel = nil
    }
}
