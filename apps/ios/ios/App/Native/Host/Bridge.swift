// The page's way to the app without Capacitor (docs/NATIVE_APP_PLAN.md §3.1 and N1): the Mac app's transport
// (apps/mac/Folevi/Bridge/MessageRouter.swift), so both apps answer `foleviShell` and `foleviNative` the same way.
//
//   page:   window.webkit.messageHandlers.folevi.postMessage({ plugin, method, options })   (bridge.js)
//           -> a promise of { ok: true, value } or { ok: false, error: { code, message, data } }
//   native: window.__foleviEmit(plugin, event, data) for events (WebHost.emit), for this view only
//
// Options or answers above 256 KB go through capacitor://localhost/_bridge/<id> instead of the message
// (AppScheme.swift), as on the Mac. Only the app's own page may call (its main frame, on the app's origin).
//
// The plugins keep the shape they had as Capacitor plugins: a BridgePlugin subclass with `@objc func name(_ call:
// BridgeCall)` methods, called by name, answering with call.resolve(...) or call.reject(message, code, error,
// data). Moving them off Capacitor changed the types, not their bodies.
import UIKit
import WebKit

/// One call from the page: its options and the one answer it gets (CAPPluginCall's API, so the plugins read
/// the same).
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

    /// A refusal the page reads as { code, message, data } (Capacitor's reject had the same four parts).
    func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil, _ data: [String: Any]? = nil) {
        finish(.failure(BridgeError(code: code, message: message, data: data)))
    }

    /// Whether it was answered yet (a call is answered once; later answers are dropped).
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

    var json: [String: Any] {
        var e: [String: Any] = ["message": message]
        if let code { e["code"] = code }
        if let data, JSONSerialization.isValidJSONObject(data) {
            e["data"] = data
            // The Mac's errors carry `path` on the error itself: bridge.js reads either.
            if let path = data["path"] as? String { e["path"] = path }
        }
        return e
    }
}

/// What a plugin is: a name the page calls it by, its methods, and the host it answers for. The iOS twin of
/// CAPPlugin as the app used it.
class BridgePlugin: NSObject {
    /// The host whose page this plugin answers (set when it's registered).
    weak var bridge: WebHost?

    /// The name the page calls it by ("FoleviNative", "FoleviShell").
    var jsName: String { "" }

    /// Every method the page may call (each an `@objc func name(_ call: BridgeCall)`).
    var methods: Set<String> { [] }

    /// Once, when it's registered with a host.
    func load() {}

    /// An event for this plugin's listeners on the page (bridge.js listen(plugin, event, cb)).
    func notifyListeners(_ event: String, data: [String: Any]?) {
        bridge?.emit(jsName, event, data ?? [:])
    }

    /// Asked before the web view goes somewhere: true cancels (handled here), false allows, nil leaves it to the
    /// host's own rules (WebHost.decide).
    func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? { nil }

    /// Runs one call: the method by name, on the main thread (each method moves its own work elsewhere).
    @MainActor
    func invoke(_ call: BridgeCall) {
        let selector = NSSelectorFromString("\(call.method):")
        guard methods.contains(call.method), responds(to: selector) else {
            return call.reject("\(jsName).\(call.method) isn't in this build of Folevi.", "unavailable")
        }
        _ = perform(selector, with: call)
    }
}

