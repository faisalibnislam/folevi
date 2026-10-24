// Home (plan 5.3; web IphoneHome.tsx, HomeDashboard.tsx): the search field, recent notes as cards (a row on
// iPhone, a grid on iPad and Mac), Catch me up / Your week, All notes, Drafts, Shared with Me, Changes and Reviews
// with counts, Starred, Folders (cards, with drag and drop), Tags (folded), then Templates, Archive and Trash.
// The frame draws the bars: it reads `HomeScreen.title`, `model.eyebrow` and puts `HomeToolbar` where it
// belongs. Frames without a large title bar (the Mac's content area) pass `showsHeader: true`.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct HomeScreen: View {
    public static let title = "Home"

    @Bindable var model: HomeModel
    let showsHeader: Bool
    @State private var tagsOpen = false
    @State private var width: CGFloat = 390
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(model: HomeModel, showsHeader: Bool = false) {
        self.model = model
        self.showsHeader = showsHeader
    }

    private var compact: Bool { width < 600 }
    private var gutter: CGFloat { compact ? 16 : 28 }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if showsHeader { HomeHeader(eyebrow: model.eyebrow, sync: model.syncIndicator).padding(.horizontal, gutter).padding(.top, 12) }
                searchEntry.padding(.horizontal, gutter).padding(.top, showsHeader ? 14 : 6)
                if model.locked {
                    EmptyState(systemImage: "lock", title: "\(model.spaceName) is locked", message: "Unlock this device to see its notes.")
                        .padding(.top, 30)
                } else {
                    recents.padding(.top, 14)
                    rows.padding(.horizontal, gutter)
                    starred.padding(.horizontal, gutter).padding(.top, 26)
                    folders.padding(.top, 26)
                    if !model.tags.isEmpty { tags.padding(.horizontal, gutter).padding(.top, 18) }
                    more.padding(.horizontal, gutter).padding(.top, 22)
                }
            }
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 120)
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Folevi.color.canvas)
        .refreshable { await model.refresh() }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .folderDialogs(model.dialogs, actions: model.actions, tree: model.tree.value?.folders ?? [])
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("home-screen")
    }

    // MARK: Search

    private var searchEntry: some View {
        Button { navigator.open(.search(prompt: model.searchPrompt), nil) } label: {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .medium)).foregroundStyle(Folevi.color.inkFaint)
                Text(model.searchPrompt).foleviFont(.body).foregroundStyle(Folevi.color.inkFaint).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 38)
            .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.control, style: .continuous).fill(Folevi.color.surfaceSunken))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.searchPrompt)
        .accessibilityAddTraits(.isSearchField)
        .accessibilityIdentifier("home-search")
        .keyboardShortcut("f", modifiers: .command)
    }

    // MARK: Recents

    @ViewBuilder private var recents: some View {
        if !model.recentsLoaded && model.recents.isEmpty {
            HStack(spacing: 14) { ForEach(0..<3, id: \.self) { _ in PlaceholderCard().frame(width: 156) } }
                .padding(.horizontal, gutter)
                .padding(.bottom, 20)
                .accessibilityLabel("Loading")
        } else if model.recents.isEmpty {
            Text("Notes you open show up here")
                .foleviFont(.callout)
                .foregroundStyle(Folevi.color.inkMuted)
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(Folevi.color.line, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
                .padding(.horizontal, gutter)
                .padding(.bottom, 16)
        } else if compact && !typeSize.isAccessibilitySize {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 14) {
                    ForEach(model.recents, id: \.id) { row in recentCard(row).frame(width: 156) }
                }
                .scrollTargetLayout()
                .padding(.horizontal, gutter)
                .padding(.top, 4)
                .padding(.bottom, 22)
            }
            .scrollTargetBehavior(.viewAligned)
            .accessibilityLabel("Recent notes")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 260 : 168, maximum: typeSize.isAccessibilitySize ? 600 : 230), spacing: 18, alignment: .top)], spacing: 22) {
                ForEach(model.recents, id: \.id) { row in recentCard(row) }
            }
            .padding(.horizontal, gutter)
            .padding(.bottom, 22)
            .accessibilityLabel("Recent notes")
        }
    }

    private func recentCard(_ row: NoteRow) -> some View {
        let starred = model.actions.isStarred(row)
        return NoteCardCell(
            row: row,
            model: CardMapping.noteCard(row, starred: starred),
            onTap: { navigator.open(.note(id: row.id), $0) },
            accessibilityActions: [
                (starred ? "Unstar" : "Star", { Task { await model.actions.star([row.id], !starred) } }),
                ("Remove from recent", { Task { await model.actions.removeFromRecent([row.id]) } }),
                ("Move to Trash", { Task { await model.actions.trash([row.id]) } }),
            ]
        ) {
            HomeNoteMenu(row: row, starred: starred, recent: true, model: model)
        }
    }

    // MARK: Rows

    private var rows: some View {
        VStack(spacing: 0) {
            catchUp
            ForEach(model.rows, id: \.id) { row in
                Button { navigator.open(ScreenRoute(webRoute: row.route), nil) } label: {
                    ListRow(row.title, systemImage: HomeModel.symbol(for: row.id), accessory: model.count(row).map { .count($0) } ?? .chevron)
                }
                .buttonStyle(RowPressStyle())
                .accessibilityIdentifier("home-row-\(row.id.rawValue)")
                RowDivider()
            }
        }
    }

    @ViewBuilder private var catchUp: some View {
        switch model.catchUp {
        case .hidden:
            EmptyView()
        case .offer(let error):
            VStack(alignment: .leading, spacing: 4) {
                Button { Task { await model.runCatchUp() } } label: {
                    ListRow("Catch me up") { FoliSpark(size: 18) }
                }
                .buttonStyle(RowPressStyle())
                .accessibilityHint("A quick AI brief of this week’s notes and what’s due")
                .accessibilityIdentifier("home-catch-up")
                if let error {
                    Text(error).foleviFont(.footnote).foregroundStyle(Folevi.color.destructive).padding(.leading, 34).padding(.bottom, 6)
                }
                RowDivider()
            }
        case .running:
            CatchUpCardView(phase: .running, onRefresh: {}, onClose: {}, onSource: { _ in }).padding(.vertical, 10)
        case .ready(let brief):
            CatchUpCardView(phase: .ready(brief)) {
                Task { await model.runCatchUp() }
            } onClose: {
                Task { await model.closeCatchUp() }
            } onSource: { id in
                navigator.open(.note(id: id), nil)
            }
            .padding(.vertical, 10)
        }
    }

    // MARK: Starred

    private var starred: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader("Starred", actionTitle: "See all") { navigator.open(.notes(.starred), nil) }
            if model.value != nil && model.starred.isEmpty {
                Text("Star notes to keep them close").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).padding(.vertical, 10)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.starred, id: \.id) { row in
                        Button { navigator.open(.note(id: row.id), CardFrames.shared.source(for: row.id)) } label: {
                            ListRow(row.title.isEmpty ? "Untitled" : row.title) { NoteGlyph(folderColor: row.folder?.color, plain: row.folder == nil) }
                        }
                        .buttonStyle(RowPressStyle { navigator.prepareNote(row.id) })
                        .modifier(RecordsFrame(id: row.id, kind: .noteRow))
                        .contextMenu { HomeNoteMenu(row: row, starred: true, recent: false, model: model) }
                        .draggable(NoteDragItem(id: row.id, title: row.title, folderId: row.folder?.id))
                        RowDivider()
                    }
                    if model.moreStarred {
                        Button { navigator.open(.notes(.starred), nil) } label: {
                            ListRow("See all starred", accessory: .chevron) { EmptyView() }
                        }
                        .buttonStyle(RowPressStyle())
                    }
                }
            }
        }
    }

    // MARK: Folders

    private var folderContext: FolderMenuContext {
        FolderMenuContext(session: model.session.value, places: model.places.value, links: model.folderLinks)
    }

    private var folders: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionHeader("Folders")
                Menu {
                    if model.canEdit {
                        Button { model.dialogs.open(.newFolder(parent: nil)) } label: { Label("New folder", systemImage: "folder.badge.plus") }
                    }
                    Button { navigator.open(.allFolders, nil) } label: { Label("All folders", systemImage: "folder") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.ink).frame(width: 30, height: 30)
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("Folder options")
            }
            .padding(.horizontal, gutter)
            // Dropping a folder on the section itself moves it to the top level, last.
            .onDrop(of: [.foleviFolderRef], delegate: SectionDrop { item in Task { await model.dropFolder(item, on: nil, zone: .after) } })
            if model.value != nil && model.folders.isEmpty {
                Text("Folders keep related notes together").foleviFont(.callout).foregroundStyle(Folevi.color.inkMuted).padding(.horizontal, gutter).padding(.vertical, 10)
            } else if compact && !typeSize.isAccessibilitySize {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(model.folders, id: \.id) { folderCell($0).frame(width: 142) }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, gutter)
                    .padding(.top, 6)
                    .padding(.bottom, 24)
                }
                .scrollTargetBehavior(.viewAligned)
                .accessibilityLabel("Folders")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 240 : 150, maximum: 210), spacing: 16, alignment: .top)], spacing: 20) {
                    ForEach(model.folders, id: \.id) { folderCell($0) }
                }
                .padding(.horizontal, gutter)
                .padding(.bottom, 12)
                .accessibilityLabel("Folders")
            }
        }
    }

    private func folderCell(_ folder: FolderCard) -> some View {
        FolderCardCell(
            card: CardMapping.folderCard(folder),
            folder: MenuFolder(folder),
            context: folderContext,
            actions: model.actions,
            dialogs: model.dialogs,
            onOpen: { navigator.open(.folder(id: folder.id), $0) },
            onDropNotes: { items in Task { await model.dropNotes(items, on: folder) } },
            onDropFolder: { item, zone in Task { await model.dropFolder(item, on: folder, zone: zone) } }
        )
    }

    // MARK: Tags

    private var tags: some View {
        DisclosureGroup(isExpanded: $tagsOpen) {
            VStack(spacing: 0) {
                ForEach(model.tags, id: \.id) { tag in
                    Button { navigator.open(.tag(id: tag.id), nil) } label: {
                        ListRow(tag.name) {
                            Image(systemName: "number").font(.system(size: 15, weight: .medium)).foregroundStyle(TagColors.color(tag.color))
                        }
                    }
                    .buttonStyle(RowPressStyle())
                    RowDivider()
                }
            }
        } label: {
            Text("Tags").foleviFont(.title2).foregroundStyle(Folevi.color.heading).accessibilityAddTraits(.isHeader)
        }
        .tint(Folevi.color.inkMuted)
    }

    // MARK: Templates, Archive, Trash

    private var more: some View {
        VStack(spacing: 0) {
            ForEach([("Templates", "rectangle.on.rectangle", NotesListView.templates), ("Archive", "archivebox", .archive), ("Trash", "trash", .trash)], id: \.0) { item in
                Button { navigator.open(.notes(item.2), nil) } label: {
                    ListRow(item.0, systemImage: item.1, accessory: .chevron)
                }
                .buttonStyle(RowPressStyle())
                .accessibilityIdentifier("home-row-\(item.2.rawValue)")
                RowDivider()
            }
        }
    }
}

