// "Open in new tab" on a folder (its menu, a middle-click, or a ⌘-click where the list doesn't multi-select): a
// folder tab joins the strip behind the one on screen, a folder already in a tab keeps it, and the strip stays bounded
// without dropping the tab on screen.
#if os(macOS) || os(iOS)
import Testing
@testable import FoleviMac
import FoleviScreens

@MainActor
@Suite("Background tabs")
struct TabBackgroundTests {
    @Test func aFolderOpensBehindTheTabOnScreen() {
        let m = TabsModel()
        _ = m.show(.note("doc_a"))
        let id = m.addInBackground(.folder("fld_x"))
        #expect(id?.hasPrefix(FrameTab.folderPrefix) == true)
        #expect(m.tabs.first { $0.id == id }?.route == .folder("fld_x"))
        #expect(m.activeID == "doc_a")
    }

    @Test func aFolderWithATabKeepsIt() {
        let m = TabsModel()
        _ = m.show(.folder("fld_x"))
        _ = m.show(.note("doc_a"))
        let before = m.tabs.map(\.id)
        #expect(m.addInBackground(.folder("fld_x")) == nil)
        #expect(m.tabs.map(\.id) == before)
        #expect(m.activeID == "doc_a")
    }

    @Test func theStripStaysBoundedAndKeepsTheTabOnScreen() {
        let m = TabsModel()
        _ = m.show(.note("doc_first"))
        for i in 0..<TabsModel.maxTabs { m.addInBackground(.folder("fld_\(i)")) }
        #expect(m.tabs.count - 1 <= TabsModel.maxTabs)
        #expect(m.activeID == "doc_first")
        #expect(m.tabs.contains { $0.id == "doc_first" })
        #expect(m.tabs.contains { $0.route == .folder("fld_\(TabsModel.maxTabs - 1)") })
    }
}
#endif
