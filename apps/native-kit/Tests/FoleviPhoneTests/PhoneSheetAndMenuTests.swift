import Testing
import CoreGraphics
import SwiftUI
import FoleviDesign

@Suite("Sheets and menus")
struct PhoneSheetAndMenuTests {
    // An iPhone 18 Pro: 874 tall, the status bar reaching 62 in.
    let h: CGFloat = 874
    let top: CGFloat = 62

    @Test func largeIsUnderTheStatusBarLessTen() {
        #expect(PhoneSheetDetents.large(screenHeight: h, top: top) == 802)
    }

    @Test func mediumIsFiftySixPercent() {
        #expect(PhoneSheetDetents.medium(screenHeight: h, top: top) == 489)
    }

    @Test func mediumEndsAfterTheLastWholeBlockThatFits() {
        // Places ends at 300, Settings and Help at 520 (too tall for medium): medium ends at Places + 14.
        #expect(PhoneSheetDetents.medium(screenHeight: h, top: top, blocks: [300, 520, 600]) == 314)
    }

    @Test func mediumIgnoresBlocksThatLeaveItTooShort() {
        // A first block under 30% of the screen keeps the usual medium.
        #expect(PhoneSheetDetents.medium(screenHeight: h, top: top, blocks: [120, 700]) == 489)
    }

    @Test func createMenuOpensAboveThePlusWithItsRightEdgeOnIt() {
        let plus = CGRect(x: 326, y: 790, width: 56, height: 56)
        let spot = PhoneMenuPlacement.place(size: CGSize(width: 250, height: 200), anchor: plus, side: .top, align: .end, screen: CGSize(width: 402, height: 874), safeTop: 62)
        #expect(spot.origin.x == 132)
        #expect(spot.origin.y == 582)
        #expect(spot.anchorPoint == UnitPoint(x: 1, y: 1))
    }

    @Test func menuFlipsBelowWhenThereIsNoRoomAbove() {
        let pill = CGRect(x: 300, y: 66, width: 88, height: 44)
        let spot = PhoneMenuPlacement.place(size: CGSize(width: 250, height: 300), anchor: pill, side: .top, align: .end, screen: CGSize(width: 402, height: 874), safeTop: 62)
        #expect(spot.origin.y == 118)
        #expect(spot.origin.x == 138)
        #expect(spot.anchorPoint == UnitPoint(x: 1, y: 0))
    }
}
