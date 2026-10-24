// Folders as rows and as a tree (web app/Sidebar.tsx folders section, iphone/Organize.tsx list): each row opens its
// folder, shows its menu on long press or right click, drags into other folders, and takes drops (before, inside or
// after by where on the row; spring-loaded on the iPad and the Mac). The tree nests folders with disclosure, keeps
// which ones are open, and lists only the first few top-level folders with "+N more" (and "Show less"), opened
// down to the folder you're in, as the sidebar does. Frames can use `FolderTreeView` in their sidebars too.
import SwiftUI
import FoleviDesign
import FoleviEngine

/// One folder as a row: glyph in its colour, name, where it is (nested folders outside their parent), count.
struct FolderRowCell: View {
    let node: FolderNode
    var path: String? = nil
    var indent: CGFloat = 0
    var disclosure: Bool? = nil
    var onDisclosure: () -> Void = {}
    var active = false
    let context: FolderMenuContext
    let actions: NoteActions
    let dialogs: FolderDialogState
    var onOpen: () -> Void
    var onSpring: (@MainActor () -> Void)? = nil
    var onDropNotes: ([NoteDragItem]) -> Void
    var onDropFolder: (FolderDragItem, FolderRules.Zone) -> Void
    @State private var zone: FolderRules.Zone?
    @State private var spring = SpringLoader()
    @ScaledMetric(relativeTo: .body) private var height: CGFloat = 46

    var body: some View {
        let folder = MenuFolder(node)
        HStack(spacing: 8) {
            if let disclosure {
                Button(action: onDisclosure) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Folevi.color.inkFaint)
                        .rotationEffect(.degrees(disclosure ? 90 : 0))
                        .frame(width: 20, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(disclosure ? "Collapse \(node.name)" : "Expand \(node.name)")
            } else {
                Color.clear.frame(width: 20)
            }
            Button(action: onOpen) {
                HStack(spacing: 10) {
                    FolderGlyph(colorId: node.color, size: 22)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(node.name).foleviFont(.body).foregroundStyle(Folevi.color.ink).lineLimit(1)
                            if context.isLocked(node.id) { Image(systemName: "lock.fill").font(.system(size: 10)).foregroundStyle(Folevi.color.inkFaint).accessibilityLabel("Always fully encrypted") }
                            if node.sync != .saved { Image(systemName: "icloud.slash").font(.system(size: 10)).foregroundStyle(Folevi.color.emberInk).accessibilityLabel("Not synced") }
                        }
                        if let path { Text("in \(path)").foleviFont(.caption).foregroundStyle(Folevi.color.inkFaint).lineLimit(1) }
                    }
                    Spacer(minLength: 8)
                    if let n = node.noteCount, n > 0 { Text(n.formatted()).foleviFont(.callout).foregroundStyle(Folevi.color.inkFaint).monospacedDigit() }
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(RowPressStyle())
        }
        .padding(.leading, indent)
        .padding(.horizontal, 4)
        .frame(height: path == nil ? height : height + 12)
        .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.small, style: .continuous).fill(active ? Folevi.color.accentSoft : zone == .inside ? Folevi.color.emberSoft : .clear))
        .overlay(alignment: zone == .before ? .top : .bottom) {
            if zone == .before || zone == .after { Capsule().fill(Folevi.color.ember).frame(height: 2.5).padding(.leading, indent + 28) }
        }
        .contextMenu { FolderMenuItems(folder: folder, context: context, actions: actions, dialogs: dialogs) }
        .draggable(FolderDragItem(id: node.id, name: node.name, parentId: node.parentId)) {
            HStack { FolderGlyph(colorId: node.color, size: 20); Text(node.name).foleviFont(.body) }.padding(8).background(Folevi.color.surfaceRaised)
        }
        .onDrop(of: [.foleviNoteRef, .foleviFolderRef], delegate: FolderDrop(folderId: node.id, axis: .vertical, length: path == nil ? height : height + 12, zone: $zone, spring: spring, onSpring: onSpring, onNotes: onDropNotes, onFolder: onDropFolder))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(node.name)\(path.map { ", in \($0)" } ?? "")\(node.noteCount.map { ", \($0 == 1 ? "1 page" : "\($0) pages")" } ?? "")")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("folder-row-\(node.id)")
    }
}

