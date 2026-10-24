// The native side of the bridge (docs/NATIVE_APP_PLAN.md section 3): one client per Page View (per window, per
// open place). It speaks the protocol over an `EngineTransport`:
//
// - request/response with ids and timeouts (hello, query, command, editor), replies decoded off the main thread
//   straight into each call's generated type;
// - live views: `watch` returns an observable `ValueStore`, `watchList` a windowed `ListStore` whose diffs are
//   applied as they arrive; `rev` gaps refetch; stores pause off screen and resume with a fresh value;
// - events as an AsyncStream of typed `EngineEvent`s;
// - reconnection: when the page reloads or its content process ends, stores keep their last values (marked
//   disconnected), the client says hello again once the engine is back (`engine.ready`, or polling while it
//   boots) and resubscribes everything;
// - performance: batches are decoded off the main thread in arrival order and applied in one main-actor pass per
//   group of batches that arrived together (the engine already flushes at most once a frame); signposts
//   `engine.call` and `engine.update` measure the plan's latency budgets (section 3.4).
import Foundation
import Observation
import os

@MainActor
@Observable
public final class EngineClient {
    public enum State: Equatable, Sendable {
        /// Not started.
        case idle
        /// Saying hello (the page is loading or the engine is booting).
        case connecting
        /// The engine answered hello and its data layer is up.
        case ready
        /// The engine is up but not ready (signed out, a gate, the store opening): waiting for `engine.ready`.
        case waiting
        /// The page reloads or its content process ended; the host brings it back.
        case disconnected
        /// The app and the web export disagree on the protocol (development builds with a stale export).
        case mismatch(String)
    }

    public private(set) var state: State = .idle
    /// The engine's hello reply (build, features, names), once connected.
    public private(set) var hello: HelloValue?
    /// Set when the engine's contract hash differs from this build's generated Swift (a stale export in a
    /// development build): calls still work for the names both know.
    public private(set) var contractWarning: String?

    /// The place this client's Page View is bound to (`acct:<user id>` or `library`); every message names it.
    public let place: String
    @ObservationIgnored public var timeout: Duration = .seconds(10)
    /// How long a command waits for the engine to become ready before failing (plan 4.6: at most 5 s).
    @ObservationIgnored public var readyWait: Duration = .seconds(5)
    /// Optional render cache of what was on screen (plan 4.6); values persist through it when watched with a key.
    @ObservationIgnored public var snapshot: LaunchSnapshotStore?

    @ObservationIgnored let transport: any EngineTransport
    @ObservationIgnored let app: AppInfo
    @ObservationIgnored private var nextId = 0
    @ObservationIgnored private var entries: [String: Entry] = [:]
    @ObservationIgnored private var decoders = SubscriptionDecoders()
    @ObservationIgnored private var listeners: [UUID: AsyncStream<EngineEvent>.Continuation] = [:]
    @ObservationIgnored private var readyWaiters: [UUID: CheckedContinuation<Void, any Error>] = [:]
    @ObservationIgnored private var connectTask: Task<Void, Never>?
    @ObservationIgnored private let pipeline = InboundPipeline()
    @ObservationIgnored private static let signposter = OSSignposter(subsystem: "com.folevi.engine", category: "bridge")
    @ObservationIgnored private static let log = Logger(subsystem: "com.folevi.engine", category: "bridge")

    public init(transport: any EngineTransport, place: String, app: AppInfo) {
        self.transport = transport
        self.place = place
        self.app = app
    }

    /// Hooks the transport up and connects. Call once, after the Page View started loading.
    public func start() {
        guard state == .idle else { return }
        pipeline.client = self
        transport.onBatch = { [weak self] data in
            guard let self else { return }
            self.pipeline.enqueue(data, decoders: self.decoders)
        }
        transport.onLifecycle = { [weak self] event in self?.pageChanged(event) }
        connect()
    }

    // MARK: Live views

