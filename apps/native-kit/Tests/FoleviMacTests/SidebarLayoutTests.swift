// The sidebar's More section and Customize sidebar (the owner, 2026-11-27): the layout rules (the same cases as the
// web's apps/web/test/sidebar-layout.test.ts), the saved layout read and written through the engine, and the Mac
// sidebar and Customize sidebar drawn offscreen, light and dark (written at 2x to FOLEVI_SIDEBAR_OUT when set, for a
// person to look at), with what VoiceOver reads in them.
#if os(macOS)
import AppKit
import Foundation
import SwiftUI
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac
import FoleviScreens

@Suite("Sidebar layout")
struct SidebarLayoutRulesTests {
    private func ids(_ s: [SidebarSlot]) -> [String] { s.map(\.id.rawValue) }
    private func more(_ s: [SidebarSlot]) -> [String] { s.filter(\.more).map(\.id.rawValue) }

    @Test func theDefault() {
        let d = SidebarLayout.defaults
        #expect(ids(d) == ["home", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "calendar", "reviews", "shared", "vault", "changes", "templates"])
        #expect(more(d) == ["shared", "changes", "templates"])
        #expect(SidebarLayout.resolve(nil) == d)
    }

    @Test func savedAndReadBack() {
        let mine = SidebarLayout.move(SidebarLayout.place(SidebarLayout.defaults, .calendar, at: .ai, after: false), .tasks, more: true)
        let back = SidebarLayout.resolve(SidebarLayout.save(mine))
        #expect(back == mine)
        #expect(ids(back).prefix(2) == ["home", "calendar"])
        // As JSON (what the engine hands over), and null or something else: the default.
        #expect(SidebarLayout.Saved(json: SidebarLayout.save(mine).json) == SidebarLayout.save(mine))
        #expect(SidebarLayout.Saved(json: .null) == nil)
        #expect(SidebarLayout.Saved(json: .object(["order": .string("x")])) == nil)
    }

    @Test func anItemAddedLaterGoesToItsDefaultPlace() {
        // Saved before Reviews and Templates existed, with Calendar moved to the top and Shared with Me on the sidebar.
        let saved = SidebarLayout.Saved(order: ["home", "calendar", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "shared", "vault", "changes"], more: ["changes"])
        let slots = SidebarLayout.resolve(saved)
        #expect(ids(slots) == ["home", "calendar", "ai", "dna", "bookmarks", "drafts", "notes", "tasks", "reviews", "shared", "vault", "changes", "templates"])
        #expect(more(slots) == ["changes", "templates"])
    }

    @Test func unknownIdsAreLeftOutAndDuplicatesKeepTheirFirstPlace() {
        let slots = SidebarLayout.resolve(SidebarLayout.Saved(order: ["tasks", "gone", "home", "tasks"], more: ["gone", "tasks"]))
        #expect(ids(slots).firstIndex(of: "tasks")! < ids(slots).firstIndex(of: "home")!)
        #expect(!ids(slots).contains("gone"))
        #expect(Set(ids(slots)).count == SidebarItemID.allCases.count)
        #expect(slots.first { $0.id == .tasks }?.more == true)
    }

    @Test func homeAndDraftsStayOnTheSidebar() {
        let d = SidebarLayout.defaults
        #expect(SidebarLayout.move(d, .home, more: true) == d)
        #expect(SidebarLayout.move(d, .drafts, more: true) == d)
        let forced = SidebarLayout.resolve(SidebarLayout.Saved(order: ["home", "drafts"], more: ["home", "drafts"]))
        #expect(!more(forced).contains("home"))
        #expect(!more(forced).contains("drafts"))
    }

    @Test func movingToMoreAndBack() {
        let d = SidebarLayout.defaults
        let moved = SidebarLayout.move(d, .calendar, more: true)
        #expect(ids(moved) == ids(d))
        #expect(more(moved) == ["calendar", "shared", "changes", "templates"])
        #expect(SidebarLayout.move(moved, .calendar, more: false) == d)
    }

    @Test func placing() {
        let d = SidebarLayout.defaults
        #expect(ids(SidebarLayout.place(d, .templates, at: .home, after: false)).prefix(2) == ["templates", "home"])
        #expect(SidebarLayout.place(d, .home, at: .home, after: true) == d)
    }

    @Test func moveUpAndDownStepOverItemsNotShownHere() {
        let d = SidebarLayout.defaults
        // Foli AI and Foli DNA are off here: Bookmarks moving up steps over them and lands before Home.
        let shown = SidebarItemID.allCases.filter { $0 != .ai && $0 != .dna }
        let up = SidebarLayout.step(d, .bookmarks, by: -1, shown: shown)
        #expect(up.map(\.id).filter(shown.contains).prefix(2) == [.bookmarks, .home])
        #expect(SidebarLayout.step(d, .home, by: -1, shown: shown) == d)
        #expect(SidebarLayout.step(d, .templates, by: 1, shown: shown) == d)
    }

