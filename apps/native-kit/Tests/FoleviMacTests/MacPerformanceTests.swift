// The Mac performance pass of 2026-11-19 (docs/MAC_PERFORMANCE_2026-11-19.md): what was found, held in place.
#if os(macOS)
import AppKit
import SwiftUI
import Testing
@testable import FoleviDesign
@testable import FoleviEngine
@testable import FoleviMac

@Suite("Mac performance", .serialized)
@MainActor
struct MacPerformanceTests {
    /// A planner popover is let go when it closes. Its content's `close` held the panel, and the panel its content.
    @Test func aClosedPopoverIsReleased() async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let anchor = NSView(frame: NSRect(x: 20, y: 200, width: 80, height: 24))
        window.contentView?.addSubview(anchor)
        weak var held: PlannerPanel?
        do {
            let panel = PlannerPanel.popover(below: anchor) { close in Button("Done") { close() } }
            held = panel
            #expect(panel != nil)
            panel?.close()
        }
        // (The fade, then the turn of the run loop that lets it go.)
        for _ in 0..<40 where held != nil { try await Task.sleep(nanoseconds: 50_000_000) }
        #expect(held == nil)
        window.close()
    }

    /// One formatter for each template, however many dates are written (a month's page asked for about sixty a pass).
    @Test func datesShareTheirFormatters() {
        let before = PlannerDates.Formatters.shared.count
        var out: Set<String> = []
        for day in 1...28 { out.insert(PlannerDates.format(String(format: "2026-11-%02d", day), "EEEEMMMMd")) }
        #expect(out.count == 28)
        #expect(PlannerDates.Formatters.shared.count - before <= 1)
        #expect(PlannerDates.long("2026-11-19") == "Thursday, November 19")
        #expect(PlannerDates.dueLabel("2026-11-20", today: "2026-11-19") == "Tomorrow")
        #expect(PlannerDates.dueLabel("2026-11-22", today: "2026-11-19") == "Sunday")
        #expect(PlannerDates.dueLabel("2026-12-30", today: "2026-11-19") == "Dec 30")
    }

    /// Quick Add's words for a time and a day are the same as before, from kept formatters.
    @Test func quickAddsWordsAreUnchanged() {
        #expect(WebQuickAddPanel.dayLabel("2026-11-19", today: "2026-11-19") == "Today")
        #expect(WebQuickAddPanel.dayLabel("2026-11-20", today: "2026-11-19") == "Tomorrow")
        #expect(WebQuickAddPanel.dayLabel("2026-11-18", today: "2026-11-19") == "Yesterday")
        let before = PlannerDates.Formatters.shared.count
        let all = PlannerTimeField.times.map { WebQuickAddPanel.clock($0) }
        #expect(Set(all).count == all.count)
        #expect(PlannerDates.Formatters.shared.count - before <= 2)
    }

    /// The card covers kept decoded stop at the cap, oldest first, and all go when memory is short.
    @Test func coverPicturesAreCapped() {
        let files = CoverFiles()
        let picture = Image(systemName: "doc")
        for i in 0..<(CoverFiles.cap + 25) { files.keep("file-\(i)", picture) }
        #expect(files.count == CoverFiles.cap)
        files.relieve()
        #expect(files.count == 0)
    }

    /// The card line breaks kept can be let go, and what shows asks again.
    @Test func lineBreaksCanBeLetGo() {
        let layout = WebLineLayout()
        #expect(layout.count == 0)
        layout.relieve()
        #expect(layout.count == 0)
        #expect(WebLineLayout.cap >= 1000)
    }

    /// A list's rows take no pointer while it moves, and do again when it rests or is pressed.
    @Test func aMovingListIsQuietUntilItRestsOrIsPressed() async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let watch = ScrollWatchView(frame: .zero)
        window.contentView?.addSubview(watch)
        var states: [Bool] = []
        watch.changed = { states.append($0) }
        watch.begin()
        #expect(watch.scrolling)
        try await Task.sleep(nanoseconds: 30_000_000)
        #expect(states == [true])
        // At rest for longer than `rest`: it ends by itself.
        for _ in 0..<40 where watch.scrolling { try await Task.sleep(nanoseconds: 25_000_000) }
        #expect(!watch.scrolling)
        #expect(states == [true, false])

        // A press while it moves is held back, the rows answer again, and the press is sent on.
        watch.begin()
        let press = try #require(NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 10, y: 10), modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
        var sent: [NSEvent] = []
        #expect(watch.pressed(press) { sent.append($0) } == nil)
        #expect(!watch.scrolling)
        for _ in 0..<20 where sent.isEmpty { try await Task.sleep(nanoseconds: 10_000_000) }
        #expect(sent.count == 1)
        // At rest a press passes straight through.
        #expect(watch.pressed(press) { sent.append($0) } === press)
        window.close()
    }
}
#endif
