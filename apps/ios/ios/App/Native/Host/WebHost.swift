// The web view the app shows Folevi in, and everything Capacitor used to do around it (docs/NATIVE_APP_PLAN.md N1):
// the configuration (the same data store, origin, media and content-mode settings, so an upgraded install keeps
// its storage and the page behaves as before), the scheme handlers (AppScheme for capacitor://localhost,
// LibraryFileHandler for folevi-file://), the bridge (Bridge.swift: plugins called by name, events to the page),
// navigation rules, JavaScript panels, and reloading when WebKit's content process ends.
//
// One host is one web view and one page. The first is made while the app launches (WebHost.prewarm(), from
// AppDelegate), before the window exists, so the page is already loading when the scene asks for it; a mode or
// place switch makes a new one on the same storage (FoleviViewController.restart()).
import SafariServices
import UIKit
import WebKit
import FoleviEngine

/// What the build put in App/folevi-host.json (scripts/sync-web.mjs): which page the app opens and where it signs in.
struct HostConfig {
    enum Mode: String { case bundled, shellDev, website }

    /// bundled: the export inside the app at capacitor://localhost (releases); shellDev: the built-in interface from
    /// a development server; website: the website itself, with the offline page from the bundle.
    var mode: Mode = .bundled
    /// Where the page lives: capacitor://localhost, or the development server or website's origin.
    var serverURL = URL(string: AppScheme.origin)!
    /// The first page loaded.
    var startURL = URL(string: AppScheme.origin + "/")!
    /// The website for sign-in and /api/auth (ShellAuth.service).
    var serviceURL = URL(string: "https://app.folevi.com")!
    /// The website's offline page (website mode only), from the bundle.
    var errorPath: String?
    /// Dropbox and Google Drive public client ids (none: not offered).
    var dropboxAppKey = ""
    var googleClientId = ""

    var bundled: Bool { mode != .website }

    static func load(bundle: Bundle = .main) -> HostConfig {
        guard let url = bundle.url(forResource: "folevi-host", withExtension: "json"), let data = try? Data(contentsOf: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return HostConfig() }
        return parse(json)
    }

    static func parse(_ json: [String: Any]) -> HostConfig {
        var c = HostConfig()
        if let raw = json["mode"] as? String, let mode = Mode(rawValue: raw) { c.mode = mode }
        if c.mode != .bundled, let raw = json["serverUrl"] as? String, let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" {
            c.serverURL = URL(string: AppOrigin.of(url))!
            c.startURL = url
        }
        if let raw = json["serviceUrl"] as? String, let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" { c.serviceURL = url }
        c.errorPath = (json["errorPath"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        c.dropboxAppKey = json["dropboxAppKey"] as? String ?? ""
        c.googleClientId = json["googleClientId"] as? String ?? ""
        return c
    }

    /// The offline page's address (website mode), served from the bundle at capacitor://localhost.
    var errorURL: URL? { errorPath.flatMap { URL(string: AppScheme.origin + "/" + $0) } }
}

/// Used on the main thread only (as Capacitor's bridge was); not an actor, so the plugins reach it as before.
final class WebHost: NSObject {
    let config: HostConfig
    /// The page's web view.
    let pageView: WKWebView
    /// The same, as the plugins reach it (`bridge?.webView`, as with Capacitor's bridge).
    var webView: WKWebView? { pageView }
    /// The view controller showing this page (sheets and pickers are shown from it).
    weak var viewController: UIViewController?

    private(set) var plugins: [String: BridgePlugin] = [:]
    private let appScheme: AppScheme?
    let libraryFiles: LibraryFileHandler
    private var router: MessageRouter?
    private var initialLoad = true
    private var opaqueBeforeLoad = true
    private var observers: [NSObjectProtocol] = []
    /// Whether the page's bridge script is up (it says so when it runs): links wait until it is.
    private var pageReady = false
    private var waitingLinks: [URL] = []

    /// The page on show (the key window's), for links and app events.
    static weak var current: WebHost?
    /// The native frame's engine transport hears the page reload or its process end (resubscribes after).
    var onPageLifecycle: ((PageLifecycle) -> Void)?

    var serverURL: URL { config.serverURL }
    /// "capacitor://localhost" (or the development server's origin).
    var appOrigin: String { AppOrigin.of(config.serverURL) }

    // MARK: prewarm

    private static var prewarmed: WebHost?

    /// Makes the first page while the app launches, so it's loading before the window asks for it.
    @MainActor static func prewarm() {
        guard prewarmed == nil else { return }
        prewarmed = WebHost()
    }

    /// The prewarmed page (once), else a new one.
    @MainActor static func take() -> WebHost {
        if let p = prewarmed {
            prewarmed = nil
            return p
        }
        return WebHost()
    }

    // MARK: making one

