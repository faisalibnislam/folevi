// Back always goes somewhere when it should (the owner, 21 November 2026): a tab opened from a page (Home's See all
// and cards, a folder card, a note from a list, a link) remembers the tab it came from, and Back with nothing left
// in it closes it and shows that tab again, as Safari does. The sidebar and "+" open fresh tabs with no way back.
#if os(macOS) || os(iOS)
import Foundation
import Testing
@testable import FoleviMac
import FoleviScreens

@MainActor
@Suite("Back to the tab you came from")
struct TabBackTests {
    @Test func seeAllFromHomeGoesBackToHomeAndCloses() {
        let m = TabsModel()
        #expect(!m.canGoBack)
        m.show(.notes(.all))
        let all = m.activeID
        #expect(m.canGoBack)
        #expect(m.goBack() == .home)
        #expect(m.activeID == FrameTab.homeID)
        #expect(!m.tabs.contains { $0.id == all })
        // It went to the closed tabs, so ⇧⌘T still brings it back.
        #expect(m.closed.last?.id == all)
    }

    @Test func theTabsOwnHistoryComesFirst() {
        let m = TabsModel()
        m.show(.note("a"))
        m.show(.note("b"), .replace)
        #expect(m.goBack() == .note("a"))
        #expect(m.tabs.count == 2)
        // Then, with nothing left in it, the tab it came from.
        #expect(m.goBack() == .home)
        #expect(m.tabs.count == 1)
    }

    @Test func aFolderOpenedFromHomeGoesBackToHome() {
        let m = TabsModel()
        m.show(.folder("plums"))
        #expect(m.activeID.hasPrefix(FrameTab.folderPrefix))
        #expect(m.goBack() == .home)
        #expect(m.activeID == FrameTab.homeID)
    }

    @Test func aNoteFromAListGoesBackToTheList() {
        let m = TabsModel()
        m.show(.notes(.all))
        let list = m.activeID
        m.show(.note("a"))
        #expect(m.goBack() == .notes(.all))
        #expect(m.activeID == list)
    }

    @Test func theSidebarAndPlusOpenFreshTabs() {
        let m = TabsModel()
        m.show(.notes(.all), fromPage: false)
        #expect(!m.canGoBack)
        #expect(m.goBack() == nil)
        #expect(m.tabs.count == 2)
    }

    @Test func noWayBackOnceTheOpenerIsClosed() {
        let m = TabsModel()
        m.show(.notes(.all))
        let list = m.activeID
        m.show(.note("a"))
        m.close(list)
        #expect(!m.canGoBack)
        #expect(m.goBack() == nil)
    }

    @Test func aBackgroundTabFromAPageRemembersItsOpener() {
        let m = TabsModel()
        let id = m.addInBackground(.folder("plums"))
        #expect(id != nil)
        #expect(m.select(id: id!) != nil)
        #expect(m.goBack() == .home)
        // From the sidebar (a ⌘-click): no way back.
        let fresh = m.addInBackground(.folder("pears"), fromPage: false)
        #expect(m.select(id: fresh!) != nil)
        #expect(!m.canGoBack)
    }

    @Test func aLinkReplacingTheNoteKeepsTheOpener() {
        let m = TabsModel()
        m.show(.notes(.all))
        m.show(.note("a"))
        m.show(.note("b"), .replace)
        #expect(m.goBack() == .note("a"))
        #expect(m.goBack() == .notes(.all))
    }
}
#endif
