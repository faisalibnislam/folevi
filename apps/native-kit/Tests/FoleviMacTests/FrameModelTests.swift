// The Mac frame's models against the scripted engine (DemoEngine over ScriptedTransport): tabs with the web's
// rules, routes, the sidebar's sections and folder tree, drop rules, the tab strip's layout, and the frame model
// end to end (views, commands, editor commands, events, gates).
#if os(macOS)
import Foundation
import Testing
import FoleviEngine
@testable import FoleviMac

@MainActor
func eventually(_ what: String = "", timeout: Duration = .seconds(3), _ condition: @MainActor () -> Bool) async {
    let clock = ContinuousClock()
    let end = clock.now + timeout
    while clock.now < end {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(5))
    }
    Issue.record("timed out waiting: \(what)")
}

@Suite("Routes")
struct RouteTests {
    @Test func pathsRoundTrip() {
        let routes: [FrameRoute] = [.home, .catchUp, .notes(.all), .notes(.unsorted), .notes(.starred), .notes(.archive), .notes(.trash), .notes(.templates), .folder("f 1"), .tag("t1"), .shared, .changes, .tasks, .calendar, .search("kyoto trip"), .note("doc_1")]
        for r in routes { #expect(FrameRoute(path: r.path) == r, "\(r.path)") }
    }

    @Test func webPaths() {
        #expect(FrameRoute(path: "/") == .home)
        #expect(FrameRoute(path: "/documents") == .home)
        #expect(FrameRoute(path: "/unsorted") == .notes(.unsorted))
        #expect(FrameRoute(path: "/d/abc?x=1") == .note("abc"))
        #expect(FrameRoute(path: "/folders") == .home)
        #expect(FrameRoute(path: "/graph") == .web("/graph"))
    }

    @Test func tabKeysFollowTheWeb() {
        #expect(FrameRoute.note("n1").tabKey == "n1")
        #expect(FrameRoute.folder("f").tabKey == "view:folder:f")
        #expect(FrameRoute.search("a").tabKey == FrameRoute.search("b").tabKey)
        #expect(FrameRoute.home.tabKey == FrameTab.homeID)
    }
}

@Suite("Tabs") @MainActor
struct TabsTests {
    @Test func notesOpenTheirOwnTabsAndSwitchBack() {
        let t = TabsModel()
        t.show(.note("a"))
        t.show(.note("b"))
        #expect(t.tabs.map(\.id) == ["home", "a", "b"])
        t.show(.note("a"))
        #expect(t.activeID == "a")
        #expect(t.tabs.count == 3)
    }

    @Test func aLinkInsideANoteReplacesItsTab() {
        let t = TabsModel()
        t.show(.note("a"))
        t.show(.note("b"), .replace)
        #expect(t.tabs.map(\.id) == ["home", "b"])
        // From Home a link never replaces Home.
        t.select(id: "home")
        t.show(.note("c"), .replace)
        #expect(t.tabs.map(\.id) == ["home", "b", "c"])
    }

    @Test func viewsHaveOneTabEach() {
        let t = TabsModel()
        t.show(.search("one"))
        t.show(.search("two"))
        #expect(t.tabs.count == 2)
        #expect(t.activeRoute == .search("two"))
        t.show(.folder("f1"))
        t.show(.folder("f2"))
        #expect(t.tabs.map(\.id) == ["home", "view:search", "view:folder:f1", "view:folder:f2"])
    }

    @Test func twelveTabsAtMostDroppingTheOldest() {
        let t = TabsModel()
        for i in 1...13 { t.show(.note("n\(i)")) }
        #expect(t.tabs.count == TabsModel.maxTabs + 1)
        #expect(t.tabs.first?.id == "home")
        #expect(!t.tabs.contains { $0.id == "n1" })
        #expect(t.activeID == "n13")
    }

