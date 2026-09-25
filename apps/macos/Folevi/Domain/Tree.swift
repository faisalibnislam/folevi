import Foundation

/// Anything placed in the block tree.
public protocol TreeNode {
    var id: String { get }
    var parentId: String? { get }
    var rank: String { get }
}

public struct FlatEntry<T> {
    public var block: T
    public var depth: Int
}

public struct TreeIssue: Equatable, Sendable {
    public enum Code: String, Sendable { case duplicateId = "duplicate_id", missingParent = "missing_parent", cycle, tooDeep = "too_deep", duplicateRank = "duplicate_rank" }
    public var blockId: String
    public var code: Code
}

/// Port of packages/editor-schema/src/tree.ts.
public enum Tree {
    static func idLess(_ a: String, _ b: String) -> Bool {
        Array(a.utf8).lexicographicallyPrecedes(Array(b.utf8))
    }

    public static func compareSiblings<T: TreeNode>(_ a: T, _ b: T) -> Bool {
        let r = Rank.compare(a.rank, b.rank)
        if r != 0 { return r < 0 }
        return idLess(a.id, b.id)
    }

    /// Children grouped by parent (nil = root). Orphans (parent missing) are shown at the root.
    public static func childrenMap<T: TreeNode>(_ blocks: [T]) -> [String?: [T]] {
        let ids = Set(blocks.map(\.id))
        var map: [String?: [T]] = [:]
        for b in blocks {
            let key: String? = (b.parentId != nil && ids.contains(b.parentId!)) ? b.parentId : nil
            map[key, default: []].append(b)
        }
        for key in map.keys {
            map[key]?.sort { compareSiblings($0, $1) }
        }
        return map
    }

    /// Depth-first document order with nesting depth. Cycles are broken (the cyclic block becomes a root).
    public static func flatten<T: TreeNode>(_ blocks: [T]) -> [FlatEntry<T>] {
        let map = childrenMap(blocks)
        var out: [FlatEntry<T>] = []
        var visited = Set<String>()
        func walk(_ parent: String?, _ depth: Int) {
            for child in map[parent] ?? [] {
                if visited.contains(child.id) { continue }
                visited.insert(child.id)
                out.append(FlatEntry(block: child, depth: depth))
                walk(child.id, depth + 1)
            }
        }
        walk(nil, 0)
        let rest = blocks.filter { !visited.contains($0.id) }.sorted { compareSiblings($0, $1) }
        for b in rest where !visited.contains(b.id) {
            visited.insert(b.id)
            out.append(FlatEntry(block: b, depth: 0))
        }
        return out
    }

    public static func checkInvariants<T: TreeNode>(_ blocks: [T]) -> [TreeIssue] {
        var issues: [TreeIssue] = []
        var byId: [String: T] = [:]
        for b in blocks {
            if byId[b.id] != nil { issues.append(TreeIssue(blockId: b.id, code: .duplicateId)) }
            byId[b.id] = b
        }
        for b in blocks {
            if let p = b.parentId, byId[p] == nil { issues.append(TreeIssue(blockId: b.id, code: .missingParent)) }
            var seen: Set<String> = [b.id]
            var cur = b.parentId
            var depth = 0
            while let c = cur {
                if seen.contains(c) {
                    issues.append(TreeIssue(blockId: b.id, code: .cycle))
                    break
                }
                seen.insert(c)
                depth += 1
                cur = byId[c]?.parentId
            }
            if depth > FoleviLimits.maxDepth { issues.append(TreeIssue(blockId: b.id, code: .tooDeep)) }
        }
        return issues
    }

    public static func descendantIds<T: TreeNode>(_ blocks: [T], rootId: String) -> [String] {
        let map = childrenMap(blocks)
        var out: [String] = []
        func walk(_ id: String) {
            for c in map[id] ?? [] {
                out.append(c.id)
                walk(c.id)
            }
        }
        walk(rootId)
        return out
    }

