// Every web view of the app is made here (docs/MAC_WEBKIT_PLAN.md §3): the app:// scheme, the data store of this
// build (Paths), the bridge script at document start with what the page starts with, the "folevi" message handler
// bound to this view, content rules (FOLEVI_OFFLINE; WM1 adds local mode's), the user agent, and the preferences
// the owner chose (Writing Tools off in notes, decision M5).
import AppKit
import WebKit
import FoleviMac

/// What a view is for: a main window's page, a place's hidden runner (WM1), Quick Add's panel (WM2).
enum ViewRole: String {
    case main, runner, quickAdd
}

/// A web view that knows its place and role, and lets the title bar take clicks in drag areas (WM2).
final class FoleviWebView: WKWebView {
    /// The place the view is bound to ("library", "acct:<user id>"), nil before places. Set by the host only.
    var place: String?
    let role: ViewRole
    let events = ViewEvents()
    /// Set once the first page finished loading (links and commands wait for it).
    var loaded = false
    /// The window's Page View inside the native frame (N8): the page is in native chrome mode and the app draws
    /// the window's chrome, so the page's title bar reports (button spots, drag areas, title) don't apply.
    let nativeFrame: Bool

    /// WM2 (TitleBar.swift): a mouse down the window takes (a drag area of the page's top bar). True when taken.
    var mouseDownHook: ((FoleviWebView, NSEvent) -> Bool)?

    init(frame: NSRect, configuration: WKWebViewConfiguration, place: String?, role: ViewRole, nativeFrame: Bool = false) {
        self.place = place
        self.role = role
        self.nativeFrame = nativeFrame
        super.init(frame: frame, configuration: configuration)
        events.view = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    override func mouseDown(with event: NSEvent) {
        if mouseDownHook?(self, event) == true { return }
        super.mouseDown(with: event)
    }

    /// A click on a window that isn't key (a floating note or another window was in front) acts at once: it places the
    /// caret, presses the page's button or follows the link, as well as bringing the window forward (MAC-05).
    /// WKWebView's own answer is yes only over a selection being dragged. The hidden runner takes no clicks anyway.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        role == .runner ? super.acceptsFirstMouse(for: event) : true
    }

    // MARK: Edit > Undo and Redo

    /// The frame model of the note this view shows: a main window's Page View with a note on screen, or a
    /// floating note. Nil for any other view (Quick Add, a window without the native frame) and off a note.
    private var noteModel: FrameModel? {
        let model = NativeFrame.controller(for: self)?.model ?? FloatingNotes.open.first { $0.view === self }?.model
        return model?.route.isNote == true ? model : nil
    }

    /// Edit > Undo with the page as the window's first responder. The system's `undo:` drives WebKit's undo
    /// stack, which is not the editor's history (the one ⌘Z in the note and the note's bars use): the two came
    /// apart, so the menu undid something else and showed off while the editor still had steps. On a note the
    /// menu runs the editor's own undo. A plain field of the page (the title, a caption, a cell) keeps WebKit's,
    /// the one that knows its typing; so does a view that shows no note. (A native text field never asks here:
    /// it is the first responder itself, and the window answers for it as before.)
    @objc func undo(_ sender: Any?) { history(undo: true) }

    @objc func redo(_ sender: Any?) { history(undo: false) }

    private func history(undo: Bool) {
        let system = { [weak self] in
            guard let manager = self?.undoManager else { return }
            if undo { if manager.canUndo { manager.undo() } } else if manager.canRedo { manager.redo() }
        }
        guard let model = noteModel else { return system() }
        FrameCommands.pageKeyboard(self) { place in
            if place == .field { return system() }
            if undo { model.editor(.undo) } else { model.editor(.redo) }
        }
    }

