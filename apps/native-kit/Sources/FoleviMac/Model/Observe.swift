// AppKit has no automatic Observation tracking before macOS 26, so views re-run a closure whenever anything it
// read from an @Observable model changes (withObservationTracking, re-armed after each change, on the main actor).
import Foundation
import Observation

@MainActor
public final class Observer {
    private var active = true
    private let body: @MainActor () -> Void

    /// Runs `body` now and again after every change to what it read, until `cancel()` or release.
    public init(_ body: @escaping @MainActor () -> Void) {
        self.body = body
        track()
    }

    public func cancel() { active = false }

    private func track() {
        guard active else { return }
        withObservationTracking { body() } onChange: { [weak self] in
            // onChange runs before the new value is stored: run again on the next turn of the main actor.
            Task { @MainActor [weak self] in self?.track() }
        }
    }
}
