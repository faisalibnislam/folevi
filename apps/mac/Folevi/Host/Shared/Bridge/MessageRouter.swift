// The native end of mac-bridge.js (docs/MAC_WEBKIT_PLAN.md §4.3): one per web view, the "folevi" message handler
// with replies. Every call is answered only for the app's own page (its main frame, on app://folevi), and the
// routers get the sender view's place from the host, never from an argument (§3, MULTI_ACCOUNT_PLAN.md §2.2).
//
//   { plugin: "FoleviShell", method, options }    -> ShellRouter (foleviShell, the iOS method names)
//   { plugin: "FoleviDesktop", method, options }  -> DesktopRouter (foleviDesktop)
//   { plugin: "FoleviHost", method: "ping" }      -> the transport itself (checks, MacEval)
//   { ..., bodyId }                               -> the options were POSTed to app://folevi/_bridge/<bodyId>
//
// Answers are { ok: true, value } or { ok: false, error: { code, message, path? } }; an answer above 256 KB is kept
// for one GET of app://folevi/_bridge/<id> and the reply is { ok: true, bodyId }.
import AppKit
import WebKit

/// A failure the page reads as { code, message, path } (shell-bridge.js's plainError, local-store's codes).
struct BridgeError: Error {
    let code: String
    let message: String
    let path: String?

    init(code: String, message: String, path: String? = nil) {
        self.code = code
        self.message = message
        self.path = path
    }

    static func unavailable(_ what: String) -> BridgeError {
        BridgeError(code: "unavailable", message: "\(what) isn't in this build of Folevi for Mac yet.")
    }

    static func invalid(_ message: String) -> BridgeError { BridgeError(code: "invalid_argument", message: message) }

    var json: [String: Any] {
        var e: [String: Any] = ["code": code, "message": message]
        if let path { e["path"] = path }
        return e
    }
}

/// Native to page events for one view (Events.swift).
protocol BridgeEvents: AnyObject {
    func emit(_ plugin: String, _ event: String, _ data: [String: Any])
}

/// What a router knows about the view a call came from: set by the host when the view is made.
struct BridgeContext {
    /// The view's place ("library", "acct:<user id>") or nil before places.
    var place: () -> String?
    /// The window the view is in (a runner has none): sheets and panels attach to it.
    var window: () -> NSWindow?
    var events: BridgeEvents
}

final class MessageRouter: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "folevi"

    let shell: ShellRouter
    let desktop: DesktopRouter
    private let bodies: BridgeBodies

    init(context: BridgeContext, bodies: BridgeBodies = .shared) {
        shell = ShellRouter(place: context.place, window: context.window, events: context.events)
        desktop = DesktopRouter(context: context)
        self.bodies = bodies
    }

    /// A call the router may answer: from the app's own page, in its main frame, well formed. Nil otherwise.
    struct Call {
        let plugin: String
        let method: String
        let options: [String: Any]
    }

    enum Refusal: Error, Equatable { case notAllowed, malformed, missingBody }

    /// Checks who asks and what (a pure function, RouterTests).
    static func accept(isMainFrame: Bool, scheme: String, host: String, port: Int, body: Any, bodies: BridgeBodies) -> Result<Call, Refusal> {
        guard isMainFrame, scheme == AppScheme.scheme, host == AppScheme.host, port == 0 else { return .failure(.notAllowed) }
        guard let dict = body as? [String: Any], let plugin = dict["plugin"] as? String, let method = dict["method"] as? String,
              plugin.count <= 40, method.count <= 80, method.range(of: "^[A-Za-z][A-Za-z0-9]*$", options: .regularExpression) != nil else { return .failure(.malformed) }
        if let id = dict["bodyId"] as? String {
            guard let data = bodies.takeCall(id), let options = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .failure(.missingBody) }
            return .success(Call(plugin: plugin, method: method, options: options))
        }
        let options = dict["options"] as? [String: Any] ?? [:]
        return .success(Call(plugin: plugin, method: method, options: options))
    }

    /// The reply envelope for a value (kept for a GET when it's big).
    static func envelope(_ value: [String: Any], bodies: BridgeBodies) -> [String: Any] {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value) else {
            return ["ok": false, "error": BridgeError(code: "io", message: "Folevi couldn't send that answer.").json]
        }
        if data.count > BridgeBodies.limit { return ["ok": true, "bodyId": bodies.putReply(data)] }
        return ["ok": true, "value": value]
    }

    static func envelope(_ error: Error) -> [String: Any] {
        let e = error as? BridgeError ?? BridgeError(code: "io", message: (error as NSError).localizedDescription)
        return ["ok": false, "error": e.json]
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        let call: Call
        switch Self.accept(isMainFrame: message.frameInfo.isMainFrame, scheme: origin.protocol, host: origin.host, port: origin.port, body: message.body, bodies: bodies) {
        case .success(let c): call = c
        case .failure(.notAllowed): return replyHandler(Self.envelope(BridgeError(code: "not_allowed", message: "Only Folevi's own page may ask that.")), nil)
        case .failure(.missingBody): return replyHandler(Self.envelope(BridgeError(code: "invalid_argument", message: "That call's body went missing.")), nil)
        case .failure: return replyHandler(Self.envelope(BridgeError.invalid("Folevi couldn't read that call.")), nil)
        }
        Task { @MainActor in
            do {
                let value = try await self.route(call)
                replyHandler(Self.envelope(value, bodies: self.bodies), nil)
            } catch {
                replyHandler(Self.envelope(error), nil)
            }
        }
    }

    @MainActor
    func route(_ call: Call) async throws -> [String: Any] {
        switch call.plugin {
        case "FoleviShell": return try await shell.handle(call.method, call.options)
        case "FoleviDesktop": return try await desktop.handle(call.method, call.options)
        case "FoleviHost":
            guard call.method == "ping" else { throw BridgeError.unavailable("FoleviHost.\(call.method)") }
            return ["pong": true, "version": Paths.version, "echo": call.options["echo"] ?? NSNull()]
        default:
            throw BridgeError(code: "unavailable", message: "Folevi for Mac doesn't know \(call.plugin).")
        }
    }
}
