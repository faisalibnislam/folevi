// How the client reaches the engine: one call per message (native to JavaScript, answered with the reply JSON)
// and a stream of batches (JavaScript to native). `WebViewTransport` is the real one over a WKWebView;
// `ScriptedTransport` answers from Swift (tests, SwiftUI previews, screens built before the engine has a view).
import Foundation

@MainActor
public protocol EngineTransport: AnyObject, Sendable {
    /// Sends one `ToEngine` message (JSON) and returns the reply (JSON).
    func call(_ message: String) async throws -> Data
    /// Where batches from the engine go (raw JSON; the client decodes them off the main thread).
    var onBatch: (@MainActor (Data) -> Void)? { get set }
    /// Lifecycle of the page behind the transport (reloads, the content process ending).
    var onLifecycle: (@MainActor (PageLifecycle) -> Void)? { get set }
}

public enum PageLifecycle: Sendable, Equatable {
    /// The page is loading again (a reload, a navigation of the whole page): every subscription is gone.
    case reloading
    /// The web content process ended (memory pressure in the background). The host reloads the view.
    case terminated
}

/// A transport whose engine is a Swift closure. `respond` gets each message as JSON and returns the reply's
/// `value` (or throws an `EngineFailure.engine` for an error reply); `push` sends batches as the engine would.
@MainActor
public final class ScriptedTransport: EngineTransport {
    public typealias Responder = @MainActor (_ message: JSONValue) async throws -> JSONValue
    public var onBatch: (@MainActor (Data) -> Void)?
    public var onLifecycle: (@MainActor (PageLifecycle) -> Void)?
    public private(set) var sent: [JSONValue] = []
    private let respond: Responder

    public init(respond: @escaping Responder) { self.respond = respond }

    public func call(_ message: String) async throws -> Data {
        let msg = try JSONDecoder().decode(JSONValue.self, from: Data(message.utf8))
        sent.append(msg)
        let id = msg["id"]?.string ?? ""
        let reply: JSONValue
        do {
            let value = try await respond(msg)
            reply = .object(["kind": .string("reply"), "id": .string(id), "ok": .bool(true), "value": value])
        } catch let EngineFailure.engine(error) {
            reply = .object(["kind": .string("reply"), "id": .string(id), "ok": .bool(false), "error": try JSONValue.from(error)])
        }
        return try JSONEncoder().encode(reply)
    }

    /// Delivers a batch (an array of updates and events) as if the engine had posted it.
    public func push(_ batch: JSONValue) {
        guard let data = try? JSONEncoder().encode(batch) else { return }
        onBatch?(data)
    }

    public func push(json: String) { onBatch?(Data(json.utf8)) }

    public func simulate(_ event: PageLifecycle) { onLifecycle?(event) }
}
