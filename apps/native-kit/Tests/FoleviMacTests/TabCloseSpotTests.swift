// The × on a title bar tab (the owner, 2026-11-19: "Close button should always align to the left, whatever the
// size of the tab is"). It sat in the icon's place beside the title, so in a tab wider than its title it floated
// in the middle. It is now at the tab's leading edge in every tab; the picture check is
// docs/audits/2026-11-18-mac-ui (tabs-close).
#if os(macOS)
import CoreGraphics
import Testing
@testable import FoleviMac

@Suite("Tab close button")
struct TabCloseSpotTests {
    /// In a narrow tab (its icon against the tab's padding) the × is centred on the icon it stands in for.
    @Test func itSitsWhereANarrowTabsIconIs() {
        let iconCentre = TabCloseSpot.padding + TabCloseSpot.icon / 2
        #expect(TabCloseSpot.leading + TabCloseSpot.button / 2 == iconCentre)
    }

    /// It is inside the tab's capsule, and nearer its edge than the tab's own padding.
    @Test func itIsAtTheLeadingEdge() {
        #expect(TabCloseSpot.leading > 0)
        #expect(TabCloseSpot.leading <= TabCloseSpot.padding)
    }

    /// A centred icon and title keep clear of it, with air between.
    @Test func theIconBesideItNeverTouchesIt() {
        #expect(TabCloseSpot.clear >= TabCloseSpot.leading + TabCloseSpot.button + 4)
    }

    /// A wide tab keeps its icon beside the title; a narrow one shows the × in the icon's stead.
    @Test func aWideTabKeepsItsIconAndANarrowOneGivesItsPlace() {
        let content: CGFloat = TabCloseSpot.icon + 5 + 80
        #expect(TabCloseSpot.iconStays(tab: 369, content: content))
        #expect(!TabCloseSpot.iconStays(tab: 115, content: content))
        // Exactly enough room either side counts as clear.
        #expect(TabCloseSpot.iconStays(tab: content + TabCloseSpot.clear * 2, content: content))
    }
}
#endif
