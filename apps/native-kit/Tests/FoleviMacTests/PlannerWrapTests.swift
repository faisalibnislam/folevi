// The Tasks and Calendar screens' paragraphs wrap as the web's `text-wrap: pretty` (line breaks read from the
// web frame, 2026-10-28).
#if os(macOS)
import XCTest
import FoleviDesign
@testable import FoleviMac

final class PlannerWrapTests: XCTestCase {
    func testCalendarHintBreaksAsTheWeb() {
        let style = WebTextStyle(size: 12, leading: 16, letterSpacing: -0.096)
        let text = "Drag tasks between days to reschedule, or use a task’s edit button to pick a date. Arrow keys move between days."
        XCTAssertEqual(PrettyWrap.lines(text, style, width: 300), "Drag tasks between days to reschedule,\nor use a task’s edit button to pick a date.\nArrow keys move between days.")
    }

    func testTaskTitleBreaksAsTheWeb() {
        let style = WebTextStyle(size: 14, leading: 18.9, letterSpacing: -0.096)
        XCTAssertEqual(PrettyWrap.lines("Add a task with Quick Add (⇧⌘A). It lands in your Inbox page", style, width: 198), "Add a task with Quick\nAdd (⇧⌘A). It lands\nin your Inbox page")
    }

    func testOneLineStaysAsItIs() {
        let style = WebTextStyle(size: 14, leading: 18.9)
        XCTAssertEqual(PrettyWrap.lines("Buy matcha", style, width: 300), "Buy matcha")
    }

    func testDueWordsAsTheWeb() {
        XCTAssertEqual(PlannerDates.dueLabel("2026-10-28", today: "2026-10-28"), "Today")
        XCTAssertEqual(PlannerDates.dueLabel("2026-10-29", today: "2026-10-28"), "Tomorrow")
        XCTAssertEqual(PlannerDates.dueLabel("2026-10-30", today: "2026-10-28"), "Friday")
        XCTAssertEqual(PlannerDates.dueLabel("2026-11-06", today: "2026-10-28"), "Nov 6")
        XCTAssertEqual(PlannerDates.timeLabel("15:00"), "3:00 PM")
        XCTAssertEqual(PlannerDates.monthGrid("2026-10").first, "2026-09-28")
    }
}
#endif
