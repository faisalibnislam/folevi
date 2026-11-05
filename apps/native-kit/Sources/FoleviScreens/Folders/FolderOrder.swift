// The Folders page's order (web lib/app/folderOrder.ts): its sorts, and dragging a folder card to a new spot
// among the others. Pure, so the Mac, the iPad, the iPhone and the tests agree with the web.
import Foundation

/// Manual: the folders' own order (as the sidebar shows them). Name: A to Z. Recent: the last changed first (the
/// time each card shows).
public enum FoldersSort: String, Sendable, CaseIterable {
    case manual, name, recent

    /// The sort a saved value stands for. Earlier versions saved Name, Last updated ("updated"), Most pages or
    /// notes ("count") and Newest ("created"): Name stays Name, Last updated is Recent, the others are Manual (as is
    /// anything unknown).
    public init(saved: String?) {
        switch saved {
        case "name": self = .name
        case "recent", "updated": self = .recent
        default: self = .manual
        }
    }

    public var label: String {
        switch self {
        case .manual: "Manual"
        case .name: "Name"
        case .recent: "Recent"
        }
    }

    public static var options: [(FoldersSort, String)] { allCases.map { ($0, $0.label) } }
}

public enum FolderOrder {
    /// One folder moved among its siblings: right after `afterId` (nil: first), as `folder.move` takes it.
    public struct Move: Hashable, Sendable {
        public var id: String
        public var afterId: String?
        public init(id: String, afterId: String?) {
            self.id = id
            self.afterId = afterId
        }
    }

    /// `items` (given in their manual order) in `sort`'s order.
    public static func sorted<T>(_ items: [T], by sort: FoldersSort, name: (T) -> String, updatedAt: (T) -> Double) -> [T] {
        switch sort {
        case .manual: return items
        case .name: return items.sorted { name($0).localizedCaseInsensitiveCompare(name($1)) == .orderedAscending }
        case .recent:
            // (Stable: folders changed at the same moment keep their manual order.)
            return items.enumerated().sorted { a, b in
                let x = updatedAt(a.element), y = updatedAt(b.element)
                return x != y ? x > y : a.offset < b.offset
            }.map(\.element)
        }
    }

    /// The order with `dragged` put in the gap at `gap`, counted among the others (0: before the first; their count:
    /// after the last). A folder that wasn't in the list (dragged in from the sidebar) joins it there.
    public static func reordered(_ ids: [String], moving dragged: String, toGap gap: Int) -> [String] {
        var rest = ids.filter { $0 != dragged }
        rest.insert(dragged, at: max(0, min(gap, rest.count)))
        return rest
    }

    /// Whether dropping in that gap changes anything.
    public static func changes(_ ids: [String], moving dragged: String, toGap gap: Int) -> Bool {
        reordered(ids, moving: dragged, toGap: gap) != ids
    }

    /// The gap a card's zone stands for: before it (its own index among the others) or after it (one more). Nil for
    /// inside, for the dragged card itself, or a card that isn't in the list.
    public static func gap(_ ids: [String], moving dragged: String, at target: String, zone: FolderRules.Zone) -> Int? {
        guard target != dragged, zone != .inside, let i = ids.filter({ $0 != dragged }).firstIndex(of: target) else { return nil }
        return zone == .before ? i : i + 1
    }

    /// The fewest moves (each "put this folder right after that one") that turn the order `current` into `target`,
    /// in the order to send them. The folders already in the right order relative to each other (the longest such
    /// run) stay; every other one goes right after the folder before it in `target`, from the first to the last. A
    /// folder of `target` that isn't in `current` always moves.
    public static func moves(from current: [String], to target: [String]) -> [Move] {
        var at: [String: Int] = [:]
        for (i, id) in current.enumerated() where at[id] == nil { at[id] = i }
        let seq: [(id: String, pos: Int)] = target.compactMap { id in at[id].map { (id, $0) } }
        var tails: [Int] = []
        var prev = [Int](repeating: -1, count: seq.count)
        for i in seq.indices {
            var lo = 0, hi = tails.count
            while lo < hi {
                let mid = (lo + hi) / 2
                if seq[tails[mid]].pos < seq[i].pos { lo = mid + 1 } else { hi = mid }
            }
            if lo > 0 { prev[i] = tails[lo - 1] }
            if lo == tails.count { tails.append(i) } else { tails[lo] = i }
        }
        var kept = Set<String>()
        var i = tails.last ?? -1
        while i >= 0 {
            kept.insert(seq[i].id)
            i = prev[i]
        }
        return target.enumerated().compactMap { n, id in kept.contains(id) ? nil : Move(id: id, afterId: n > 0 ? target[n - 1] : nil) }
    }

    /// A folder dropped in a gap among the Folders page's cards. `shown`: the cards' ids in `sort`'s order;
    /// `manual`: the same folders in their own order; `links`: every folder (for where one dragged in from the sidebar
    /// was). In Name or Recent the order on screen, with the move, becomes the manual order (the folders take new
    /// places) and the page switches to Manual (`setSort`). One toast, with Undo.
    @MainActor
    public static func drop(_ dragged: String, name: String, gap: Int, shown: [String], manual: [String], links: [FolderRules.Link], sort: FoldersSort, setSort: @escaping @MainActor @Sendable (FoldersSort) -> Void, actions: NoteActions) async {
        let target = reordered(shown, moving: dragged, toGap: gap)
        let steps = moves(from: manual, to: target)
        guard !steps.isEmpty || sort != .manual, changes(shown, moving: dragged, toGap: gap) else { return }
        // A folder dragged in from the sidebar (a nested one) comes up to the top level; Undo puts it back.
        let outside = !shown.contains(dragged)
        let was = outside ? FolderRules.place(links, dragged) : nil
        let before = sort
        if sort != .manual { setSort(.manual) }
        let back = moves(from: target.filter { !outside || $0 != dragged }, to: manual)
        let top = { (list: [Move]) in list.map { (id: $0.id, place: FolderRules.Place(parentId: nil, afterId: $0.afterId)) } }
        let message = before == .manual ? "Moved “\(name)”" : "Moved “\(name)”. Folders are now in manual order."
        await actions.moveFolders(top(steps), message: message) {
            Task { @MainActor in
                await actions.moveFolders((was.map { [(id: dragged, place: $0)] } ?? []) + top(back), message: nil)
                if before != .manual { setSort(before) }
            }
        }
    }

    /// `current` with `moves` applied one after another (what the engine ends up with).
    public static func apply(_ moves: [Move], to current: [String]) -> [String] {
        var out = current
        for m in moves {
            out.removeAll { $0 == m.id }
            let i = m.afterId.flatMap { out.firstIndex(of: $0).map { $0 + 1 } } ?? 0
            out.insert(m.id, at: i)
        }
        return out
    }
}