    /// Undo and Redo show on while the editor has a step to undo or redo (`editor.state`), on a note.
    override func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        let undo = item.action == #selector(undo(_:))
        guard undo || item.action == #selector(redo(_:)) else { return super.validateUserInterfaceItem(item) }
        let menuItem = item as? NSMenuItem
        guard let model = noteModel else {
            // (As the window words and answers them for a view of its own: "Undo Typing".)
            menuItem?.title = (undo ? undoManager?.undoMenuItemTitle : undoManager?.redoMenuItemTitle) ?? (undo ? "Undo" : "Redo")
            return (undo ? undoManager?.canUndo : undoManager?.canRedo) ?? false
        }
        menuItem?.title = undo ? "Undo" : "Redo"
        return (undo ? model.editorState?.undo : model.editorState?.redo) ?? false
    }

    // MARK: WebKit's own menu

    /// What WebKit's menu offers that would leave or reload the page, by the items' identifiers.
    private static let leavingItems: Set<String> = [
        "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
        "WKMenuItemIdentifierOpenLink", "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierOpenFrameInNewWindow",
        "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow",
        "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierDownloadImage", "WKMenuItemIdentifierDownloadMedia",
    ]

    /// A right-click where the page draws no menu of its own (the title, a caption, the cover, the margins) shows
    /// WebKit's. Reload, Back and Forward, opening a link in a window of WebKit's and the downloads come out of
    /// it: the page is the window's engine as well as its note, and links open through the app. Copy, Paste,
    /// Look Up, spelling, Share and Services stay. (The menus the page draws itself never come through here.)
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        for item in menu.items where Self.leavingItems.contains(item.identifier?.rawValue ?? "") { menu.removeItem(item) }
        // No separator first, last, or after another.
        for item in menu.items.reversed() where item.isSeparatorItem {
            let at = menu.index(of: item)
            if at == 0 || at == menu.numberOfItems - 1 || menu.item(at: at - 1)?.isSeparatorItem == true { menu.removeItem(item) }
        }
    }
}

/// A page that is about to go away (its window closed, its place switched, the app quitting). WebKit ends it
/// without the events a browser sends a closing page, and those events are what save the last words typed: the
/// note's own pending save (it waits a moment after each key), a canvas's, the title's, the "On this Mac"
/// library's files. So the page is told it is closing, as a browser would tell it, and is kept until it has saved.
@MainActor
enum PageClosing {
    /// The closing event saves at once where it can; the short wait after it is for what is written a moment
    /// later (the device's database, files).
    static let script = "window.dispatchEvent(new Event('pagehide')); await new Promise((r) => setTimeout(r, 250));"

    /// Tells `view`'s page it is closing and keeps the view alive until the page answers, one second at most;
    /// `then` runs once after that (what lets the page go: a blank page loaded, or nothing more than the view's
    /// release). The window is off the screen already: nothing here waits on it.
    static func flush(_ view: FoleviWebView, then: @escaping @MainActor () -> Void = {}) {
        guard view.loaded else { return then() }
        var kept: FoleviWebView? = view
        let finish: @MainActor () -> Void = {
            guard kept != nil else { return }
            kept = nil
            then()
        }
        view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { _ in finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { finish() }
    }
}

/// What the page starts with, written into the bridge script (Electron read it with sendSync).
struct Bootstrap {
    var mode: String
    var place: String?
    /// A hidden runner keeping a place in sync (no window).
    var background = false
    /// Where to open after a switch to another place (shell-bridge.js's SHELL.start).
    var start: String?

    var json: [String: Any] {
        [
            "version": Paths.version,
            "build": Paths.build,
            "debug": Paths.isDebug,
            "desktop": Array(DesktopRouter.features).sorted(),
            "shell": [
                "mode": mode,
                "deviceName": Platform.deviceName,
                "places": ["current": place.map { $0 as Any } ?? NSNull(), "background": background] as [String: Any],
                "start": start.map { $0 as Any } ?? NSNull(),
            ] as [String: Any],
        ]
    }
}

@MainActor
enum WebViewFactory {
    /// The app:// handler every view shares (made at launch).
    static var scheme: AppScheme = AppScheme(root: Paths.shellRoot, serviceOrigin: origin(Paths.serviceURL), extraConnect: Paths.extraConnect)

