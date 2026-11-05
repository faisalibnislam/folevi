import Testing
import Foundation
@testable import FoleviScreens
import FoleviEngine

@Suite("The Folders page's order")
struct FolderOrderTests {
    @Test func savedSortsMapToTheNewOnes() {
        #expect(FoldersSort(saved: "name") == .name)
        #expect(FoldersSort(saved: "updated") == .recent)
        #expect(FoldersSort(saved: "recent") == .recent)
        #expect(FoldersSort(saved: "manual") == .manual)
        #expect(FoldersSort(saved: "count") == .manual)
        #expect(FoldersSort(saved: "created") == .manual)
        #expect(FoldersSort(saved: nil) == .manual)
        #expect(FoldersSort.options.map(\.1) == ["Manual", "Name", "Recent"])
    }

    struct F { var id: String; var name: String; var at: Double }

    @Test func sorts() {
        let folders = [F(id: "a", name: "beta", at: 10), F(id: "b", name: "Alpha", at: 30), F(id: "c", name: "gamma", at: 20), F(id: "d", name: "delta", at: 30)]
        let ids = { (s: FoldersSort) in FolderOrder.sorted(folders, by: s, name: \.name, updatedAt: \.at).map(\.id) }
        #expect(ids(.manual) == ["a", "b", "c", "d"])
        #expect(ids(.name) == ["b", "a", "d", "c"])
        #expect(ids(.recent) == ["b", "d", "c", "a"], "the last changed first; a tie keeps the manual order")
    }

    @Test func reorderedPutsTheFolderInTheGap() {
        let ids = ["a", "b", "c", "d"]
        #expect(FolderOrder.reordered(ids, moving: "a", toGap: 2) == ["b", "c", "a", "d"])
        #expect(FolderOrder.reordered(ids, moving: "d", toGap: 0) == ["d", "a", "b", "c"])
        #expect(FolderOrder.reordered(ids, moving: "x", toGap: 1) == ["a", "x", "b", "c", "d"])
        #expect(FolderOrder.reordered(ids, moving: "b", toGap: 99) == ["a", "c", "d", "b"])
        #expect(!FolderOrder.changes(ids, moving: "b", toGap: 1))
        #expect(FolderOrder.changes(ids, moving: "b", toGap: 2))
    }

    @Test func aCardsZoneIsAGap() {
        let ids = ["a", "b", "c", "d"]
        #expect(FolderOrder.gap(ids, moving: "a", at: "c", zone: .before) == 1)
        #expect(FolderOrder.gap(ids, moving: "a", at: "c", zone: .after) == 2)
        #expect(FolderOrder.gap(ids, moving: "d", at: "a", zone: .before) == 0)
        #expect(FolderOrder.gap(ids, moving: "a", at: "c", zone: .inside) == nil)
        #expect(FolderOrder.gap(ids, moving: "a", at: "a", zone: .before) == nil)
    }

    @Test(arguments: [
        (["a", "b", "c", "d"], ["a", "b", "c", "d"]),
        (["a", "b", "c", "d"], ["b", "c", "a", "d"]),
        (["a", "b", "c", "d"], ["d", "c", "b", "a"]),
        (["a", "b", "c", "d", "e"], ["c", "a", "e", "b", "d"]),
    ])
    func movesTurnOneOrderIntoTheOther(current: [String], target: [String]) {
        #expect(FolderOrder.apply(FolderOrder.moves(from: current, to: target), to: current) == target)
    }

    @Test func fewestMoves() {
        #expect(FolderOrder.moves(from: ["a", "b", "c"], to: ["a", "b", "c"]).isEmpty)
        #expect(FolderOrder.moves(from: ["a", "b", "c", "d"], to: ["b", "c", "a", "d"]) == [.init(id: "a", afterId: "c")])
        #expect(FolderOrder.moves(from: ["a", "b", "c", "d"], to: ["d", "a", "b", "c"]) == [.init(id: "d", afterId: nil)])
        #expect(FolderOrder.moves(from: ["a", "b"], to: ["a", "x", "b"]) == [.init(id: "x", afterId: "a")])
        #expect(FolderOrder.moves(from: ["a", "b", "c"], to: ["c", "b", "a"]).count == 2)
    }

    @Test @MainActor func dropInNameOrderSwitchesToManualAndKeepsTheOrderOnScreen() async {
        let engine = FakeEngine()
        engine.onCommand = { _, _ in .object(["ok": .bool(true)]) }
        let log = FeedbackLog()
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        var sort = FoldersSort.name
        // Manual a, b, c, d; on screen by name d, c, b, a; c dragged to the front.
        await FolderOrder.drop("c", name: "C", gap: 0, shown: ["d", "c", "b", "a"], manual: ["a", "b", "c", "d"], links: ["a", "b", "c", "d"].map { FolderRules.Link(id: $0, parentId: nil) }, sort: sort, setSort: { sort = $0 }, actions: actions)
        #expect(sort == .manual)
        let moves = engine.commands(named: "folder.move").map { FolderOrder.Move(id: $0["id"]?.string ?? "", afterId: $0["afterId"]?.string) }
        #expect(FolderOrder.apply(moves, to: ["a", "b", "c", "d"]) == ["c", "d", "b", "a"])
        #expect(log.toasts.last?.message == "Moved “C”. Folders are now in manual order.")
        #expect(log.toasts.last?.actionTitle == "Undo")
    }

    @Test @MainActor func dropInManualOrderIsOneMove() async {
        let engine = FakeEngine()
        engine.onCommand = { _, _ in .object(["ok": .bool(true)]) }
        let log = FeedbackLog()
        let actions = NoteActions(client: engine.client(), feedback: log.feedback)
        var sort = FoldersSort.manual
        await FolderOrder.drop("a", name: "A", gap: 2, shown: ["a", "b", "c", "d"], manual: ["a", "b", "c", "d"], links: [], sort: sort, setSort: { sort = $0 }, actions: actions)
        let moves = engine.commands(named: "folder.move")
        #expect(moves.count == 1)
        #expect(moves.first?["id"]?.string == "a")
        #expect(moves.first?["afterId"]?.string == "c")
        #expect(log.toasts.last?.message == "Moved “A”")
        // Back where it was: nothing happens.
        await FolderOrder.drop("b", name: "B", gap: 1, shown: ["a", "b", "c", "d"], manual: ["a", "b", "c", "d"], links: [], sort: sort, setSort: { sort = $0 }, actions: actions)
        #expect(engine.commands(named: "folder.move").count == 1)
    }
}
