// What scrolling the iPhone's note cards costs the main thread, frame by frame (docs/IOS_PERFORMANCE.md). Read as
// the main thread's own CPU time, which other work on the Mac doesn't inflate as it does a wall clock, so runs can
// be compared; a phone's numbers are its own (the budget there is 8 ms a frame, measured with Instruments).
#if os(iOS)
import Foundation
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviPhone
@testable import FoleviScreens

extension Rendering {
@Suite("Scrolling 5,000 notes on the iPhone", .serialized) @MainActor
struct PhoneScrollPerformanceTests {
    private func cpuMillis() -> Double {
        var t = timespec()
        clock_gettime(CLOCK_THREAD_CPUTIME_ID, &t)
        return Double(t.tv_sec) * 1000 + Double(t.tv_nsec) / 1_000_000
    }

    private func stats(_ a: [Double]) -> String {
        let s = a.sorted()
        return String(format: "avg %.2f, p50 %.2f, p95 %.2f, max %.2f ms", a.reduce(0, +) / Double(a.count), s[s.count / 2], s[Int(Double(s.count) * 0.95)], s.last ?? 0)
    }

    @Test func cards() async throws {
        let engine = FakeEngine(rows: 5000)
        let defaults = UserDefaults(suiteName: "folevi.perf.\(UUID().uuidString)")!
        defaults.set(NotesLayout.cards.rawValue, forKey: "folevi.layout.all")
        let model = NotesListModel(client: engine.client(), kind: NotesListKind(.all), defaults: defaults)
        let actions = PhoneNotesListActions(open: { _ in }, openNote: { _ in }, back: {}, menu: { _ in }, rowMenu: { _, _ in }, selecting: { _ in })
        let host = ScreenHost(PhoneNotesListScreen(model: model, actions: actions), size: .iphone, scheme: .light)
        defer { host.close() }
        await eventually("5,000 rows", timeout: .seconds(5)) { model.total == 5000 }
        await host.settle(0.5)
        let scroll = try #require(host.scrollView(), "no scroll view")
        var cpu: [Double] = []
        var wall: [Double] = []
        // The first frames scroll the title under the bar; the rest are the long run through the cards.
        for frame in 1...360 {
            let c0 = cpuMillis()
            let w0 = CFAbsoluteTimeGetCurrent()
            scroll.contentOffset = CGPoint(x: 0, y: CGFloat(frame) * 40)
            scroll.layoutIfNeeded()
            await nextTurn()
            await nextTurn()
            cpu.append(cpuMillis() - c0)
            wall.append((CFAbsoluteTimeGetCurrent() - w0) * 1000)
        }
        // Back up over cards it has drawn before: a list scrolled down and up again.
        var back: [Double] = []
        for frame in stride(from: 360, through: 1, by: -1) {
            let c0 = cpuMillis()
            scroll.contentOffset = CGPoint(x: 0, y: CGFloat(frame) * 40)
            scroll.layoutIfNeeded()
            await nextTurn()
            await nextTurn()
            back.append(cpuMillis() - c0)
        }
        print("PERF ios iPhone cards scrolled back, main-thread CPU per frame: \(stats(back)); total \(Int(back.reduce(0, +))) ms")
        print("PERF ios iPhone cards 5000 rows, main-thread CPU per frame: \(stats(cpu)); total \(Int(cpu.reduce(0, +))) ms; wall: \(stats(wall)); window start \(model.store.state.start)")
        #expect(cpu.sorted()[Int(Double(cpu.count) * 0.5)] < 33)
    }
}
}
#endif
