// Holds a hosted screen on the Simulator's screen so a real screenshot (`xcrun simctl io <id> screenshot`) can be
// compared with what the snapshot tests capture in-process. Runs only with FOLEVI_SCREEN_HOLD=<marker dir>:
// it writes `<name>.ready` there, waits for `<name>.taken`, and also saves its own capture as `<name>.capture.png`.
#if os(iOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviScreens

@Suite("Hold screens for real screenshots", .serialized) @MainActor
struct ScreenHoldTests {
    @Test func darkHomeBar() async throws {
        guard let dir = ProcessInfo.processInfo.environment["FOLEVI_SCREEN_HOLD"] else { return }
        ScreenClock.fixed = fixedNow
        for size in [DeviceSize.iphone] {
            let engine = FakeEngine()
            let model = HomeModel(client: engine.client())
            let host = ScreenHost(Framed(title: "Home", large: true) { HomeScreen(model: model) } bar: { HomeToolbar(model: model) }, size: size, scheme: .dark)
            await eventually { model.value != nil && model.places.value != nil }
            await host.settle(1)
            let name = "home-bar-\(size.rawValue)-dark"
            if let image = host.image(scale: 2), let png = screenPNG(image) { try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).capture.png")) }
            let ready = URL(fileURLWithPath: dir).appendingPathComponent("\(name).ready")
            let taken = URL(fileURLWithPath: dir).appendingPathComponent("\(name).taken")
            try Data().write(to: ready)
            for _ in 0..<200 where !FileManager.default.fileExists(atPath: taken.path) { try? await Task.sleep(for: .milliseconds(100)) }
            host.close()
        }
    }
}
#endif