    @Test func closingShowsTheRightNeighbourElseTheLeft() {
        let t = TabsModel()
        for id in ["a", "b", "c"] { t.show(.note(id)) }
        t.select(id: "b")
        #expect(t.close("b") == .note("c"))
        #expect(t.close("c") == .note("a"))
        #expect(t.close("a") == .home)
        #expect(t.close("home") == nil)
        #expect(t.tabs.count == 1)
    }

    @Test func closingABackgroundTabKeepsTheActiveOne() {
        let t = TabsModel()
        for id in ["a", "b"] { t.show(.note(id)) }
        #expect(t.close("a") == nil)
        #expect(t.activeID == "b")
    }

    @Test func closeOthersAndToTheRight() {
        let t = TabsModel()
        for id in ["a", "b", "c", "d"] { t.show(.note(id)) }
        t.select(id: "b")
        t.closeToTheRight(of: "b")
        #expect(t.tabs.map(\.id) == ["home", "a", "b"])
        t.closeOthers("a")
        #expect(t.tabs.map(\.id) == ["home", "a"])
        #expect(t.activeID == "a")
    }

    @Test func reopenClosedNewestFirst() {
        let t = TabsModel()
        for id in ["a", "b"] { t.show(.note(id)) }
        t.close("a")
        t.close("b")
        #expect(t.reopenClosed() == .note("b"))
        #expect(t.reopenClosed() == .note("a"))
        #expect(t.reopenClosed() == nil)
    }

    @Test func reorderKeepsHomeFirst() {
        let t = TabsModel()
        for id in ["a", "b", "c"] { t.show(.note(id)) }
        t.move("c", to: 0)
        #expect(t.tabs.map(\.id) == ["home", "c", "a", "b"])
        t.move("home", to: 3)
        #expect(t.tabs.first?.id == "home")
        t.move("c", to: 99)
        #expect(t.tabs.map(\.id) == ["home", "a", "b", "c"])
    }

    @Test func commandNumbersAndNextPrevious() {
        let t = TabsModel()
        for id in ["a", "b", "c"] { t.show(.note(id)) }
        #expect(t.select(number: 1) == .home)
        #expect(t.select(number: 9) == .note("c"))
        #expect(t.select(number: 3) == .note("b"))
        #expect(t.select(number: 7) == nil)
        t.select(id: "c")
        #expect(t.selectNext() == .home)
        #expect(t.selectNext(-1) == .note("c"))
    }

    @Test func restoreSkipsBadEntries() {
        let t = TabsModel()
        var bad = FrameTab(route: .note("x"))
        bad.id = "not-x"
        t.restore(.init(tabs: [FrameTab(route: .note("a")), bad, FrameTab(route: .note("a")), FrameTab(route: .folder("f"))], active: "view:folder:f"))
        #expect(t.tabs.map(\.id) == ["home", "a", "view:folder:f"])
        #expect(t.activeID == "view:folder:f")
        t.restore(.init(tabs: [], active: "gone"))
        #expect(t.activeID == "home")
    }
}

@Suite("History")
struct HistoryTests {
    @Test func backForwardAndTruncation() {
        var h = RouteHistory()
        h.push(.note("a"))
        h.push(.note("b"))
        #expect(h.back() == .note("a"))
        h.push(.folder("f"))
        #expect(!h.canGoForward)
        #expect(h.back() == .note("a"))
        #expect(h.back() == .home)
        #expect(h.back() == nil)
        h.forget(.note("a"))
        #expect(h.items == [.home, .folder("f")])
    }
}

@Suite("Sidebar") @MainActor
struct SidebarTests {
    @Test func sectionsCountsAndTree() {
        let demo = DemoEngine(now: Date(timeIntervalSince1970: 1_800_000_000))
        let sections = SidebarModel.sections(session: demo.session, home: demo.homeValue, tree: FoldersTreeValue(space: "personal", folders: demo.folders, tags: demo.tags))
        #expect(sections.map(\.id) == [SidebarModel.topHeader, SidebarModel.foldersHeader, SidebarModel.tagsHeader, SidebarModel.moreHeader])
        let top = sections[0].children
        #expect(top.map(\.title) == ["Home", "Catch me up", "All notes", "Drafts", "Shared with me", "Changes", "Starred"])
        #expect(top.first { $0.title == "All notes" }?.count == demo.homeValue.rows.first { $0.id == .notes }?.count)
        let folders = sections[1].children
        #expect(folders.map(\.title) == ["Work", "Trips", "Reading", "Recipes"])
        #expect(folders[0].children.first?.title == "Projects")
        #expect(folders[0].children.first?.children.first?.title == "Launch 1.1")
        #expect(folders[2].sync == .waiting)
        #expect(sections[3].children.map(\.title) == ["Templates", "Archive", "Trash"])
    }

