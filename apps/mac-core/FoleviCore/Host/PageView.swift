// Folevi Core's web views: the hidden engine page of each place, the warm editor pages notes show in, and the
// hidden runners places that aren't open keep. Every one runs the bundled export (the shared sync engine and the
// note editor) on app://folevi in native chrome mode; Core draws everything around it.
//
// The shared host files (Places.swift, ShellRouter.swift, Downloads.swift, Printing.swift...) build against the
// names here: `FoleviWebView`, `ViewRole`, `ViewEvents`, `Events`, `Bootstrap`, `WebViewFactory`, `Navigation`.
import AppKit
import FoleviEngine
import WebKit

/// What a view is for. `main` is a page that serves windows (the engine page and the editor pages); `runner` keeps
/// a place no window shows in sync; `quickAdd` is never made by Core (Quick Add is native) but the shared routers
/// know the name.
enum ViewRole: String {
    case main, runner, quickAdd
}

/// A web view that knows its place and role.
final class FoleviWebView: WKWebView {
    /// The place the view is bound to ("library", "acct:<user id>"), nil before places. Set by the host only.
    var place: String?
    let role: ViewRole
    let events = ViewEvents()
    /// Set once the first page finished loading.
    var loaded = false
    /// A page in native chrome mode (engine and editor pages): its reloads and ended processes go to its engine
    /// client.
    let nativeFrame: Bool
    /// Told when the page reloads or its process ends (the engine client resubscribes).
    var onLifecycle: ((PageLifecycle) -> Void)?
    /// Told once the first page finished loading.
    var onLoaded: (() -> Void)?

    init(frame: NSRect, configuration: WKWebViewConfiguration, place: String?, role: ViewRole, nativeFrame: Bool) {
        self.place = place
        self.role = role
        self.nativeFrame = nativeFrame
        super.init(frame: frame, configuration: configuration)
        events.view = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a nib") }

    /// A click on a window that isn't key acts at once (places the caret, presses a button), as in other Mac apps.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { role != .runner }

    // MARK: Edit > Undo and Redo

    /// The note's own history (the editor's), when this page shows a note: `run(undo)` performs a step, `state`
    /// says whether there is one each way. Set by the page's owner (Engine/Pages.swift).
    var editorHistory: (run: (Bool) -> Void, state: () -> (undo: Bool, redo: Bool)?)?

    /// Edit > Undo on a note runs the editor's undo (WebKit's own undo stack isn't the editor's history). A plain
    /// field of the page (the title, a caption) and a page without a note keep WebKit's.
    @objc func undo(_ sender: Any?) { history(undo: true) }

    @objc func redo(_ sender: Any?) { history(undo: false) }

    private func history(undo: Bool) {
        if let h = editorHistory, h.state() != nil {
            h.run(undo)
        } else if let m = undoManager {
            if undo { if m.canUndo { m.undo() } } else if m.canRedo { m.redo() }
        }
    }

    override func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        let isUndo = item.action == #selector(undo(_:))
        guard isUndo || item.action == #selector(redo(_:)) else { return super.validateUserInterfaceItem(item) }
        if let s = editorHistory?.state() {
            (item as? NSMenuItem)?.title = isUndo ? "Undo" : "Redo"
            return isUndo ? s.undo : s.redo
        }
        return (isUndo ? undoManager?.canUndo : undoManager?.canRedo) ?? false
    }

    // MARK: WebKit's own menu

    private static let leavingItems: Set<String> = [
        "WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
        "WKMenuItemIdentifierOpenLink", "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierOpenFrameInNewWindow",
        "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow",
        "WKMenuItemIdentifierDownloadLinkedFile", "WKMenuItemIdentifierDownloadImage", "WKMenuItemIdentifierDownloadMedia",
    ]

    /// Where the page draws no menu of its own, WebKit's shows: Copy, Paste, Look Up, spelling, Share and Services
    /// stay; what would leave or reload the page (it is also the place's engine) goes.
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        for item in menu.items where Self.leavingItems.contains(item.identifier?.rawValue ?? "") { menu.removeItem(item) }
        for item in menu.items.reversed() where item.isSeparatorItem {
            let at = menu.index(of: item)
            if at == 0 || at == menu.numberOfItems - 1 || menu.item(at: at - 1)?.isSeparatorItem == true { menu.removeItem(item) }
        }
    }
}

/// Native to page events for one view: window.__foleviEmit(plugin, event, data), which mac-bridge.js defines.
final class ViewEvents: BridgeEvents {
    weak var view: WKWebView?

    init(view: WKWebView? = nil) { self.view = view }

