// The app's one screen: Capacitor's web view showing Folevi (capacitor.config.ts server.url), plus what makes
// it feel like an app rather than a browser tab: swiping in from the left edge goes back through the page's
// own history, the whole page doesn't rubber-band when a view scrolls past its end, the page gets
// `window.foleviNative` (bridge.js) on Folevi's own pages only, and a navigation called off on purpose doesn't
// end on the offline page (NavigationGuard).
import Capacitor
import UIKit
import WebKit

final class FoleviViewController: CAPBridgeViewController {
    private var navigationGuard: NavigationGuard?
    private let statusBarTaps = StatusBarTapProxy()
    private var observers: [NSObjectProtocol] = []

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // A tap on the status bar scrolls the screen on show back to its top (Native/SystemSettings.swift).
        webView?.scrollView.scrollsToTop = false
        statusBarTaps.onTap = { [weak self] in self?.bridge?.triggerWindowJSEvent(eventName: "folevi:status-bar-tap") }
        view.insertSubview(statusBarTaps, at: 0)
        // Reduce Transparency, Increase Contrast, the text size: the page asks again when one changes.
        observers = SystemAccessibility.changes.map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.bridge?.triggerWindowJSEvent(eventName: "folevi:accessibility")
            }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        statusBarTaps.fit(view.bounds)
        view.sendSubviewToBack(statusBarTaps)
    }

    /// A local library's attachments (folevi-file://, Native/Shell/LibraryFileHandler.swift).
    private let libraryFiles = LibraryFileHandler()

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.setURLSchemeHandler(libraryFiles, forURLScheme: LibraryFileHandler.scheme)
        let webView = super.webView(with: frame, configuration: configuration)
        // The router moves with history.pushState, so the edge swipe steps back through the app's pages.
        webView.allowsBackForwardNavigationGestures = true
        // The app's views scroll inside the page; the page itself stays put (no pull-down that fights them).
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        return webView
    }

    /// Whether the app shows the interface built into it (capacitor.config.ts plugins.FoleviShell.bundled),
    /// rather than the website: then the page gets `window.foleviShell` too.
    private var bundled: Bool { Self.bundled(bridge) }

    static func bundled(_ bridge: CAPBridgeProtocol?) -> Bool { bridge?.config.getPluginConfig("FoleviShell").getBoolean("bundled", false) ?? false }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FoleviNativePlugin())
        if bundled {
            if let raw = bridge?.config.getPluginConfig("FoleviShell").getString("serviceUrl"), let url = URL(string: raw) { ShellAuth.shared.service = url }
            // Dropbox and Google Drive client ids from the build (capacitor.config.ts); none: not offered.
            ShellCloud.shared.dropboxAppKey = bridge?.config.getPluginConfig("FoleviShell").getString("dropboxAppKey") ?? ""
            ShellCloud.shared.googleClientId = bridge?.config.getPluginConfig("FoleviShell").getString("googleClientId") ?? ""
            libraryFiles.origin = AppOrigin.of(bridge?.config.serverURL)
            bridge?.registerPluginInstance(FoleviShellPlugin())
            Self.startPlaces()
            applyMode()
        }
        // Local mode's widgets, Shortcuts and Spotlight work from the page (Native/LocalExtensions.swift).
        AppServices.modeApplied(local: bundled && ShellMode.current == "local")
        LocalExtensions.attach(bridge)
        // The extensions' REST API is the site this app loads; links that came early can go to the page now.
        AppServices.launched(serverURL: bundled ? ShellAuth.shared.service : bridge?.config.serverURL)
        DeepLinkRouter.bridgeReady()
        if let webView, let capacitor = webView.navigationDelegate {
            let guardian = NavigationGuard(forwardingTo: capacitor)
            navigationGuard = guardian
            webView.navigationDelegate = guardian
        }
        guard let webView, let origin = bridge.map({ AppOrigin.of($0.config.serverURL) }), let source = Self.bridgeScript(origin: origin, shell: bundled ? Self.shellBootstrap() : nil) else { return }
        // After Capacitor's own scripts (they define window.Capacitor, which bridge.js calls through).
        webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG && targetEnvironment(simulator)
        SimulatorEval.install(on: webView)
        DebugHooks.install()
        #endif
    }

    /// bridge.js with the one origin allowed to use it, the app's version and, in the built-in interface, what
    /// `foleviShell` starts with (the mode, read before any page script runs, and this device's name).
    private static func bridgeScript(origin: String, shell: [String: Any]?) -> String? {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let template = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        let shellJSON = shell.flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        // The shared Dropbox and Google Drive code, inside bridge.js's function (scripts/bundle-cloud.mjs).
        let kit = shell == nil ? "" : (Bundle.main.url(forResource: "folevi-cloud", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "")
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "\"__FOLEVI_ORIGIN__\"", with: jsString(origin))
            .replacingOccurrences(of: "\"__FOLEVI_VERSION__\"", with: jsString(version))
            .replacingOccurrences(of: "\"__FOLEVI_BUILD__\"", with: jsString(build))
            .replacingOccurrences(of: "\"__FOLEVI_SHELL__\"", with: shellJSON)
    }

    /// Where the next page opens after a switch to another place (placesSwitch), once.
    static var startPath: String?

    /// What the page starts with. A mode switch starts the app's screen again (`restart`), so it's read anew. The
    /// page's place (several places, docs/MULTI_ACCOUNT_PLAN.md §2.2) is the open one: the app has one web view.
    private static func shellBootstrap() -> [String: Any] {
        let start = startPath
        startPath = nil
        return [
            "mode": ShellMode.current, "deviceName": ShellAuth.deviceName, "deviceFamily": UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone",
            "places": ["current": ShellPlaces.state.current.map { $0 as Any } ?? NSNull(), "background": false] as [String: Any],
            "start": start.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// A first launch of this version: where the app was becomes the places; the one session older builds kept moves
    /// to its account (then the screen opens again in it).
    private static func startPlaces() {
        let libraryFile = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Folevi", isDirectory: true).appendingPathComponent("library.json")
        ShellPlaces.migrate(libraryConfigured: FileManager.default.fileExists(atPath: libraryFile.path))
        if ShellMode.current == "account", ShellPlaces.state.current == nil, let first = ShellPlaces.state.accounts.first { ShellPlaces.setCurrent(first.id) }
        guard ShellAuth.shared.token(for: nil) != nil else { return }
        Task {
            guard let u = await ShellAuth.shared.adoptLegacy() else { return }
            await MainActor.run {
                let first = ShellPlaces.state.accounts.isEmpty
                guard let a = ShellPlaces.addAccount(userId: u.userId, name: u.name, email: u.email, avatarUrl: u.avatarUrl) else { return }
                if first { E2eeKeys.adoptLegacy(userId: u.userId) }
                if ShellPlaces.state.current == nil && ShellMode.current == "account" {
                    ShellPlaces.setCurrent(a.id)
                    restart()
                }
            }
        }
    }

    /// A new web view on the same storage, for a new mode: its scripts and network rules start from it.
    static func restart() {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow) else { return }
        guard let old = window.rootViewController as? FoleviViewController, old.webView != nil else {
            window.rootViewController = FoleviViewController()
            return
        }
        // The old page leaves first, while it's still on screen (a web view taken off it stops running, and would
        // keep its databases and locks open: the next page, the same library maybe, would wait on it for ever).
        old.retire { window.rootViewController = FoleviViewController() }
    }

    private var retiring: BlankLoad?

    /// Sends this web view's page away (about:blank), then `done`; at most a second and a half.
    private func retire(then done: @escaping () -> Void) {
        guard let webView else { return done() }
        let load = BlankLoad { [weak self] in
            self?.retiring = nil
            webView.configuration.userContentController.removeAllUserScripts()
            webView.configuration.userContentController.removeAllScriptMessageHandlers()
            done()
        }
        retiring = load
        webView.stopLoading()
        webView.navigationDelegate = load
        webView.load(URLRequest(url: URL(string: "about:blank")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { load.finish() }
    }

    /// Local mode never reaches Folevi or its database: a second layer under the page's own policy (plan §1),
    /// rules WebKit applies to everything the web view loads. Account mode takes them away again.
    func applyMode() {
        guard let controller = webView?.configuration.userContentController else { return }
        controller.removeAllContentRuleLists()
        guard ShellMode.current == "local" else { return }
        // WebKit's rule patterns have no alternation: one rule per host.
        let patterns = [#"^[a-z]+://([^/]*\.)?folevi\.com"#, #"^[a-z]+://[^/]*\.convex\.cloud"#, #"^[a-z]+://[^/]*\.convex\.site"#]
        let rules = patterns.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        guard let data = try? JSONSerialization.data(withJSONObject: rules), let encoded = String(data: data, encoding: .utf8) else { return }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "folevi-local-mode", encodedContentRuleList: encoded) { list, _ in
            guard let list else { return }
            DispatchQueue.main.async { controller.add(list) }
        }
    }

    private static func jsString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(json.dropFirst().dropLast())
    }
}

/// Origins as the page sees them ("https://app.folevi.com", "http://app.localhost:3002").
enum AppOrigin {
    static func of(_ url: URL?) -> String {
        guard let url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return "" }
        return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }
}

