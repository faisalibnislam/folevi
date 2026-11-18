// A screen's own controls in the card's glass controls (CardItems.swift; the owner, 2026-11-18): where room runs
// short they fold into one "…" menu, and nothing is lost there: every choice (ticked where chosen), every pull-down's
// entries and every action, each group under its own heading. And a screen hands its items to the frame under its
// own tab key only through the slot ScreenRoot gives it on the Mac's native look.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac

@Suite("Card items") @MainActor
struct CardItemsTests {
    @Test func foldedMenuKeepsEveryFunction() {
        var picked: [String] = []
        let groups: [CardGroup] = [
            .segmented("layout", "View as", [CardOption(id: "grid", title: "Grid", symbol: "square.grid.2x2"), CardOption(id: "list", title: "List", symbol: "list.bullet")], selected: "list") { picked.append("layout:\($0)") },
            .sort([("edited", "Last edited"), ("title", "Title")], value: "title") { picked.append("sort:\($0)") },
            .button("addTask", "Add task", symbol: "plus") { _ in picked.append("add") },
            .actions("step", "Go to", [CardOption(id: "prev", title: "Previous week"), CardOption(id: "today", title: "Today")]) { picked.append("step:\($0)") },
            .more { [WebMenuEntry(.item("Empty Trash…", id: "emptyTrash")) { picked.append("empty") }] },
        ]
        let menu = CardGroupsView.folded(groups, anchor: nil)
        let items = menu.filter { $0.item.kind == .item }
        let titles = items.map(\.item.title)
        #expect(titles.contains("Add task"))
        #expect(titles.contains("Grid") && titles.contains("List"))
        #expect(titles.contains("Last edited") && titles.contains("Title"))
        #expect(titles.contains("Previous week") && titles.contains("Today"))
        #expect(titles.contains("Empty Trash…"))
        // The current choices are ticked; the others aren't.
        #expect(items.first { $0.item.title == "List" }?.item.checked == true)
        #expect(items.first { $0.item.title == "Grid" }?.item.checked == false)
        #expect(items.first { $0.item.title == "Title" }?.item.checked == true)
        // Headings name the groups.
        let headings = menu.filter { $0.item.kind == .heading }.map(\.item.title)
        #expect(headings.contains("View as") && headings.contains("Sort by"))
        // Each runs what the control does.
        for e in items { e.action() }
        #expect(picked == ["add", "layout:grid", "layout:list", "sort:edited", "sort:title", "step:prev", "step:today", "empty"])
    }

    @Test func aCompactSegmentedGroupIsAPullDownOfTheSameChoices() {
        var picked: String?
        let entries = CardGroupsView.choices([CardOption(id: "month", title: "Month"), CardOption(id: "week", title: "Week", count: 3)], selected: "week") { picked = $0 }
        #expect(entries.map(\.item.title) == ["Month", "Week  3"])
        #expect(entries.map(\.item.checked) == [false, true])
        entries[0].action()
        #expect(picked == "month")
    }

    @Test func aScreenHandsItsItemsUnderItsTabKey() async {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let frame = FrameModel(client: demo.client())
        let view = Color.clear
            .cardItems(key: 1) { CardItems(subtitle: "12", trailing: [.more { [] }]) }
            .environment(\.cardSlot, CardSlot(frame: frame, owner: "view:notes"))
            .frame(width: 200, height: 100)
        let host = NSHostingView(rootView: view)
        host.frame = CGRect(x: 0, y: 0, width: 200, height: 100)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        await eventually("items", timeout: .seconds(3)) { frame.cardItems["view:notes"] != nil }
        #expect(frame.cardItems["view:notes"]?.subtitle == "12")
        #expect(frame.cardItems["view:notes"]?.trailing.map(\.id) == ["more"])
    }
}
#endif
