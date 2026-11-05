import Testing
import FoleviEngine
import FoleviScreens
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

    // MARK: the sidebar's own order

    @Test func noOrderSavedIsRankOrder() {
        #expect(SidebarFolderSort.applying(nil, to: manual).map(\.id) == ["a", "b", "c", "b1", "b2"])
        #expect(SidebarFolderSort.applying([], to: manual).map(\.id) == ["a", "b", "c", "b1", "b2"])
    }

    @Test func eachLevelFollowsTheOrderAndUnnamedOnesComeLast() {
        let order = SidebarFolderSort.applying(["c", "gone", "b", "b2", "b1"], to: manual).map(\.id)
        #expect(order == ["c", "b", "b2", "b1", "a"])
    }

    @Test func aMoveGivesEveryIdDepthFirst() {
        #expect(SidebarFolderSort.orderAfterMove(manual, id: "c", parentId: nil, afterId: nil) == ["c", "a", "b", "b1", "b2"])
        #expect(SidebarFolderSort.orderAfterMove(manual, id: "b2", parentId: "b", afterId: nil) == ["a", "b", "b2", "b1", "c"])
        #expect(SidebarFolderSort.orderAfterMove(manual, id: "a", parentId: "b", afterId: "b1") == ["b", "b1", "a", "b2", "c"])
    }

    private func plan(order: [String]? = nil, sort: SidebarFolderSort = .manual, id: String, target: String?, zone: FolderRules.Zone) -> SidebarFolderSort.DropPlan? {
        let shown = SidebarFolderSort.sorted(SidebarFolderSort.applying(order, to: manual), by: sort)
        guard case .move(let place, _) = SidebarFolderSort.resolveDrop(shown, dragged: id, target: target, zone: zone, targetOpen: false) else { return nil }
        return SidebarFolderSort.planDrop(rank: manual, order: order, shown: shown, sort: sort, id: id, place: place, nest: target == nil || zone == .inside)
    }

    @Test func betweenRowsOfItsLevelChangesOnlyTheSidebarOrder() {
        let p = plan(id: "c", target: "a", zone: .before)
        #expect(p == SidebarFolderSort.DropPlan(order: ["c", "a", "b", "b1", "b2"], move: nil, adopt: false))
    }

    @Test func ontoAFolderNestsForRealLastByRank() {
        #expect(plan(id: "c", target: "b", zone: .inside) == SidebarFolderSort.DropPlan(order: nil, move: FolderRules.Place(parentId: "b", afterId: "b2"), adopt: false))
        let saved = plan(order: ["b", "b2", "b1", "a", "c"], id: "c", target: "b", zone: .inside)
        #expect(saved == SidebarFolderSort.DropPlan(order: ["b", "b2", "b1", "c", "a"], move: FolderRules.Place(parentId: "b", afterId: "b2"), adopt: false))
    }

    @Test func betweenRowsOfAnotherLevelMovesThereAndTakesThatSpot() {
        let p = plan(id: "a", target: "b1", zone: .after)
        #expect(p == SidebarFolderSort.DropPlan(order: ["b", "b1", "a", "b2", "c"], move: FolderRules.Place(parentId: "b", afterId: "b2"), adopt: false))
    }

    @Test func sortedByNameTheShownOrderBecomesTheSidebars() {
        let p = plan(sort: .name, id: "a", target: "b", zone: .before)
        #expect(p == SidebarFolderSort.DropPlan(order: ["a", "b", "b2", "b1", "c"], move: nil, adopt: true))
    }
}
