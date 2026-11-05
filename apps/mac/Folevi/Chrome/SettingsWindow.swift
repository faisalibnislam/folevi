// Settings in a window of its own for ⌘, (decision M2, docs/MAC_POLISH_PLAN.md §3.10). Since 6 November 2026 (the
// owner): a list of the sections down the left, as System Settings has (Folevi's own line icons, the web's Settings
// list's; Foli AI's flower), and the section's page on the right, from the open place (/settings/<section>?window=1;
// the page draws the section alone there, WM4). A fixed size that always fits the screen above the Dock (a long
// page scrolls inside it); it remembers its last section and its place on screen; Escape or ⌘W closes it.
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
final class SettingsWindow: NSObject, NSWindowDelegate {
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
        // (Its icon stands in for the flower the list draws; see SettingsList.)
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

    /// The window's size: 880 by 640, or less on a smaller screen (its room above the Dock, less a margin).
    nonisolated static func size(room: NSSize) -> NSSize {
        NSSize(width: min(880, room.width - 40), height: min(640, room.height - 40))
    }

    private(set) var window: SettingsNSWindow?
    /// The list of sections on the left, and the pane on the right that holds the page or the native section.
    private let list = SettingsListState()
    private var pane: NSView?
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
        if !sections.contains(where: { $0.id == Self.toolbarID(current) }) { current = sections.first?.id ?? "desktop" }
        rebuildList()
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
        let room = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.size ?? NSSize(width: 1440, height: 900)
        let size = Self.size(room: room)
        let window = SettingsNSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenNone)
        window.delegate = self
        // The list on the left, a hairline, the pane on the right.
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        let sidebar = NSHostingView(rootView: SettingsList(state: list) { SettingsWindow.shared.go(to: $0) })
        sidebar.translatesAutoresizingMaskIntoConstraints = false
        let pane = NSView()
        pane.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(sidebar)
        content.addSubview(pane)
        NSLayoutConstraint.activate([
            sidebar.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            sidebar.topAnchor.constraint(equalTo: content.topAnchor),
            sidebar.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: SettingsList.width),
            pane.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            pane.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            pane.topAnchor.constraint(equalTo: content.topAnchor),
            pane.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        window.contentView = content
        self.pane = pane
        // Its place on screen is remembered; its size is always the one that fits this screen.
        if !window.setFrameUsingName("FoleviSettings") { window.center() }
        var frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: size))
        frame.origin = NSPoint(x: window.frame.minX, y: window.frame.maxY - frame.height)
        if let screen = (window.screen ?? NSScreen.main)?.visibleFrame {
            frame.origin.x = min(max(frame.origin.x, screen.minX), screen.maxX - frame.width)
            frame.origin.y = min(max(frame.origin.y, screen.minY), screen.maxY - frame.height)
        }
        window.setFrame(frame, display: false)
        window.setFrameAutosaveName("FoleviSettings")
        self.window = window
        return window
    }

    private func load(place: String?) {
        guard let window, let content = pane else { return }
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

    private func go(to section: String) {
        current = section
        list.selected = Self.toolbarID(section)
        window?.title = sections.first { $0.id == Self.toolbarID(section) }?.title ?? "Settings"
        updateNative()
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
        if sections.contains(where: { $0.id == Self.toolbarID(id) }) { list.selected = Self.toolbarID(id) }
        window?.title = sections.first { $0.id == Self.toolbarID(id) }?.title ?? "Settings"
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
        list.sections = sections
        list.selected = Self.toolbarID(current)
        window?.title = sections.first { $0.id == Self.toolbarID(current) }?.title ?? "Settings"
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
        if let content = pane, let frame = nativeFrame(), let section = MacSettingsSection(rawValue: current) {
            if macModel?.frame !== frame { macModel = MacSettingsModel(frame: frame) }
            // (After the layout pass that measured it: resizing inside it would lay the page out again mid-pass.)
            let root = AnyView(SettingsScreen(model: macModel!, section: section, windowed: true)
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
        guard let content = pane, Self.nativeSections.contains(current), let section = SettingsSection(macId: current), let client = nativeClient() else {
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

    /// A profile picture from disk: JPEG, PNG, WebP or GIF.
    static func pickImage() async -> (data: Data, mimeType: String)? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.jpeg, .png, .webP, .gif]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return nil }
        let types = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"]
        return (data, types[url.pathExtension.lowercased()] ?? "image/jpeg")
    }

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

/// What the list of sections shows: the sections and the one open.
@MainActor @Observable
final class SettingsListState {
    var sections: [SettingsWindow.Section] = []
    var selected = ""
}

/// The Settings window's list of sections, drawn as the main window's sidebar rows are (frame.sidebar.item): a Folevi
/// line icon (Foli AI's flower) and the name, the open one filled.
struct SettingsList: View {
    static let width: CGFloat = 220
    let state: SettingsListState
    let pick: @MainActor (String) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ScrollView(.vertical) {
            VStack(spacing: 2) {
                ForEach(state.sections, id: \.id) { row($0) }
            }
            .padding(EdgeInsets(top: 12, leading: 10, bottom: 12, trailing: 10))
        }
        .scrollIndicators(.never)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity, alignment: .top)
        .background((WebStyles.vars["color-sidebar"]?.resolve(scheme).color ?? .clear))
        .overlay(alignment: .trailing) {
            Rectangle().fill(WebStyles.vars["color-line"]?.resolve(scheme).color ?? .clear).frame(width: 1)
        }
    }

    private func row(_ s: SettingsWindow.Section) -> some View {
        let on = state.selected == s.id
        let st = WebStyles.named(on ? "frame.sidebar.item.active" : "frame.sidebar.item").resolve(scheme)
        let fill = WebStyles.vars["mac-selected"]?.resolve(scheme).color ?? .clear
        let hover = WebStyles.vars["mac-hover"]?.resolve(scheme).color ?? .clear
        let iconInk = on ? st.color.color : (WebStyles.vars["color-ink-muted"]?.resolve(scheme).color ?? st.color.color)
        return Button { pick(s.id) } label: {
            HStack(spacing: st.gap) {
                Group {
                    if s.id == "ai" { AiMarkGlyph(size: 18) } else { WebIconView(s.icon, size: 18).foregroundStyle(iconInk) }
                }
                .frame(width: 20, height: 20)
                Text(s.title).webText(st.text).lineLimit(1).foregroundStyle(st.color.color)
                Spacer(minLength: 0)
            }
            .padding(st.padding.edgeInsets)
            .frame(height: st.height)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowStyle(selected: on, fill: fill, hover: hover, radius: st.radius))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A row's fill: the open one's, a lighter one under the pointer.
private struct SettingsRowStyle: ButtonStyle {
    let selected: Bool
    let fill: Color
    let hover: Color
    let radius: CGFloat
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: radius, style: .circular).fill(selected || configuration.isPressed ? fill : hovering ? hover : .clear))
            .onHover { hovering = $0 }
    }
}