/// The "folevi" message handler of one web view: checks who asks, finds the plugin, answers.
final class MessageRouter: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "folevi"

    weak var host: WebHost?
    private let bodies: BridgeBodies

    init(host: WebHost, bodies: BridgeBodies = .shared) {
        self.host = host
        self.bodies = bodies
    }

    struct Call {
        let plugin: String
        let method: String
        let options: [String: Any]
    }

    enum Refusal: Error, Equatable { case notAllowed, malformed, missingBody }

    /// Checks who asks and what (a pure function, HostTests): the main frame of the app's own origin, a well formed
    /// call, its body when it was POSTed.
    static func accept(isMainFrame: Bool, origin: String, appOrigin: String, body: Any, bodies: BridgeBodies) -> Result<Call, Refusal> {
        guard isMainFrame, !appOrigin.isEmpty, origin == appOrigin else { return .failure(.notAllowed) }
        guard let dict = body as? [String: Any], let plugin = dict["plugin"] as? String, let method = dict["method"] as? String,
              plugin.count <= 40, method.count <= 80, method.range(of: "^[A-Za-z][A-Za-z0-9]*$", options: .regularExpression) != nil else { return .failure(.malformed) }
        if let id = dict["bodyId"] as? String {
            guard let data = bodies.takeCall(id), let options = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .failure(.missingBody) }
            return .success(Call(plugin: plugin, method: method, options: options))
        }
        return .success(Call(plugin: plugin, method: method, options: dict["options"] as? [String: Any] ?? [:]))
    }

    /// The reply envelope for a value (kept for one GET when it's big).
    static func envelope(_ value: [String: Any], bodies: BridgeBodies) -> [String: Any] {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else {
            return ["ok": false, "error": BridgeError(code: "io", message: "Folevi couldn't send that answer.").json]
        }
        if data.count > BridgeBodies.limit { return ["ok": true, "bodyId": bodies.putReply(data)] }
        return ["ok": true, "value": value]
    }

    static func envelope(_ error: BridgeError) -> [String: Any] { ["ok": false, "error": error.json] }

    /// "scheme://host[:port]" of a frame's security origin.
    static func origin(of o: WKSecurityOrigin) -> String {
        let scheme = o.protocol.lowercased(), host = o.host.lowercased()
        return o.port == 0 ? "\(scheme)://\(host)" : "\(scheme)://\(host):\(o.port)"
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let appOrigin = MainActor.assumeIsolated { host?.appOrigin ?? "" }
        let call: Call
        switch Self.accept(isMainFrame: message.frameInfo.isMainFrame, origin: Self.origin(of: message.frameInfo.securityOrigin), appOrigin: appOrigin, body: message.body, bodies: bodies) {
        case .success(let c): call = c
        case .failure(.notAllowed): return replyHandler(Self.envelope(BridgeError(code: "not_allowed", message: "Not allowed here")), nil)
        case .failure(.missingBody): return replyHandler(Self.envelope(BridgeError(code: "invalid_argument", message: "That call's body went missing.")), nil)
        case .failure: return replyHandler(Self.envelope(BridgeError(code: "invalid_argument", message: "Folevi couldn't read that call.")), nil)
        }
        let bodies = self.bodies
        let reply: (Result<[String: Any], BridgeError>) -> Void = { result in
            let envelope: [String: Any]
            switch result {
            case .success(let value): envelope = Self.envelope(value, bodies: bodies)
            case .failure(let error): envelope = Self.envelope(error)
            }
            if Thread.isMainThread { replyHandler(envelope, nil) } else { DispatchQueue.main.async { replyHandler(envelope, nil) } }
        }
        MainActor.assumeIsolated {
            guard let host else { return reply(.failure(BridgeError(code: "unavailable", message: "Folevi couldn't reach the app."))) }
            host.route(call, BridgeCall(method: call.method, options: call.options, answer: reply))
        }
    }
}

/// Bodies of bridge calls too big for a message, and answers too big for a reply: each is taken once (the Mac's
/// BridgeBodies, apps/mac/Folevi/App/AppScheme.swift).
final class BridgeBodies {
    static let shared = BridgeBodies()
    private let lock = NSLock()
    private var calls: [String: Data] = [:]
    private var replies: [String: Data] = [:]
    /// Above this, a call's options or an answer go through /_bridge/<id> (bridge.js has the same).
    static let limit = 256 * 1024
    static let maxBody = 64 * 1024 * 1024
    private static let idPattern = #"^[A-Za-z0-9_-]{8,64}$"#

    static func validId(_ id: String) -> Bool { id.range(of: idPattern, options: .regularExpression) != nil }

    func putCall(_ id: String, _ body: Data) -> Bool {
        guard Self.validId(id), body.count <= Self.maxBody else { return false }
        lock.lock(); defer { lock.unlock() }
        if calls.count > 32 { calls.removeAll() }
        calls[id] = body
        return true
    }

    func takeCall(_ id: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return calls.removeValue(forKey: id)
    }

    func putReply(_ body: Data) -> String {
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        lock.lock(); defer { lock.unlock() }
        if replies.count > 32 { replies.removeAll() }
        replies[id] = body
        return id
    }

    func takeReply(_ id: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return replies.removeValue(forKey: id)
    }
}
