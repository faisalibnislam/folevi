// Where a view's page may go and what it may ask for (docs/MAC_WEBKIT_PLAN.md §3, Electron's main.ts rules):
// - the main frame stays on app://folevi; a link elsewhere opens in the default browser (http, https, mailto
//   only), and a link to one of the product's pages on Folevi's website opens in the app instead (Links.target);
// - window.open and target=_blank to Folevi's own paths open a new window, the rest go to the browser;
// - embeds (frames) may load https pages, as the page's policy allows;
// - the microphone (audio only) for the app's own page; nothing else.
// A load that fails shows the offline page with Try again; a crashed page reloads.
import AppKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class Navigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    static let shared = Navigation()

    /// Opens a URL outside the app (tests replace it to see what would have opened).
    var openExternally: (URL) -> Void = { NSWorkspace.shared.open($0) }

    func attach(_ view: FoleviWebView) {
        view.navigationDelegate = self
        view.uiDelegate = self
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""
        // A `download` link (an export's blob:, an attachment): saved where the person picks (Downloads.swift).
        if Downloads.isDownload(action: action), ["blob", "data", "https", AppScheme.scheme].contains(scheme) { return decisionHandler(.download) }
        // Frames: the page's own embeds (the policy's frame-src decides which load).
        if let target = action.targetFrame, !target.isMainFrame {
            return decisionHandler(["https", "about", "blob", "data", AppScheme.scheme].contains(scheme) ? .allow : .cancel)
        }
        if Links.isAppUrl(url) { return decisionHandler(.allow) }
        if scheme == "about" { return decisionHandler(.allow) }
        decisionHandler(.cancel)
        switch Links.target(url) {
        // A product page on Folevi's website opens here (in a new window when the link asked for one).
        case .app(let path): if action.targetFrame == nil { WindowManager.shared.openMain(path: path) } else { webView.load(URLRequest(url: Links.appURL(path))) }
        case .browser: openExternally(url)
        case .ignore: break
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let view = webView as? FoleviWebView, !view.loaded, Links.isAppUrl(webView.url ?? URL(fileURLWithPath: "/")) else { return }
        view.loaded = true
        WindowManager.shared.loaded(view)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        failed(webView, error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(webView, error)
    }

    private func failed(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        // A navigation replaced by another, or one this delegate cancelled: not a failure.
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
        let failed = (e.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        guard failed.map(Links.isAppUrl) ?? true, failed?.path != AppScheme.offlinePath else { return }
        var c = URLComponents(string: AppScheme.origin + AppScheme.offlinePath)!
        c.queryItems = [URLQueryItem(name: "url", value: failed?.absoluteString ?? AppScheme.origin + "/")]
        if let url = c.url { webView.load(URLRequest(url: url)) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process ended (memory pressure, a crash): it starts again where it was.
        webView.reload()
    }

    // MARK: new windows, permissions, panels

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        switch Links.target(url) {
        case .app(let path): WindowManager.shared.openMain(path: path)
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
        if let window = webView.window {
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
        if let window = webView.window { alert.beginSheetModal(for: window, completionHandler: done) } else { done(alert.runModal()) }
    }
}
