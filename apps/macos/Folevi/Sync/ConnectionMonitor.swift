import Foundation
import Network

/// Combines NWPathMonitor (is there a network path at all?) with the Convex WebSocket state
/// (is the backend actually reachable?). Emits a single `isOnline` signal.
final class ConnectionMonitor: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.folevi.mac.path")
    private let lock = NSLock()
    private var pathSatisfied = true
    private var continuations: [UUID: AsyncStream<Bool>.Continuation] = [:]

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.update(path.status == .satisfied)
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    private func update(_ satisfied: Bool) {
        lock.lock()
        let changed = satisfied != pathSatisfied
        pathSatisfied = satisfied
        let conts = Array(continuations.values)
        lock.unlock()
        if changed { for c in conts { c.yield(satisfied) } }
    }

    var hasNetworkPath: Bool {
        lock.lock()
        defer { lock.unlock() }
        return pathSatisfied
    }

    /// Emits the current path state immediately and then every change.
    func pathUpdates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let id = UUID()
            lock.lock()
            continuations[id] = continuation
            let current = pathSatisfied
            lock.unlock()
            continuation.yield(current)
            continuation.onTermination = { [weak self] _ in
                guard let self else { return }
                self.lock.lock()
                self.continuations[id] = nil
                self.lock.unlock()
            }
        }
    }
}
