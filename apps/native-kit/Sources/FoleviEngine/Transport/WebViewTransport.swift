// The transport over a WKWebView (docs/NATIVE_APP_PLAN.md section 3.1, generalised from the Mac's MessageRouter):
//
// - JavaScript to native: `window.webkit.messageHandlers.foleviEngine.postMessage(json)`, a JSON string (an array
//   of updates and events) so the client decodes `Data` with JSONDecoder off the main thread.
// - Native to JavaScript: `callAsyncJavaScript("return __foleviEngine.handle(m)", arguments: ["m": json])`,
//   which resolves with the reply as a JSON string.
// - Only the main frame of the app's own origin may post (as MessageRouter checks), and the host tells the
//   transport when the page reloads or its content process ends so the client can resubscribe.
#if canImport(WebKit)
import Foundation
import WebKit

@MainActor
public final class WebViewTransport: NSObject, EngineTransport {
    /// An origin allowed to post (`app://folevi` on the Mac, `capacitor://localhost` on iOS).
    public struct Origin: Hashable, Sendable {
        public let scheme: String
        public let host: String
        public let port: Int
        public init(scheme: String, host: String, port: Int = 0) {
            self.scheme = scheme
            self.host = host
            self.port = port
        }
        public static let mac = Origin(scheme: "app", host: "folevi")
        public static let ios = Origin(scheme: "capacitor", host: "localhost")
    }

    public var onBatch: (@MainActor (Data) -> Void)?
    public var onLifecycle: (@MainActor (PageLifecycle) -> Void)?
    public private(set) weak var webView: WKWebView?
    private let allowed: Set<Origin>
    private let world: WKContentWorld
    private var proxy: MessageProxy?

    /// Installs the `foleviEngine` message handler on the view's content controller. Call `detach()` before the
    /// view goes away (the handler is held weakly, so forgetting it doesn't leak the transport).
    public init(webView: WKWebView, allowed: Set<Origin>, world: WKContentWorld = .page) {
        self.webView = webView
        self.allowed = allowed
        self.world = world
        super.init()
        let proxy = MessageProxy(owner: self)
        self.proxy = proxy
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: EngineContract.messageHandler, contentWorld: world)
        controller.add(proxy, contentWorld: world, name: EngineContract.messageHandler)
    }

    public func detach() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: EngineContract.messageHandler, contentWorld: world)
        proxy = nil
    }

    /// The JavaScript the host runs before the first paint to turn native chrome mode on (protocol.ts
    /// `NativeChromeMarker`). Add it as a `WKUserScript` at document start, main frame only.
    public static func markerScript(_ marker: NativeChromeMarker) -> String {
        let json = (try? JSONEncoder().encode(marker)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        return "document.documentElement.setAttribute('data-native-chrome', '');window.\(EngineContract.markerGlobal)=\(json);"
    }

    public func call(_ message: String) async throws -> Data {
        guard let webView else { throw EngineFailure.pageGone }
        let script = "if (!window.\(EngineContract.engineGlobal)) { return null; } return await window.\(EngineContract.engineGlobal).handle(m);"
        let result: Any?
        do {
            result = try await webView.callAsyncJavaScript(script, arguments: ["m": message], in: nil, contentWorld: world)
        } catch {
            let ns = error as NSError
            // The web content process ended or the page navigated away mid-call.
            if ns.domain == WKError.errorDomain, ns.code == WKError.webContentProcessTerminated.rawValue || ns.code == WKError.webViewInvalidated.rawValue {
                throw EngineFailure.pageGone
            }
            throw EngineFailure.transport(ns.localizedDescription)
        }
        guard let reply = result as? String else {
            // No engine yet (the page is booting, or isn't in native chrome mode).
            throw EngineFailure.notReady
        }
        return Data(reply.utf8)
    }

    /// The host calls this from its navigation delegate when the page starts loading again.
    public func pageWillReload() { onLifecycle?(.reloading) }

    /// The host calls this from `webViewWebContentProcessDidTerminate(_:)`.
    public func contentProcessDidTerminate() { onLifecycle?(.terminated) }

    fileprivate func receive(_ message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, allowed.contains(Origin(scheme: origin.protocol, host: origin.host, port: origin.port)) else { return }
        guard let body = message.body as? String else { return }
        onBatch?(Data(body.utf8))
    }
}

/// Holds the transport weakly (WKUserContentController retains its handlers).
private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: WebViewTransport?
    init(owner: WebViewTransport) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { owner?.receive(message) }
    }
}
#endif
