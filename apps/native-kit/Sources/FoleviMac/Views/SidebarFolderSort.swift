// The sidebar's own folder order (the owner, 5 and 6 November 2026; the web's lib/app/sidebarFolderSort.ts). The
// sort button beside Folders picks Manual, Name (A to Z) or Recent (last changed first), kept on this device. Manual
// is the sidebar's OWN order: the person's, synced with their account to all their devices (`folders.tree`
// sidebarOrder, `folder.setSidebarOrder`; one per Personal and per workspace), independent of the folders' rank (the
// Folders page's order, which everyone in a workspace shares).
//
// The saved order is a list of folder ids: each level is sorted by a folder's place in it, the folders it doesn't
// name after those it does, in rank order. Nothing saved: rank order; a new folder shows at the bottom of its level.
//
// Dragging in the sidebar: between two folders of its own level a folder moves in the sidebar order only. Onto a
// folder it really goes inside (last by rank among its new siblings) and shows last among them in the sidebar too.
// Between rows of another level it really moves there and takes that spot in the sidebar order. A drag between rows
// while sorted by Name or Recent first makes the order shown the sidebar order, then switches to Manual.
import Foundation
import FoleviEngine
import FoleviScreens

public enum SidebarFolderSort: String, CaseIterable, Sendable {
    case manual, name, recent

    public var title: String {
        switch self {
        case .manual: "Manual"
        case .name: "Name"
        case .recent: "Recent"
        }
    }

    /// The folders (in rank order, as `folders.tree` lists them) in the sidebar's own order: each level by a folder's
    /// place in `order`, the ones it doesn't name after those it does, in rank order. No order: as given.
    public static func applying(_ order: [String]?, to folders: [FolderNode]) -> [FolderNode] {
        guard let order, !order.isEmpty else { return folders }
        var at: [String: Int] = [:]
        for (i, id) in order.enumerated() where at[id] == nil { at[id] = i }
        var rank: [String: Int] = [:]
        for (i, f) in folders.enumerated() { rank[f.id] = i }
        return folders.sorted { a, b in
            let ka = at[a.id] ?? Int.max
            let kb = at[b.id] ?? Int.max
            return ka != kb ? ka < kb : rank[a.id]! < rank[b.id]!
        }
    }

    /// The folders in the order the sidebar lists them, each level sorted on its own (siblings keep the list's
    /// order). `folders` are in the sidebar's own order (`applying`). For Recent, `changed` is each folder's last
    /// change; one it doesn't know keeps its manual place after those it does.
    public static func sorted(_ folders: [FolderNode], by sort: SidebarFolderSort, changed: [String: Double] = [:]) -> [FolderNode] {
        guard sort != .manual else { return folders }
        var manual: [String: Int] = [:]
        for (i, f) in folders.enumerated() { manual[f.id] = i }
        return folders.sorted { a, b in
            switch sort {
            case .manual:
                return manual[a.id]! < manual[b.id]!
            case .name:
                let c = a.name.localizedStandardCompare(b.name)
                return c == .orderedSame ? manual[a.id]! < manual[b.id]! : c == .orderedAscending
            case .recent:
                switch (changed[a.id], changed[b.id]) {
                case let (ta?, tb?) where ta != tb: return ta > tb
                case (.some, nil): return true
                case (nil, .some): return false
                default: return manual[a.id]! < manual[b.id]!
                }
            }
        }
    }

    /// Every id, depth first, each level in the list's order.
    static func flatten(_ links: [FolderRules.Link]) -> [String] {
        let ids = Set(links.map(\.id))
        var kids: [String?: [String]] = [:]
        for l in links { kids[l.parentId.flatMap { ids.contains($0) ? $0 : nil }, default: []].append(l.id) }
        var out: [String] = []
        var seen = Set<String>()
        func walk(_ parent: String?) {
            for id in kids[parent] ?? [] where !seen.contains(id) {
                seen.insert(id)
                out.append(id)
                walk(id)
            }
        }
        walk(nil)
        for l in links where !seen.contains(l.id) {
            seen.insert(l.id)
            out.append(l.id)
            walk(l.id)
        }
        return out
    }

