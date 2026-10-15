// The app's one screen: Capacitor's web view showing Folevi (capacitor.config.ts server.url), plus what makes
// it feel like an app rather than a browser tab: swiping in from the left edge goes back through the page's
// own history, the whole page doesn't rubber-band when a view scrolls past its end, and the page gets
// `window.foleviNative` (bridge.js), on Folevi's own pages only.
import Capacitor
import UIKit
import WebKit

final class FoleviViewController: CAPBridgeViewController {
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
        guard let webView, let origin = bridge.map({ AppOrigin.of($0.config.serverURL) }), let source = Self.bridgeScript(origin: origin) else { return }
        // After Capacitor's own scripts (they define window.Capacitor, which bridge.js calls through).
        webView.configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG && targetEnvironment(simulator)
        SimulatorEval.install(on: webView)
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