/// Which folders are open in a tree, kept per device (the web keeps them in local storage).
@MainActor
@Observable
public final class FolderTreeState {
    public var open: Set<String>
    public var showAll: Bool {
        didSet { defaults.set(showAll, forKey: "\(key).all") }
    }
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let key: String

    public init(key: String = "folevi.folders.tree", defaults: UserDefaults = .standard) {
        self.key = key
        self.defaults = defaults
        open = Set(defaults.stringArray(forKey: "\(key).open") ?? [])
        showAll = defaults.bool(forKey: "\(key).all")
    }

    public func toggle(_ id: String) {
        if open.contains(id) { open.remove(id) } else { open.insert(id) }
        defaults.set(Array(open), forKey: "\(key).open")
    }

    public func expand(_ id: String) {
        guard !open.contains(id) else { return }
        open.insert(id)
        defaults.set(Array(open), forKey: "\(key).open")
    }
}

/// The rows a tree shows: open folders' children under them, only the first `limit` top-level folders (plus the
/// active one's) until "+N more". Pure, so the tests check it against the sidebar's rules.
public enum FolderTreeRows {
    public static let sidebarLimit = 5

    public struct Row: Hashable, Sendable {
        public var node: FolderNode
        public var hasChildren: Bool
        public var open: Bool
    }

    public static func rows(_ tree: [FolderNode], open: Set<String>, activeId: String?, showAll: Bool, limit: Int = sidebarLimit) -> (rows: [Row], hidden: Int) {
        // The active folder's ancestors are open, so it shows.
        var opened = open
        var activeRoot: String?
        if let activeId, let active = tree.first(where: { $0.id == activeId }) {
            var at = active.parentId
            activeRoot = active.id
            while let a = at, let node = tree.first(where: { $0.id == a }) {
                opened.insert(a)
                activeRoot = a
                at = node.parentId
            }
        }
        let roots = tree.filter { $0.depth == 0 }
        let shownRoots = showAll ? roots : roots.enumerated().filter { $0.offset < limit || $0.element.id == activeRoot }.map(\.element)
        let shown = Set(shownRoots.map(\.id))
        var out: [Row] = []
        var skipBelow: Int?
        var inShownRoot = false
        for node in tree {
            if node.depth == 0 { inShownRoot = shown.contains(node.id); skipBelow = nil }
            guard inShownRoot else { continue }
            if let s = skipBelow, node.depth > s { continue }
            skipBelow = nil
            let isOpen = opened.contains(node.id)
            out.append(Row(node: node, hasChildren: node.childCount > 0, open: isOpen))
            if !isOpen { skipBelow = node.depth }
        }
        return (out, roots.count - shownRoots.count)
    }
}

/// The folder tree: nested rows with disclosure, drops and menus, "+N more" and "Show less".
public struct FolderTreeView: View {
    let tree: [FolderNode]
    let context: FolderMenuContext
    let actions: NoteActions
    let dialogs: FolderDialogState
    @Bindable var state: FolderTreeState
    var activeId: String?
    var limit: Int?
    @Environment(\.screenNavigator) private var navigator

    public init(tree: [FolderNode], context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState, state: FolderTreeState, activeId: String? = nil, limit: Int? = FolderTreeRows.sidebarLimit) {
        self.tree = tree
        self.context = context
        self.actions = actions
        self.dialogs = dialogs
        self.state = state
        self.activeId = activeId
        self.limit = limit
    }

