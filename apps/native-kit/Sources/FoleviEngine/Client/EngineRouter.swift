// Multi-place routing (plan 2.1, 3.6): one Page View, and so one EngineClient, per window per open place. Native
// screens of a window talk to their own window's client; things that name a place (Quick Add, a notification
// for another account) find its client here.
import Foundation
import Observation

@MainActor
@Observable
public final class EngineRouter {
    public private(set) var clients: [String: EngineClient] = [:]

    public init() {}

    /// Adds (or replaces) the client for its place.
    public func register(_ client: EngineClient) { clients[client.place] = client }

    public func remove(place: String) { clients[place] = nil }

    public func client(for place: String) -> EngineClient? { clients[place] }

    /// Runs a command in a named place; fails with `place_mismatch`'s wording when no Page View hosts it.
    @discardableResult
    public func command<C: EngineCommandSpec>(_ command: C, in place: String) async throws -> C.Result {
        guard let client = clients[place] else {
            throw EngineFailure.engine(EngineError(code: BridgeErrorCode.placeMismatch.rawValue, message: "That account isn't open on this device right now."))
        }
        return try await client.command(command)
    }
}