    @Test func capabilitiesHideRows() {
        let demo = DemoEngine()
        var s = demo.session
        s.capabilities = Capabilities(graph: false, sharing: false, changes: false, workspaces: false, ai: false, purchases: false)
        var home = demo.homeValue
        home.catchUp.available = false
        let top = SidebarModel.sections(session: s, home: home, tree: nil)[0].children.map(\.title)
        #expect(top == ["Home", "All notes", "Drafts", "Starred"])
    }

    @Test func orphansShowAtTheTop() {
        let nodes = [FolderNode(id: "a", name: "A", color: nil, parentId: "gone", depth: 1, rank: "a", childCount: 0, noteCount: 1, encrypted: false, sync: .saved)]
        #expect(SidebarModel.folderTree(nodes).map(\.title) == ["A"])
    }

    @Test func selectionIds() {
        #expect(SidebarModel.selectionId(for: .folder("x")) == "folder:x")
        #expect(SidebarModel.selectionId(for: .notes(.unsorted)) == "dest:/drafts")
        #expect(SidebarModel.selectionId(for: .note("n")) == nil)
    }
}

@Suite("Folder drops") @MainActor
struct DropTests {
    let demo = DemoEngine()
    var tree: FolderTree { FolderTree(demo.folders) }

    @Test func neverIntoItselfOrItsChildren() {
        #expect(tree.canMove("fld_work", into: "fld_work") == .selfTarget)
        #expect(tree.canMove("fld_work", into: "fld_launch") == .descendant)
        #expect(tree.canMove("fld_trips", into: "fld_launch") == nil)
        #expect(tree.canMove("fld_launch", into: nil) == nil)
    }

    @Test func fiveLevelsAtMost() {
        var folders = demo.folders
        // Launch 1.1 (depth 2) gets two levels under it: anything with children can't go deeper than allowed.
        folders.append(FolderNode(id: "d3", name: "d3", color: nil, parentId: "fld_launch", depth: 3, rank: "a", childCount: 1, noteCount: 0, encrypted: false, sync: .saved))
        folders.append(FolderNode(id: "d4", name: "d4", color: nil, parentId: "d3", depth: 4, rank: "a", childCount: 0, noteCount: 0, encrypted: false, sync: .saved))
        let t = FolderTree(folders)
        #expect(t.canMove("fld_trips", into: "d4") == .tooDeep)
        #expect(t.canMove("fld_trips", into: "d3") == nil)
    }

    @Test func sidebarDropPlaces() {
        let folderRow = SidebarNode(id: "folder:fld_trips", kind: .folder, title: "Trips", symbol: "folder")
        // On a folder row: inside it, at its end.
        #expect(SidebarDrop.folder("fld_reading", onto: folderRow, parentIsFolders: false, index: -1, tree: tree) == .init(parentId: "fld_trips", afterId: nil))
        // On the Folders header between Work and Trips: top level, after Work.
        #expect(SidebarDrop.folder("fld_recipes", onto: nil, parentIsFolders: true, index: 1, tree: tree) == .init(parentId: nil, afterId: "fld_work"))
        // Its own slot changes nothing.
        #expect(SidebarDrop.folder("fld_trips", onto: nil, parentIsFolders: true, index: 1, tree: tree) == nil)
        // Into its own subfolder: refused.
        let launch = SidebarNode(id: "folder:fld_launch", kind: .folder, title: "Launch", symbol: "folder")
        #expect(SidebarDrop.folder("fld_work", onto: launch, parentIsFolders: false, index: -1, tree: tree) == nil)
    }

