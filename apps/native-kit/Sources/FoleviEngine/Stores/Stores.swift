// Observable stores the screens bind to (SwiftUI @Observable). A store keeps its last value while its screen is
// in the navigation stack, pauses its subscription after 60 s off screen, and resumes with a fresh value when the
// screen comes back (plan 3.2). Native holds no authority: every value comes from the engine.
import Foundation
import Observation

/// Shared status of a live view.
public enum StoreStatus: Equatable, Sendable {
    /// Waiting for the first value.
    case loading
    /// Live.
    case live
    /// Paused off screen (the last value stays).
    case paused
    /// The engine isn't reachable right now (booting, reloading); the last value stays.
    case disconnected
}

/// A live value view (`session`, `home`, `sync.status`, ...).
@MainActor
@Observable
public final class ValueStore<Value: Codable & Sendable> {
    /// The latest value; the launch snapshot's until the engine answers.
    public internal(set) var value: Value?
    /// The value came from this device's copy while the server hasn't answered (offline, starting up).
    public internal(set) var isStale = false
    /// The view failed (the folder is gone, no access); later updates may recover.
    public internal(set) var error: EngineError?
    public internal(set) var status: StoreStatus = .loading

    @ObservationIgnored let sub: String
    @ObservationIgnored let spec: SubscriptionSpec
    @ObservationIgnored weak var client: EngineClient?
    @ObservationIgnored var lastRev = 0
    @ObservationIgnored var visibility = VisibilityTimer()
    @ObservationIgnored private let token: SubscriptionToken

    init(sub: String, spec: SubscriptionSpec, client: EngineClient, initial: Value?) {
        self.sub = sub
        self.spec = spec
        self.client = client
        self.value = initial
        self.token = SubscriptionToken(sub: sub, client: client)
    }

    /// Tell the store whether its screen is on screen; off screen for 60 s pauses the subscription.
    public func setVisible(_ visible: Bool) {
        visibility.set(visible) { [weak self] in
            guard let self else { return }
            self.client?.pause(self.sub)
        } resume: { [weak self] in
            guard let self else { return }
            self.client?.resume(self.sub)
        }
    }

    /// Ends the subscription now (it also ends when the store is released).
    public func cancel() { client?.unwatch(sub) }

    func apply(rev: Int, payload: UpdatePayload?, stale: Bool, error: EngineError?) -> Bool {
        if rev != lastRev + 1, rev != 1 { return false }
        lastRev = rev
        if case .value(let v)? = payload, let typed = v as? Value { value = typed }
        isStale = stale
        self.error = error
        status = .live
        return true
    }
}

/// A live windowed list (`notes.list`). Bind cells to `row(at:)` for positions `0 ..< total`, and report what's
/// visible with `setVisibleRange` so the window follows the scroll.
@MainActor
@Observable
public final class ListStore<Row: EngineRow> {
    public internal(set) var state = ListState<Row>()
    public internal(set) var isStale = false
    public internal(set) var error: EngineError?
    public internal(set) var status: StoreStatus = .loading
    /// Bumps once per applied update: a cheap key for diffable data sources.
    public internal(set) var version = 0

    public var total: Int { state.total }
    public var isComplete: Bool { state.complete }
    public var rows: [Row] { state.rows }
    public func row(at index: Int) -> Row? { state.row(at: index) }

    @ObservationIgnored let sub: String
    @ObservationIgnored let spec: SubscriptionSpec
    @ObservationIgnored weak var client: EngineClient?
    @ObservationIgnored var lastRev = 0
    @ObservationIgnored var window: ListWindow
    @ObservationIgnored let windowing: ListWindowing
    @ObservationIgnored var visibility = VisibilityTimer()
    @ObservationIgnored private let token: SubscriptionToken

    init(sub: String, spec: SubscriptionSpec, client: EngineClient, window: ListWindow, windowing: ListWindowing) {
        self.sub = sub
        self.spec = spec
        self.client = client
        self.window = window
        self.windowing = windowing
        self.token = SubscriptionToken(sub: sub, client: client)
    }

    /// The rows on screen now (positions in the whole list). Moves the window when they near its edges.
    public func setVisibleRange(_ visible: Range<Int>) {
        guard windowing.needsMove(current: window, visible: visible, total: state.total, complete: state.complete) else { return }
        let next = windowing.window(for: visible)
        guard next != window else { return }
        window = next
        client?.moveWindow(sub, to: next)
    }

    public func setVisible(_ visible: Bool) {
        visibility.set(visible) { [weak self] in
            guard let self else { return }
            self.client?.pause(self.sub)
        } resume: { [weak self] in
            guard let self else { return }
            self.client?.resume(self.sub)
        }
    }

    public func cancel() { client?.unwatch(sub) }

    func apply(rev: Int, payload: UpdatePayload?, stale: Bool, error: EngineError?) -> Bool {
        if rev != lastRev + 1, rev != 1 { return false }
        lastRev = rev
        if case .diff(let d)? = payload, let diff = d as? RowDiff<Row> {
            // A diff without reset on a fresh subscription can't be applied (native missed the reset): refetch.
            if rev == 1, diff.reset != true, !state.order.isEmpty { return false }
            state.apply(diff)
            version &+= 1
        }
        isStale = stale
        self.error = error
        status = .live
        return true
    }
}

/// Ends a subscription when its store is released (a store's deinit can't reach the main actor itself).
final class SubscriptionToken: Sendable {
    let sub: String
    weak let client: EngineClient?
    init(sub: String, client: EngineClient) {
        self.sub = sub
        self.client = client
    }
    deinit {
        let sub = sub
        Task { @MainActor [client] in client?.unwatch(sub) }
    }
}

/// Pauses after 60 s off screen; resumes at once on screen (only if it had paused).
@MainActor
final class VisibilityTimer {
    static var pauseAfter: Duration = .seconds(60)
    private var task: Task<Void, Never>?
    private var didPause = false
    private var visible = true

    func set(_ visible: Bool, pause: @escaping @MainActor () -> Void, resume: @escaping @MainActor () -> Void) {
        guard visible != self.visible else { return }
        self.visible = visible
        task?.cancel()
        task = nil
        if visible {
            if didPause {
                didPause = false
                resume()
            }
        } else {
            let delay = Self.pauseAfter
            task = Task { @MainActor [weak self] in
                try? await Task.sleep(for: delay)
                guard let self, !Task.isCancelled, !self.visible else { return }
                self.didPause = true
                pause()
            }
        }
    }
}