/// "Home" in large serif with the workspace above it and the sync status under it (frames without a large
/// title bar).
public struct HomeHeader: View {
    let eyebrow: String?
    let sync: SyncIndicator?
    public init(eyebrow: String?, sync: SyncIndicator?) {
        self.eyebrow = eyebrow
        self.sync = sync
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let eyebrow { Text(eyebrow).foleviFont(.footnote).foregroundStyle(Folevi.color.inkMuted) }
            Text(HomeScreen.title).foleviFont(.largeTitle).foregroundStyle(Folevi.color.heading).accessibilityAddTraits(.isHeader)
            if let sync { SyncStatusView(sync, showsLabel: true).padding(.top, 2) }
        }
    }
}

/// The note menu on Home's cards and starred rows (web NoteContextMenu with `recent`).
struct HomeNoteMenu: View {
    let row: NoteRow
    let starred: Bool
    let recent: Bool
    let model: HomeModel
    @Environment(\.screenNavigator) private var navigator

    var body: some View {
        Button { navigator.open(.note(id: row.id), CardFrames.shared.source(for: row.id)) } label: { Label("Open", systemImage: "arrow.up.forward.square") }
        Divider()
        Button { Task { await model.actions.star([row.id], !starred) } } label: { Label(starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star") }
        Button { Task { await model.actions.duplicate(row.id) } } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
        Button { Task { await model.actions.archive([row.id], true) } } label: { Label("Archive", systemImage: "archivebox") }
        if recent {
            Button { Task { await model.actions.removeFromRecent([row.id]) } } label: { Label("Remove from recent", systemImage: "eye.slash") }
        }
        Divider()
        Button(role: .destructive) { Task { await model.actions.trash([row.id]) } } label: { Label("Move to Trash", systemImage: "trash") }
    }
}

/// A row's press: the sunken tint at touch-down (and `onPress`, for notes).
struct RowPressStyle: ButtonStyle {
    var onPress: () -> Void = {}
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Folevi.color.accentSoft.opacity(0.6) : Color.clear)
            .contentShape(Rectangle())
            .onChange(of: configuration.isPressed) { _, pressed in if pressed { onPress() } }
    }
}

