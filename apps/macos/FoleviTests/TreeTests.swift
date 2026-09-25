import XCTest

private struct Node: TreeNode, Equatable {
    var id: String
    var parentId: String?
    var rank: String
}

final class TreeTests: XCTestCase {
    private func treeFixture() throws -> [Node] {
        try XCTUnwrap(Fixtures.reference["tree"]?.arrayValue).map {
            Node(id: $0["id"]?.stringValue ?? "", parentId: $0["parentId"]?.stringValue, rank: $0["rank"]?.stringValue ?? "")
        }
    }

    func testFlattenMatchesReference() throws {
        let expected = try XCTUnwrap(Fixtures.reference["flatOrder"]?.arrayValue).compactMap(\.stringValue)
        let flat = Tree.flatten(try treeFixture()).map { "\($0.block.id):\($0.depth)" }
        XCTAssertEqual(flat, expected)
    }

    func testRankForPositionMatchesReference() throws {
        let tree = try treeFixture()
        for c in try XCTUnwrap(Fixtures.reference["ranks"]?.arrayValue) {
            let r = try Tree.rankForPosition(tree, parentId: c["parentId"]?.stringValue, afterId: c["afterId"]?.stringValue,
                                             movingId: c["movingId"]?.stringValue)
            XCTAssertEqual(r, c["result"]?.stringValue, "\(c.canonicalString)")
        }
    }

    func testAssignPositionsMatchesReference() throws {
        let input = try XCTUnwrap(Fixtures.reference["flatInput"]?.arrayValue).map { e -> Tree.FlatInput in
            let parent: String?? = e["parentId"] == nil ? .none : .some(e["parentId"]?.stringValue)
            return Tree.FlatInput(id: e["id"]?.stringValue ?? "", depth: e["depth"]?.intValue ?? 0, rank: e["rank"]?.stringValue, parentId: parent)
        }
        let result = try Tree.assignPositions(input)
        let expected = try XCTUnwrap(Fixtures.reference["assigned"]?.objectValue)
        XCTAssertEqual(result.count, expected.count)
        for (id, pos) in expected {
            XCTAssertEqual(result[id]?.rank, pos["rank"]?.stringValue, id)
            XCTAssertEqual(result[id]?.parentId, pos["parentId"]?.stringValue, id)
        }
    }

    func testCyclesAreSurfacedAtRoot() {
        let nodes = [Node(id: "a", parentId: "b", rank: "V"), Node(id: "b", parentId: "a", rank: "G"), Node(id: "c", parentId: nil, rank: "V")]
        let flat = Tree.flatten(nodes)
        XCTAssertEqual(flat.map(\.block.id), ["c", "b", "a"])
        XCTAssertTrue(Tree.checkInvariants(nodes).contains { $0.code == .cycle })
        XCTAssertEqual(Tree.descendantIds([Node(id: "p", parentId: nil, rank: "V"), Node(id: "k", parentId: "p", rank: "V")], rootId: "p"), ["k"])
    }
}
