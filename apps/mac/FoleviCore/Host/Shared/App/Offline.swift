// FOLEVI_OFFLINE=1 starts the app with no network at all (docs/DESKTOP.md, Electron's switch for a cold offline
// start): every web view blocks http, https, ws and wss (WebViewFactory's content rules), and every URLSession of
// the app refuses them, the shared services' own sessions included (they make theirs from .ephemeral or
// .default, which this hands out with the refusing protocol first). Test runs only; off unless asked.
import Foundation
import ObjectiveC

enum Offline {
    private static var installed = false

    static func installIfAsked() {
        guard Paths.offline, !installed else { return }
        installed = true
        URLProtocol.registerClass(RefuseNetwork.self)
        swap(#selector(getter: URLSessionConfiguration.ephemeral), #selector(getter: URLSessionConfiguration.foleviOfflineEphemeral))
        swap(#selector(getter: URLSessionConfiguration.default), #selector(getter: URLSessionConfiguration.foleviOfflineDefault))
    }

    private static func swap(_ a: Selector, _ b: Selector) {
        guard let m1 = class_getClassMethod(URLSessionConfiguration.self, a), let m2 = class_getClassMethod(URLSessionConfiguration.self, b) else { return }
        method_exchangeImplementations(m1, m2)
    }
}

extension URLSessionConfiguration {
    // After the swap these names run the system's originals.
    @objc dynamic class var foleviOfflineEphemeral: URLSessionConfiguration {
        let c = self.foleviOfflineEphemeral
        c.protocolClasses = [RefuseNetwork.self] + (c.protocolClasses ?? [])
        return c
    }

    @objc dynamic class var foleviOfflineDefault: URLSessionConfiguration {
        let c = self.foleviOfflineDefault
        c.protocolClasses = [RefuseNetwork.self] + (c.protocolClasses ?? [])
        return c
    }
}

/// Fails every http(s) and ws(s) request as "not connected to the internet".
final class RefuseNetwork: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        ["http", "https", "ws", "wss"].contains(request.url?.scheme?.lowercased() ?? "")
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }

    override func stopLoading() {}
}