    @Test func aDragReordersOnlyTheShownItems() {
        let d = SidebarLayout.defaults
        // Foli AI isn't shown: the drag moves Calendar to the top of what is, and Foli AI keeps its second place.
        var shown = SidebarItemID.allCases.filter { $0 != .ai }
        shown.move(fromOffsets: [shown.firstIndex(of: .calendar)!], toOffset: 0)
        let next = SidebarLayout.reorder(d, shown: shown)
        #expect(ids(next).prefix(3) == ["calendar", "ai", "home"])
        #expect(more(next) == more(d))
    }

    @Test func theDefaultSavesAsEveryItem() {
        let saved = SidebarLayout.save(SidebarLayout.defaults)
        #expect(saved.order == SidebarItemID.allCases.map(\.rawValue))
        #expect(saved.more == ["shared", "changes", "templates"])
    }
}

@Suite("Sidebar layout on the Mac", .serialized) @MainActor
struct SidebarLayoutMacTests {
    static let out = ProcessInfo.processInfo.environment["FOLEVI_SIDEBAR_OUT"]
    static let moreKey = "folevi.sidebar.more-open"

    @Test func aChangeShowsAtOnceAndIsSaved() async {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let frame = FrameModel(client: demo.client())
        let store = frame.sidebarLayout
        await eventually("layout read") { frame.session.value != nil }
        #expect(store.slots == SidebarLayout.defaults)
        store.save(SidebarLayout.move(store.slots, .tasks, more: true))
        // At once, before the engine has it.
        #expect(store.slots.first { $0.id == .tasks }?.more == true)
        await eventually("saved", timeout: .seconds(5)) { SidebarLayout.Saved(json: demo.sidebarLayout)?.more.contains("tasks") == true }
        await eventually("read back") { store.saved?.more.contains("tasks") == true }
        #expect(demo.commandLog.contains("settings.run"))
        // A Mac starting with a layout saved elsewhere (the web's, say) shows it.
        let elsewhere = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        elsewhere.sidebarLayout = SidebarLayout.Saved(order: ["calendar", "home"], more: ["calendar", "home"]).json
        let next = FrameModel(client: elsewhere.client())
        await eventually("saved elsewhere") { next.sidebarLayout.saved != nil }
        let order = next.sidebarLayout.slots.map(\.id)
        #expect(order.firstIndex(of: .calendar)! < order.firstIndex(of: .home)!)
        #expect(next.sidebarLayout.slots.first { $0.id == .calendar }?.more == true)
        #expect(next.sidebarLayout.slots.first { $0.id == .home }?.more == false)
        // Reset to default: null, the default layout.
        store.save(nil)
        await eventually("reset", timeout: .seconds(5)) { demo.sidebarLayout == .null }
        await eventually("default again") { store.saved == nil && store.slots == SidebarLayout.defaults }
    }

    @Test func theItemMenus() {
        let frame = FrameModel(client: DemoEngine().client())
        let titles = { (id: SidebarItemID) in SidebarCustomize.menu(frame, id).filter { $0.item.kind == .item }.map(\.item.title) }
        #expect(titles(.tasks) == ["Move to More", "Customize sidebar…"])
        #expect(titles(.templates) == ["Move to sidebar", "Customize sidebar…"])
        #expect(titles(.home) == ["Always on the sidebar", "Customize sidebar…"])
        #expect(SidebarCustomize.menu(frame, .drafts).first?.disabled == true)
        // Move to More saves the move.
        SidebarCustomize.menu(frame, .calendar).first?.action()
        #expect(frame.sidebarLayout.slots.first { $0.id == .calendar }?.more == true)
    }

    @Test func itemsShowOnlyWhereTheyreAvailable() async {
        let frame = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        await eventually("session") { frame.session.value != nil && frame.home.value != nil }
        let caps = frame.session.value?.capabilities
        #expect(SidebarItemID.home.available(in: frame))
        #expect(SidebarItemID.drafts.available(in: frame))
        #expect(SidebarItemID.ai.available(in: frame) == (caps?.ai ?? false))
        #expect(SidebarItemID.changes.available(in: frame) == (caps?.changes ?? false))
        // Reviews while it's open, even with nothing due.
        frame.open(.web("/review"), .replace)
        #expect(SidebarItemID.reviews.available(in: frame))
    }

    // MARK: drawn

    @Test func moreOpensForThePageYoureOn() {
        let all: (SidebarItemID) -> Bool = { _ in true }
        let closed = SidebarSections(slots: SidebarLayout.defaults, available: all, selected: { $0 == .home }, toggled: false)
        #expect(closed.onSidebar == [.home, .ai, .dna, .bookmarks, .drafts, .notes, .tasks, .calendar, .reviews, .vault])
        #expect(closed.underMore == [.shared, .changes, .templates])
        #expect(!closed.moreOpen)
        // On Templates, More opens by itself.
        let here = SidebarSections(slots: SidebarLayout.defaults, available: all, selected: { $0 == .templates }, toggled: false)
        #expect(here.activeInMore && here.moreOpen)
        // Items not here are left out of both.
        let some = SidebarSections(slots: SidebarLayout.defaults, available: { $0 != .ai && $0 != .changes }, selected: { _ in false }, toggled: true)
        #expect(!some.onSidebar.contains(.ai) && !some.underMore.contains(.changes))
        #expect(some.moreOpen)
    }

