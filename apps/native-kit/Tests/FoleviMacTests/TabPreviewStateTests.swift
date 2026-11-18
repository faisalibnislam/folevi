// The strip's hover card: moving from one tab to the next shows the next one's picture, whichever order SwiftUI
// reports the pointer leaving one tab and entering the next (it was lost when the leave came second).
#if os(macOS)
import Testing
import CoreGraphics
@testable import FoleviMac

@MainActor @Suite struct TabPreviewStateTests {
    @Test func enteringTheNextTabBeforeLeavingThisOneStillShowsIt() async throws {
        let p = TabPreviewState()
        p.enter("a", frame: .zero, active: false)
        p.enter("b", frame: .zero, active: false)
        p.leaveTab("a")
        try await Task.sleep(for: .milliseconds(450))
        #expect(p.shownID == "b")
    }

    @Test func leavingBeforeTheRestShowsNothing() async throws {
        let p = TabPreviewState()
        p.enter("a", frame: .zero, active: false)
        p.leaveTab("a")
        try await Task.sleep(for: .milliseconds(450))
        #expect(p.shownID == nil)
    }

    @Test func theOpenTabShowsNone() {
        let p = TabPreviewState()
        p.enter("a", frame: .zero, active: true)
        #expect(p.shownID == nil)
    }
}
#endif