    /// Starts a live value view. The store fills with the first update; `snapshotKey` keeps its last value in the
    /// launch snapshot so the next launch can draw it at once.
    public func watch<V: EngineViewSpec>(_ view: V, snapshotKey: String? = nil) -> ValueStore<V.Value> {
        let sub = newId("v")
        let spec = SubscriptionSpec(name: V.name, args: AnyArgs(view.args), isList: false, decoder: .value(V.Value.self))
        let initial: V.Value? = snapshotKey.flatMap { snapshot?.value(V.Value.self, key: $0) }
        let store = ValueStore<V.Value>(sub: sub, spec: spec, client: self, initial: initial)
        let snapshot = snapshotKey.flatMap { key in self.snapshot.map { (key, $0) } }
        register(sub, spec: spec, window: nil, store: store) { [weak store] rev, payload, stale, error in
            guard let store else { return true }
            let ok = store.apply(rev: rev, payload: payload, stale: stale, error: error)
            if ok, let (key, snap) = snapshot, let value = store.value { snap.set(value, key: key) }
            return ok
        } disconnected: { [weak store] in
            store?.status = .disconnected
            store?.lastRev = 0
        } paused: { [weak store] in
            store?.status = .paused
            store?.lastRev = 0
        }
        return store
    }

    /// Starts a live windowed list. Without a window it asks for the first `2 * overscan` rows. `snapshotKey`
    /// keeps the top of the list (its first 40 rows) in the launch snapshot, so the next launch draws it at once.
    public func watchList<L: EngineListSpec>(_ list: L, window: ListWindow? = nil, windowing: ListWindowing = ListWindowing(), snapshotKey: String? = nil) -> ListStore<L.Row> {
        let sub = newId("l")
        let spec = SubscriptionSpec(name: L.name, args: AnyArgs(list.args), isList: true, decoder: .list(L.Row.self))
        let win = window ?? ListWindow(start: 0, count: windowing.overscan * 2)
        let initial: ListSnapshot<L.Row>? = snapshotKey.flatMap { snapshot?.value(ListSnapshot<L.Row>.self, key: $0) }
        let store = ListStore<L.Row>(sub: sub, spec: spec, client: self, window: win, windowing: windowing, initial: initial)
        let snapshot = snapshotKey.flatMap { key in self.snapshot.map { (key, $0) } }
        register(sub, spec: spec, window: win, store: store) { [weak store] rev, payload, stale, error in
            guard let store else { return true }
            let ok = store.apply(rev: rev, payload: payload, stale: stale, error: error)
            if ok, let (key, snap) = snapshot, let top = store.state.snapshot() { snap.set(top, key: key) }
            return ok
        } disconnected: { [weak store] in
            store?.status = .disconnected
            store?.lastRev = 0
        } paused: { [weak store] in
            store?.status = .paused
            store?.lastRev = 0
        }
        return store
    }

    /// Reads a value view once (search, a sheet).
    public func query<V: EngineViewSpec>(_ view: V) async throws -> V.Value {
        try await whenReady()
        var m = OutgoingMessage(id: newId("q"), kind: .query)
        m.place = place
        m.name = V.name
        m.args = AnyArgs(view.args)
        return try await send(m, as: V.Value.self)
    }

    /// Reads a list view's first window once.
    public func queryList<L: EngineListSpec>(_ list: L, window: ListWindow? = nil) async throws -> RowDiff<L.Row> {
        try await whenReady()
        var m = OutgoingMessage(id: newId("q"), kind: .query)
        m.place = place
        m.name = L.name
        m.args = AnyArgs(list.args)
        m.window = window
        return try await send(m, as: RowDiff<L.Row>.self)
    }

    /// Runs a command (a write). Replies once the change is applied on this device (queued if offline). Waits up
    /// to `readyWait` for the engine to become ready.
    @discardableResult
    public func command<C: EngineCommandSpec>(_ command: C) async throws -> C.Result {
        try await whenReady()
        var m = OutgoingMessage(id: newId("c"), kind: .command)
        m.place = place
        m.name = C.name
        m.args = AnyArgs(command.args)
        return try await send(m, as: C.Result.self)
    }

