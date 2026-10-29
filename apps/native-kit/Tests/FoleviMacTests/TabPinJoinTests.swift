// Pinned tabs and joined notes in the tab model, against the web's rules (apps/web/src/lib/app/tabs.tsx and
// TabStrip.tsx): pinned tabs sit after Home and stay through closing others or all; joined notes are one tab of two
// or three, a note in at most one tab; unjoin, move, take out and sizes as the web does them; and the strip's widths
// when tabs of different kinds share the room.
#if os(macOS)
import CoreGraphics
import Foundation
import Testing
@testable import FoleviMac

@MainActor
@Suite("Pinned and joined tabs")
struct TabPinJoinTests {
    static func model(_ notes: [String]) -> TabsModel {
        let m = TabsModel()
        for n in notes { m.show(.note(n)) }
        return m
    }

    static func ids(_ m: TabsModel) -> [String] { m.tabs.map(\.id) }

    @Test func pinningMovesATabToTheStartAndKeepsIt() {
        let m = Self.model(["a", "b", "c"])
        m.setPinned("c", true)
        #expect(Self.ids(m) == ["home", "c", "a", "b"])
        m.setPinned("b", true)
        // To the end of the pinned ones.
        #expect(Self.ids(m) == ["home", "c", "b", "a"])
        // Moving keeps pinned tabs among pinned ones, the others among the others.
        m.move("a", to: 1)
        #expect(Self.ids(m) == ["home", "c", "b", "a"])
        m.move("b", to: 1)
        #expect(Self.ids(m) == ["home", "b", "c", "a"])
        // Closing others, to the right or all keeps them.
        m.show(.note("d"))
        m.closeOthers("d")
        #expect(Self.ids(m) == ["home", "b", "c", "d"])
        m.closeAll()
        #expect(Self.ids(m) == ["home", "b", "c"])
        // Unpinned: to the start of the others.
        m.show(.note("e"))
        m.setPinned("b", false)
        #expect(Self.ids(m) == ["home", "c", "b", "e"])
    }

    @Test func aFullStripNeverDropsAPinnedTab() {
        let m = Self.model(["p"])
        m.setPinned("p", true)
        for i in 0..<20 { m.show(.note("n\(i)")) }
        #expect(m.tabs.contains { $0.id == "p" })
        #expect(m.tabs.count == TabsModel.maxTabs + 1)
    }

    @Test func joiningMakesOneTabAndMergesTheNotesOwn() {
        let m = Self.model(["a", "b", "c"])
        m.select(id: "a")
        let shown = m.join("a", note: "b")
        #expect(shown == .note("b"))
        let joined = m.tabs[1]
        #expect(joined.id.hasPrefix("join:"))
        #expect(joined.panes == ["a", "b"])
        // b's own tab merged in; the focus is the note joined.
        #expect(Self.ids(m) == ["home", joined.id, "c"])
        #expect(m.activeID == joined.id && m.activeRoute == .note("b"))
        // Opening a joined note shows its group with that note in focus.
        m.show(.note("c"))
        m.show(.note("a"))
        #expect(m.activeID == joined.id && m.activeRoute == .note("a"))
        // A third, then no more than three.
        m.join(joined.id, note: "c")
        #expect(m.tabs[1].panes == ["a", "b", "c"])
        m.show(.note("d"))
        #expect(m.join(joined.id, note: "d") == nil)
        #expect(m.tabs.first { $0.isJoined }?.panes == ["a", "b", "c"])
    }

    @Test func unjoinSplitsAtAGapAndKeepsSizes() {
        let m = Self.model(["a", "b", "c"])
        m.select(id: "a")
        m.join("a", note: "b")
        let id = m.tabs[1].id
        m.join(id, note: "c")
        m.setSizes(id, [0.2, 0.3, 0.5])
        m.unjoin(id, gap: 0)
        // a alone, then b and c still joined (their sizes made to add up to 1 again).
        #expect(m.tabs[1].id == "a" && m.tabs[1].panes == nil)
        #expect(m.tabs[2].panes == ["b", "c"])
        let s = m.tabs[2].sizes ?? []
        #expect(abs(s[0] - 0.375) < 1e-9 && abs(s[1] - 0.625) < 1e-9)
        // The focus (c) went with its side.
        #expect(m.activeID == m.tabs[2].id)
        m.unjoinAll(m.tabs[2].id)
        #expect(Self.ids(m) == ["home", "a", "b", "c"])
    }

