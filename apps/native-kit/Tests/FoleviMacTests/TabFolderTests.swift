// Folders open like Finder (the owner, 6 November 2026): a folder shows in a folder tab that navigates instead of
// adding a tab; from Home, a note or another view the folder tab used last is reused (or one opens); a folder already
// in another tab switches to it; background tabs still open; each tab has its own Back and Forward; old saves with one
// tab per folder still restore.
#if os(macOS) || os(iOS)
import Foundation
import Testing
@testable import FoleviMac
import FoleviScreens

@MainActor
@Suite("Folder tabs")
struct TabFolderTests {
    private func folderTabs(_ m: TabsModel) -> [FrameTab] { m.tabs.filter(\.isFolderTab) }

    @Test func theFolderTabOnScreenNavigates() {
        let m = TabsModel()
        m.show(.folder("brainstorming"))
        let tab = m.activeID
        #expect(tab.hasPrefix(FrameTab.folderPrefix))
        m.setTitle("Brainstorming", for: tab)
        m.show(.folder("cherries"))
        #expect(m.tabs.count == 2)
        #expect(m.activeID == tab)
        #expect(m.activeRoute == .folder("cherries"))
        // Its title follows (the engine names it again; until then the route's).
        #expect(m.active.title == "Folder")
        // The Folders page is folder browsing too.
        m.show(.web("/folders"))
        #expect(m.tabs.count == 2)
        #expect(m.activeRoute == .web("/folders"))
        m.show(.folder("plums"))
        #expect(m.tabs.count == 2)
        #expect(m.activeID == tab)
    }

    @Test func fromHomeTheLastFolderTabIsReusedOrOneOpens() {
        let m = TabsModel()
        m.show(.folder("a"))
        let tab = m.activeID
        m.select(id: FrameTab.homeID)
        m.show(.folder("b"))
        #expect(m.activeID == tab)
        #expect(m.activeRoute == .folder("b"))
        #expect(m.tabs.count == 2)
        // Home itself is never replaced, and with no folder tab one opens.
        let fresh = TabsModel()
        fresh.show(.folder("x"))
        #expect(fresh.tabs.count == 2)
        #expect(fresh.tabs[0].route == .home)
        #expect(fresh.active.isFolderTab)
    }

    @Test func fromANoteOrAViewTheFolderTabUsedLastIsReused() {
        let m = TabsModel()
        m.show(.folder("a"))
        let first = m.activeID
        let second = m.addInBackground(.folder("b"))!
        m.select(id: second)
        m.show(.note("n"))
        m.select(id: first)
        m.show(.tasks(.today))
        // The first folder tab was on screen last: it goes to the folder; the note and Tasks keep their tabs.
        m.show(.folder("c"))
        #expect(m.activeID == first)
        #expect(m.activeRoute == .folder("c"))
        #expect(m.tabs.contains { $0.id == "n" })
        #expect(m.tabs.contains { $0.route == .tasks(.today) })
        #expect(m.tabs.first { $0.id == second }?.route == .folder("b"))
        // From the note, the same.
        m.select(id: "n")
        m.show(.folder("d"))
        #expect(m.activeID == first)
        #expect(m.tabs.first { $0.id == "n" }?.route == .note("n"))
        #expect(folderTabs(m).count == 2)
    }

    @Test func aFolderOpenElsewhereSwitchesToItsTab() {
        let m = TabsModel()
        m.show(.folder("a"))
        let first = m.activeID
        let second = m.addInBackground(.folder("b"))!
        // The folder tab on screen (showing a) stays as it was; b's tab comes forward.
        m.show(.folder("b"))
        #expect(m.activeID == second)
        #expect(m.tabs.first { $0.id == first }?.route == .folder("a"))
        #expect(folderTabs(m).count == 2)
        // From Home too.
        m.select(id: FrameTab.homeID)
        m.show(.folder("a"))
        #expect(m.activeID == first)
        #expect(m.tabs.first { $0.id == second }?.route == .folder("b"))
    }

    @Test func otherViewsAndNotesKeepTheirOwnTabs() {
        let m = TabsModel()
        m.show(.folder("a"))
        m.show(.tasks(.today))
        m.show(.notes(.unsorted))
        m.show(.note("n"))
        #expect(m.tabs.count == 5)
        m.show(.tag("t"))
        #expect(m.tabs.count == 6)
    }

