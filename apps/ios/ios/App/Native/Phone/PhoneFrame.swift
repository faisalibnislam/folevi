// The native iPhone frame (docs/NATIVE_APP_PLAN.md section 4.1 to 4.3 and 4.6, work packages N5 and N6): the web
// view becomes the Page View (the engine plus the note page, in "native chrome" mode), and everything around a
// note is UIKit and SwiftUI: tab stacks with large titles, the floating tab bar, the note's bars, the keyboard
// toolbar, sheets, the zoom from a card into its note, and the launch snapshot.
//
// This file holds the switch, the engine transport over the Page View, the signposts and a small helper that
// redraws UIKit from @Observable models.
//
// Switches: on by default in the built-in interface (bundled and shellDev). FOLEVI_WEB_FRAME=1 in the
// environment, or the `folevi.webFrame` setting, brings back today's web frame (FoleviViewController).
import Observation
import os
import UIKit
import WebKit
import FoleviEngine
import FoleviDesign

@MainActor
enum PhoneFrame {
    /// Whether the app shows the native frame (decided once per launch: the page's marker script depends on it).
    static let enabled: Bool = {
        let env = ProcessInfo.processInfo.environment
        if env["FOLEVI_WEB_FRAME"] == "1" { return false }
        if UserDefaults.standard.bool(forKey: "folevi.webFrame") { return false }
        return HostConfig.load().bundled
    }()

    /// What the page runs before its first paint: `<html data-native-chrome>` and `window.__foleviNativeChrome`.
    static func markerScript(place: String?) -> String {
        let platform: NativeChromeMarker.Platform = UIDevice.current.userInterfaceIdiom == .pad ? .ipados : .ios
        return WebViewTransport.markerScript(NativeChromeMarker(platform: platform, protocol: EngineContract.protocolVersion, place: place))
    }

    /// The page the Page View idles on (nothing drawn, the engine running).
    static let idlePath = "/native"

    static let signposter = OSSignposter(subsystem: "com.folevi.ios", category: "frame")
    static let log = Logger(subsystem: "com.folevi.ios", category: "frame")
}

// MARK: - The engine transport

/// WebViewTransport plus the big-batch route: a batch over 256 KB is POSTed to /_bridge/<id> (AppScheme keeps it)
/// and the message only names it.
@MainActor
final class PhoneEngineTransport: EngineTransport {
    let inner: WebViewTransport
    var onBatch: (@MainActor (Data) -> Void)?
    var onLifecycle: (@MainActor (PageLifecycle) -> Void)?

    init(host: WebHost) {
        var allowed: Set<WebViewTransport.Origin> = [.ios]
        if let url = URL(string: host.appOrigin), let scheme = url.scheme, let h = url.host {
            allowed.insert(.init(scheme: scheme, host: h, port: url.port ?? 0))
        }
        inner = WebViewTransport(webView: host.pageView, allowed: allowed)
        inner.onBatch = { [weak self] data in self?.receive(data) }
        inner.onLifecycle = { [weak self] event in self?.onLifecycle?(event) }
    }

    func call(_ message: String) async throws -> Data { try await inner.call(message) }

    func pageEvent(_ event: PageLifecycle) {
        switch event {
        case .reloading: inner.pageWillReload()
        case .terminated: inner.contentProcessDidTerminate()
        }
    }

    func detach() { inner.detach() }

    private func receive(_ data: Data) {
        // An array is a batch; an object names a big one.
        if data.first == UInt8(ascii: "{"), let pointer = try? JSONDecoder().decode(BigBatchPointer.self, from: data) {
            if let body = BridgeBodies.shared.takeCall(pointer.bodyId) { onBatch?(body) }
            return
        }
        onBatch?(data)
    }
}

// MARK: - Observation for UIKit

/// Runs `apply` now and again whenever an @Observable value it read changes (iOS 17 has no automatic tracking
/// in UIKit). Keep the returned token; `cancel()` or dropping it stops the loop.
@MainActor
final class Observer {
    private var apply: (() -> Void)?

    init(_ apply: @escaping @MainActor () -> Void) {
        self.apply = apply
        run()
    }

    func cancel() { apply = nil }

    private func run() {
        guard let apply else { return }
        withObservationTracking {
            apply()
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.run() }
        }
    }
}

// MARK: - Measurements

/// Launch and open timings (os_signpost intervals, readable by Instruments and XCTOSSignpostMetric), plus the
/// numbers themselves in the log ("com.folevi.ios", "frame") so a script can read them from the Simulator.
@MainActor
enum PhoneMetrics {
    private static var launchState: OSSignpostIntervalState?
    private static var launchReported = false
    private static var openState: (id: String, state: OSSignpostIntervalState, start: CFAbsoluteTime)?

    /// Seconds since the process started (the kernel's start time), for the cold launch number.
    static func secondsSinceProcessStart() -> Double {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return -1 }
        let start = info.kp_proc.p_un.__p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
        return Date().timeIntervalSince1970 - started
    }

    static func launchBegan() {
        guard launchState == nil else { return }
        launchState = PhoneFrame.signposter.beginInterval("launch.firstFrame")
    }

    /// The first frame with content is on screen (`source`: "snapshot" or "live").
    static func firstFrame(_ source: String) {
        guard !launchReported else { return }
        launchReported = true
        if let s = launchState { PhoneFrame.signposter.endInterval("launch.firstFrame", s) }
        let seconds = secondsSinceProcessStart()
        PhoneFrame.log.notice("metric launch.firstFrame \(Int(seconds * 1000), privacy: .public) ms (\(source, privacy: .public))")
        record("launchFirstFrameMs", Int(seconds * 1000), source: source)
    }

    static func openBegan(_ id: String) {
        if let o = openState { PhoneFrame.signposter.endInterval("note.open", o.state) }
        openState = (id, PhoneFrame.signposter.beginInterval("note.open", id: PhoneFrame.signposter.makeSignpostID(), "\(id, privacy: .public)"), CFAbsoluteTimeGetCurrent())
    }

    /// The note's content is on screen (note.ready arrived, or it was ready already, and the transition ended).
    static func openEnded(_ id: String, prepared: Bool) {
        guard let o = openState, o.id == id else { return }
        openState = nil
        PhoneFrame.signposter.endInterval("note.open", o.state)
        let ms = Int((CFAbsoluteTimeGetCurrent() - o.start) * 1000)
        PhoneFrame.log.notice("metric note.open \(ms, privacy: .public) ms prepared=\(prepared, privacy: .public)")
        record("noteOpenMs", ms, source: prepared ? "prepared" : "cold")
    }

    /// The last numbers, in the app's tmp folder (the UI tests' driver reads them from the Simulator).
    private static func record(_ key: String, _ value: Int, source: String) {
        #if DEBUG
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("native-metrics.json")
        var all = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        var list = all[key] as? [[String: Any]] ?? []
        list.append(["ms": value, "source": source, "at": Date().timeIntervalSince1970])
        all[key] = list
        if let data = try? JSONSerialization.data(withJSONObject: all, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: url) }
        #endif
    }
}

/// The design system's palette (the app target has its own `Folevi` namespace, Shared/).
typealias DS = FoleviDesign.Folevi