    /// Every folder id, depth first, with `id` moved into `parentId` right after `afterId` (nil: first among its new
    /// siblings), the rest in the order `shown` lists them: the sidebar order to save after a drop.
    public static func orderAfterMove(_ shown: [FolderNode], id: String, parentId: String?, afterId: String?) -> [String] {
        var links = FolderRules.links(shown)
        guard let i = links.firstIndex(where: { $0.id == id }) else { return flatten(links) }
        var moved = links.remove(at: i)
        moved.parentId = parentId
        if let afterId, let j = links.firstIndex(where: { $0.id == afterId }) {
            links.insert(moved, at: j + 1)
        } else if let j = links.firstIndex(where: { $0.parentId == parentId }) {
            links.insert(moved, at: j)
        } else {
            links.append(moved)
        }
        return flatten(links)
    }

    /// The sibling a folder goes after to be last inside `parentId` in `folders`' order (nil: it'd be the only one).
    public static func lastSibling(in folders: [FolderNode], parentId: String?, except: String) -> String? {
        folders.last { $0.parentId == parentId && $0.id != except }?.id
    }

    /// Where a folder dropped on the sidebar's tree goes among the folders as shown (the web's resolveFolderDrop):
    /// `targetOpen` says the target's subfolders show under it, so a line below it is above its first subfolder.
    public static func resolveDrop(_ shown: [FolderNode], dragged: String, target: String?, zone: FolderRules.Zone, targetOpen: Bool) -> FolderRules.Drop {
        let links = FolderRules.links(shown)
        if let target, target != dragged, zone == .after, targetOpen, links.contains(where: { $0.parentId == target && $0.id != dragged }) {
            guard let now = FolderRules.place(links, dragged) else { return .refused(.selfTarget) }
            if let problem = FolderRules.moveProblem(links, id: dragged, into: target) { return .refused(problem) }
            let next = FolderRules.Place(parentId: target, afterId: nil)
            return .move(next, changed: next != now)
        }
        return FolderRules.resolveDrop(links, dragged: dragged, target: target, zone: zone)
    }

    /// What a drop on the sidebar's tree does.
    public struct DropPlan: Hashable, Sendable {
        /// The sidebar order to save, or nil to leave it as it is.
        public var order: [String]?
        /// A real move (the parent changes, for everyone): last among the new siblings by rank.
        public var move: FolderRules.Place?
        /// The drop makes the order shown (Name or Recent) the sidebar's: switch to Manual.
        public var adopt: Bool
    }

    /// What dropping `id` at `place` (among the folders as `shown`) does. `nest`: dropped onto a folder (or the
    /// top level's space), not between rows. `rank` is `folders.tree`'s list, `order` the saved sidebar order.
    public static func planDrop(rank: [FolderNode], order: [String]?, shown: [FolderNode], sort: SidebarFolderSort, id: String, place: FolderRules.Place, nest: Bool) -> DropPlan {
        let was = FolderRules.place(FolderRules.links(rank), id)
        let move = was?.parentId != place.parentId || was == nil
            ? FolderRules.Place(parentId: place.parentId, afterId: lastSibling(in: rank, parentId: place.parentId, except: id))
            : nil
        let manual = applying(order, to: rank)
        if nest {
            let saved = !(order ?? []).isEmpty
            let next = saved ? orderAfterMove(manual, id: id, parentId: place.parentId, afterId: lastSibling(in: manual, parentId: place.parentId, except: id)) : nil
            return DropPlan(order: next, move: move, adopt: false)
        }
        let base = sort == .manual ? manual : shown
        return DropPlan(order: orderAfterMove(base, id: id, parentId: place.parentId, afterId: place.afterId), move: move, adopt: sort != .manual)
    }
}
