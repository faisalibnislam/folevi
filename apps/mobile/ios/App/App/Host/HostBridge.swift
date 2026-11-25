// How the page reaches Folevi's own plugins in the Capacitor app (docs/MOBILE.md). Capacitor carries every call:
// the page's bridge (bridge/mobile-bridge.js) sends call(plugin, method, options) to one Capacitor plugin,
// "FoleviHost", which hands it to the Folevi plugin by name (FoleviShell, FoleviNative) and answers with its value
// or its refusal ({ code, message, data }). Events from a Folevi plugin reach the page as FoleviHost's "event".
//
// The Folevi plugins keep the shape they have in the iPhone and iPad app and the Mac app: a BridgePlugin subclass
// with `@objc func name(_ call: BridgeCall)` methods (apps/ios/ios/App/Native/Host/Bridge.swift), so the shell
// services in apps/ios/ios/App/Native/Shell build here unchanged. This file is the small part that differs: the
// transport and the host they ask for the web view, its origin and the screen.
import Capacitor
import UIKit
import WebKit

/// One call from the page: its options and the one answer it gets.
final class BridgeCall: NSObject, @unchecked Sendable {
    let method: String
    let options: [String: Any]
    private let lock = NSLock()
    private var answer: ((Result<[String: Any], BridgeError>) -> Void)?

    init(method: String, options: [String: Any], answer: @escaping (Result<[String: Any], BridgeError>) -> Void) {
        self.method = method
        self.options = options
        self.answer = answer
    }

    func getString(_ key: String) -> String? { options[key] as? String }

    func getBool(_ key: String) -> Bool? {
        guard let n = options[key] as? NSNumber else { return nil }
        return n.boolValue
    }

    func getInt(_ key: String) -> Int? {
        guard let n = options[key] as? NSNumber, n !== kCFBooleanTrue, n !== kCFBooleanFalse else { return nil }
        let d = n.doubleValue
        guard d.isFinite, d == d.rounded(), abs(d) < Double(Int.max) else { return nil }
        return n.intValue
    }

    func getDouble(_ key: String) -> Double? {
        guard let n = options[key] as? NSNumber, n !== kCFBooleanTrue, n !== kCFBooleanFalse else { return nil }
        return n.doubleValue
    }

    func getArray(_ key: String) -> [Any]? { options[key] as? [Any] }

    func getObject(_ key: String) -> [String: Any]? { options[key] as? [String: Any] }

    func resolve() { finish(.success([:])) }

    func resolve(_ value: [String: Any]) { finish(.success(value)) }

    /// A refusal the page reads as { code, message, data }.
    func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil, _ data: [String: Any]? = nil) {
        finish(.failure(BridgeError(code: code, message: message, data: data)))
    }

    var answered: Bool {
        lock.lock(); defer { lock.unlock() }
        return answer == nil
    }

    private func finish(_ result: Result<[String: Any], BridgeError>) {
        lock.lock()
        let a = answer
        answer = nil
        lock.unlock()
        a?(result)
    }
}

/// A failure as the page reads it: { code, message, data }.
struct BridgeError: Error {
    let code: String?
    let message: String
    let data: [String: Any]?

    init(code: String?, message: String, data: [String: Any]? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}

/// A Folevi plugin: the name the page calls it by, its methods, and the host it answers for.
class BridgePlugin: NSObject {
    weak var bridge: WebHost?

    var jsName: String { "" }

    var methods: Set<String> { [] }

    func load() {}

    func notifyListeners(_ event: String, data: [String: Any]?) {
        bridge?.emit(jsName, event, data ?? [:])
    }

    /// Asked before the web view goes somewhere: true cancels, false allows, nil leaves it to Capacitor.
    func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? { nil }

    @MainActor
    func invoke(_ call: BridgeCall) {
        let selector = NSSelectorFromString("\(call.method):")
        guard methods.contains(call.method), responds(to: selector) else {
            return call.reject("\(jsName).\(call.method) isn't in this build of Folevi.", "unavailable")
        }
        _ = perform(selector, with: call)
    }
}

/// What the Folevi plugins ask of the app: the web view, its origin, the screen, and a way to send events.
final class WebHost: NSObject {
    struct Config {
        /// The built-in interface (always, in this app): the page gets `window.foleviShell`.
        var bundled = true
    }