    @MainActor init(config: HostConfig = .load()) {
        self.config = config
        let scheme = AppScheme.bundledRoot.map { AppScheme(root: $0) }
        scheme?.bridgeOrigin = AppOrigin.of(config.serverURL)
        appScheme = scheme
        let files = LibraryFileHandler()
        libraryFiles = files
        // Scheme handlers belong to the configuration before the web view is made (WebKit copies it then).
        let configuration = Self.configuration(config)
        if let scheme { configuration.setURLSchemeHandler(scheme, forURLScheme: AppScheme.scheme) }
        configuration.setURLSchemeHandler(files, forURLScheme: LibraryFileHandler.scheme)
        pageView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        super.init()
        // The user content controller is shared with the web view: handlers and scripts added now still apply.
        let router = MessageRouter(host: self)
        self.router = router
        pageView.configuration.userContentController.addScriptMessageHandler(router, contentWorld: .page, name: MessageRouter.name)
        Self.style(pageView)
        pageView.navigationDelegate = self
        pageView.uiDelegate = self
        pageView.scrollView.delegate = self
        KeyboardHost.shared.attach(self)
        observeApp()
        // The newest page is the one links and app events go to (a restart's replaces the last).
        Self.current = self
        FoleviViewController.prepare(self)
        load()
    }

    /// The configuration Capacitor gave the web view (CAPBridgeViewController.webViewConfiguration), minus its own
    /// bridge: the default data store (the storage an upgrade must keep), inline media, App-Bound Domains, the
    /// user agent's "FoleviiOS/1.0", the recommended content mode.
    private static func configuration(_ config: HostConfig) -> WKWebViewConfiguration {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .default()
        c.allowsInlineMediaPlayback = true
        c.suppressesIncrementalRendering = false
        c.allowsAirPlayForMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        c.limitsNavigationsToAppBoundDomains = true
        c.preferences.isElementFullscreenEnabled = true
        let appName = c.applicationNameForUserAgent.flatMap { $0.isEmpty ? nil : $0 }
        c.applicationNameForUserAgent = appName.map { "\($0) FoleviiOS/1.0" } ?? "FoleviiOS/1.0"
        c.defaultWebpagePreferences.preferredContentMode = .recommended
        c.userContentController = WKUserContentController()
        return c
    }

    /// The web view's own settings: no bounce, no inset adjustment (the page lays itself out under the bars with
    /// safe-area insets), no link previews, the system background until the page paints, the edge swipe through
    /// the page's history, and a focus() from the page raising the keyboard.
    private static func style(_ v: WKWebView) {
        v.scrollView.bounces = false
        v.scrollView.alwaysBounceVertical = false
        v.scrollView.contentInsetAdjustmentBehavior = .never
        v.scrollView.isScrollEnabled = true
        v.scrollView.scrollsToTop = false
        v.allowsLinkPreview = false
        v.allowsBackForwardNavigationGestures = !PhoneFrame.enabled
        v.backgroundColor = .systemBackground
        v.scrollView.backgroundColor = .systemBackground
        KeyboardHost.allowProgrammaticFocus()
        #if DEBUG
        v.isInspectable = true
        #endif
    }

    func register(_ plugin: BridgePlugin) {
        plugin.bridge = self
        plugins[plugin.jsName] = plugin
        plugin.load()
    }

