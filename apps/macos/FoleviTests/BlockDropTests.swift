import XCTest

/// Drag-and-drop move computation: pointer gap + nesting depth → parent/rank, using the same rank
/// helpers (and reference tree fixture) as the rest of the editor.
final class BlockDropTests: XCTestCase {
    private struct Node: TreeNode, Equatable {
        var id: String
        var parentId: String?
        var rank: String
    }

    /// a
    /// b
    ///   b1
    ///   b2
    ///     b2x
    /// c
    /// d
    private func fixture() throws -> [Node] {
        let roots = try Rank.sequence(4)
        let kids = try Rank.sequence(2)
        return [
            Node(id: "a", parentId: nil, rank: roots[0]),
            Node(id: "b", parentId: nil, rank: roots[1]),
            Node(id: "b1", parentId: "b", rank: kids[0]),
            Node(id: "b2", parentId: "b", rank: kids[1]),
            Node(id: "b2x", parentId: "b2", rank: "V"),
            Node(id: "c", parentId: nil, rank: roots[2]),
            Node(id: "d", parentId: nil, rank: roots[3]),
        ]
    }

    private func rows(_ nodes: [Node]) -> [BlockDrop.Row] {
        Tree.flatten(nodes).map { BlockDrop.Row(id: $0.block.id, depth: $0.depth, parentId: $0.block.parentId) }
    }

    private func apply(_ nodes: [Node], moving ids: [String], gap: Int, depth: Int) throws -> [Node] {
        let remaining = BlockDrop.remaining(rows(nodes), dragging: Set(ids))
        let range = BlockDrop.depthRange(remaining: remaining, gap: gap)
        XCTAssertTrue(range.contains(depth), "depth \(depth) not allowed in \(range)")
        let placement = BlockDrop.placement(remaining: remaining, gap: gap, depth: depth)
        let positions = try XCTUnwrap(BlockDrop.positions(nodes, moving: ids, to: placement))
        return nodes.map { n in
            guard let p = positions[n.id] else { return n }
            return Node(id: n.id, parentId: p.parentId, rank: p.rank)
        }
    }

    private func outline(_ nodes: [Node]) -> [String] {
        Tree.flatten(nodes).map { "\($0.block.id):\($0.depth)" }
    }

    func testRemainingSkipsDraggedSubtree() throws {
        let remaining = BlockDrop.remaining(rows(try fixture()), dragging: ["b"])
        XCTAssertEqual(remaining.map(\.id), ["a", "c", "d"])
        let nested = BlockDrop.remaining(rows(try fixture()), dragging: ["b2"])
        XCTAssertEqual(nested.map(\.id), ["a", "b", "b1", "c", "d"])
    }

    func testGapFromPointer() {
        let mids: [Double] = [10, 40, 70]
        XCTAssertEqual(BlockDrop.gap(forY: 0, midpoints: mids), 0)
        XCTAssertEqual(BlockDrop.gap(forY: 25, midpoints: mids), 1)
        XCTAssertEqual(BlockDrop.gap(forY: 69.9, midpoints: mids), 2)
        XCTAssertEqual(BlockDrop.gap(forY: 500, midpoints: mids), 3)
    }

    func testDepthRangeAndHorizontalNesting() throws {
        let remaining = BlockDrop.remaining(rows(try fixture()), dragging: ["d"])
        // Top of the document: only the root level.
        XCTAssertEqual(BlockDrop.depthRange(remaining: remaining, gap: 0), 0...0)
        // Between b2x (depth 2) and c (depth 0): anything from root up to one deeper than b2x.
        XCTAssertEqual(BlockDrop.depthRange(remaining: remaining, gap: 5), 0...3)
        // Between b (0) and its first child b1 (1): can't go shallower than b1.
        XCTAssertEqual(BlockDrop.depthRange(remaining: remaining, gap: 2), 1...1)
        // 24pt per level, clamped to the range.
        XCTAssertEqual(BlockDrop.depth(original: 0, horizontalOffset: 30, in: 0...3), 1)
        XCTAssertEqual(BlockDrop.depth(original: 0, horizontalOffset: 11, in: 0...3), 0)
        XCTAssertEqual(BlockDrop.depth(original: 2, horizontalOffset: -60, in: 0...3), 0)
        XCTAssertEqual(BlockDrop.depth(original: 0, horizontalOffset: 500, in: 0...3), 3)
    }

    func testMoveRootDownKeepsChildren() throws {
        // Drag "b" (with b1, b2, b2x) to after "c" at root level.
        let moved = try apply(try fixture(), moving: ["b"], gap: 2, depth: 0)
        XCTAssertEqual(outline(moved), ["a:0", "c:0", "b:0", "b1:1", "b2:1", "b2x:2", "d:0"])
    }

    func testMoveUpToTop() throws {
        let moved = try apply(try fixture(), moving: ["d"], gap: 0, depth: 0)
        XCTAssertEqual(outline(moved), ["d:0", "a:0", "b:0", "b1:1", "b2:1", "b2x:2", "c:0"])
    }

