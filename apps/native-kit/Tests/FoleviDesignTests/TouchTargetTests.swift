// The UI audit's touch fixes that can be checked without a finger: the Insert sheet's table grid finds the cell under
// a point (and nothing off the grid, so a swipe that ends there adds no table: IPHONE-01), and the iPad's measured
// controls that count as controls for the 44-point touch height (IPAD-08).
import CoreGraphics
import Testing
@testable import FoleviDesign

@Suite("Touch targets")
struct TouchTargetTests {
    /// A grid 362 wide (an iPhone 17's sheet): cells (362 - 20 - 28) / 8 = 39.25 wide, 27.475 tall, 4 apart.
    static let width: CGFloat = 362

    @Test func gridCellUnderAPoint() {
        let first = QuickTablePicker.cell(at: CGPoint(x: 12, y: 12), width: Self.width)
        #expect(first?.r == 1 && first?.c == 1)
        // The third column, second row.
        let mid = QuickTablePicker.cell(at: CGPoint(x: 10 + 2 * 43.25 + 5, y: 10 + 31.475 + 5), width: Self.width)
        #expect(mid?.r == 2 && mid?.c == 3)
        // The far corner is 5 by 8.
        let last = QuickTablePicker.cell(at: CGPoint(x: Self.width - 11, y: 20 + 5 * 27.475 + 16 - 11), width: Self.width)
        #expect(last?.r == 5 && last?.c == 8)
    }

    @Test func offTheGridIsNothing() {
        // Well above the grid (where a swipe up ends): no table.
        #expect(QuickTablePicker.cell(at: CGPoint(x: 100, y: -200), width: Self.width) == nil)
        // A finger that drifts just past the edge while sliding still counts (the slack), farther doesn't.
        #expect(QuickTablePicker.cell(at: CGPoint(x: Self.width + 10, y: 40), width: Self.width, slack: 24) != nil)
        #expect(QuickTablePicker.cell(at: CGPoint(x: Self.width + 40, y: 40), width: Self.width, slack: 24) == nil)
    }

    @Test func seeAllIsAControl() {
        #expect(WebStylePair.isControl("notes.section.seeAll"))
        #expect(WebStylePair.isControl("notes.toolbar.select"))
        #expect(WebStylePair.isControl("notes.catchup.button"))
        #expect(!WebStylePair.isControl("notes.section.title"))
    }

    @MainActor @Test func touchSizedRaisesControlsTo44() {
        var short = WebStyles.named("notes.section.seeAll").light
        short.height = 28
        let pair = WebStylePair(light: short, dark: short).touchSized("notes.section.seeAll")
        #expect(pair.light.height == 44)
        #expect(WebStylePair(light: short, dark: short).touchSized("notes.section.title").light.height == 28)
    }
}
