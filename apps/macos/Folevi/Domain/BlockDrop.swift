import Foundation

/// Pure geometry-free logic behind block drag and drop (and the keyboard/"place" moves):
/// which gap the pointer is over, which nesting depths are allowed there, and what parent/rank the
/// moved blocks get. The editor feeds it the visible rows; tests feed it fixtures.
public enum BlockDrop {
    /// A visible row in document order.
    public struct Row: Equatable, Sendable {
        public var id: String
        public var depth: Int
        public var parentId: String?
        public init(id: String, depth: Int, parentId: String?) {
            self.id = id
            self.depth = depth
            self.parentId = parentId
        }
    }

    /// Where the moved blocks go: under `parentId`, directly after `afterId` (nil = first child).
    public struct Placement: Equatable, Sendable {
        public var parentId: String?
        public var afterId: String?
        public init(parentId: String?, afterId: String?) {
            self.parentId = parentId
            self.afterId = afterId
        }
    }

    public struct Position: Equatable, Sendable {
        public var parentId: String?
        public var rank: String
    }

    /// The rows that stay put while `roots` (and everything nested under them) are dragged.
    public static func remaining(_ rows: [Row], dragging roots: Set<String>) -> [Row] {
        var out: [Row] = []
        var skipDeeperThan: Int?
        for r in rows {
            if let d = skipDeeperThan {
                if r.depth > d { continue }
                skipDeeperThan = nil
            }
            if roots.contains(r.id) {
                skipDeeperThan = r.depth
                continue
            }
            out.append(r)
        }
        return out
    }

    /// Gap index (0…count) for a pointer at `y`, given each remaining row's vertical midpoint.
    public static func gap(forY y: Double, midpoints: [Double]) -> Int {
        midpoints.firstIndex { y < $0 } ?? midpoints.count
    }

    /// Depths a block may take in a gap: never shallower than the row below (that would orphan it
    /// visually) and at most one deeper than the row above.
    public static func depthRange(remaining: [Row], gap: Int, maxDepth: Int = FoleviLimits.maxDepth) -> ClosedRange<Int> {
        let upper = min(gap > 0 ? remaining[gap - 1].depth + 1 : 0, maxDepth)
        let lower = min(gap < remaining.count ? remaining[gap].depth : 0, upper)
        return lower...upper
    }

    /// Desired depth from the drag's horizontal offset: each `step` points right/left nests/un-nests.
    public static func depth(original: Int, horizontalOffset dx: Double, step: Double = 24, in range: ClosedRange<Int>) -> Int {
        let desired = original + Int((dx / step).rounded(.toNearestOrAwayFromZero))
        return min(max(desired, range.lowerBound), range.upperBound)
    }

    /// Parent and preceding sibling for a drop into `gap` at `depth` (depth must be in `depthRange`).
    public static func placement(remaining: [Row], gap: Int, depth: Int) -> Placement {
        var i = gap - 1
        while i >= 0 {
            let r = remaining[i]
            if r.depth == depth { return Placement(parentId: r.parentId, afterId: r.id) }
            if r.depth < depth { return Placement(parentId: r.id, afterId: nil) }
            i -= 1
        }
        return Placement(parentId: nil, afterId: nil)
    }

    /// New parent/rank for each moved root (in order), keeping subtrees attached. Returns nil when the
    /// move would put a block inside itself.
    public static func positions<T: TreeNode>(_ nodes: [T], moving ids: [String], to placement: Placement) -> [String: Position]? {
        var working: [String: Node] = [:]
        for n in nodes { working[n.id] = Node(id: n.id, parentId: n.parentId, rank: n.rank) }
        if let parent = placement.parentId {
            let all = Array(working.values)
            for id in ids where id == parent || Tree.descendantIds(all, rootId: id).contains(parent) { return nil }
        }
        var out: [String: Position] = [:]
        var after = placement.afterId
        for id in ids {
            guard var node = working[id] else { continue }
            let all = Array(working.values)
            let rank = (try? Tree.rankForPosition(all, parentId: placement.parentId, afterId: after, movingId: id))
                ?? Rank.betweenOrAfter(after.flatMap { working[$0]?.rank }, nil)
            node.parentId = placement.parentId
            node.rank = rank
            working[id] = node
            out[id] = Position(parentId: placement.parentId, rank: rank)
            after = id
        }
        return out
    }

    /// True when dropping `root` at `placement` would leave it exactly where it is.
    public static func isNoOp<T: TreeNode>(_ nodes: [T], root: String, placement: Placement, dragged: Set<String>) -> Bool {
        guard let node = nodes.first(where: { $0.id == root }), node.parentId == placement.parentId else { return false }
        let siblings = (Tree.childrenMap(nodes)[node.parentId] ?? []).filter { !dragged.contains($0.id) || $0.id == root }
        guard let idx = siblings.firstIndex(where: { $0.id == root }) else { return false }
        let previous = idx > 0 ? siblings[idx - 1].id : nil
        return previous == placement.afterId
    }

    /// What changed between the committed and the new version of a block. A move (parent/rank) is a
    /// `position` change — moves must never be sent as content-only edits.
    public static func changedFields(old: Block?, new: Block) -> [ChangedField] {
        guard let old else { return [.content, .position] }
        var f: [ChangedField] = []
        if old.text != new.text || old.content != new.content { f.append(.content) }
        if old.parentId != new.parentId || old.rank != new.rank { f.append(.position) }
        return f.isEmpty ? [.content] : f
    }

    struct Node: TreeNode {
        var id: String
        var parentId: String?
        var rank: String
    }
}