    func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        let send = { [weak self] in
            guard let view = self?.view else { return }
            let payload: Any = JSONSerialization.isValidJSONObject(data) ? data : [:]
            view.callAsyncJavaScript("window.__foleviEmit && window.__foleviEmit(plugin, event, data)", arguments: ["plugin": plugin, "event": event, "data": payload], in: nil, in: .page, completionHandler: nil)
        }
        if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
    }
}

/// Events to more than one view.
enum Events {
    /// Every page, or those whose place passes `filter`.
    @MainActor
    static func broadcast(_ plugin: String, _ event: String, _ data: [String: Any], where filter: (String?) -> Bool = { _ in true }) {
        for view in WindowManager.shared.allViews where filter(view.place) { view.events.emit(plugin, event, data) }
    }

    /// A command for one page (foleviDesktop.onCommand).
    @MainActor
    static func command(_ command: [String: Any], to view: FoleviWebView) {
        view.events.emit("FoleviDesktop", "command", command)
    }
}

/// A page that is about to go away: it is told it is closing (as a browser tells a closing tab) and kept until it
/// has saved, one second at most.
@MainActor
enum PageClosing {
    static let script = "window.dispatchEvent(new Event('pagehide')); await new Promise((r) => setTimeout(r, 250));"

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

/// What the page starts with, written into the bridge script.
struct Bootstrap {
    var mode: String
    var place: String?
    var background = false
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
    /// The app:// handler every view shares.
    static var scheme: AppScheme = AppScheme(root: Paths.shellRoot, serviceOrigin: origin(Paths.serviceURL), extraConnect: Paths.extraConnect)

    /// Content rule lists every view gets (FOLEVI_OFFLINE's); Places adds the library's through `rulesFor`.
    static var rules: [WKContentRuleList] = []
    static var rulesFor: ((String?, ViewRole) -> [WKContentRuleList])?

    /// More settings for a view's configuration by its place and role (Places: runners and the library's pages
    /// keep running behind other windows).
    static var configure: [(WKWebViewConfiguration, String?, ViewRole) -> Void] = []

    static func origin(_ url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return url.absoluteString }
        return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
    }

