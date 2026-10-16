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

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        // The router moves with history.pushState, so the edge swipe steps back through the app's pages.
        webView.allowsBackForwardNavigationGestures = true
        // The app's views scroll inside the page; the page itself stays put (no pull-down that fights them).
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        return webView
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FoleviNativePlugin())
        // The extensions' REST API is the site this app loads; links that came early can go to the page now.
        AppServices.launched(serverURL: bridge?.config.serverURL)
        DeepLinkRouter.bridgeReady()
        if let webView, let capacitor = webView.navigationDelegate {
            let guardian = NavigationGuard(forwardingTo: capacitor)
            navigationGuard = guardian
            webView.navigationDelegate = guardian
        }
        guard let webView, let origin = bridge.map({ AppOrigin.of($0.config.serverURL) }), let source = Self.bridgeScript(origin: origin) else { return }
        // After Capacitor's own scripts (they define window.Capacitor, which bridge.js calls through).
        webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG && targetEnvironment(simulator)
        SimulatorEval.install(on: webView)
        DebugHooks.install()
        #endif
    }

    /// bridge.js with the one origin allowed to use it and the app's version filled in.
    private static func bridgeScript(origin: String) -> String? {
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"), let template = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        return template
            .replacingOccurrences(of: "\"__FOLEVI_ORIGIN__\"", with: jsString(origin))
            .replacingOccurrences(of: "\"__FOLEVI_VERSION__\"", with: jsString(version))
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
