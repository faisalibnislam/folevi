import Testing
import FoleviEngine
@testable import FoleviMac

@Suite("Sidebar folder sort")
struct SidebarFolderSortTests {
    private func f(_ id: String, _ name: String, parent: String? = nil) -> FolderNode {
        FolderNode(id: id, name: name, color: nil, parentId: parent, depth: parent == nil ? 0 : 1, rank: "a", childCount: 0, noteCount: 0, encrypted: false, sync: .saved)
    }

    private var manual: [FolderNode] { [f("a", "Zebra"), f("b", "apple"), f("c", "Mango"), f("b1", "Kiwi", parent: "b"), f("b2", "Fig", parent: "b")] }

    @Test func manualKeepsTheFoldersOwnOrder() {
        #expect(SidebarFolderSort.sorted(manual, by: .manual).map(\.id) == ["a", "b", "c", "b1", "b2"])
    }

    @Test func nameSortsAToZIgnoringCase() {
        #expect(SidebarFolderSort.sorted(manual, by: .name).map(\.id) == ["b", "b2", "b1", "c", "a"])
    }

    @Test func recentPutsTheLastChangedFirst() {
        let order = SidebarFolderSort.sorted(manual, by: .recent, changed: ["c": 300, "a": 100]).map(\.id)
        #expect(order == ["c", "a", "b", "b1", "b2"])
    }
}
