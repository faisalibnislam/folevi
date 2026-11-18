// The Mac's title bar tabs follow one rule (the owner, 2026-11-18, Safari's): every tab the same width whatever its
// title, together filling the bar, a joined tab as wide as two, never narrower than the least before it scrolls.
#if os(macOS)
import Testing
import CoreGraphics
@testable import FoleviMac

@Suite struct TabFillTests {
    private let one = TabStripMath.Item.flex(TabStripMath.Flex(basis: 1, min: 1))
    private let two = TabStripMath.Item.flex(TabStripMath.Flex(basis: 2, min: 2))

    @Test func everyTabIsTheSameWidthAndTheyFillTheBar() {
        let s = TabStripMath.filling(items: [one, one, one], gap: 4, padding: 12, available: 1000)
        #expect(Set(s.widths).count == 1)
        // (Whole points: at most a point per tab left over at the end.)
        #expect(s.content <= 1000 && s.content > 1000 - 3)
        #expect(s.visible == s.content)
    }

    @Test func twoTabsAreWideAndTwelveAreNarrow() {
        let few = TabStripMath.filling(items: [one, one], gap: 4, padding: 0, available: 1000)
        let many = TabStripMath.filling(items: Array(repeating: one, count: 10), gap: 4, padding: 0, available: 1000)
        #expect(few.widths[0] > many.widths[0])
        #expect(few.widths[0] == 498)
    }

    @Test func tabsStopAtTheLeastAndTheStripScrolls() {
        let s = TabStripMath.filling(items: Array(repeating: one, count: 20), gap: 4, padding: 0, available: 800, minimum: 90)
        #expect(s.widths.allSatisfy { $0 == 90 })
        #expect(s.visible == 800)
        #expect(s.content > s.visible)
    }

    @Test func aJoinedTabIsAsWideAsTwoAndPinnedKeepTheirOwn() {
        let s = TabStripMath.filling(items: [.fixed(36), one, two], gap: 4, padding: 0, available: 1000)
        #expect(s.widths[0] == 36)
        #expect(s.widths[2] == s.widths[1] * 2 + 4)
    }

    @Test func withNoRoomGivenEachTakesTheIdeal() {
        let s = TabStripMath.filling(items: [one, one], gap: 4, padding: 0, available: nil, ideal: 180)
        #expect(s.widths == [180, 180])
    }
}
#endif
