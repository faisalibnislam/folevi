// All folders (web views/OrganizeIndex.tsx, iphone/Organize.tsx): every folder of the space, nested ones too, as
// folder cards ("in Work / Clients" under a nested one), as rows, or as the tree; a search field, sort (Name, Last
// updated, Most notes, Newest), New folder, and every folder's menu, drags and drops. On the iPhone the tree is how
// nested folders are walked without opening each one.
import SwiftUI
import Observation
import FoleviDesign
import FoleviEngine

public enum FoldersLayout: String, Sendable, CaseIterable { case tiles, list, tree }
public enum FoldersSort: String, Sendable, CaseIterable { case name, updated, count, created }

@MainActor
@Observable
public final class AllFoldersModel {
    public let client: EngineClient
    public let actions: NoteActions
    public let tree: ValueStore<FoldersTreeValue>
    public let cards: ValueStore<FolderCardsValue>
    public let session: ValueStore<SessionValue>
    public let places: ValueStore<PlacesValue>
    public let locks: ValueStore<FolderLocksValue>
    public let dialogs = FolderDialogState()
    public let treeState: FolderTreeState
    public var query = ""
    public var layout: FoldersLayout { didSet { defaults.set(layout.rawValue, forKey: "folevi.folders.layout") } }
    public var sort: FoldersSort { didSet { defaults.set(sort.rawValue, forKey: "folevi.folders.sort") } }
    @ObservationIgnored private let defaults: UserDefaults

    public init(client: EngineClient, feedback: ScreenFeedback = ScreenFeedback(), space: SpaceRef? = nil, defaults: UserDefaults = .standard) {
        self.client = client
        self.defaults = defaults
        self.actions = NoteActions(client: client, feedback: feedback, space: space)
        self.tree = client.watch(.foldersTree(space: space), snapshotKey: "folders.tree.\(client.place).\(space ?? "current")")
        // Top-level cards carry previews and update times; nested folders draw from the tree until R9.3.
        self.cards = client.watch(.foldersCards(space: space, parentId: nil))
        self.session = client.watch(.session, snapshotKey: "session.\(client.place)")
        self.places = client.watch(.placesList)
        self.locks = client.watch(PendingN7Views.FolderLocks(SpaceArgs(space: space)))
        self.treeState = FolderTreeState(defaults: defaults)
        self.layout = defaults.string(forKey: "folevi.folders.layout").flatMap(FoldersLayout.init(rawValue:)) ?? .tiles
        self.sort = defaults.string(forKey: "folevi.folders.sort").flatMap(FoldersSort.init(rawValue:)) ?? .name
    }

    public var nodes: [FolderNode] { tree.value?.folders ?? [] }
    public var isLoading: Bool { tree.value == nil }
    public var total: Int { nodes.count }
    public var links: [FolderRules.Link] { FolderRules.links(nodes) }

    public var canEdit: Bool {
        guard let s = session.value else { return true }
        return s.spaces.first { $0.id == s.space }?.canEdit ?? true
    }

    public var context: FolderMenuContext {
        FolderMenuContext(session: session.value, places: places.value, links: links, locks: locks.error == nil ? locks.value : nil)
    }

    /// "Work / Clients" for nested folders (their ancestors' names).
    public func path(_ node: FolderNode) -> String? {
        guard node.parentId != nil else { return nil }
        var names: [String] = []
        var at = node.parentId
        var guardCount = 0
        while let id = at, let parent = nodes.first(where: { $0.id == id }), guardCount < 64 {
            names.insert(parent.name, at: 0)
            at = parent.parentId
            guardCount += 1
        }
        return names.isEmpty ? nil : names.joined(separator: " / ")
    }

    private func card(_ id: String) -> FolderCard? { cards.value?.folders.first { $0.id == id } }

    /// The folders shown in tiles and list: matching the search, sorted.
    public var shown: [FolderNode] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var out = q.isEmpty ? nodes : nodes.filter { $0.name.lowercased().contains(q) || (path($0)?.lowercased().contains(q) ?? false) }
        switch sort {
        case .name:
            out.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .count:
            out.sort { ($0.noteCount ?? 0, $1.name) > ($1.noteCount ?? 0, $0.name) }
        case .updated:
            out.sort { (card($0.id)?.updatedAt ?? 0) > (card($1.id)?.updatedAt ?? 0) }
        case .created:
            // Newest first: folders made later rank later in the tree until R9.3 gives createdAt.
            out.reverse()
        }
        return out
    }

    public func cardModel(_ node: FolderNode) -> FolderCardModel {
        if let c = card(node.id) { return CardMapping.folderCard(c, parentName: path(node)) }
        var m = CardMapping.folderCard(node)
        m.parentName = path(node)
        return m
    }

    public var sortOptions: [(FoldersSort, String)] { [(.name, "Name"), (.updated, "Last updated"), (.count, "Most notes"), (.created, "Newest")] }

    public var emptyTitle: String {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? "No folders yet" : "No folders match “\(q)”"
    }

    public func setVisible(_ on: Bool) {
        tree.setVisible(on)
        cards.setVisible(on)
    }

    public func refresh() async {
        do { try await client.command(.engineRefresh) } catch { actions.report(error) }
    }
}