    public var body: some View {
        let result = FolderTreeRows.rows(tree, open: state.open, activeId: activeId, showAll: limit == nil || state.showAll, limit: limit ?? .max)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(result.rows, id: \.node.id) { row in
                FolderRowCell(
                    node: row.node,
                    indent: CGFloat(row.node.depth) * 18,
                    disclosure: row.hasChildren ? row.open : nil,
                    onDisclosure: { state.toggle(row.node.id) },
                    active: row.node.id == activeId,
                    context: context,
                    actions: actions,
                    dialogs: dialogs,
                    onOpen: { navigator.open(.folder(id: row.node.id), nil) },
                    // Held over a closed folder, the tree opens it (as the Finder does), so a drag can go deeper.
                    onSpring: row.hasChildren && !row.open ? { state.expand(row.node.id) } : nil,
                    onDropNotes: { items in Task { await FolderDrops.dropNotes(items, into: row.node, actions: actions) } },
                    onDropFolder: { item, zone in Task { await FolderDrops.drop(item, targetId: row.node.id, targetName: row.node.name, zone: zone, links: context.links, actions: actions) } }
                )
            }
            if result.hidden > 0 {
                Button { state.showAll = true } label: {
                    Text("+\(result.hidden.formatted()) more").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).padding(.leading, 30).frame(minHeight: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(result.hidden) more folders")
                // A drag held on "+N more" shows every folder, so it can reach one that was hidden (web data-drop-expand).
                .onDrop(of: [.foleviNoteRef, .foleviFolderRef], isTargeted: Binding(get: { false }, set: { if $0 { state.showAll = true } })) { _ in false }
            } else if limit != nil && state.showAll && tree.filter({ $0.depth == 0 }).count > (limit ?? 0) {
                Button { state.showAll = false } label: {
                    Text("Show less").foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted).padding(.leading, 30).frame(minHeight: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Show fewer folders")
            }
        }
    }
}

extension FolderDrops {
    @MainActor
    static func dropNotes(_ items: [NoteDragItem], into node: FolderNode, actions: NoteActions) async {
        let notes = items.flatMap(\.notes)
        var from: [String: String?] = [:]
        for n in notes { from[n.id] = n.folderId }
        await actions.move(notes.map(\.id), to: FolderTarget(id: node.id, name: node.name), from: from)
    }
}

/// Where a folder is: its ancestors as chips that open them and take drops (a folder dropped on one moves inside
/// it, which takes it out of the folders between).
struct FolderPathBar: View {
    let ancestors: [FolderNode]
    let actions: NoteActions
    let links: [FolderRules.Link]
    @Environment(\.screenNavigator) private var navigator

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Button { navigator.open(.allFolders, nil) } label: {
                    Image(systemName: "folder").font(.system(size: 12, weight: .medium)).foregroundStyle(Folevi.color.inkMuted).frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("All folders")
                .onDrop(of: [.foleviFolderRef], delegate: SectionDrop { item in
                    Task { await FolderDrops.drop(item, targetId: nil, targetName: nil, zone: .after, links: links, actions: actions) }
                })
                ForEach(ancestors, id: \.id) { a in
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Folevi.color.inkFaint).accessibilityHidden(true)
                    PathChip(node: a, actions: actions, links: links) { navigator.open(.folder(id: a.id), nil) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Folder path")
    }
}

private struct PathChip: View {
    let node: FolderNode
    let actions: NoteActions
    let links: [FolderRules.Link]
    let onOpen: () -> Void
    @State private var zone: FolderRules.Zone?
    @State private var spring = SpringLoader()

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 5) {
                FolderGlyph(colorId: node.color, size: 14)
                Text(node.name).lineLimit(1)
            }
            .foleviFont(.footnote)
            .foregroundStyle(Folevi.color.ink)
            .padding(.horizontal, 8)
            .frame(minHeight: 26)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.chip, style: .continuous).fill(zone != nil ? Folevi.color.emberSoft : Folevi.color.accentSoft))
        }
        .buttonStyle(.plain)
        .onDrop(of: [.foleviNoteRef, .foleviFolderRef], delegate: FolderDrop(folderId: node.id, axis: .horizontal, length: 0, zone: $zone, spring: spring, onSpring: onOpen, onNotes: { items in
            Task { await FolderDrops.dropNotes(items, into: node, actions: actions) }
        }, onFolder: { item, _ in
            Task { await FolderDrops.drop(item, targetId: node.id, targetName: node.name, zone: .inside, links: links, actions: actions) }
        }))
        .accessibilityHint("Opens \(node.name)")
    }
}
