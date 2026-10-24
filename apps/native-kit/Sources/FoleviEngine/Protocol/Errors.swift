// Errors native code sees from the engine client: the engine's own (bridge codes and the server's ConvexError
// codes, passed through with their user-facing message) plus the transport's.
import Foundation

public enum EngineFailure: Error, Equatable, Sendable, CustomStringConvertible {
    /// The engine refused or failed (its code and message; `message` is written for people).
    case engine(EngineError)
    /// No reply in time.
    case timeout(String)
    /// The Page View hasn't booted (or is signed out); retried after `engine.ready` by the client.
    case notReady
    /// The web content process ended; the host reloads it and the client resubscribes.
    case pageGone
    /// The app and the web export speak different protocols (a stale export in a development build).
    case protocolMismatch(app: Int, engine: Int)
    /// A message this build couldn't read.
    case decoding(String)
    /// The transport failed (JavaScript threw, the page isn't the app's).
    case transport(String)
    /// The call was cancelled (its screen went away).
    case cancelled

    public var code: String {
        switch self {
        case .engine(let e): e.code
        case .timeout: "timeout"
        case .notReady: BridgeErrorCode.engineNotReady.rawValue
        case .pageGone: BridgeErrorCode.pageGone.rawValue
        case .protocolMismatch: BridgeErrorCode.protocolMismatch.rawValue
        case .decoding: "decoding"
        case .transport: "transport"
        case .cancelled: "cancelled"
        }
    }

    /// The bridge code, when it is one (nil for the server's own codes).
    public var bridgeCode: BridgeErrorCode? { BridgeErrorCode(rawValue: code) }

    /// Text to show people.
    public var message: String {
        switch self {
        case .engine(let e): e.message
        case .timeout: "Folevi is taking too long to answer. Try again."
        case .notReady: "Folevi is still starting."
        case .pageGone: "Folevi is reloading."
        case .protocolMismatch: "This build of Folevi doesn't match its notes engine. Rebuild the app."
        case .decoding, .transport: "Something went wrong. Try again."
        case .cancelled: "Cancelled."
        }
    }

    /// Worth retrying once the engine is ready again.
    public var isRetryable: Bool {
        switch self {
        case .notReady, .pageGone, .timeout: true
        case .engine(let e): e.code == BridgeErrorCode.engineNotReady.rawValue || e.code == BridgeErrorCode.pageGone.rawValue
        default: false
        }
    }

    public var description: String { "\(code): \(message)" }

    static func from(_ error: EngineError) -> EngineFailure {
        switch BridgeErrorCode(rawValue: error.code) {
        case .engineNotReady: .notReady
        case .pageGone: .pageGone
        default: .engine(error)
        }
    }
}