    /// A page for `place`. `nativeFrame` pages also get the native chrome marker (the engine and editor pages).
    static func make(place: String?, role: ViewRole, bootstrap: Bootstrap, frame: NSRect = .zero, nativeFrame: Bool = false, window: @escaping () -> NSWindow?) -> FoleviWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = Paths.dataStore
        config.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme)
        config.applicationNameForUserAgent = userAgentSuffix
        config.preferences.isElementFullscreenEnabled = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = false
        config.mediaTypesRequiringUserActionForPlayback = []
        // Apple's Writing Tools stay out of notes (Foli AI covers writing help), as in today's Folevi.
        config.writingToolsBehavior = .none
        // The engine and editor pages serve every window: their timers keep running while no window shows them.
        if nativeFrame { keepAwake(config) }
        for step in configure { step(config, place, role) }
        let ucc = WKUserContentController()
        if let source = bridgeScript(bootstrap) {
            ucc.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if nativeFrame {
            let marker = WebViewTransport.markerScript(NativeChromeMarker(platform: .macos, protocol: EngineContract.protocolVersion, place: place))
            ucc.addUserScript(WKUserScript(source: marker, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        for list in rules + (rulesFor?(place, role) ?? []) { ucc.add(list) }
        config.userContentController = ucc

        let view = FoleviWebView(frame: frame, configuration: config, place: place, role: role, nativeFrame: nativeFrame)
        let router = MessageRouter(context: BridgeContext(
            place: { [weak view] in view?.place },
            window: { [weak view] in view?.window ?? window() ?? NSApp.keyWindow },
            events: view.events
        ))
        ucc.addScriptMessageHandler(router, contentWorld: .page, name: MessageRouter.name)
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        view.underPageBackgroundColor = .textBackgroundColor
        #if DEBUG
        view.isInspectable = true
        #endif
        Navigation.shared.attach(view)
        WindowManager.shared.register(view)
        return view
    }

    /// No timer stretching or process nap for a page that serves windows from outside any of them.
    static func keepAwake(_ config: WKWebViewConfiguration) {
        config.preferences.inactiveSchedulingPolicy = .none
        for (name, value) in [("_setHiddenPageDOMTimerThrottlingEnabled:", false), ("_setPageVisibilityBasedProcessSuppressionEnabled:", false)] {
            let selector = Selector((name))
            guard config.preferences.responds(to: selector) else { continue }
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(config.preferences.method(for: selector), to: Setter.self)(config.preferences, selector, value)
        }
    }

    /// The page's browserLabel() reads "FoleviDesktop" (a Mac app); Core adds its own name after it.
    static var userAgentSuffix: String {
        "Version/\(safariVersion) Safari/605.1.15 FoleviDesktop/\(Paths.version) FoleviCore/\(Paths.version)"
    }

    private static let safariVersion: String = {
        if let info = NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist"), let v = info["CFBundleShortVersionString"] as? String, !v.isEmpty { return v }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return "\(os.majorVersion).\(os.minorVersion)"
    }()

    private static func resource(_ name: String) -> String? {
        Bundle.main.url(forResource: name, withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    /// mac-bridge.js with the bootstrap and the shared files inside its function.
    static func bridgeScript(_ bootstrap: Bootstrap) -> String? {
        guard let template = resource("mac-bridge"), let shell = resource("shell-bridge") else { return nil }
        let kit = resource("folevi-cloud") ?? ""
        guard let data = try? JSONSerialization.data(withJSONObject: bootstrap.json), let boot = String(data: data, encoding: .utf8) else { return nil }
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "/*__FOLEVI_SHELL_BRIDGE__*/", with: shell)
            .replacingOccurrences(of: "/*__FOLEVI_EXTRAS__*/", with: resource("capabilities") ?? "")
            .replacingOccurrences(of: "\"__FOLEVI_BOOT__\"", with: boot)
    }

    /// Compiles the rule lists every view needs before the first one opens (FOLEVI_OFFLINE's).
    static func prepareRules() async {
        guard Paths.offline else { return }
        let json = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]"#
        if let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-offline", encodedContentRuleList: json) {
            rules.append(list)
        }
    }
}

/// Where a page may go and what it may ask for: the main frame stays on app://folevi; a link elsewhere opens in
/// the default browser (http, https, mailto), and a link to one of Folevi's own pages opens in Core instead;
/// embeds may load https pages; the microphone (audio only) for the app's own page; nothing else. A load that
/// fails shows the offline page; a page whose process ended loads again.
@MainActor
final class Navigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let shared = Navigation()

    /// Opens a URL outside the app (tests replace it).
    var openExternally: (URL) -> Void = { NSWorkspace.shared.open($0) }
    /// Opens one of Folevi's own paths in Core (a window's route; the app model sets it).
    var openInApp: (String) -> Void = { _ in }

    func attach(_ view: FoleviWebView) {
        view.navigationDelegate = self
        view.uiDelegate = self
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        if Downloads.isDownload(action: action), ["blob", "data", "https", AppScheme.scheme].contains(scheme) { return decisionHandler(.download) }
        if let target = action.targetFrame, !target.isMainFrame {
            return decisionHandler(["https", "about", "blob", "data", AppScheme.scheme].contains(scheme) ? .allow : .cancel)
        }
        if Links.isAppUrl(url) { return decisionHandler(.allow) }
        if scheme == "about" { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        switch Links.target(url) {
        case .app(let path): openInApp(path)
        case .browser: openExternally(url)
        case .ignore: break
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if let view = webView as? FoleviWebView, view.nativeFrame, view.loaded { view.onLifecycle?(.reloading) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let view = webView as? FoleviWebView, !view.loaded, Links.isAppUrl(webView.url ?? URL(fileURLWithPath: "/")) else { return }
        view.loaded = true
        view.onLoaded?()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }

    private func failed(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
        let failed = (e.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        guard failed.map(Links.isAppUrl) ?? true, failed?.path != AppScheme.offlinePath else { return }
        var c = URLComponents(string: AppScheme.origin + AppScheme.offlinePath)!
        c.queryItems = [URLQueryItem(name: "url", value: failed?.absoluteString ?? AppScheme.origin + "/")]
        if let url = c.url { webView.load(URLRequest(url: url)) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if let view = webView as? FoleviWebView, view.nativeFrame { view.onLifecycle?(.terminated) }
        webView.reload()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        switch Links.target(url) {
        case .app(let path): openInApp(path)
        case .browser: openExternally(url)
        case .ignore: break
        }
        return nil
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let own = origin.protocol == AppScheme.scheme && origin.host == AppScheme.host && frame.isMainFrame
        decisionHandler(own && type == .microphone ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        if let window = webView.window ?? NSApp.keyWindow {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        present(alert, in: webView) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert, in: webView) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    private func present(_ alert: NSAlert, in webView: WKWebView, done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window ?? NSApp.keyWindow { alert.beginSheetModal(for: window, completionHandler: done) } else { done(alert.runModal()) }
    }
}