    @Test func theSidebarDrawn() async throws {
        UserDefaults.standard.removeObject(forKey: Self.moreKey)
        defer { UserDefaults.standard.removeObject(forKey: Self.moreKey) }
        let frame = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        let tasks: ValueStore<TaskCounts> = frame.client.watch(.tasksCounts(), snapshotKey: "tasks.counts")
        await eventually("ready", timeout: .seconds(8)) { frame.folders.value != nil && frame.home.value != nil && frame.session.value != nil }
        let sidebar = { WebSidebar(model: frame, tasks: tasks, actions: WebSidebarActions()) }

        // More starts closed, with Shared with Me, Changes and Templates under it.
        var sections = sidebar().macSections()
        #expect(!sections.moreOpen)
        #expect(sections.underMore == [.shared, .changes, .templates].filter { $0.available(in: frame) })
        #expect(sections.onSidebar.first == .home)
        let closed = await draw("sidebar-more-closed", size: CGSize(width: 280, height: 900)) { _ in sidebar() }

        // Opened, as last left.
        UserDefaults.standard.set(true, forKey: Self.moreKey)
        #expect(sidebar().macSections().moreOpen)
        let open = await draw("sidebar-more-open", size: CGSize(width: 280, height: 900)) { _ in sidebar() }
        #expect(closed != nil && open != nil && closed != open, "More open and closed draw differently")

        // Closed, with the page you're on under More: it opens by itself, and stays open after.
        UserDefaults.standard.set(false, forKey: Self.moreKey)
        frame.open(.notes(.templates), .replace)
        sections = sidebar().macSections()
        #expect(sections.activeInMore && sections.moreOpen)
        _ = await draw("sidebar-more-current", size: CGSize(width: 280, height: 900)) { _ in sidebar() }
        #expect(UserDefaults.standard.bool(forKey: Self.moreKey))

        // A person's own layout: Calendar under More, Templates on the sidebar right after Home.
        frame.open(.home, .replace)
        UserDefaults.standard.set(false, forKey: Self.moreKey)
        let store = frame.sidebarLayout
        store.save(SidebarLayout.place(SidebarLayout.move(SidebarLayout.move(store.slots, .calendar, more: true), .templates, more: false), .templates, at: .home, after: true))
        sections = sidebar().macSections()
        #expect(sections.onSidebar.prefix(2) == [.home, .templates])
        #expect(sections.underMore.first == .calendar)
        _ = await draw("sidebar-own-layout", size: CGSize(width: 280, height: 900)) { _ in sidebar() }
    }

    @Test func customizeSidebarDrawn() async throws {
        let frame = FrameModel(client: DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000)).client())
        await eventually("ready", timeout: .seconds(8)) { frame.session.value != nil && frame.home.value != nil }
        // Only the items this person has here, in their order.
        let items = SidebarCustomizeSheet.items(frame)
        #expect(items.map(\.id) == SidebarLayout.defaults.map(\.id).filter { $0.available(in: frame) })
        #expect(SidebarCustomizeRow.place(SidebarSlot(.home, more: false)) == "Always on the sidebar")
        #expect(SidebarCustomizeRow.place(SidebarSlot(.templates, more: true)) == "Under More")
        #expect(SidebarCustomizeRow.place(SidebarSlot(.tasks, more: false)) == "On the sidebar")
        let image = await draw("customize-sidebar", size: CGSize(width: 420, height: 520)) { _ in SidebarCustomizeSheet(model: frame, close: {}) }
        #expect(image != nil)
    }

    /// Draws `view` in an offscreen window (never shown on screen, never taking the keyboard), light and dark, and
    /// returns the light picture's PNG.
    @discardableResult
    private func draw<V: View>(_ name: String, size: CGSize, _ view: (ColorScheme) -> V) async -> Data? {
        _ = FoleviFonts.register()
        var light: Data?
        for scheme in [ColorScheme.light, .dark] {
            let root = view(scheme)
                .frame(width: size.width, height: size.height)
                .background(scheme == .dark ? Color.black : Color.white)
                .environment(\.colorScheme, scheme)
            let host = NSHostingView(rootView: root)
            host.frame = CGRect(origin: .zero, size: size)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            window.contentView = host
            window.setFrameOrigin(CGPoint(x: -20000, y: -20000))
            window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                try? await Task.sleep(for: .milliseconds(120))
            }
            let image = DnaSnapshotTests.image(host, scale: 2)
            #expect(image != nil, "\(name): couldn't draw")
            if let out = Self.out, let image, let data = DnaSnapshotTests.png(image) {
                let d = URL(fileURLWithPath: out)
                try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
                try? data.write(to: d.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
            if scheme == .light, let image { light = DnaSnapshotTests.png(image) }
        }
        return light
    }

}
#endif
