// The folder rules the web enforces, in Swift (packages/editor-schema/src/folders.ts and
// apps/web/src/lib/app/folderDrop.ts): folders nest up to five levels, never into themselves or their own
// subfolders; a drop on a card's leading quarter goes before it, the trailing quarter after it, the middle inside
// it. The server checks the same again; these keep the screens from offering a move it would refuse.
import Foundation
import FoleviEngine

public enum FolderRules {
    public static let maxDepth = 5

    public struct Link: Hashable, Sendable {
        public var id: String
        public var parentId: String?
        public init(id: String, parentId: String?) {
            self.id = id
            self.parentId = parentId
        }
    }

    public enum Problem: String, Sendable { case selfTarget = "self", descendant, depth }

    public enum Zone: Sendable { case before, inside, after }

    /// A folder's place among its siblings.
    public struct Place: Hashable, Sendable {
        public var parentId: String?
        public var afterId: String?
        public init(parentId: String?, afterId: String?) {
            self.parentId = parentId
            self.afterId = afterId
        }
    }

    public enum Drop: Hashable, Sendable {
        case move(Place, changed: Bool)
        case refused(Problem)
    }

    public static func links(_ nodes: [FolderNode]) -> [Link] { nodes.map { Link(id: $0.id, parentId: $0.parentId) } }

    /// The zone at `x` along a card of `width` (horizontal rows of cards) or `y` along a row's height.
    public static func zone(at offset: CGFloat, length: CGFloat) -> Zone {
        guard length > 0 else { return .inside }
        let f = offset / length
        return f < 0.25 ? .before : f > 0.75 ? .after : .inside
    }

    static func parents(_ folders: [Link]) -> [String: String?] {
        let ids = Set(folders.map(\.id))
        var out: [String: String?] = [:]
        for f in folders { out[f.id] = f.parentId.flatMap { ids.contains($0) ? $0 : nil } }
        return out
    }

    /// Level of a folder: 1 at the top level.
    public static func depth(_ folders: [Link], _ id: String) -> Int {
        let p = parents(folders)
        var seen: Set<String> = [id]
        var level = 1
        var at = p[id] ?? nil
        while let a = at, !seen.contains(a), level < 64 {
            seen.insert(a)
            level += 1
            at = p[a] ?? nil
        }
        return level
    }

    public static func descendants(_ folders: [Link], _ id: String) -> Set<String> {
        let p = parents(folders)
        var children: [String: [String]] = [:]
        for f in folders { if let parent = p[f.id] ?? nil { children[parent, default: []].append(f.id) } }
        var out = Set<String>()
        var queue = [id]
        while let next = queue.first {
            queue.removeFirst()
            for c in children[next] ?? [] where c != id && !out.contains(c) {
                out.insert(c)
                queue.append(c)
            }
        }
        return out
    }

    /// Levels a folder and what's inside it take up (1 with no subfolders).
    public static func height(_ folders: [Link], _ id: String) -> Int {
        let p = parents(folders)
        var children: [String: [String]] = [:]
        for f in folders { if let parent = p[f.id] ?? nil { children[parent, default: []].append(f.id) } }
        var seen = Set<String>()
        func walk(_ at: String, _ level: Int) -> Int {
            if seen.contains(at) || level > 64 { return level - 1 }
            seen.insert(at)
            return (children[at] ?? []).reduce(level) { max($0, walk($1, level + 1)) }
        }
        return walk(id, 1)
    }

    public static func moveProblem(_ folders: [Link], id: String, into parentId: String?) -> Problem? {
        guard let parentId else { return nil }
        if parentId == id { return .selfTarget }
        if descendants(folders, id).contains(parentId) { return .descendant }
        if depth(folders, parentId) + height(folders, id) > maxDepth { return .depth }
        return nil
    }

    /// Whether a new folder may go inside `parentId` (the "New folder inside" item).
    public static func canNest(_ folders: [Link], in parentId: String?) -> Bool {
        guard let parentId else { return true }
        return depth(folders, parentId) < maxDepth
    }

    static func siblings(_ folders: [Link], in parentId: String?, except: String? = nil) -> [Link] {
        let p = parents(folders)
        return folders.filter { $0.id != except && (p[$0.id] ?? nil) == parentId }
    }

    public static func place(_ folders: [Link], _ id: String) -> Place? {
        guard folders.contains(where: { $0.id == id }) else { return nil }
        let parent = parents(folders)[id] ?? nil
        let sibs = siblings(folders, in: parent)
        let i = sibs.firstIndex { $0.id == id } ?? 0
        return Place(parentId: parent, afterId: i > 0 ? sibs[i - 1].id : nil)
    }

    /// Where `dragged` goes when dropped on `target` in `zone` (target nil: the top level, last).
    public static func resolveDrop(_ folders: [Link], dragged: String, target: String?, zone: Zone) -> Drop {
        guard let now = place(folders, dragged) else { return .refused(.selfTarget) }
        let next: Place
        if let target {
            guard let at = place(folders, target) else { return .refused(.selfTarget) }
            if target == dragged {
                return zone == .inside ? .refused(.selfTarget) : .move(now, changed: false)
            }
            switch zone {
            case .inside:
                next = Place(parentId: target, afterId: siblings(folders, in: target, except: dragged).last?.id)
            case .after:
                next = Place(parentId: at.parentId, afterId: target)
            case .before:
                let sibs = siblings(folders, in: at.parentId, except: dragged)
                let i = sibs.firstIndex { $0.id == target } ?? 0
                next = Place(parentId: at.parentId, afterId: i > 0 ? sibs[i - 1].id : nil)
            }
        } else {
            next = Place(parentId: nil, afterId: siblings(folders, in: nil, except: dragged).last?.id)
        }
        if let problem = moveProblem(folders, id: dragged, into: next.parentId) { return .refused(problem) }
        return .move(next, changed: next != now)
    }

    /// What people read when a move is refused.
    public static func message(_ problem: Problem) -> String {
        switch problem {
        case .selfTarget: "A folder can't go inside itself."
        case .descendant: "A folder can't go inside one of its own folders."
        case .depth: "Folders nest up to \(maxDepth) levels deep."
        }
    }
}
