// The app's one screen: Folevi's web view (Native/Host/WebHost.swift, no Capacitor since N1), plus what makes it
// feel like an app rather than a browser tab: swiping in from the left edge goes back through the page's own
// history, the whole page doesn't rubber-band when a view scrolls past its end, a tap on the status bar scrolls
// the screen on show to its top, and the page gets `window.foleviNative` (bridge.js) and, in the built-in
// interface, `window.foleviShell` (Native/Shell/shell-bridge.js) on Folevi's own page only.
//
// The page is made while the app launches (WebHost.prewarm() in AppDelegate) and handed to the first screen; a
// mode or place switch makes a new one on the same storage (restart()).
import UIKit
import WebKit

final class FoleviViewController: UIViewController {
    let host: WebHost
    private let statusBarTaps = StatusBarTapProxy()
    private var observers: [NSObjectProtocol] = []
    private var statusBarStyle: UIStatusBarStyle = .default

    /// What the plugins and extensions call the page's host (CAPBridgeViewController's `bridge` before).
    var bridge: WebHost? { host }
    var webView: WKWebView? { host.pageView }

    /// On the page given, else the one the app started loading at launch (or a new one).
    init(host: WebHost? = nil) {
        let host = host ?? WebHost.take()
        self.host = host
        super.init(nibName: nil, bundle: nil)
        host.viewController = self
        WebHost.current = host
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    override func loadView() {
        view = host.pageView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        statusBarTaps.onTap = { [weak self] in self?.host.triggerWindowJSEvent(eventName: "folevi:status-bar-tap") }
        view.insertSubview(statusBarTaps, at: 0)
        // Reduce Transparency, Increase Contrast, the text size: the page asks again when one changes. Not while
        // the page is still loading (some of these are posted as the app launches, before window.Capacitor
        // exists, which only threw "JS Eval error"): a page that loads reads them anyway (bridge.js).
        observers = SystemAccessibility.changes.map { name in
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.host.triggerWindowJSEvent(eventName: "folevi:accessibility") }
            }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        WebHost.current = host
        // Keyboard shortcuts reach the page straight away (Capacitor's hasInitialFocus).
        host.pageView.becomeFirstResponder()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        statusBarTaps.fit(view.bounds)
        view.sendSubviewToBack(statusBarTaps)
    }

    // MARK: status bar

    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    func setStatusBarStyle(_ style: UIStatusBarStyle) {
        statusBarStyle = style
        UIView.animate(withDuration: 0.2) { self.setNeedsStatusBarAppearanceUpdate() }
    }

    // MARK: the page's setup (what capacitorDidLoad did)

    /// Everything a new page needs before it loads: the plugins, the session's website, the places, the network rules
    /// of the mode, the bridge script, and links that came early.
    static func prepare(_ host: WebHost) {
        host.register(FoleviNativePlugin())
        host.register(StatusBarPlugin())
        let bundled = host.config.bundled
        if bundled {
            ShellAuth.shared.service = host.config.serviceURL
            // Dropbox and Google Drive client ids from the build (folevi-host.json); none: not offered.
            ShellCloud.shared.dropboxAppKey = host.config.dropboxAppKey
            ShellCloud.shared.googleClientId = host.config.googleClientId
            host.libraryFiles.origin = host.appOrigin
            host.register(FoleviShellPlugin())
            startPlaces()
            applyMode(to: host)
        }
        // Local mode's widgets, Shortcuts and Spotlight work from the page (Native/LocalExtensions.swift).
        AppServices.modeApplied(local: bundled && ShellMode.current == "local")
        LocalExtensions.attach(host)
        // The extensions' REST API is the site this app loads; links that came early can go to the page now.
        AppServices.launched(serverURL: bundled ? ShellAuth.shared.service : host.serverURL)
        if let source = bridgeScript(origin: host.appOrigin, shell: bundled ? shellBootstrap() : nil) { host.addUserScript(source) }
        // The native frame: the page runs in native chrome mode (the engine and the note page, no web frame).
        if PhoneFrame.enabled, bundled { host.addUserScript(PhoneFrame.markerScript(place: ShellPlaces.state.current)) }
        DeepLinkRouter.bridgeReady()
        #if DEBUG && targetEnvironment(simulator)
        SimulatorEval.install(on: host.pageView)
        DebugHooks.install()
        #endif
    }

    /// bridge.js with the one origin allowed to use it, the app's version and, in the built-in interface, what
    /// `foleviShell` starts with (the mode, read before any page script runs, and this device's name).
    private static func bridgeScript(origin: String, shell: [String: Any]?) -> String? {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let template = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        let shellJSON = shell.flatMap { try? JSONSerialization.data(withJSONObject: $0) }.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
        // The shared Dropbox and Google Drive code, inside bridge.js's function (scripts/bundle-cloud.mjs).
        let kit = shell == nil ? "" : (Bundle.main.url(forResource: "folevi-cloud", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "")
        // foleviShell's half shared with the Mac app (Native/Shell/shell-bridge.js), inside bridge.js's function too.
        let shellHalf = shell == nil ? "" : (Bundle.main.url(forResource: "shell-bridge", withExtension: "js").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "")
        return template
            .replacingOccurrences(of: "/*__FOLEVI_CLOUD_KIT__*/", with: kit)
            .replacingOccurrences(of: "/*__FOLEVI_SHELL_BRIDGE__*/", with: shellHalf)
            .replacingOccurrences(of: "\"__FOLEVI_ORIGIN__\"", with: jsString(origin))
            .replacingOccurrences(of: "\"__FOLEVI_VERSION__\"", with: jsString(version))
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
        if let phone = window.rootViewController as? PhoneFrameController {
            // The new place crossfades in (FoleviScreens' placeCrossfade for the frame's root).
            phone.retire {
                let next = PhoneFrameController(host: WebHost())
                if UIAccessibility.isReduceMotionEnabled {
                    window.rootViewController = next
                } else {
                    UIView.transition(with: window, duration: 0.28, options: [.transitionCrossDissolve, .allowAnimatedContent]) { window.rootViewController = next }
                }
            }
            return
        }
        guard let old = window.rootViewController as? FoleviViewController else {
            window.rootViewController = FoleviViewController(host: WebHost())
            return
        }
        // The old page leaves first, while it's still on screen (a web view taken off it stops running, and would
        // keep its databases and locks open: the next page, the same library maybe, would wait on it for ever).
        old.retire { window.rootViewController = FoleviViewController(host: WebHost()) }
    }

    private var retiring: BlankLoad?

    /// Sends this web view's page away (about:blank), then `done`; at most a second and a half.
    private func retire(then done: @escaping () -> Void) {
        let webView = host.pageView
        let load = BlankLoad { [weak self] in
            self?.retiring = nil
            self?.host.tearDown()
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
    static func applyMode(to host: WebHost) {
        let controller = host.pageView.configuration.userContentController
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
