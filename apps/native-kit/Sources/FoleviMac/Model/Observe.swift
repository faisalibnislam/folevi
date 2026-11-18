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

/// Waits until something `read` reads from an @Observable model changes, or the task is cancelled. A bare
/// `withCheckedContinuation { withObservationTracking … onChange: resume }` never returns once nothing changes any
/// more (a cancelled store), and cancelling its task doesn't resume it: the task, and all it held, stayed for the
/// rest of the run (FrameModel's observers kept every closed window's model, and one more per change of tabs).
@MainActor
public func nextChange(_ read: () -> Void) async {
    let once = ResumeOnceBox()
    await withTaskCancellationHandler {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            once.set(c)
            withObservationTracking { read() } onChange: { once.resume() }
            if Task.isCancelled { once.resume() }
        }
    } onCancel: {
        once.resume()
    }
}

/// A continuation resumed at most once, from whichever comes first.
private final class ResumeOnceBox: @unchecked Sendable {
    private let lock = NSLock()
    private var c: CheckedContinuation<Void, Never>?
    private var done = false

    func set(_ c: CheckedContinuation<Void, Never>) {
        lock.lock()
        if done { lock.unlock(); c.resume(); return }
        self.c = c
        lock.unlock()
    }

    func resume() {
        lock.lock()
        done = true
        let c = self.c
        self.c = nil
        lock.unlock()
        c?.resume()
    }
}