    /// Rank for placing a block under `parentId` directly after `afterId` (nil = first child).
    public static func rankForPosition<T: TreeNode>(_ blocks: [T], parentId: String?, afterId: String?, movingId: String? = nil) throws -> String {
        let siblings = (childrenMap(blocks)[parentId] ?? []).filter { $0.id != movingId }
        guard let afterId else { return try Rank.between(nil, siblings.first?.rank) }
        guard let idx = siblings.firstIndex(where: { $0.id == afterId }) else {
            return try Rank.between(siblings.last?.rank, nil)
        }
        let prev = siblings[idx]
        let next: T? = idx + 1 < siblings.count ? siblings[idx + 1] : nil
        if let next, Rank.compare(prev.rank, next.rank) == 0 {
            // Equal ranks (concurrent inserts) — place after both.
            let after2 = idx + 2 < siblings.count ? siblings[idx + 2].rank : nil
            return try Rank.between(next.rank, after2)
        }
        return try Rank.between(prev.rank, next?.rank)
    }

    public struct FlatInput: Sendable {
        public var id: String
        public var depth: Int
        public var rank: String?
        public var parentId: String??
        public init(id: String, depth: Int, rank: String? = nil, parentId: String?? = .none) {
            self.id = id
            self.depth = depth
            self.rank = rank
            self.parentId = parentId
        }
    }

    public struct Position: Equatable, Sendable {
        public var parentId: String?
        public var rank: String
    }

    /// Converts a flat (depth-annotated) ordering into parent/rank assignments, keeping existing ranks
    /// wherever they are already correctly ordered (longest increasing subsequence per parent).
    public static func assignPositions(_ flat: [FlatInput]) throws -> [String: Position] {
        var parents: [String?] = []
        var stack: [(id: String, depth: Int)] = []
        for entry in flat {
            var depth = max(0, entry.depth)
            while let top = stack.last, top.depth >= depth { stack.removeLast() }
            let parent = stack.last
            if let parent { depth = min(depth, parent.depth + 1) } else { depth = 0 }
            parents.append(parent?.id)
            stack.append((entry.id, depth))
        }
        // Groups in first-appearance order (JS Map iteration order).
        var groupOrder: [String?] = []
        var groups: [String?: [Int]] = [:]
        for (i, p) in parents.enumerated() {
            if groups[p] == nil { groupOrder.append(p) }
            groups[p, default: []].append(i)
        }
        var result: [String: Position] = [:]
        for parentId in groupOrder {
            let idxs = groups[parentId] ?? []
            let ranks: [String?] = idxs.map { i in
                let e = flat[i]
                // In TS: e.rank !== undefined && e.parentId === parentId (undefined parentId never matches).
                if let r = e.rank, case .some(let p) = e.parentId, p == parentId { return r }
                return nil
            }
            let keep = longestIncreasing(ranks)
            var prevRank: String? = nil
            for k in 0..<idxs.count {
                let e = flat[idxs[k]]
                if keep.contains(k), let r = ranks[k] {
                    prevRank = r
                } else {
                    var nextRank: String? = nil
                    for j in (k + 1)..<max(k + 1, idxs.count) where keep.contains(j) {
                        nextRank = ranks[j]
                        break
                    }
                    prevRank = try Rank.between(prevRank, nextRank)
                }
                result[e.id] = Position(parentId: parentId, rank: prevRank ?? "V")
            }
        }
        return result
    }

    /// O(n log n) LIS over defined ranks (strictly increasing).
    static func longestIncreasing(_ ranks: [String?]) -> Set<Int> {
        var tails: [Int] = []
        var prev = [Int](repeating: -1, count: ranks.count)
        for i in 0..<ranks.count {
            guard let r = ranks[i] else { continue }
            var lo = 0
            var hi = tails.count
            while lo < hi {
                let mid = (lo + hi) >> 1
                if let t = ranks[tails[mid]], Rank.compare(t, r) < 0 { lo = mid + 1 } else { hi = mid }
            }
            if lo > 0 { prev[i] = tails[lo - 1] }
            if lo < tails.count { tails[lo] = i } else { tails.append(i) }
        }
        var keep = Set<Int>()
        var k = tails.last ?? -1
        while k != -1 {
            keep.insert(k)
            k = prev[k]
        }
        return keep
    }
}
