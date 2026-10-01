import Foundation

/// Organizing notes (the web's noteActions.ts and useCardSelection.ts): one action on one or many notes,
/// sent to `documents:bulkUpdate`, and the multi-select that picks them.
public enum BulkAction: Equatable, Sendable {
    /// `nil` moves to Drafts (no folder).
    case move(folderId: String?)
    case star(Bool)
    case archive(Bool)
    case trash
    case restore
    case delete

    /// The `action` argument of documents:bulkUpdate.
    public var arg: JSONValue {
        switch self {
        case .move(let folderId): return ["kind": "move", "folderId": folderId.map { .string($0) } ?? .null]
        case .star(let starred): return ["kind": "star", "starred": .bool(starred)]
        case .archive(let archived): return ["kind": "archive", "archived": .bool(archived)]
        case .trash: return ["kind": "trash"]
        case .restore: return ["kind": "restore"]
        case .delete: return ["kind": "delete"]
        }
    }
}

public enum Organize {
    /// The server takes at most this many notes per bulk call (documents.MAX_BULK); bigger sets go in turns.
    public static let chunkSize = 50

    public static func chunks(_ ids: [String], size: Int = chunkSize) -> [[String]] {
        stride(from: 0, to: ids.count, by: max(1, size)).map { Array(ids[$0..<min($0 + size, ids.count)]) }
    }

    /// "1 note" / "12 notes".
    public static func notes(_ n: Int) -> String {
        n == 1 ? String(localized: "1 note") : String(localized: "\(n.formatted()) notes")
    }

    /// What the toast says after an action changed `n` notes (the web's wording).
    public static func message(for action: BulkAction, count n: Int, folderName: String? = nil) -> String {
        switch action {
        case .move:
            let name = folderName ?? String(localized: "Drafts")
            return n == 1 ? String(localized: "Moved to \(name)") : String(localized: "Moved \(notes(n)) to \(name)")
        case .star(true): return n == 1 ? String(localized: "Starred") : String(localized: "Starred \(notes(n))")
        case .star(false): return n == 1 ? String(localized: "Removed from Starred") : String(localized: "Unstarred \(notes(n))")
        case .archive(true): return n == 1 ? String(localized: "Archived") : String(localized: "Archived \(notes(n))")
        case .archive(false): return n == 1 ? String(localized: "Moved out of Archive") : String(localized: "Moved \(notes(n)) out of Archive")
        case .trash: return n == 1 ? String(localized: "Moved to Trash") : String(localized: "Moved \(notes(n)) to Trash")
        case .restore: return n == 1 ? String(localized: "Restored") : String(localized: "Restored \(notes(n))")
        case .delete: return String(localized: "\(notes(n)) will be permanently deleted.")
        }
    }

    /// Notes the server skipped (no permission, or not in a state the action applies to).
    public static func skippedMessage(_ n: Int) -> String {
        String(localized: "\(notes(n)) couldn’t be changed. You may not have permission.")
    }

    /// The action that undoes `action` (none for permanent deletion; moves undo per note, see `moveBack`).
    public static func inverse(of action: BulkAction) -> BulkAction? {
        switch action {
        case .star(let s): return .star(!s)
        case .archive(let a): return .archive(!a)
        case .trash: return .restore
        case .restore: return .trash
        case .move, .delete: return nil
        }
    }

    /// Undoing a move: each note goes back to the folder it came from, grouped into one call per folder
    /// (`nil` = Drafts), in a stable order.
    public static func moveBack(done: [String], previousFolders: [String: String?]) -> [(folderId: String?, ids: [String])] {
        var order: [String?] = []
        var groups: [String?: [String]] = [:]
        for id in done {
            let from: String? = previousFolders[id] ?? nil
            if groups[from] == nil { order.append(from) }
            groups[from, default: []].append(id)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }

    /// The "Empty Trash?" dialog's description (the web's wording).
    public static func emptyTrashText(total: Int, deletable: Int, more: Bool) -> String {
        let count = "\(deletable.formatted())\(more ? "+" : "")"
        var text = deletable == 1
            ? String(localized: "\(count) note will be permanently deleted, including attachments and version history. This can’t be undone.")
            : String(localized: "\(count) notes will be permanently deleted, including attachments and version history. This can’t be undone.")
        if deletable < total {
            text += " " + String(localized: "\((total - deletable).formatted()) you don’t have permission to delete will stay in Trash.")
        }
        return text
    }

    /// "{n} documents will be permanently deleted." after emptying the Trash.
    public static func trashScheduled(_ n: Int) -> String {
        n == 1 ? String(localized: "1 document will be permanently deleted.") : String(localized: "\(n.formatted()) documents will be permanently deleted.")
    }
}

/// Multi-select over the notes shown in a list (⌘-click toggles, Shift-click selects the range from the
/// last one, ⌘A selects everything shown, Escape clears). Only notes still shown count as selected.
public struct NoteSelectionState: Equatable, Sendable {
    public private(set) var picked: Set<String> = []
    public private(set) var anchor: String?

    public init() {}

    public func selectedIds(in shown: [String]) -> [String] { shown.filter { picked.contains($0) } }
    public func isSelected(_ id: String) -> Bool { picked.contains(id) }
    public var isEmpty: Bool { picked.isEmpty }

    public mutating func toggle(_ id: String) {
        anchor = id
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }

    public mutating func selectRange(to id: String, in shown: [String]) {
        guard let to = shown.firstIndex(of: id) else { return }
        let from = anchor.flatMap { shown.firstIndex(of: $0) }
        let (a, b) = from.map { $0 < to ? ($0, to) : (to, $0) } ?? (to, to)
        picked.formUnion(shown[a...b])
        if from == nil { anchor = id }
    }

    public mutating func selectAll(_ shown: [String]) { picked = Set(shown) }

    public mutating func clear() {
        picked = []
        anchor = nil
    }
}
