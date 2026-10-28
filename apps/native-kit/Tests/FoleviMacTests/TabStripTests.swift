// The tab strip's sizing and scrolling against the web's TabStrip.tsx: tabs shrink before the list scrolls, the
// open tab is brought wholly into view (clear of the soft edges) by as little as it takes, the arrows step by
// max(160, 70%), and the scroll stays in range. 2, 8 and 20 tabs, wide and narrow, the open tab at the start, in
// the middle and at the end, and Back and Forward across tabs out of sight.
#if os(macOS)
import CoreGraphics
import Testing
@testable import FoleviMac

@Suite("Tab strip")
struct TabStripTests {
    /// The web's measures: Home 78.47 wide, an open tab 200 wide (its title), 6 between tabs, 4 either side.
    static let home: CGFloat = 78.47, open: CGFloat = 200, gap: CGFloat = 6, padding: CGFloat = 8

    /// `count` tabs with Home first and tab `active` open (0 is Home), in a list given `available`.
    static func strip(_ count: Int, active: Int, available: CGFloat?) -> (sizes: TabStripMath.Sizes, lefts: [CGFloat]) {
        let fixed: [CGFloat?] = (0..<count).map { $0 == 0 ? home : ($0 == active ? open : nil) }
        let s = TabStripMath.sizes(fixed: fixed, gap: gap, padding: padding, available: available)
        var x = padding / 2
        var lefts: [CGFloat] = []
        for w in s.widths {
            lefts.append(x)
            x += w + gap
        }
        return (s, lefts)
    }

    /// The scroll after the strip brings tab `active` into view from `scroll`.
    static func revealed(_ count: Int, active: Int, available: CGFloat, from scroll: CGFloat) -> CGFloat {
        let (s, lefts) = strip(count, active: active, available: available)
        return TabStripMath.reveal(left: lefts[active], width: s.widths[active], scroll: scroll, visible: s.visible, content: s.content) ?? scroll
    }

    /// Tab `active` lies wholly in view at `scroll`, clear of a soft edge where there's room for that.
    static func inView(_ count: Int, active: Int, available: CGFloat, at scroll: CGFloat) -> Bool {
        let (s, lefts) = strip(count, active: active, available: available)
        let pad = max(0, min(TabStripMath.fade + 4, (s.visible - s.widths[active]) / 2))
        let left = lefts[active] - scroll, right = left + s.widths[active]
        let atStart = scroll < 1, atEnd = scroll > s.content - s.visible - 1
        return (left >= pad - 1 || (atStart && left >= 0)) && (right <= s.visible - pad + 1 || (atEnd && right <= s.visible + 1))
    }

    @Test func twoTabsSitAtTheirFullWidth() {
        // Wide: Home and one other tab at 284 (flex-basis), the list as wide as they are, nothing to scroll.
        let (s, _) = Self.strip(2, active: 0, available: 900)
        #expect(s.widths == [Self.home, 284])
        #expect(s.visible == s.content)
        #expect(s.content == Self.padding + Self.home + 284 + Self.gap)
        // The open tab keeps its own width (172 to 284).
        #expect(Self.strip(2, active: 1, available: 900).sizes.widths == [Self.home, Self.open])
        #expect(TabStripMath.overflow(scroll: 0, visible: s.visible, content: s.content) == (false, false))
    }

    @Test func tabsShrinkEvenlyBeforeTheListScrolls() {
        // Four tabs in 700: the two others share the shortfall evenly and the list just fits.
        let (s, _) = Self.strip(4, active: 1, available: 700)
        let natural = Self.padding + Self.home + Self.open + 2 * 284 + 3 * Self.gap
        let each = 284 - (natural - 700) / 2
        #expect(s.widths == [Self.home, Self.open, each, each])
        #expect(s.visible == 700)
        #expect(abs(s.content - 700) < 0.01)
        // Never below 172: then it scrolls.
        let (many, _) = Self.strip(8, active: 1, available: 900)
        #expect(many.widths.dropFirst(2).allSatisfy { $0 == TabStripMath.minTab })
        #expect(many.visible == 900)
        #expect(many.content > 900)
        #expect(TabStripMath.overflow(scroll: 0, visible: many.visible, content: many.content) == (false, true))
    }