public struct AllFoldersScreen: View {
    @Bindable var model: AllFoldersModel
    @State private var width: CGFloat = 390
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(model: AllFoldersModel) { self.model = model }

    private var gutter: CGFloat { width < 600 ? 16 : 28 }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                SearchField(text: $model.query, prompt: "Search")
                    .padding(.horizontal, gutter)
                    .padding(.vertical, 6)
                if model.isLoading {
                    VStack(spacing: 0) { ForEach(0..<6, id: \.self) { _ in PlaceholderRow() } }.padding(.horizontal, gutter)
                } else if model.shown.isEmpty {
                    EmptyState(systemImage: "folder", title: model.emptyTitle, message: model.query.isEmpty ? "Folders keep related notes together." : nil, actionTitle: model.query.isEmpty && model.canEdit ? "New folder" : nil) {
                        model.dialogs.open(.newFolder(parent: nil))
                    }
                    .padding(.top, 30)
                } else {
                    switch model.layout {
                    case .tiles: tiles
                    case .list: rows
                    case .tree:
                        FolderTreeView(tree: model.nodes, context: model.context, actions: model.actions, dialogs: model.dialogs, state: model.treeState, limit: nil)
                            .padding(.horizontal, gutter - 4)
                    }
                }
            }
            .padding(.bottom, 120)
        }
        .background(Folevi.color.canvas)
        .refreshable { await model.refresh() }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .folderDialogs(model.dialogs, actions: model.actions, tree: model.nodes)
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("all-folders")
    }

    private var columns: [GridItem] {
        let count = typeSize.isAccessibilitySize ? 1 : max(2, Int((width - gutter * 2 + 14) / ((width < 600 ? 150 : 180) + 14)))
        return Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .top), count: count)
    }

    private var tiles: some View {
        LazyVGrid(columns: columns, spacing: 20) {
            ForEach(model.shown, id: \.id) { node in
                FolderCardCell(
                    card: model.cardModel(node),
                    folder: MenuFolder(node),
                    context: model.context,
                    actions: model.actions,
                    dialogs: model.dialogs,
                    onOpen: { navigator.open(.folder(id: node.id), $0) },
                    onDropNotes: { items in Task { await FolderDrops.dropNotes(items, into: node, actions: model.actions) } },
                    onDropFolder: { item, zone in Task { await FolderDrops.drop(item, targetId: node.id, targetName: node.name, zone: zone, links: model.links, actions: model.actions) } }
                )
            }
        }
        .padding(.horizontal, gutter)
        .padding(.top, 8)
    }

    private var rows: some View {
        VStack(spacing: 0) {
            ForEach(model.shown, id: \.id) { node in
                FolderRowCell(
                    node: node,
                    path: model.path(node),
                    context: model.context,
                    actions: model.actions,
                    dialogs: model.dialogs,
                    onOpen: { navigator.open(.folder(id: node.id), nil) },
                    onSpring: { navigator.open(.folder(id: node.id), nil) },
                    onDropNotes: { items in Task { await FolderDrops.dropNotes(items, into: node, actions: model.actions) } },
                    onDropFolder: { item, zone in Task { await FolderDrops.drop(item, targetId: node.id, targetName: node.name, zone: zone, links: model.links, actions: model.actions) } }
                )
                RowDivider(leadingInset: 58)
            }
        }
        .padding(.horizontal, gutter - 4)
    }
}

/// All folders' bar items: "…" with New folder, View as and Sort by.
public struct AllFoldersTrailingItems: View {
    @Bindable var model: AllFoldersModel
    let glass: Bool
    public init(model: AllFoldersModel, glass: Bool = true) {
        self.model = model
        self.glass = glass
    }
    public var body: some View {
        GlassWrap(glass) {
            Menu {
                if model.canEdit {
                    Button { model.dialogs.open(.newFolder(parent: nil)) } label: { Label("New folder", systemImage: "folder.badge.plus") }
                    Divider()
                }
                Section("View as") {
                    Picker("View as", selection: $model.layout) {
                        Label("Tiles", systemImage: "square.grid.2x2").tag(FoldersLayout.tiles)
                        Label("List", systemImage: "list.bullet").tag(FoldersLayout.list)
                        Label("Tree", systemImage: "list.bullet.indent").tag(FoldersLayout.tree)
                    }
                    .pickerStyle(.inline)
                }
                Section("Sort by") {
                    Picker("Sort by", selection: $model.sort) {
                        ForEach(model.sortOptions, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .pickerStyle(.inline)
                }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.ink).frame(width: 30, height: 30)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Folders options")
        }
    }
}

public struct AllFoldersToolbar: ToolbarContent {
    let model: AllFoldersModel
    public init(model: AllFoldersModel) { self.model = model }
    public var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) { AllFoldersTrailingItems(model: model, glass: !SystemGlass.inToolbars) }
    }
}