    /// Drives the note page (keyboard toolbar, bars, menus, opening notes).
    @discardableResult
    public func editor<E: EngineEditorSpec>(_ command: E) async throws -> E.Result {
        try await whenReady()
        var m = OutgoingMessage(id: newId("e"), kind: .editor)
        m.name = E.name
        m.args = AnyArgs(command.args)
        return try await send(m, as: E.Result.self)
    }

    /// Every event from the engine, typed, from now on. Ends when the caller stops iterating.
    public func events() -> AsyncStream<EngineEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            listeners[id] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listeners[id] = nil }
            }
        }
    }

    // MARK: Subscriptions (stores call these)

    func unwatch(_ sub: String) {
        guard entries.removeValue(forKey: sub) != nil else { return }
        decoders.bySub[sub] = nil
        guard state == .ready else { return }
        var m = OutgoingMessage(id: newId("u"), kind: .unwatch)
        m.sub = sub
        fireAndForget(m)
    }

    func pause(_ sub: String) {
        guard var entry = entries[sub], !entry.paused else { return }
        entry.paused = true
        entries[sub] = entry
        entry.markPaused()
        guard state == .ready else { return }
        var m = OutgoingMessage(id: newId("u"), kind: .unwatch)
        m.sub = sub
        fireAndForget(m)
    }

    func resume(_ sub: String) {
        guard var entry = entries[sub], entry.paused else { return }
        entry.paused = false
        entries[sub] = entry
        if state == .ready { sendWatch(sub, entry) }
    }

    func moveWindow(_ sub: String, to window: ListWindow) {
        guard var entry = entries[sub] else { return }
        entry.window = window
        entries[sub] = entry
        guard state == .ready, !entry.paused else { return }
        var m = OutgoingMessage(id: newId("w"), kind: .window)
        m.sub = sub
        m.window = window
        fireAndForget(m)
    }

    /// How many subscriptions are registered (tests, the debug overlay).
    public var subscriptionCount: Int { entries.count }

    // MARK: Inbound

    func apply(_ items: [InboundItem]) {
        let interval = Self.signposter.beginInterval("engine.update", "\(items.count) items")
        defer { Self.signposter.endInterval("engine.update", interval) }
        for item in items {
            switch item {
            case .update(let sub, let rev, let payload, let stale, let error):
                guard let entry = entries[sub], !entry.paused else { continue }
                if !entry.apply(rev, payload, stale, error) {
                    // A gap in `rev` (or a list update native can't place): ask for the whole value again.
                    Self.log.info("rev gap on \(sub, privacy: .public); refetching")
                    entry.markDisconnected()
                    sendWatch(sub, entry)
                }
            case .event(let event):
                handle(event)
                for continuation in listeners.values { continuation.yield(event) }
            case .ignored:
                continue
            }
        }
    }

    private func handle(_ event: EngineEvent) {
        if case .engineReady = event, state != .ready {
            connect()
        }
    }

    private func pageChanged(_ event: PageLifecycle) {
        state = .disconnected
        hello = nil
        for entry in entries.values where !entry.paused { entry.markDisconnected() }
        connect(after: event == .terminated ? .milliseconds(300) : .milliseconds(100))
    }

    // MARK: Connecting

    private func connect(after delay: Duration = .zero) {
        connectTask?.cancel()
        if state != .disconnected { state = .connecting }
        connectTask = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            var backoff: Duration = .milliseconds(150)
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let value = try await self.sayHello()
                    if Task.isCancelled { return }
                    self.hello = value
                    guard value.protocol == EngineContract.protocolVersion else {
                        self.state = .mismatch("The app speaks protocol \(EngineContract.protocolVersion), the engine \(value.protocol).")
                        Self.log.fault("protocol mismatch: app \(EngineContract.protocolVersion), engine \(value.protocol)")
                        self.failWaiters(EngineFailure.protocolMismatch(app: EngineContract.protocolVersion, engine: value.protocol))
                        return
                    }
                    self.contractWarning = value.schemaHash == EngineContract.schemaHash ? nil : "The engine's contract (\(value.schemaHash), revision \(value.revision)) differs from this build's (\(EngineContract.schemaHash), revision \(EngineContract.revision)). Run pnpm engine:gen and rebuild."
                    if let warning = self.contractWarning { Self.log.error("\(warning, privacy: .public)") }
                    if value.ready {
                        self.becameReady()
                    } else {
                        // Up but not ready: `engine.ready` brings it on.
                        self.state = .waiting
                    }
                    return
                } catch {
                    if Task.isCancelled { return }
                    if self.state != .disconnected { self.state = .connecting }
                    try? await Task.sleep(for: backoff)
                    backoff = min(backoff * 2, .seconds(2))
                }
            }
        }
    }

    private func sayHello() async throws -> HelloValue {
        var m = OutgoingMessage(id: newId("h"), kind: .hello)
        m.app = AppInfo(platform: app.platform, version: app.version, build: app.build, protocol: EngineContract.protocolVersion, schemaHash: EngineContract.schemaHash)
        return try await send(m, as: HelloValue.self)
    }

    private func becameReady() {
        state = .ready
        for (sub, entry) in entries where !entry.paused { sendWatch(sub, entry) }
        let waiters = readyWaiters
        readyWaiters.removeAll()
        for w in waiters.values { w.resume() }
    }

    private func whenReady() async throws {
        switch state {
        case .ready: return
        case .mismatch(let message): throw EngineFailure.transport(message)
        case .idle: start()
        default: break
        }
        let id = UUID()
        let wait = readyWait
        let timer = Task { @MainActor [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self, let w = self.readyWaiters.removeValue(forKey: id) else { return }
            w.resume(throwing: EngineFailure.notReady)
        }
        defer { timer.cancel() }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, any Error>) in
            readyWaiters[id] = c
        }
    }

    private func failWaiters(_ error: any Error) {
        let waiters = readyWaiters
        readyWaiters.removeAll()
        for w in waiters.values { w.resume(throwing: error) }
    }

    // MARK: Sending

    private func register(_ sub: String, spec: SubscriptionSpec, window: ListWindow?, store: AnyObject, apply: @escaping @MainActor (Int, UpdatePayload?, Bool, EngineError?) -> Bool, disconnected: @escaping @MainActor () -> Void, paused: @escaping @MainActor () -> Void) {
        let entry = Entry(spec: spec, window: window, apply: apply, markDisconnected: disconnected, markPaused: paused)
        entries[sub] = entry
        decoders.bySub[sub] = spec.decoder
        if state == .idle { start() }
        // Registered before sending: an update may arrive before the reply.
        if state == .ready { sendWatch(sub, entry) }
    }

    private func sendWatch(_ sub: String, _ entry: Entry) {
        var m = OutgoingMessage(id: newId("w"), kind: .watch)
        m.sub = sub
        m.place = place
        m.name = entry.spec.name
        m.args = entry.spec.args
        m.window = entry.window
        Task { [weak self] in
            do {
                _ = try await self?.send(m, as: WatchValue.self)
            } catch let failure as EngineFailure {
                guard let self, let entry = self.entries[sub] else { return }
                if case .engine(let error) = failure {
                    _ = entry.apply(1, nil, false, error)
                }
            } catch {}
        }
    }

    private func fireAndForget(_ m: OutgoingMessage) {
        Task { [weak self] in _ = try? await self?.send(m, as: Ignored.self) }
    }

    func send<T: Decodable & Sendable>(_ message: OutgoingMessage, as: T.Type) async throws -> T {
        let json: String
        do { json = try message.json() } catch { throw EngineFailure.decoding("Couldn't encode \(message.kind.rawValue): \(error)") }
        let interval = Self.signposter.beginInterval("engine.call", id: Self.signposter.makeSignpostID(), "\(message.kind.rawValue) \(message.name ?? "")")
        defer { Self.signposter.endInterval("engine.call", interval) }
        let transport = self.transport
        let timeout = self.timeout
        let label = "\(message.kind.rawValue) \(message.name ?? "")"
        // The call races a timer; whichever finishes first answers (a JavaScript call can't be cancelled).
        let data: Data = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, any Error>) in
            let once = ResumeOnce(continuation)
            let timer = Task {
                try? await Task.sleep(for: timeout)
                once.resume(throwing: EngineFailure.timeout(label))
            }
            Task { @MainActor in
                do { once.resume(returning: try await transport.call(json)) } catch { once.resume(throwing: error) }
                timer.cancel()
            }
        }
        // Decode off the main thread: replies can be big (a list's first window).
        let reply = try await Task.detached(priority: .userInitiated) { () throws -> ReplyEnvelope<T> in
            do { return try JSONDecoder().decode(ReplyEnvelope<T>.self, from: data) } catch { throw EngineFailure.decoding("\(label): \(error)") }
        }.value
        if reply.ok, let value = reply.value { return value }
        // An ok reply without a value: fine for types that read from nothing (Ignored, empty results).
        if reply.ok, let empty = try? JSONDecoder().decode(T.self, from: Data("{}".utf8)) { return empty }
        throw EngineFailure.from(reply.error ?? EngineError(code: "failed", message: "Something went wrong."))
    }

    private func newId(_ prefix: String) -> String {
        nextId += 1
        return "\(prefix)\(nextId)"
    }

    struct Entry {
        let spec: SubscriptionSpec
        var window: ListWindow?
        var paused = false
        let apply: @MainActor (Int, UpdatePayload?, Bool, EngineError?) -> Bool
        let markDisconnected: @MainActor () -> Void
        let markPaused: @MainActor () -> Void

        init(spec: SubscriptionSpec, window: ListWindow?, apply: @escaping @MainActor (Int, UpdatePayload?, Bool, EngineError?) -> Bool, markDisconnected: @escaping @MainActor () -> Void, markPaused: @escaping @MainActor () -> Void) {
            self.spec = spec
            self.window = window
            self.apply = apply
            self.markDisconnected = markDisconnected
            self.markPaused = markPaused
        }
    }
}

