// The launch snapshot (plan 4.6): the view-model values that were on screen, saved at most every 2 s, so the
// next launch draws the last screen at once while the engine boots. A render cache, never written back: the
// engine's values replace it. Encrypted places pass `seal`/`open` (the device's local storage key, plan 3.7), and
// the app lock calls `clear()`.
import Foundation

public final class LaunchSnapshotStore: @unchecked Sendable {
    public typealias Seal = @Sendable (Data) throws -> Data
    private let url: URL
    private let seal: Seal?
    private let open: Seal?
    private let queue = DispatchQueue(label: "com.folevi.engine.snapshot")
    private var values: [String: Data] = [:]
    private var dirty = false
    private var writeScheduled = false
    private var locked = false
    public var throttle: TimeInterval = 2

    /// `url`: e.g. Application Support/Places/<place>/launch.json. Reads what's there now.
    public init(url: URL, seal: Seal? = nil, open: Seal? = nil) {
        self.url = url
        self.seal = seal
        self.open = open
        if var data = try? Data(contentsOf: url) {
            if let open { data = (try? open(data)) ?? Data() }
            values = (try? JSONDecoder().decode([String: Data].self, from: data)) ?? [:]
        }
    }

    public func value<T: Decodable>(_ type: T.Type, key: String) -> T? {
        queue.sync { values[key] }.flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }

    public func set<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        queue.async {
            guard !self.locked, self.values[key] != data else { return }
            self.values[key] = data
            self.dirty = true
            self.scheduleWrite()
        }
    }

    /// Drops everything, on disk too (the app lock engaged, signing out). `lock` stops saving until `unlock()`.
    public func clear(lock: Bool = false) {
        queue.sync {
            values.removeAll()
            dirty = false
            locked = lock
            try? FileManager.default.removeItem(at: url)
        }
    }

    public func unlock() { queue.sync { locked = false } }

    /// Writes now (the app going to the background).
    public func flush() { queue.sync { writeNow() } }

    private func scheduleWrite() {
        guard !writeScheduled else { return }
        writeScheduled = true
        queue.asyncAfter(deadline: .now() + throttle) {
            self.writeScheduled = false
            self.writeNow()
        }
    }

    private func writeNow() {
        guard dirty, !locked else { return }
        dirty = false
        guard var data = try? JSONEncoder().encode(values) else { return }
        if let seal { guard let sealed = try? seal(data) else { return }; data = sealed }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
    }
}