    /// The page on screen now (one at a time; a mode or place switch makes a new one).
    static weak var current: WebHost?

    weak var capacitor: CAPBridgeProtocol?
    weak var hostPlugin: FoleviHostPlugin?
    let config = Config()
    private(set) var plugins: [String: BridgePlugin] = [:]

    /// Where the page lives: capacitor://localhost, or the development server's origin.
    var serverURL: URL { capacitor?.config.serverURL ?? URL(string: "capacitor://localhost")! }
    var appOrigin: String { AppOrigin.of(serverURL) }
    var webView: WKWebView? { capacitor?.webView }
    var viewController: UIViewController? { capacitor?.viewController }

    func register(_ plugin: BridgePlugin) {
        plugin.bridge = self
        plugins[plugin.jsName] = plugin
        plugin.load()
    }

    func emit(_ plugin: String, _ event: String, _ data: [String: Any]) {
        let send: () -> Void = { self.hostPlugin?.notifyListeners("event", data: ["plugin": plugin, "event": event, "data": data]) }
        if Thread.isMainThread { send() } else { DispatchQueue.main.async(execute: send) }
    }

    /// A "folevi:…" event on the page's window (what the iPhone and iPad app's WebHost does with the same call):
    /// FoleviHost's "windowEvent", which bridge/mobile-bridge.js dispatches.
    func triggerWindowJSEvent(eventName: String) {
        guard eventName.hasPrefix("folevi:") else { return }
        emit("FoleviHost", "windowEvent", ["name": eventName])
    }
}

/// "FoleviHost": the one Capacitor plugin the page's bridge calls; it routes to the Folevi plugins by name.
@objc(FoleviHostPlugin)
final class FoleviHostPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "FoleviHostPlugin"
    let jsName = "FoleviHost"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "call", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
    ]

    let host = WebHost()

    override func load() {
        host.capacitor = bridge
        host.hostPlugin = self
        WebHost.current = host
    }

    @objc func call(_ call: CAPPluginCall) {
        guard let name = call.getString("plugin"), let method = call.getString("method"),
              method.range(of: "^[A-Za-z][A-Za-z0-9]*$", options: .regularExpression) != nil else {
            return call.reject("Folevi couldn't read that call.", "invalid_argument")
        }
        let options = (call.getObject("options") ?? [:]) as [String: Any]
        let inner = BridgeCall(method: method, options: options) { result in
            switch result {
            case .success(let value): call.resolve(value)
            case .failure(let e): call.reject(e.message, e.code, nil, e.data)
            }
        }
        DispatchQueue.main.async {
            // Only the app's own page (its main frame on the app's origin) reaches the Folevi plugins.
            guard let page = self.host.webView?.url, AppOrigin.of(page) == self.host.appOrigin else {
                return inner.reject("Not allowed here", "not_allowed")
            }
            guard let plugin = self.host.plugins[name] else { return inner.reject("\(name) isn't in this build of Folevi.", "unavailable") }
            MainActor.assumeIsolated { plugin.invoke(inner) }
        }
    }

    /// The page's bridge is up: links that came before it can go now.
    @objc func ready(_ call: CAPPluginCall) {
        call.resolve()
        DispatchQueue.main.async { MainActor.assumeIsolated { DeepLinkRouter.bridgeReady() } }
    }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        for plugin in host.plugins.values {
            if let answer = plugin.shouldOverrideLoad(navigationAction) { return answer }
        }
        return nil
    }
}

/// Origins as the page sees them ("capacitor://localhost", "http://localhost:3003").
enum AppOrigin {
    static func of(_ url: URL?) -> String {
        guard let url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return "" }
        return url.port.map { "\(scheme)://\(host):\($0)" } ?? "\(scheme)://\(host)"
    }
}
