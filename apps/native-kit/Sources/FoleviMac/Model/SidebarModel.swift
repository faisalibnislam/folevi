// What the Mac sidebar shows (docs/NATIVE_APP_PLAN.md sections 4.5 and 5.2, the web's Sidebar.tsx): the fixed
// destinations with their counts, the folder tree (nested, with note counts), tags, and Templates, Archive and
// Trash. Built from the engine's `session`, `home` and `folders.tree` values; pure, so tests build it from
// fixtures. Also the folder drop rules the outline enforces (the web's folderDrop.ts: never into itself or its
// own subfolders, five levels at most), so a drag never offers a move the server would refuse.
import Foundation
import FoleviEngine
import FoleviScreens

public struct SidebarNode: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case header
        case destination(FrameRoute)
        case folder
        case tag
    }

    public var id: String
    public var kind: Kind
    public var title: String
    public var symbol: String
    public var count: Int?
    /// A folder's or tag's colour key.
    public var colorId: String?
    /// Waiting to sync, failed, conflict (folders).
    public var sync: SyncMark = .saved
    public var children: [SidebarNode] = []

    public var route: FrameRoute? {
        switch kind {
        case .destination(let r): return r
        case .folder: return .folder(String(id.dropFirst(SidebarModel.folderPrefix.count)))
        case .tag: return .tag(String(id.dropFirst(SidebarModel.tagPrefix.count)))
        case .header: return nil
        }
    }

    /// The folder's id for a folder row.
    public var folderId: String? {
        kind == .folder ? String(id.dropFirst(SidebarModel.folderPrefix.count)) : nil
    }
}

public enum SidebarModel {
    public static let folderPrefix = "folder:"
    public static let tagPrefix = "tag:"
    public static let foldersHeader = "header:folders"
    public static let tagsHeader = "header:tags"
    public static let moreHeader = "header:more"
    public static let topHeader = "header:top"

    /// The sidebar's sections, top to bottom. Each section is a header node with its rows as children.
    public static func sections(session: SessionValue?, home: HomeValue?, tree: FoldersTreeValue?) -> [SidebarNode] {
        let caps = session?.capabilities
        let count = { (id: HomeRow.Id) -> Int? in home?.rows.first { $0.id == id }?.count }
        var top: [SidebarNode] = [destination(.home)]
        // Foli AI's brief only where Foli AI is on (the web hides the card otherwise).
        if home?.catchUp.available ?? caps?.ai ?? false { top.append(destination(.catchUp)) }
        top.append(destination(.notes(.all), count: count(.notes)))
        top.append(destination(.notes(.unsorted), count: count(.drafts)))
        if caps?.sharing ?? true { top.append(destination(.shared, count: count(.shared))) }
        if caps?.changes ?? true { top.append(destination(.changes, count: count(.changes))) }
        top.append(destination(.notes(.starred)))

        var out = [SidebarNode(id: topHeader, kind: .header, title: "", symbol: "", children: top)]
        out.append(SidebarNode(id: foldersHeader, kind: .header, title: "Folders", symbol: "", children: folderTree(tree?.folders ?? [])))
        let tags = tree?.tags ?? home?.tags ?? []
        if !tags.isEmpty {
            out.append(SidebarNode(id: tagsHeader, kind: .header, title: "Tags", symbol: "", children: tags.map { t in
                SidebarNode(id: tagPrefix + t.id, kind: .tag, title: t.name, symbol: "number", colorId: t.color)
            }))
        }
        out.append(SidebarNode(id: moreHeader, kind: .header, title: "More", symbol: "", children: [
            destination(.notes(.templates)), destination(.notes(.archive)), destination(.notes(.trash)),
        ]))
        return out
    }

    static func destination(_ route: FrameRoute, count: Int? = nil) -> SidebarNode {
        SidebarNode(id: "dest:\(route.path)", kind: .destination(route), title: route.fallbackTitle, symbol: route.symbol, count: count.flatMap { $0 > 0 ? $0 : nil })
    }

