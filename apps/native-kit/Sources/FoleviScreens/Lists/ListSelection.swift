// Finder-style multi-select of a list's folders and notes (the web's lib/app/multiSelect.ts; docs/DESIGN_SYSTEM.md
// "Multi-select"), as plain values so the Mac and iPad lists and the tests share the rules:
// - a plain click opens the item, as ever;
// - ⌘-click adds or removes one item, ⇧-click selects the run from the last one clicked;
// - ⌘A selects every item shown, Escape clears;
// - the actions offered are those every selected item can take (a folder and a note: Open in new tabs and Move).
import Foundation

public struct ListSelection: Equatable, Sendable {
    public var picked: Set<String>
    /// Where a ⇧-click range starts: the last item ⌘-clicked.
    public var anchor: String?

    public init(picked: Set<String> = [], anchor: String? = nil) {
        self.picked = picked
        self.anchor = anchor
    }

    public var isEmpty: Bool { picked.isEmpty }
    public var count: Int { picked.count }
    public func contains(_ id: String) -> Bool { picked.contains(id) }

    /// ⌘-click: the item goes in, or comes out; either way the next range starts from it.
    public mutating func toggle(_ id: String) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
        anchor = id
    }

    /// ⇧-click: every item from the anchor to `id` (in `order`, the list as shown) joins the selection. With no
    /// anchor (or one no longer shown) it's the item alone, and it becomes the anchor.
    public mutating func extend(to id: String, in order: [String]) {
        guard let to = order.firstIndex(of: id) else { return }
        guard let anchor, let from = order.firstIndex(of: anchor) else {
            picked.insert(id)
            self.anchor = id
            return
        }
        for i in min(from, to)...max(from, to) { picked.insert(order[i]) }
    }

    /// ⌘A: everything shown.
    public mutating func selectAll(_ order: [String]) {
        picked = Set(order)
        anchor = order.first
    }

    public mutating func clear() {
        picked.removeAll()
        anchor = nil
    }

    /// The selected ids still shown, in the list's order.
    public func ordered(_ order: [String]) -> [String] { order.filter { picked.contains($0) } }

    /// What a click does: toggle (⌘), range (⇧), or nil (it opens the item).
    public enum Click: Sendable { case toggle, range }

    public static func click(command: Bool, shift: Bool, option: Bool = false) -> Click? {
        if option { return nil }
        if command { return .toggle }
        if shift { return .range }
        return nil
    }
}

/// One selected item, with what decides the actions it can take.
public struct SelectedItem: Sendable, Hashable {
    public enum Kind: Sendable, Hashable { case note, folder }
    public var kind: Kind
    public var starred: Bool
    public var archived: Bool
    public var template: Bool

    public init(_ kind: Kind, starred: Bool = false, archived: Bool = false, template: Bool = false) {
        self.kind = kind
        self.starred = starred
        self.archived = archived
        self.template = template
    }

    public static let folder = SelectedItem(.folder)
}

public extension ListSelection {
    /// The actions a selection offers, in the bar's order: only those every selected item can take. Notes: bookmark,
    /// archive, trash (and copy elsewhere); folders: colour and delete; both: open in new tabs and move.
    static func actions(_ items: [SelectedItem], trash: Bool = false, canEdit: Bool, canCopy: Bool = false, tabs: Bool = false) -> [BulkAction] {
        guard !items.isEmpty else { return [] }
        let notes = items.filter { $0.kind == .note }
        let allNotes = notes.count == items.count
        let allFolders = notes.isEmpty
        if trash { return allNotes ? [.restore, .deleteForever] : [] }
        var out: [BulkAction] = []
        if tabs { out.append(.openTabs) }
        // Templates aren't filed in folders; where nothing can be changed nothing moves.
        if canEdit && !notes.contains(where: \.template) { out.append(.move) }
        if allNotes && canCopy { out.append(.copy) }
        if allNotes { out.append(notes.allSatisfy(\.starred) ? .unstar : .star) }
        if allFolders && canEdit { out.append(.color) }
        if allNotes { out.append(notes.allSatisfy(\.archived) ? .unarchive : .archive) }
        if allNotes { out.append(.trash) }
        if allFolders && canEdit { out.append(.deleteFolders) }
        return out
    }

    /// What's selected, in words: "1 note", "2 folders", "1 folder and 3 notes".
    static func noun(notes: Int, folders: Int) -> String {
        func n(_ c: Int, _ one: String, _ many: String) -> String { c == 1 ? "1 \(one)" : "\(c.formatted()) \(many)" }
        if folders == 0 { return n(notes, "note", "notes") }
        if notes == 0 { return n(folders, "folder", "folders") }
        return "\(n(folders, "folder", "folders")) and \(n(notes, "note", "notes"))"
    }

    /// Moving several selected folders into `target` (nil: the top level): which move, which are there already and
    /// which can't go (into itself, its own subfolder, too deep). A folder inside another selected folder goes along
    /// with that one and isn't moved on its own.
    static func planFolderMoves(_ links: [FolderRules.Link], ids: [String], into target: String?) -> (move: [String], unchanged: [String], refused: [(id: String, problem: FolderRules.Problem)]) {
        let parent = Dictionary(links.map { ($0.id, $0.parentId) }, uniquingKeysWith: { a, _ in a })
        let picked = Set(ids)
        var move: [String] = [], unchanged: [String] = [], refused: [(id: String, problem: FolderRules.Problem)] = []
        for id in ids {
            guard let up = parent[id] else { continue }
            // Inside another selected folder (not the target itself): it goes along with that one.
            var p = up, steps = 0, carried = false
            while let a = p, steps < 64 {
                if picked.contains(a) && a != target { carried = true; break }
                p = parent[a] ?? nil
                steps += 1
            }
            if carried { continue }
            if up == target { unchanged.append(id); continue }
            if let problem = FolderRules.moveProblem(links, id: id, into: target) { refused.append((id, problem)) } else { move.append(id) }
        }
        return (move, unchanged, refused)
    }
}