    @Test func theListTakesOnlyTheRoomItNeeds() {
        // Unbounded (nil) and generous room both give the content's own width, so New note keeps its place.
        let (free, _) = Self.strip(3, active: 2, available: nil)
        let (room, _) = Self.strip(3, active: 2, available: 5000)
        #expect(free.visible == free.content)
        #expect(room.visible == free.visible)
    }

    @Test(arguments: [2, 8, 20], [1280.0, 520.0])
    func theOpenTabIsBroughtIntoView(count: Int, available: CGFloat) {
        // Wherever the open tab is (the start, the middle, the end) and wherever the list was scrolled, after the
        // reveal it's wholly in view.
        let (s, _) = Self.strip(count, active: 0, available: available)
        let ends: [CGFloat] = [0, max(0, s.content - s.visible) / 2, max(0, s.content - s.visible)]
        for active in Set([0, 1, count / 2, count - 1]) {
            for from in ends {
                let to = Self.revealed(count, active: active, available: available, from: from)
                #expect(Self.inView(count, active: active, available: available, at: to), "\(count) tabs, open \(active), from \(from) to \(to)")
                let (sz, _) = Self.strip(count, active: active, available: available)
                #expect(to >= 0 && to <= max(0, sz.content - sz.visible))
            }
        }
    }

    @Test func aTabAlreadyInViewDoesntMoveTheStrip() {
        // 20 tabs in 520: the second tab open with the list at its start stays put (no reveal).
        let (s, lefts) = Self.strip(20, active: 1, available: 520)
        #expect(TabStripMath.reveal(left: lefts[1], width: s.widths[1], scroll: 0, visible: s.visible, content: s.content) == nil)
    }

    @Test func revealMovesAsLittleAsItTakes() {
        // The last tab open from the start: the strip goes to its end (the tab's right edge plus the soft edge's room,
        // clamped to the range).
        let (s, lefts) = Self.strip(20, active: 19, available: 520)
        let to = TabStripMath.reveal(left: lefts[19], width: s.widths[19], scroll: 0, visible: s.visible, content: s.content)
        #expect(to == s.content - s.visible)
        // A middle tab just past the right edge: only far enough for it and 32 points of room.
        let (m, ml) = Self.strip(20, active: 4, available: 520)
        let mid = TabStripMath.reveal(left: ml[4], width: m.widths[4], scroll: 0, visible: m.visible, content: m.content)
        #expect(mid == (ml[4] + m.widths[4] + TabStripMath.fade + 4 - m.visible).rounded())
    }

    @Test func backAndForwardAcrossTabsOutOfSight() {
        // 20 tabs, narrow. At the last tab (the strip at its end), Back to the second tab scrolls to it; Forward to the
        // last again scrolls back to the end.
        let n = 20, w: CGFloat = 520
        let atEnd = Self.revealed(n, active: n - 1, available: w, from: 0)
        let back = Self.revealed(n, active: 1, available: w, from: atEnd)
        #expect(back < atEnd)
        #expect(Self.inView(n, active: 1, available: w, at: back))
        let forward = Self.revealed(n, active: n - 1, available: w, from: back)
        #expect(Self.inView(n, active: n - 1, available: w, at: forward))
        #expect(forward == atEnd)
        // Back to the neighbour that's already shown doesn't move the strip.
        let (s, lefts) = Self.strip(n, active: n - 2, available: w)
        #expect(TabStripMath.reveal(left: lefts[n - 2], width: s.widths[n - 2], scroll: atEnd, visible: s.visible, content: s.content) == nil)
    }

    @Test func aNarrowListLeavesLessRoomForTheSoftEdges() {
        // A list barely wider than the open tab: the room either side is half what's left, not 32.
        let to = TabStripMath.reveal(left: 400, width: 200, scroll: 0, visible: 240, content: 1000)
        #expect(to == 380)
    }

    @Test func arrowsStepAndTheScrollStaysInRange() {
        #expect(TabStripMath.step(visible: 100) == 160)
        #expect(TabStripMath.step(visible: 1000) == 700)
        #expect(TabStripMath.clamp(-20, visible: 500, content: 1500) == 0)
        #expect(TabStripMath.clamp(2000, visible: 500, content: 1500) == 1000)
        #expect(TabStripMath.clamp(300, visible: 500, content: 400) == 0)
        #expect(TabStripMath.overflow(scroll: 1000, visible: 500, content: 1500) == (true, false))
        #expect(TabStripMath.overflow(scroll: 400, visible: 500, content: 1500) == (true, true))
    }
}
#endif