/// Resumes a continuation once; later calls are ignored.
final class ResumeOnce<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, any Error>?
    init(_ continuation: CheckedContinuation<T, any Error>) { self.continuation = continuation }
    func resume(returning value: T) { take()?.resume(returning: value) }
    func resume(throwing error: any Error) { take()?.resume(throwing: error) }
    private func take() -> CheckedContinuation<T, any Error>? {
        lock.withLock {
            defer { continuation = nil }
            return continuation
        }
    }
}

/// What a subscription asks for, kept to resubscribe after a reload or a `rev` gap.
struct SubscriptionSpec: Sendable {
    let name: String
    let args: AnyArgs
    let isList: Bool
    let decoder: PayloadDecoder
}

/// Decodes batches off the main thread, one at a time in arrival order, and hands the results to the main actor
/// in groups: batches decoded while the main actor was busy are applied together in one pass.
final class InboundPipeline: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [InboundItem] = []
    private var flushScheduled = false
    private let continuation: AsyncStream<(Data, SubscriptionDecoders)>.Continuation
    @MainActor weak var client: EngineClient?

    init() {
        let (stream, continuation) = AsyncStream<(Data, SubscriptionDecoders)>.makeStream(bufferingPolicy: .unbounded)
        self.continuation = continuation
        Task.detached(priority: .userInitiated) { [weak self] in
            for await (data, decoders) in stream {
                guard let self else { return }
                let items: [InboundItem]
                do {
                    items = try InboundItem.decodeBatch(data, decoders: decoders)
                } catch {
                    Logger(subsystem: "com.folevi.engine", category: "bridge").error("couldn't decode a batch: \(String(describing: error), privacy: .public)")
                    continue
                }
                self.append(items)
            }
        }
    }

    deinit { continuation.finish() }

    func enqueue(_ data: Data, decoders: SubscriptionDecoders) {
        continuation.yield((data, decoders))
    }

    private func append(_ items: [InboundItem]) {
        let schedule: Bool = lock.withLock {
            pending.append(contentsOf: items)
            if flushScheduled { return false }
            flushScheduled = true
            return true
        }
        guard schedule else { return }
        Task { @MainActor [weak self] in self?.flush() }
    }

    @MainActor private func flush() {
        let items: [InboundItem] = lock.withLock {
            flushScheduled = false
            defer { pending.removeAll(keepingCapacity: true) }
            return pending
        }
        client?.apply(items)
    }
}