    @Test func panesMoveAndComeOut() {
        let m = Self.model(["a", "b", "c"])
        m.select(id: "a")
        m.join("a", note: "b")
        let id = m.tabs[1].id
        m.join(id, note: "c")
        m.setSizes(id, [0.2, 0.3, 0.5])
        m.movePane(id, from: 0, to: 2)
        #expect(m.tabs[1].panes == ["b", "c", "a"])
        #expect(m.tabs[1].sizes == [0.3, 0.5, 0.2])
        // Taking out the note with focus (c): it gets its own tab just after; the group shows its first note.
        let shown = m.detachPane(id, note: "c")
        #expect(m.tabs[1].panes == ["b", "a"])
        #expect(m.tabs[2].id == "c")
        #expect(shown == .note("b"))
        // Down to one: the group becomes that note's own tab.
        m.detachPane(id, note: "a")
        #expect(Self.ids(m) == ["home", "b", "a", "c"])
    }

    @Test func pinnedJoinedTabsStayPinned() {
        let m = Self.model(["a", "b"])
        m.setPinned("a", true)
        m.select(id: "a")
        m.join("a", note: "b")
        #expect(m.tabs[1].pinned && m.tabs[1].isJoined)
        m.unjoin(m.tabs[1].id, gap: 0)
        #expect(m.tabs[1].pinned && m.tabs[2].pinned)
    }

    @Test func aLinkInsideAJoinedNoteOpensInItsPlace() {
        let m = Self.model(["a", "b"])
        m.select(id: "a")
        m.join("a", note: "b")
        m.show(.note("a"))
        m.show(.note("z"), .replace)
        #expect(m.tabs[1].panes == ["z", "b"])
        #expect(m.activeRoute == .note("z"))
    }

    @Test func savedJoinedAndPinnedTabsComeBack() throws {
        let m = Self.model(["a", "b", "c"])
        m.select(id: "a")
        m.join("a", note: "b")
        m.setPinned("c", true)
        let data = try JSONEncoder().encode(m.saved)
        let back = TabsModel()
        back.restore(try JSONDecoder().decode(TabsModel.Saved.self, from: data))
        #expect(back.tabs.map(\.id) == m.tabs.map(\.id))
        #expect(back.tabs[1].pinned && back.tabs[2].panes == ["a", "b"])
        // A saved file from before pins and joins still reads.
        let old = #"{"tabs":[{"id":"x","path":"/d/x","title":"X"}],"active":"x"}"#
        back.restore(try JSONDecoder().decode(TabsModel.Saved.self, from: Data(old.utf8)))
        #expect(back.tabs.map(\.id) == ["home", "x"] && !back.tabs[1].pinned)
    }

    @Test func tabsOfEachKindShareTheRoomByTheirBasis() {
        // Home (36), a pinned tab (86), joined notes (460, down to 240) and two tabs (284, down to 172).
        let items: [TabStripMath.Item] = [.fixed(36), .fixed(86), .flex(.joined), .flex(.tab), .flex(.tab)]
        let gap: CGFloat = 6, pad: CGFloat = 8
        let natural = pad + 36 + 86 + 460 + 284 * 2 + gap * 4
        #expect(TabStripMath.sizes(items: items, gap: gap, padding: pad, available: nil).widths == [36, 86, 460, 284, 284])
        // 200 short: shared by basis (460 : 284 : 284).
        let s = TabStripMath.sizes(items: items, gap: gap, padding: pad, available: natural - 200)
        let k = 200 / CGFloat(460 + 284 + 284)
        #expect(abs(s.widths[2] - (460 - 460 * k)) < 0.01 && abs(s.widths[3] - (284 - 284 * k)) < 0.01)
        #expect(abs(s.visible - (natural - 200)) < 0.01 && abs(s.content - s.visible) < 0.01)
        // Far short: every tab at its minimum, then the list scrolls.
        let tight = TabStripMath.sizes(items: items, gap: gap, padding: pad, available: 400)
        #expect(tight.widths == [36, 86, 240, 172, 172])
        #expect(tight.content > tight.visible)
    }
}
#endif