    @Test func backgroundTabsStillOpenAndKeepTheirFolder() {
        let m = TabsModel()
        m.show(.folder("a"))
        let tab = m.activeID
        let bg = m.addInBackground(.folder("b"))
        #expect(bg != nil)
        #expect(m.activeID == tab)
        // A folder already in a tab keeps it.
        #expect(m.addInBackground(.folder("a")) == nil)
        // Navigating the folder tab on screen elsewhere leaves the background tab alone; keys stay unique.
        m.show(.folder("c"))
        #expect(m.activeID == tab)
        #expect(m.tabs.first { $0.id == bg }?.route == .folder("b"))
        #expect(Set(m.tabs.map(\.id)).count == m.tabs.count)
        // The folder that left the tab on screen can open in the background again.
        #expect(m.addInBackground(.folder("a")) != nil)
    }

    @Test func eachTabHasItsOwnBackAndForward() {
        let m = TabsModel()
        m.show(.folder("brainstorming"))
        let tab = m.activeID
        m.show(.folder("space-cherries"))
        m.show(.note("n"))
        // A note's tab starts its own history.
        #expect(!m.active.history.canGoBack)
        m.select(id: tab)
        #expect(m.goBack() == .folder("brainstorming"))
        #expect(m.activeID == tab)
        #expect(m.goBack() == nil)
        #expect(m.goForward() == .folder("space-cherries"))
        #expect(m.activeID == tab)
        // A new folder after Back drops what was ahead.
        m.goBack()
        m.show(.folder("plums"))
        #expect(m.goForward() == nil)
        #expect(m.active.history.items == [.folder("brainstorming"), .folder("plums")])
    }

    @Test func backInANoteTabGoesToTheNoteALinkReplaced() {
        let m = TabsModel()
        m.show(.note("a"))
        m.show(.note("b"), .replace)
        #expect(m.tabs.map(\.id) == ["home", "b"])
        #expect(m.goBack() == .note("a"))
        #expect(m.tabs.map(\.id) == ["home", "a"])
        #expect(m.goForward() == .note("b"))
        #expect(m.tabs.map(\.id) == ["home", "b"])
    }

    @Test func backToAPageInAnotherTabSwitchesToIt() {
        let m = TabsModel()
        m.show(.folder("a"))
        let tab = m.activeID
        m.show(.folder("b"))
        let other = m.addInBackground(.folder("a"))!
        #expect(m.goBack() == .folder("a"))
        #expect(m.activeID == other)
        #expect(m.tabs.first { $0.id == tab }?.route == .folder("b"))
    }

    @Test func closingDropsTheHistoryAndReopeningBringsItBack() {
        let m = TabsModel()
        m.show(.folder("a"))
        m.show(.folder("b"))
        let tab = m.activeID
        m.close(tab)
        #expect(!m.active.history.canGoBack)
        m.reopenClosed()
        #expect(m.activeID == tab)
        #expect(m.goBack() == .folder("a"))
    }

    @Test func oldSavesWithOneTabPerFolderRestore() throws {
        let old = #"{"tabs":[{"id":"a","path":"/d/a","title":"A"},{"id":"view:folder:f1","path":"/folders/f1","title":"Trips"},{"id":"view:web:/folders","path":"/folders","title":"Folders"},{"id":"view:folder:f2","path":"/folders/f2","title":"Work","pinned":true}],"active":"view:folder:f1"}"#
        let m = TabsModel()
        m.restore(try JSONDecoder().decode(TabsModel.Saved.self, from: Data(old.utf8)))
        #expect(m.tabs.map(\.route) == [.home, .folder("f2"), .note("a"), .folder("f1"), .web("/folders")])
        #expect(m.tabs.filter(\.isFolderTab).count == 3)
        #expect(m.activeRoute == .folder("f1"))
        #expect(m.active.isFolderTab)
        #expect(m.active.title == "Trips")
        // They navigate like any folder tab.
        let tab = m.activeID
        m.show(.folder("f3"))
        #expect(m.activeID == tab)
        // A save of today's folder tabs comes back with the same ids; a folder twice is kept once.
        let again = TabsModel()
        var saved = m.saved
        saved.tabs.append(FrameTab(route: .folder("f2")))
        again.restore(saved)
        #expect(again.tabs.map(\.id) == m.tabs.map(\.id))
        #expect(again.activeID == tab)
    }
}
#endif