/// Sits in front of Capacitor's navigation delegate and passes everything on, except a navigation that was
/// called off on purpose (a link sent to the in-app Safari view after a redirect, a page replaced by another
/// before it loaded): Capacitor would show the offline page for those, as if the network had failed.
final class NavigationGuard: NSObject, WKNavigationDelegate {
    private weak var capacitor: (NSObjectProtocol & WKNavigationDelegate)?

    init(forwardingTo capacitor: NSObjectProtocol & WKNavigationDelegate) {
        self.capacitor = capacitor
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (capacitor?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        capacitor
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !Self.calledOff(error) else { return }
        capacitor?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !Self.calledOff(error) else { return }
        capacitor?.webView?(webView, didFail: navigation, withError: error)
    }

    /// Canceled (NSURLErrorCancelled), or stopped by a navigation policy (WebKit's "frame load interrupted").
    private static func calledOff(_ error: Error) -> Bool {
        let error = error as NSError
        return (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) || (error.domain == "WebKitErrorDomain" && error.code == 102)
    }
}

/// Waits for a web view's about:blank to load (or fail), once.
private final class BlankLoad: NSObject, WKNavigationDelegate {
    private var done: (() -> Void)?

    init(_ done: @escaping () -> Void) {
        self.done = done
    }

    func finish() {
        let d = done
        done = nil
        d?()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }
}
