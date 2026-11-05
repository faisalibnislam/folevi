// The sidebar's own folder order (the owner, 5 November 2026; the web's lib/app/sidebarFolderSort.ts): Manual
// (the folders' rank), Name (A to Z) or Recent (last changed first), chosen from the sort button beside Folders
// and kept on this device. It's independent of the Folders page's sort.
import Foundation
import FoleviEngine

public enum SidebarFolderSort: String, CaseIterable, Sendable {
    case manual, name, recent

    public var title: String {
        switch self {
        case .manual: "Manual"
        case .name: "Name"
        case .recent: "Recent"
        }
    }

    /// The folders in the order the sidebar lists them, each level sorted on its own (siblings keep the list's
    /// order). For Recent, `changed` is each folder's last change; one it doesn't know keeps its manual place
    /// after those it does.
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
}
