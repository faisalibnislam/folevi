@preconcurrency import Combine
import Foundation
@preconcurrency import ConvexMobile

/// Wraps the single process-wide Convex client.
///
/// `ConvexClientWithAuth` is internally thread-safe (all work happens in the Rust core behind async
/// FFI calls), so the wrapper is `@unchecked Sendable`; it only ever forwards calls. All arguments are
/// built from `JSONValue`, which guarantees numbers are sent as float64 (Convex `v.number()` rejects
/// the int64 encoding Swift `Int` would produce).
final class ConvexService: @unchecked Sendable {
    let client: ConvexClientWithAuth<FoleviCredentials>
    let auth: RoutingAuthProvider
    private let stateLock = NSLock()
    private var socketCancellable: AnyCancellable?
    private var socketContinuations: [UUID: AsyncStream<Bool>.Continuation] = [:]
    private var lastSocketConnected: Bool?

    init(deploymentURL: String, auth: RoutingAuthProvider) {
        self.auth = auth
        client = ConvexClientWithAuth(deploymentUrl: deploymentURL, authProvider: auth)
        socketCancellable = client.watchWebSocketState().sink { [weak self] state in
            let connected: Bool
            switch state {
            case .connected: connected = true
            case .connecting: connected = false
            }
            self?.broadcastSocket(connected)
        }
    }

    // MARK: Socket state

    private func broadcastSocket(_ connected: Bool) {
        stateLock.lock()
        lastSocketConnected = connected
        let conts = Array(socketContinuations.values)
        stateLock.unlock()
        for c in conts { c.yield(connected) }
    }

    /// Emits `true` when the WebSocket is connected, `false` while (re)connecting.
    func socketStates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let id = UUID()
            stateLock.lock()
            socketContinuations[id] = continuation
            let last = lastSocketConnected
            stateLock.unlock()
            if let last { continuation.yield(last) }
            continuation.onTermination = { [weak self] _ in
                guard let self else { return }
                self.stateLock.lock()
                self.socketContinuations[id] = nil
                self.stateLock.unlock()
            }
        }
    }

    var isSocketConnected: Bool? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return lastSocketConnected
    }

    // MARK: Auth

    func login() async -> Result<FoleviCredentials, Error> {
        await client.login()
    }

    func loginFromCache() async -> Result<FoleviCredentials, Error> {
        await client.loginFromCache()
    }

    func logout() async {
        await client.logout()
    }

    // MARK: Calls

    static func encode(_ args: [String: JSONValue]) -> [String: ConvexEncodable?] {
        args.mapValues { encodeValue($0) }
    }

    static func encodeValue(_ v: JSONValue) -> ConvexEncodable? {
        switch v {
        case .null: return nil
        case .bool(let b): return b
        case .number(let n): return n
        case .string(let s): return s
        case .array(let a): return a.map { encodeValue($0) } as [ConvexEncodable?]
        case .object(let o): return o.mapValues { encodeValue($0) } as [String: ConvexEncodable?]
        }
    }

    static func mapError(_ error: Error) -> FoleviError {
        if let f = error as? FoleviError { return f }
        if let c = error as? ClientError {
            switch c {
            case .ConvexError(let data):
                if let json = try? JSONValue(jsonString: data) {
                    if let problem = AiProblem(convexError: json) { return .ai(problem) }
                    let code = json["code"]?.stringValue ?? "server_error"
                    let message = json["message"]?.stringValue ?? String(localized: "Something went wrong.")
                    return .server(code: code, message: message)
                }
                return .server(code: "server_error", message: data)
            case .ServerError(let msg):
                if msg.localizedCaseInsensitiveContains("unauthenticated") || msg.localizedCaseInsensitiveContains("not authenticated") {
                    return .server(code: "unauthenticated", message: String(localized: "Your session expired. Sign in again."))
                }
                return .server(code: "server_error", message: String(localized: "The server couldn't complete that request."))
            case .InternalError(let msg):
                return .invalidResponse(msg)
            }
        }
        return .invalidResponse(String(describing: type(of: error)))
    }

    func mutation<T: Decodable & Sendable>(_ name: String, _ args: [String: JSONValue] = [:], timeout: Double = 25) async throws -> T {
        let encoded = ConvexService.encode(args)
        nonisolated(unsafe) let sendableArgs = encoded
        do {
            return try await withTimeout(timeout) { [self] in
                try await self.client.mutation(name, with: sendableArgs)
            }
        } catch {
            throw ConvexService.mapError(error)
        }
    }

    func mutationVoid(_ name: String, _ args: [String: JSONValue] = [:], timeout: Double = 25) async throws {
        let _: JSONValue = try await mutation(name, args, timeout: timeout)
    }

    func action<T: Decodable & Sendable>(_ name: String, _ args: [String: JSONValue] = [:], timeout: Double = 60) async throws -> T {
        let encoded = ConvexService.encode(args)
        nonisolated(unsafe) let sendableArgs = encoded
        do {
            return try await withTimeout(timeout) { [self] in
                try await self.client.action(name, with: sendableArgs)
            }
        } catch {
            throw ConvexService.mapError(error)
        }
    }

    /// One-shot query: subscribes, takes the first value, cancels.
    func query<T: Decodable & Sendable>(_ name: String, _ args: [String: JSONValue] = [:], timeout: Double = 20) async throws -> T {
        let stream: AsyncThrowingStream<T, Error> = subscribe(name, args)
        do {
            return try await withTimeout(timeout) {
                for try await value in stream { return value }
                throw FoleviError.invalidResponse("subscription ended")
            }
        } catch {
            throw ConvexService.mapError(error)
        }
    }

    /// Live query as an async stream. The stream finishes (with an error) if the server rejects the
    /// query; callers resubscribe when appropriate.
    func subscribe<T: Decodable & Sendable>(_ name: String, _ args: [String: JSONValue] = [:]) -> AsyncThrowingStream<T, Error> {
        let publisher: AnyPublisher<T, ClientError> = client.subscribe(to: name, with: ConvexService.encode(args), yielding: T.self)
        return AsyncThrowingStream { continuation in
            let cancellable = publisher.sink(receiveCompletion: { completion in
                switch completion {
                case .finished: continuation.finish()
                case .failure(let e): continuation.finish(throwing: ConvexService.mapError(e))
                }
            }, receiveValue: { value in
                continuation.yield(value)
            })
            let box = CancellableBox(cancellable)
            continuation.onTermination = { _ in box.cancel() }
        }
    }
}

final class CancellableBox: @unchecked Sendable {
    private let lock = NSLock()
    private var cancellable: AnyCancellable?
    init(_ c: AnyCancellable) { cancellable = c }
    func cancel() {
        lock.lock()
        let c = cancellable
        cancellable = nil
        lock.unlock()
        c?.cancel()
    }
}