    /// Adds a script every page of this view gets at document start, in its main frame.
    func addUserScript(_ source: String) {
        pageView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func load() {
        if config.mode == .bundled, appScheme == nil {
            // The export is missing from this build (scripts/sync-web.mjs wasn't run): say so instead of a blank page.
            pageView.loadHTMLString("<meta name=viewport content='width=device-width'><p style='font:17px -apple-system;padding:40px'>The interface built into Folevi is missing from this build.</p>", baseURL: nil)
            return
        }
        opaqueBeforeLoad = pageView.isOpaque
        pageView.isOpaque = false
        // The native frame (Native/Phone): the page idles on /native, drawing nothing until a note is asked for.
        let start = PhoneFrame.enabled && config.bundled ? URL(string: AppOrigin.of(config.serverURL) + PhoneFrame.idlePath) ?? config.startURL : config.startURL
        pageView.load(URLRequest(url: start))
    }

    // MARK: the bridge

    /// A call from the page (MessageRouter): the transport's own, or a plugin's.
    @MainActor func route(_ call: MessageRouter.Call, _ bridgeCall: BridgeCall) {
        if call.plugin == "FoleviHost" {
            switch call.method {
            case "ping":
                return bridgeCall.resolve(["pong": true, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0", "echo": call.options["echo"] ?? NSNull()])
            case "ready":
                bridgeCall.resolve()
                pageIsReady()
                return
            default:
                return bridgeCall.reject("FoleviHost.\(call.method) isn't in this build of Folevi.", "unavailable")
            }
        }
        guard let plugin = plugins[call.plugin] else { return bridgeCall.reject("Folevi doesn't know \(call.plugin).", "unavailable") }
        plugin.invoke(bridgeCall)
    }

    /// An event for this page's listeners (bridge.js listen(plugin, event, cb)).
    func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        let payload: [String: Any] = JSONSerialization.isValidJSONObject(data) ? data : [:]
        let send: () -> Void = { [weak self] in
            guard let self else { return }
            MainActor.assumeIsolated {
                self.pageView.callAsyncJavaScript("window.__foleviEmit && window.__foleviEmit(plugin, event, data)", arguments: ["plugin": plugin, "event": event, "data": payload], in: nil, in: .page, completionHandler: nil)
            }
        }
        if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
    }

    /// A window event on the page (Capacitor's triggerWindowJSEvent): `data`'s keys become the event's properties.
    func triggerWindowJSEvent(eventName: String, data: [String: Any]? = nil) {
        let payload: [String: Any] = data.flatMap { JSONSerialization.isValidJSONObject($0) ? $0 : nil } ?? [:]
        pageView.callAsyncJavaScript("var e = new Event(name); Object.assign(e, data); window.dispatchEvent(e);", arguments: ["name": eventName, "data": payload], in: nil, in: .page, completionHandler: nil)
    }

    // MARK: links (what Capacitor's App plugin did with appUrlOpen)

    /// A folevi:// link for the page: now, or once its bridge is up (bridge.js keeps it until the page listens).
    @MainActor func openLink(_ url: URL) {
        guard pageReady else { return waitingLinks.append(url) }
        emit("App", "appUrlOpen", ["url": url.absoluteString])
    }

    @MainActor private func pageIsReady() {
        pageReady = true
        let links = waitingLinks
        waitingLinks = []
        links.forEach(openLink)
    }

    // MARK: the app coming and going (Capacitor's appStateChange)

    private func observeApp() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.emit("App", "appStateChange", ["isActive": true]) }
            },
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.emit("App", "appStateChange", ["isActive": false]) }
            },
        ]
    }

    /// Takes this page away for good (a new one replaces it): no scripts, handlers or observers left behind.
    func tearDown() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        let ucc = pageView.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.removeAllScriptMessageHandlers()
        router = nil
        if Self.current === self { Self.current = nil }
    }

    /// The view controller to present sheets from (the topmost one over this page).
    func topController() -> UIViewController? {
        var top = viewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// MARK: - Navigation (CAPWebViewDelegationHandler and NavigationGuard)

extension WebHost: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        decisionHandler(decide(navigationAction))
    }

    /// The plugins first (FoleviNativePlugin decides for links), then Capacitor's rule: the app's own pages load
    /// here, anything else at the top level goes to the system.
    func decide(_ action: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .allow }
        for plugin in plugins.values {
            if let override = plugin.shouldOverrideLoad(action) { return override.boolValue ? .cancel : .allow }
        }
        let topLevel = action.targetFrame == nil || action.targetFrame?.isMainFrame == true
        let own = url.absoluteString.hasPrefix(config.serverURL.absoluteString) || url.absoluteString.hasPrefix(AppScheme.origin)
        if !own, topLevel {
            if pageView.window?.windowScene?.activationState == .foregroundActive { UIApplication.shared.open(url) }
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A new page: its bridge says when it's up again.
        pageReady = false
        onPageLifecycle?(.reloading)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        endInitialLoad()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        endInitialLoad()
        failed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    /// WebKit ended the page's process (memory pressure in the background): the page loads again, its data is safe
    /// in IndexedDB (edits are written there before any network call).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        onPageLifecycle?(.terminated)
        pageView.reload()
    }

    private func endInitialLoad() {
        guard initialLoad else { return }
        initialLoad = false
        pageView.isOpaque = opaqueBeforeLoad
    }

    /// A failed load shows the offline page (website mode), except a navigation called off on purpose (a link
    /// sent to the in-app Safari view after a redirect, a page replaced before it loaded).
    private func failed(_ error: Error) {
        let e = error as NSError
        let calledOff = (e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled) || (e.domain == "WebKitErrorDomain" && e.code == 102)
        guard !calledOff, let errorURL = config.errorURL else { return }
        pageView.load(URLRequest(url: errorURL))
    }
}

// MARK: - JavaScript panels, new windows, permissions (CAPWebViewDelegationHandler)

extension WebHost: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        guard let presenter = topController() else { return completionHandler() }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        guard let presenter = topController() else { return completionHandler(false) }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        guard let presenter = topController() else { return completionHandler(nil) }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text ?? defaultText) })
        presenter.present(alert, animated: true)
    }

    /// window.open and target=_blank that no plugin took: the system opens it (as Capacitor did).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    /// The camera and microphone for the page's recorders (iOS still asks the person once, with Info.plist's words).
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(MessageRouter.origin(of: origin) == appOrigin ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

// MARK: - No pinch zoom (Capacitor's zoomingEnabled: false)

extension WebHost: UIScrollViewDelegate {
    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}

/// Origins as the page sees them ("capacitor://localhost", "https://app.folevi.com", "http://app.localhost:3002").
enum AppOrigin {
    static func of(_ url: URL?) -> String {
        guard let url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return "" }
        return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }
}
