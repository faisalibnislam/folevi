// The app's one screen: Capacitor's web view showing Folevi's built-in interface (capacitor://localhost, the
// iPhone and iPad app's origin, so an install updated over it keeps the page's storage). Around it, only what a web
// view needs to feel like an app: the bridge script before any page script (window.foleviNative and
// window.foleviShell, bridge/mobile-bridge.js), the library's attachments (folevi-file://), no rubber-banding of the
// whole page, and local mode's network rules (it never reaches Folevi). Everything else is the web app.
import Capacitor
import UIKit
import WebKit

final class FoleviViewController: CAPBridgeViewController {
    /// A local library's attachments (folevi-file://, apps/ios Native/Shell/LibraryFileHandler.swift).
    private let libraryFiles = LibraryFileHandler()
    private let hostPlugin = FoleviHostPlugin()

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.setURLSchemeHandler(libraryFiles, forURLScheme: LibraryFileHandler.scheme)
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

    override func capacitorDidLoad() {
        guard let bridge else { return }
        bridge.registerPluginInstance(hostPlugin)
        let host = hostPlugin.host
        let shellConfig = bridge.config.getPluginConfig("FoleviShell")
        if let raw = shellConfig.getString("serviceUrl"), let url = URL(string: raw) { ShellAuth.shared.service = url }
        ShellCloud.shared.dropboxAppKey = shellConfig.getString("dropboxAppKey") ?? ""
        ShellCloud.shared.googleClientId = shellConfig.getString("googleClientId") ?? ""
        libraryFiles.origin = host.appOrigin
        host.register(FoleviNativePlugin())
        host.register(FoleviShellPlugin())
        Self.startPlaces()
        applyMode()
        AppServices.modeApplied(local: ShellMode.current == "local")
        AppServices.launched(serverURL: ShellAuth.shared.service)
        // After Capacitor's own scripts (they define window.Capacitor, which the bridge calls through).
        if let webView, let source = Self.bridgeScript(origin: host.appOrigin) {
            webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #if DEBUG
        if let webView { webView.isInspectable = true }
        #endif
        #if DEBUG && targetEnvironment(simulator)
        if let webView { SimulatorEval.install(on: webView) }
        #endif
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

    private static func shellBootstrap() -> [String: Any] {
        let start = startPath
        startPath = nil
        return [
            "mode": ShellMode.current, "deviceName": ShellAuth.deviceName, "deviceFamily": UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone",
            "places": ["current": ShellPlaces.state.current.map { $0 as Any } ?? NSNull(), "background": false] as [String: Any],
            "start": start.map { $0 as Any } ?? NSNull(),
        ]
    }

    /// The places this device holds (the library and any accounts), as the iPhone and iPad app left them.
    private static func startPlaces() {
        let libraryFile = Platform.supportFolder.appendingPathComponent("library.json")
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
    /// built-in styles current. Account mode takes the rules away again.
    private func applyMode() {
        guard let controller = webView?.configuration.userContentController else { return }
        controller.removeAllContentRuleLists()
        guard ShellMode.current == "local" else { return }
        let patterns = [#"^[a-z]+://([^/]*\.)?folevi\.com"#, #"^[a-z]+://[^/]*\.convex\.cloud"#, #"^[a-z]+://[^/]*\.convex\.site"#]
        var rules: [[String: Any]] = patterns.map { ["trigger": ["url-filter": $0], "action": ["type": "block"]] }
        let blockOnly = rules
        rules += Self.noteStylePatterns.map { ["trigger": ["url-filter": $0], "action": ["type": "ignore-previous-rules"]] }
        let encode = { (r: [[String: Any]]) in (try? JSONSerialization.data(withJSONObject: r)).flatMap { String(data: $0, encoding: .utf8) } }
        guard let encoded = encode(rules), let fallback = encode(blockOnly) else { return }
        let store = WKContentRuleListStore.default()
        store?.compileContentRuleList(forIdentifier: "folevi-local-mode", encodedContentRuleList: encoded) { list, _ in
            if let list { return DispatchQueue.main.async { controller.add(list) } }
            // Never without the rules: if the exception can't compile, block everything as before.
            store?.compileContentRuleList(forIdentifier: "folevi-local-mode-strict", encodedContentRuleList: fallback) { strict, _ in
                guard let strict else { return }
                DispatchQueue.main.async { controller.add(strict) }
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