/// Foli AI's spark (the web's AiIcon in its violet).
struct FoliSpark: View {
    var size: CGFloat = 16
    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: size, weight: .medium))
            .foregroundStyle(LinearGradient(colors: [RGBA(124, 108, 240).color, RGBA(245, 138, 184).color], startPoint: .topLeading, endPoint: .bottomTrailing))
            .accessibilityHidden(true)
    }
}

/// Tag colours by key ("marigold", "moss", "muted", ...): the warm palette's signals.
enum TagColors {
    static func color(_ key: String) -> Color {
        switch key {
        case "ember": Folevi.color.ember
        case "moss": Folevi.color.moss
        case "coral": Folevi.color.coral
        case "marigold": Folevi.color.marigold
        case "muted": Folevi.color.inkMuted
        default: FolderColor.resolve(key).color.color
        }
    }
}

/// A drop on a section header (folders to the top level).
struct SectionDrop: DropDelegate {
    var onFolder: (FolderDragItem) -> Void
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool {
        guard let provider = info.itemProviders(for: [.foleviFolderRef]).first else { return false }
        _ = provider.loadTransferable(type: FolderDragItem.self) { result in
            guard case .success(let item) = result else { return }
            Task { @MainActor in onFolder(item) }
        }
        return true
    }
}