    func testNestUnderPreviousBlock() throws {
        // Drag "c" right by one level while it sits after b2x: it becomes b's last child.
        let moved = try apply(try fixture(), moving: ["c"], gap: 5, depth: 1)
        XCTAssertEqual(outline(moved), ["a:0", "b:0", "b1:1", "b2:1", "b2x:2", "c:1", "d:0"])
        XCTAssertEqual(moved.first { $0.id == "c" }?.parentId, "b")
        // One deeper still: c becomes b2x's first child.
        let deeper = try apply(try fixture(), moving: ["c"], gap: 5, depth: 3)
        XCTAssertEqual(deeper.first { $0.id == "c" }?.parentId, "b2x")
    }

    func testFirstChildPlacement() throws {
        let remaining = BlockDrop.remaining(rows(try fixture()), dragging: ["d"])
        XCTAssertEqual(BlockDrop.placement(remaining: remaining, gap: 2, depth: 1), .init(parentId: "b", afterId: nil))
        let moved = try apply(try fixture(), moving: ["d"], gap: 2, depth: 1)
        XCTAssertEqual(outline(moved), ["a:0", "b:0", "d:1", "b1:1", "b2:1", "b2x:2", "c:0"])
    }

    func testOutdentNestedBlockToRoot() throws {
        // b2 (with b2x) dragged left after b2's old spot: back to the root, after b.
        let moved = try apply(try fixture(), moving: ["b2"], gap: 3, depth: 0)
        XCTAssertEqual(outline(moved), ["a:0", "b:0", "b1:1", "b2:0", "b2x:1", "c:0", "d:0"])
    }

    func testMultipleRootsKeepOrder() throws {
        let moved = try apply(try fixture(), moving: ["a", "c"], gap: 5, depth: 0)
        XCTAssertEqual(outline(moved), ["b:0", "b1:1", "b2:1", "b2x:2", "d:0", "a:0", "c:0"])
    }

    func testRefusesMoveIntoOwnSubtree() throws {
        XCTAssertNil(BlockDrop.positions(try fixture(), moving: ["b"], to: .init(parentId: "b2x", afterId: nil)))
    }

    func testNoOpIsDetected() throws {
        let nodes = try fixture()
        XCTAssertTrue(BlockDrop.isNoOp(nodes, root: "c", placement: .init(parentId: nil, afterId: "b"), dragged: ["c"]))
        XCTAssertFalse(BlockDrop.isNoOp(nodes, root: "c", placement: .init(parentId: nil, afterId: "d"), dragged: ["c"]))
        XCTAssertFalse(BlockDrop.isNoOp(nodes, root: "c", placement: .init(parentId: "b", afterId: "b2"), dragged: ["c"]))
    }

    func testMovesAgainstReferenceTreeFixture() throws {
        let tree = try XCTUnwrap(Fixtures.reference["tree"]?.arrayValue).map {
            Node(id: $0["id"]?.stringValue ?? "", parentId: $0["parentId"]?.stringValue, rank: $0["rank"]?.stringValue ?? "")
        }
        let flat = rows(tree)
        // Move the first root (and its subtree) to the very end, at the root level.
        let root = try XCTUnwrap(flat.first { $0.depth == 0 })
        let subtree = [root.id] + Tree.descendantIds(tree, rootId: root.id)
        let remaining = BlockDrop.remaining(flat, dragging: [root.id])
        let moved = try apply(tree, moving: [root.id], gap: remaining.count, depth: 0)
        let order = Tree.flatten(moved).map(\.block.id)
        XCTAssertEqual(Array(order.suffix(subtree.count)), subtree, "the subtree moves as one piece, in order")
        XCTAssertEqual(Array(order.prefix(order.count - subtree.count)), remaining.map(\.id), "everything else keeps its order")
        XCTAssertTrue(Tree.checkInvariants(moved).isEmpty)
        // Ranks stay valid and strictly between neighbours.
        for n in moved { XCTAssertTrue(Rank.isValid(n.rank), n.rank) }
    }

    func testMoveIsAPositionChangeForSync() {
        let old = Block(id: "x", parentId: nil, rank: "G", text: RichText.text("Hello"), content: .paragraph(ParagraphProps()))
        var moved = old
        moved.parentId = "p"
        moved.rank = "V"
        XCTAssertEqual(BlockDrop.changedFields(old: old, new: moved), [.position])
        var edited = old
        edited.text = RichText.text("Hello!")
        XCTAssertEqual(BlockDrop.changedFields(old: old, new: edited), [.content])
        var both = moved
        both.text = RichText.text("Hi")
        XCTAssertEqual(BlockDrop.changedFields(old: old, new: both), [.content, .position])
        XCTAssertEqual(BlockDrop.changedFields(old: nil, new: old), [.content, .position])
    }
}