    @Test func notesGoIntoFoldersOrDrafts() {
        let folderRow = SidebarNode(id: "folder:f", kind: .folder, title: "F", symbol: "folder")
        #expect(SidebarDrop.notesTarget(folderRow, index: -1) == .init(folderId: "f"))
        #expect(SidebarDrop.notesTarget(SidebarModel.destination(.notes(.unsorted)), index: -1) == .init(folderId: nil))
        #expect(SidebarDrop.notesTarget(SidebarModel.destination(.home), index: -1) == nil)
        #expect(SidebarDrop.notesTarget(folderRow, index: 0) == nil)
    }
}

@Suite("Tab strip layout")
struct StripLayoutTests {
    @Test func fitsAtIdealWidths() {
        var scroll: CGFloat = 0
        let f = TabStripView.layoutFrames(widths: [40, 120, 150], active: 1, available: 800, scroll: &scroll)
        #expect(f.map(\.width) == [40, 120, 150])
        #expect(scroll == 0)
    }

    @Test func activeStaysWholeWhenCrowded() {
        var scroll: CGFloat = 0
        let widths: [CGFloat] = [40] + Array(repeating: 200, count: 12)
        let f = TabStripView.layoutFrames(widths: widths, active: 12, available: 600, scroll: &scroll)
        #expect(f[12].width == 200)
        #expect(f[12].minX >= 0 && f[12].maxX <= 600.5)
        #expect(f[3].width < 200)
    }

    @Test func scrollsOnlyAsMuchAsNeeded() {
        var scroll: CGFloat = 0
        let widths: [CGFloat] = Array(repeating: 200, count: 13)
        let f = TabStripView.layoutFrames(widths: widths, active: 0, available: 300, scroll: &scroll)
        #expect(f[0].minX == 0)
        #expect(scroll == 0)
    }
}

@Suite("Frame model with the scripted engine") @MainActor
struct FrameModelTests {
    func make() async -> (DemoEngine, FrameModel) {
        let demo = DemoEngine()
        let model = FrameModel(client: demo.client())
        model.keepNoteMounted = .milliseconds(50)
        await eventually("ready") { model.isEngineReady && model.home.value != nil && model.folders.value != nil }
        return (demo, model)
    }

    @Test func liveValuesFillTheSidebar() async {
        let (_, model) = await make()
        await eventually("session") { model.session.value != nil && model.sync.value != nil && model.places.value != nil }
        #expect(model.spaceName == "Personal")
        #expect(model.accountName == "Faisal Islam")
        #expect(model.sidebar[1].children.count == 4)
        #expect(model.unreadCount == 3)
        #expect(model.sync.value?.headline == "Synced")
    }

    @Test func openingANoteShowsItInThePageViewAndClosesItLater() async {
        let (demo, model) = await make()
        model.open(.note("doc_kyoto"))
        await eventually("note.show") { demo.editorLog.contains("note.show") }
        await eventually("meta") { model.noteMeta["doc_kyoto"]?.title == "Kyoto in November" }
        #expect(model.tabs.active.title == "Kyoto in November")
        #expect(model.tabs.active.icon == "🗺️")
        model.open(.home)
        await eventually("note.close after the delay") { demo.editorLog.contains("note.close") }
        #expect(demo.shownNote == nil)
    }

    @Test func backAndForward() async {
        let (_, model) = await make()
        model.open(.notes(.all))
        model.open(.folder("fld_trips"))
        model.goBack()
        #expect(model.route == .notes(.all))
        model.goForward()
        #expect(model.route == .folder("fld_trips"))
        await eventually("folder tab named") { model.tabs.active.title == "Trips" }
    }

