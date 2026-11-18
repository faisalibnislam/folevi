// Tasks and the Calendar in the Mac's native look (the owner, 2026-11-19: "polish Tasks and Calendar next"). What
// the pass found and what now holds: the task dialogs are the frame's own sheet (drawn by themselves they had no
// panel behind their fields), a done task's box keeps a fill (its gradient was its only one, and gradients go in
// the native look), and the month's weeks share the window's height.
#if os(macOS)
import AppKit
import SwiftUI
import Testing
import FoleviEngine
@testable import FoleviDesign
@testable import FoleviMac
@testable import FoleviScreens

@Suite("Tasks and Calendar polish", .serialized) @MainActor
struct PlannerPolishTests {
    @Test func quickAddIsTheFramesSheet() {
        let model = FrameModel(client: DemoEngine().client())
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 700), styleMask: [.titled], backing: .buffered, defer: false)
        FrameSheets.attach(model, window: window)
        model.showQuickAdd(in: window)
        // The same sheet every other dialog is, with the system's surface behind it: not a panel of its own.
        #expect(FrameSheets.isShowing(model))
        #expect(FrameSheets.sheetWindow(for: model) != nil)
        #expect(PlannerPanel.top == nil)
        FrameSheets.dismiss(model)
        #expect(!FrameSheets.isShowing(model))
        model.stop()
    }

    @Test func aDoneTasksBoxKeepsAFill() {
        // The web's done box: no background colour, a moss gradient. The native look drops gradients.
        let done = WebStyles.named("planner.tasks.check.done").resolve(.light)
        #expect(done.background.a == 0)
        #expect(done.gradient != nil)
        let native = WebBoxModifier.nativeStyle(done, shadowScale: 0.5)
        #expect(native.gradient == nil)
        #expect(native.background.a == 1)
        #expect(native.background == done.gradient?.stops.last)
        // An open box keeps its own fill.
        let open = WebStyles.named("planner.tasks.check").resolve(.light)
        #expect(WebBoxModifier.nativeStyle(open, shadowScale: 0.5).background == open.background)
    }

    @Test func aFadeIsNotMadeAFill() {
        var fade = WebStyles.named("planner.tasks.check.done").resolve(.light)
        fade.gradient = WebGradient(angle: 180, stops: [RGBA(255, 255, 255, 0), RGBA(255, 255, 255)])
        #expect(WebBoxModifier.nativeStyle(fade, shadowScale: 1).background.a == 0)
    }

    @Test func theMonthsWeeksShareTheWindowsHeight() {
        // Not measured yet, or a short window: the web's row, and the page scrolls.
        #expect(MonthFit.rowHeight(visible: 0, header: 33, base: 104) == 104)
        #expect(MonthFit.rowHeight(visible: 500, header: 33, base: 104) == 104)
        // A window with more room: a sixth of what is under the weekday header, in whole points.
        #expect(MonthFit.rowHeight(visible: 33 + 6 * 130 + 4, header: 33, base: 104) == 130)
        // Never stretched past the tallest row.
        #expect(MonthFit.rowHeight(visible: 3000, header: 33, base: 104) == MonthFit.tallest)
    }

    @Test func aTallerWeekShowsMoreOfItsDay() {
        #expect(MonthFit.capacity(rowHeight: 104, base: 104) == 3)
        #expect(MonthFit.capacity(rowHeight: 104 + MonthFit.chip - 1, base: 104) == 3)
        #expect(MonthFit.capacity(rowHeight: 104 + MonthFit.chip, base: 104) == 4)
        #expect(MonthFit.capacity(rowHeight: 104 + MonthFit.chip * 3, base: 104) == 6)
    }
}
#endif
