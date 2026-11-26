// The app's one screen: Capacitor's web view showing Folevi's built-in interface (capacitor://localhost, the
// iPhone and iPad app's origin, so an install updated over it keeps the page's storage). Around it, only what a web
// view needs to feel like an app: the bridge script before any page script (window.foleviNative and
// window.foleviShell, bridge/mobile-bridge.js), the library's attachments (folevi-file://), no rubber-banding of the
// whole page, and local mode's network rules (it never reaches Folevi). Everything else is the web app.
import Capacitor
import UIKit
import VisionKit
import WebKit

final class FoleviViewController: CAPBridgeViewController {
    /// A local library's attachments (folevi-file://, apps/ios Native/Shell/LibraryFileHandler.swift).
    private let libraryFiles = LibraryFileHandler()
    private let hostPlugin = FoleviHostPlugin()

    /// Where iPhone Duo's fold crosses the page while partly open (FoldMarks.swift).
    private var foldMarks: FoldMarks?

    /// Whether local mode's network rules were on the web view before its first page load.
    private var rulesAtLoad = false

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.setURLSchemeHandler(libraryFiles, forURLScheme: LibraryFileHandler.scheme)
        // Local mode's rules go on before the page loads, so not even its first request can reach Folevi. They're
        // compiled once (AppDelegate starts it at launch) and looked up from WebKit's store after that.
        if Self.pageMode == "local", let rules = Self.localRules {
            configuration.userContentController.add(rules)
            rulesAtLoad = true
        }
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let webView = super.webView(with: frame, configuration: configuration)
        // The app's views scroll inside the page; the page itself stays put.
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // A tap on the status bar is the page's to handle (its own scroll views).
        webView.scrollView.scrollsToTop = false
        // The page's own stack moves screens on iPhone (components/iphone); the edge swipe goes back in it there.
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        return webView
    }

    /// In local mode the first page load waits for the network rules (a lookup in WebKit's store, a few milliseconds;
    /// the splash screen is up meanwhile): Capacitor's viewDidLoad is what starts it.
    override func viewDidLoad() {
        guard Self.pageMode == "local", !rulesAtLoad else { return super.viewDidLoad() }
        Self.prepareLocalRules { [weak self] rules in self?.loadAfterRules(rules) }
    }

    private func loadAfterRules(_ rules: WKContentRuleList?) {
        if let rules, let webView {
            webView.configuration.userContentController.add(rules)
            rulesAtLoad = true
        }
        super.viewDidLoad()
    }

    override func capacitorDidLoad() {
        guard let bridge else { return }
        bridge.registerPluginInstance(hostPlugin)
        let host = hostPlugin.host
        // Only the app's own page reaches the plugins, never a frame inside it (HostBridge.swift, MainFrameGate).
        if let capacitor = bridge as? CapacitorBridge { MainFrameGate.install(on: capacitor, appOrigin: { [weak host] in host?.appOrigin ?? "" }) }
        let shellConfig = bridge.config.getPluginConfig("FoleviShell")
        if let raw = shellConfig.getString("serviceUrl"), let url = URL(string: raw) { ShellAuth.shared.service = url }
        ShellCloud.shared.dropboxAppKey = shellConfig.getString("dropboxAppKey") ?? ""
        ShellCloud.shared.googleClientId = shellConfig.getString("googleClientId") ?? ""
        libraryFiles.origin = host.appOrigin
        host.register(FoleviNativePlugin())
        host.register(FoleviShellPlugin())
        Self.startPlaces()
        // The best connection for Folevi Server places (a home name or a public one), at launch and on network
        // changes: the open place's page loads again on the new name, still signed in (apps/ios ShellServer.swift).
        ServerReach.shared.onChange = { place in
            if place == ShellPlaces.state.current { Self.restart() }
        }
        ServerReach.shared.start()
        applyMode()
        AppServices.modeApplied(local: ShellMode.current == "local")
        // The share sheet, widgets and Spotlight use Folevi Cloud's REST API, whichever place is open. (A token an
        // earlier build kept for an account on a Folevi Server goes first, so it is never sent there.)
        ShellPlaces.dropServerTokens()
        AppServices.launched(serverURL: ShellAuth.shared.cloudService)
        // After Capacitor's own scripts (they define window.Capacitor, which the bridge calls through).
        if let webView, let source = Self.bridgeScript(origin: host.appOrigin) {
            webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let webView { foldMarks = FoldMarks(webView: webView) }
        #if DEBUG
        if let webView { webView.isInspectable = true }
        #endif
        #if DEBUG && targetEnvironment(simulator)
        if let webView { SimulatorEval.install(on: webView) }
        #endif
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        foldMarks?.refresh()
    }

    /// mobile-bridge.js with the one origin allowed to use it, the app's version, and what `foleviShell` starts with
    /// (the mode, read before any page script runs, this device's name, the open place).
    private static func bridgeScript(origin: String) -> String? {
        guard let url = Bundle.main.url(forResource: "mobile-bridge", withExtension: "js"), let template = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let shellJSON = (try? JSONSerialization.data(withJSONObject: shellBootstrap())).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        // The shared Dropbox and Google Drive code (apps/ios scripts/bundle-cloud.mjs), inside the bridge's function.
        let kit = Bundle.main.url(forResource: "folevi-cloud", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        // foleviShell's half shared with the Mac app (apps/ios Native/Shell/shell-bridge.js), inside it too.
        let shellHalf = Bundle.main.url(forResource: "shell-bridge", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "/*__FOLEVI_SHELL_BRIDGE__*/", with: shellHalf)
            .replacingOccurrences(of: "\"__FOLEVI_PLATFORM__\"", with: jsString("ios"))
            .replacingOccurrences(of: "\"__FOLEVI_ORIGIN__\"", with: jsString(origin))
            .replacingOccurrences(of: "\"__FOLEVI_VERSION__\"", with: jsString(version))
            .replacingOccurrences(of: "\"__FOLEVI_SHELL__\"", with: shellJSON)
    }

    /// Where the next page opens after a switch to another place (placesSwitch), once.
    static var startPath: String?

    /// The mode this page loads in: the chosen one, except on a Folevi server's sign-in screen ("Your own server",
    /// placesAddServer), which is an account's even on the very first launch or from the library.
    static var pageMode: String {
        ShellPlaces.state.current == nil && ShellPlaces.server(of: nil) != nil ? "account" : ShellMode.current
    }

    private static func shellBootstrap() -> [String: Any] {
        let start = startPath
        startPath = nil
        let current = ShellPlaces.state.current
        // A Folevi Server place's addresses, or the server whose sign-in screen this is ("Your own server"): the
        // page's Convex client and sign-in use them instead of the build's NEXT_PUBLIC values (CONTRACT §6.1). Null:
        // Folevi Cloud or the library.
        let server = ShellPlaces.server(of: current)
        return [
            "mode": pageMode, "deviceName": ShellAuth.deviceName, "deviceFamily": UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone",
            // Whether this device can read QR codes ("Your own server", ServerCodeScanner.swift).
            "canScan": DataScannerViewController.isSupported,
            "places": ["current": current.map { $0 as Any } ?? NSNull(), "background": false,
                       "server": server.map { $0.json as Any } ?? NSNull()] as [String: Any],
            "start": start.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// The places this device holds (the library and any accounts), as the iPhone and iPad app left them.
    private static func startPlaces() {
        let libraryFile = Platform.supportFolder.appendingPathComponent("library.json")
        ShellPlaces.migrate(libraryConfigured: FileManager.default.fileExists(atPath: libraryFile.path))
        // Nothing open in account mode: the first account opens, unless a sign-in is waiting (another account, or a
        // Folevi server's sign-in screen after "Your own server"; this runs again on every restart).
        if ShellMode.current == "account", ShellPlaces.state.current == nil, !ShellPlaces.pendingAccount, let first = ShellPlaces.state.accounts.first { ShellPlaces.setCurrent(first.id) }
        // The Keychain is read off the main thread: this runs before the first page loads, on every launch.
        Task.detached(priority: .utility) {
            guard ShellAuth.shared.token(for: nil) != nil else { return }
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

    /// A new screen on the same storage, for a new mode or place: its scripts and network rules start from it.
    static func restart() {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow) else { return }
        guard let old = window.rootViewController as? FoleviViewController else {
            window.rootViewController = FoleviViewController()
            return
        }
        // The old page leaves first, while it's still on screen (a web view taken off it stops running, and would
        // keep its databases and locks open: the next page, the same library maybe, would wait on it for ever).
        old.retire {
            let next = FoleviViewController()
            if UIAccessibility.isReduceMotionEnabled {
                window.rootViewController = next
            } else {
                UIView.transition(with: window, duration: 0.28, options: [.transitionCrossDissolve, .allowAnimatedContent]) { window.rootViewController = next }
            }
        }
    }

    private var retiring: BlankLoad?

    /// Sends this web view's page away (about:blank), then `done`; at most a second and a half.
    private func retire(then done: @escaping () -> Void) {
        guard let webView else { return done() }
        let load = BlankLoad { [weak self] in
            self?.retiring = nil
            webView.configuration.userContentController.removeAllUserScripts()
            done()
        }
        retiring = load
        webView.stopLoading()
        webView.navigationDelegate = load
        webView.load(URLRequest(url: URL(string: "about:blank")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { load.finish() }
    }

    /// Local mode sends Folevi nothing: rules WebKit applies to everything the web view loads, under the page's own
    /// policy. The one exception (the owner's choice, 2026-11-24, docs/MOBILE.md "Note styles and covers"): when online,
    /// the page may fetch the public list of note styles and their images, anonymously and read-only, to keep the
    /// built-in styles current. Account mode has no rules. On the rare launch where the rules weren't ready before the
    /// first load (the first one in local mode), they're added as soon as they are and the page loads again under them.
    private func applyMode() {
        guard Self.pageMode == "local", !rulesAtLoad else { return }
        Self.prepareLocalRules { [weak self] rules in
            guard let self, let rules, let webView = self.webView else { return }
            webView.configuration.userContentController.add(rules)
            self.rulesAtLoad = true
            webView.reload()
        }
    }

    /// The compiled rules, once WebKit has them (main thread only).
    private static var localRules: WKContentRuleList?
    private static var preparing: [(WKContentRuleList?) -> Void] = []

    /// Looks the rules up in WebKit's store, compiling them the first time (or after they change), then answers on
    /// the main thread. If the list with the exception can't compile, the strict list (block everything) is used.
    static func prepareLocalRules(_ done: @escaping (WKContentRuleList?) -> Void = { _ in }) {
        if let localRules { return done(localRules) }
        preparing.append(done)
        guard preparing.count == 1 else { return }
        let finish: (WKContentRuleList?) -> Void = { list in
            DispatchQueue.main.async {
                if let list { localRules = list }
                let waiting = preparing
                preparing = []
                waiting.forEach { $0(list) }
            }
        }
        let blocks = [#"^[a-z]+://([^/]*\.)?folevi\.com"#, #"^[a-z]+://[^/]*\.convex\.cloud"#, #"^[a-z]+://[^/]*\.convex\.site"#]
        let strict: [[String: Any]] = blocks.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        let full = strict + noteStylePatterns.map { ["trigger": ["url-filter": $0], "action": ["type": "ignore-previous-rules"]] }
        let encode = { (r: [[String: Any]]) in (try? JSONSerialization.data(withJSONObject: r, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } }
        guard let encoded = encode(full), let fallback = encode(strict), let store = WKContentRuleListStore.default() else { return finish(nil) }
        // The identifier names this exact list, so a changed list compiles anew and an unchanged one is only looked up.
        // (FNV-1a: String's own hash changes from one launch to the next.)
        let hash = encoded.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        let id = "folevi-local-mode-\(String(hash, radix: 36))"
        store.lookUpContentRuleList(forIdentifier: id) { found, _ in
            if let found { return finish(found) }
            store.compileContentRuleList(forIdentifier: id, encodedContentRuleList: encoded) { list, _ in
                if let list { return finish(list) }
                // Never without the rules: if the exception can't compile, block everything as before.
                store.compileContentRuleList(forIdentifier: "folevi-local-mode-strict", encodedContentRuleList: fallback) { strictList, _ in finish(strictList) }
            }
        }
    }

    /// What local mode may load from Folevi: the note styles list (GET <deployment>.convex.site/note-styles, public, no
    /// account) and the styles' images in Convex file storage (GET <deployment>.convex.cloud/api/storage/<id>).
    /// (Plain prefixes: WebKit's rules know a small regex subset, and a list it can't compile would drop every rule.)
    static let noteStylePatterns = [#"^https://[^/]*\.convex\.site/note-styles"#, #"^https://[^/]*\.convex\.cloud/api/storage/"#]

    private static func jsString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(json.dropFirst().dropLast())
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