    @Test func commandsChangeTheLiveViews() async {
        let (demo, model) = await make()
        let before = model.home.value?.starred.rows.count ?? 0
        model.star(["doc_standup"], true)
        await eventually("starred") { (model.home.value?.starred.rows.count ?? 0) == before + 1 }
        model.move(notes: ["doc_standup"], to: nil)
        await eventually("in drafts") { demo.notes.first { $0.id == "doc_standup" }?.folder == nil }
        model.move(folder: "fld_recipes", into: "fld_work", after: nil)
        await eventually("nested") { model.folders.value?.folders.first { $0.id == "fld_recipes" }?.parentId == "fld_work" }
        #expect(demo.commandLog.contains("folder.move"))
    }

    @Test func refusedFolderMovesNeverReachTheEngine() async {
        let (demo, model) = await make()
        model.move(folder: "fld_work", into: "fld_launch", after: nil)
        await eventually("toast") { !model.toasts.isEmpty }
        #expect(!demo.commandLog.contains("folder.move"))
    }

    @Test func newNoteOpensInANewTabInTheFolderOnScreen() async {
        let (demo, model) = await make()
        model.open(.folder("fld_trips"))
        model.newNote()
        await eventually("new tab") { model.route.noteId?.hasPrefix("doc_new") == true }
        let id = model.route.noteId ?? ""
        #expect(demo.notes.first { $0.id == id }?.folder?.id == "fld_trips")
    }

    @Test func trashClosesTheNotesTab() async {
        let (_, model) = await make()
        model.open(.note("doc_ideas"))
        model.trash(["doc_ideas"])
        await eventually("tab closed") { !model.tabs.tabs.contains { $0.id == "doc_ideas" } }
        #expect(model.route == .home)
    }

    @Test func linksInsideANoteReplaceItsTab() async {
        let (demo, model) = await make()
        model.open(.note("doc_kyoto"))
        demo.emit("navigate.request", .object(["route": .string("/d/doc_lisbon"), "noteId": .string("doc_lisbon"), "external": .bool(false), "newTab": .bool(false)]))
        await eventually("replaced") { model.route == .note("doc_lisbon") }
        #expect(!model.tabs.tabs.contains { $0.id == "doc_kyoto" })
        demo.emit("navigate.request", .object(["route": .string("/folders/fld_work"), "noteId": .null, "external": .bool(false), "newTab": .bool(false)]))
        await eventually("folder tab") { model.route == .folder("fld_work") }
        #expect(model.tabs.tabs.contains { $0.id == "doc_lisbon" })
    }

    @Test func toastsCarryTheirButtons() async {
        let (demo, model) = await make()
        demo.emit("toast", .object(["message": .string("Moved to Trash"), "tone": .string("info"), "undo": .null, "action": .object(["id": .string("t1"), "label": .string("Undo")])]))
        await eventually("toast") { model.toasts.first?.actionTitle == "Undo" }
        model.runToastAction(model.toasts[0])
        await eventually("toast.action sent") { demo.commandLog.contains("toast.action") }
        #expect(model.toasts.isEmpty)
    }

    @Test func gatesHideTheFrameUntilTheEngineIsBack() async {
        let (demo, model) = await make()
        demo.emit("gate.changed", DemoEngine.gate("loading"))
        await eventually("gate") { !model.isEngineReady }
        demo.emit("engine.ready", .object(["place": .string(demo.place), "protocol": .number(1), "revision": .number(Double(EngineContract.revision))]))
        demo.emit("gate.changed", DemoEngine.gate(nil))
        await eventually("back") { model.isEngineReady }
    }

    @Test func editorPanelState() async {
        let (demo, model) = await make()
        model.open(.note("doc_kyoto"))
        model.toggleNoteAI()
        await eventually("panel open") { model.editorPanel == .ai }
        model.toggleNoteAI()
        await eventually("panel closed") { model.editorPanel == nil }
        #expect(demo.editorLog.contains("ai") && demo.editorLog.contains("panel.close"))
    }
}
#endif