    /// The flat, depth-first folder list as a tree (children in the list's order). Orphans (a parent not in the
    /// list) show at the top level rather than vanishing.
    public static func folderTree(_ folders: [FolderNode]) -> [SidebarNode] {
        let ids = Set(folders.map(\.id))
        var children: [String: [FolderNode]] = [:]
        var roots: [FolderNode] = []
        for f in folders {
            if let p = f.parentId, ids.contains(p), p != f.id { children[p, default: []].append(f) } else { roots.append(f) }
        }
        var visited = Set<String>()
        func node(_ f: FolderNode) -> SidebarNode {
            visited.insert(f.id)
            let kids = (children[f.id] ?? []).filter { !visited.contains($0.id) }.map(node)
            return SidebarNode(id: folderPrefix + f.id, kind: .folder, title: f.name.isEmpty ? "Untitled folder" : f.name, symbol: "folder", count: f.noteCount, colorId: f.color, sync: f.sync, children: kids)
        }
        return roots.map(node)
    }

    /// The row a route selects (nil: nothing, as for a note).
    public static func selectionId(for route: FrameRoute) -> String? {
        switch route {
        case .folder(let id): return folderPrefix + id
        case .tag(let id): return tagPrefix + id
        case .note, .search, .web: return nil
        default: return "dest:\(route.path)"
        }
    }
}

/// The folder tree's shape for drop rules (the web's folderDrop.ts and editor-schema folders.ts).
public struct FolderTree: Sendable {
    public static let maxDepth = 5
    private var parent: [String: String?] = [:]
    private var kids: [String?: [String]] = [:]

    public init(_ folders: [FolderNode]) {
        let ids = Set(folders.map(\.id))
        for f in folders {
            let p = f.parentId.flatMap { ids.contains($0) ? $0 : nil }
            parent[f.id] = .some(p)
            kids[p, default: []].append(f.id)
        }
    }

    public func contains(_ id: String) -> Bool { parent[id] != nil }
    public func parentOf(_ id: String) -> String? { parent[id] ?? nil }
    public func children(of id: String?) -> [String] { kids[id] ?? [] }

    /// 0 for a top-level folder.
    public func depth(_ id: String) -> Int {
        var d = 0
        var cur = parentOf(id)
        var guardSteps = 0
        while let c = cur, guardSteps < 64 {
            d += 1
            cur = parentOf(c)
            guardSteps += 1
        }
        return d
    }

    /// Levels below a folder (0 for one with no subfolders).
    public func height(_ id: String) -> Int {
        let c = children(of: id)
        return c.isEmpty ? 0 : 1 + (c.map(height).max() ?? 0)
    }

    /// Whether `id` is `ancestor` or inside it.
    public func isWithin(_ id: String, _ ancestor: String) -> Bool {
        var cur: String? = id
        var steps = 0
        while let c = cur, steps < 64 {
            if c == ancestor { return true }
            cur = parentOf(c)
            steps += 1
        }
        return false
    }

    public enum Refusal: String, Sendable { case selfTarget, descendant, tooDeep }

    /// Whether `folder` may go inside `target` (nil: the top level).
    public func canMove(_ folder: String, into target: String?) -> Refusal? {
        guard let target else { return nil }
        if target == folder { return .selfTarget }
        if isWithin(target, folder) { return .descendant }
        if depth(target) + 1 + height(folder) > Self.maxDepth - 1 { return .tooDeep }
        return nil
    }

    /// The sibling a folder dropped at `index` among `parent`'s children goes after (nil: first). The dragged
    /// folder itself doesn't count (moving it down past itself).
    public func afterId(dropping folder: String, into parent: String?, at index: Int) -> String? {
        let siblings = children(of: parent)
        guard index > 0 else { return nil }
        let before = siblings.prefix(index).filter { $0 != folder }
        return before.last
    }
}