    /// More page-side scripts (resource names without ".js"), placed inside mac-bridge.js's function in this
    /// order: other packages register theirs at launch, before the first view (WM2's drag regions, for one).
    static var extraScripts: [String] = []

    /// Content rule lists every view gets (FOLEVI_OFFLINE's); WM1 adds per-place ones through `rulesFor`.
    static var rules: [WKContentRuleList] = []
    static var rulesFor: ((String?, ViewRole) -> [WKContentRuleList])?

    /// More settings for a view's configuration by its place and role, before the view is made (WM1: runners and
    /// the library's windows keep running behind other windows, `inactiveSchedulingPolicy`).
    static var configure: [(WKWebViewConfiguration, String?, ViewRole) -> Void] = []

    static func origin(_ url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return url.absoluteString }
        return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    static func make(place: String?, role: ViewRole, bootstrap: Bootstrap, frame: NSRect = .zero, nativeFrame: Bool = false, window: @escaping () -> NSWindow?) -> FoleviWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = Paths.dataStore
        config.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme)
        config.applicationNameForUserAgent = userAgentSuffix
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = false
        config.mediaTypesRequiringUserActionForPlayback = []
        // Decision M5: Apple's Writing Tools stay out of notes (Foli AI covers writing help).
        config.writingToolsBehavior = .none
        for step in configure { step(config, place, role) }
        let ucc = WKUserContentController()
        if let source = bridgeScript(bootstrap) {
            ucc.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        for list in rules + (rulesFor?(place, role) ?? []) { ucc.add(list) }
        config.userContentController = ucc

        let view = FoleviWebView(frame: frame, configuration: config, place: place, role: role, nativeFrame: nativeFrame)
        let router = MessageRouter(context: BridgeContext(
            place: { [weak view] in view?.place },
            window: { [weak view] in view?.window ?? window() },
            events: view.events
        ))
        ucc.addScriptMessageHandler(router, contentWorld: .page, name: MessageRouter.name)
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        view.underPageBackgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(red: 0x10 / 255, green: 0x10 / 255, blue: 0x11 / 255, alpha: 1) : .white
        }
        #if DEBUG
        view.isInspectable = true
        #endif
        Navigation.shared.attach(view)
        WindowManager.shared.register(view)
        return view
    }

    /// "Version/<Safari's> Safari/605.1.15 FoleviDesktop/<version>": the page's browserLabel() and session names
    /// read "Folevi for Mac", and sites that look for Safari see it.
    static var userAgentSuffix: String {
        "Version/\(safariVersion) Safari/605.1.15 FoleviDesktop/\(Paths.version)"
    }

    private static let safariVersion: String = {
        if let info = NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist"), let v = info["CFBundleShortVersionString"] as? String, !v.isEmpty { return v }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return "\(os.majorVersion).\(os.minorVersion)"
    }()

    // MARK: the bridge script

    private static func resource(_ name: String) -> String? {
        Bundle.main.url(forResource: name, withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    /// mac-bridge.js with the bootstrap and the shared files inside its function.
    static func bridgeScript(_ bootstrap: Bootstrap) -> String? {
        guard let template = resource("mac-bridge"), let shell = resource("shell-bridge") else { return nil }
        let kit = resource("folevi-cloud") ?? ""
        let extras = extraScripts.compactMap { resource($0) }.joined(separator: "\n")
        guard let data = try? JSONSerialization.data(withJSONObject: bootstrap.json), let boot = String(data: data, encoding: .utf8) else { return nil }
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "/*__FOLEVI_SHELL_BRIDGE__*/", with: shell)
            .replacingOccurrences(of: "/*__FOLEVI_EXTRAS__*/", with: extras)
            .replacingOccurrences(of: "\"__FOLEVI_BOOT__\"", with: boot)
    }

    // MARK: content rules

    /// Compiles the rule lists every view needs before the first one opens (FOLEVI_OFFLINE's).
    static func prepareRules() async {
        guard Paths.offline else { return }
        let json = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]"#
        if let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-offline", encodedContentRuleList: json) {
            rules.append(list)
        }
    }
}
