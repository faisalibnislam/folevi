// A list's bar items (web iphone/NoteList.tsx): Select (or Done in Select mode) and the "…" menu with View as
// (Cards, List), Sort by, and the list's own actions (New note here, New folder inside, New template, Generate
// with Foli AI, Empty Trash). In Select mode the leading item is Select All / Deselect All and the frame shows
// `model.selectionStatus` in the bar's middle.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct NotesListTrailingItems: View {
    @Bindable var model: NotesListModel
    let glass: Bool
    @Environment(\.screenNavigator) private var navigator
    /// `glass: false` inside a system toolbar that draws its own glass (iOS 26 and macOS 26).
    public init(model: NotesListModel, glass: Bool = true) {
        self.model = model
        self.glass = glass
    }

    public var body: some View {
        HStack(spacing: 8) {
            if model.selecting {
                Button("Done") { model.selecting = false }
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("list-done")
            } else {
                if model.selectable && model.total > 0 {
                    Button("Select") { model.selecting = true }
                        .accessibilityIdentifier("list-select")
                }
                GlassWrap(glass) {
                    Menu { menu } label: {
                        Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(Folevi.color.ink).frame(width: 30, height: 30)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel("\(model.title) options")
                    .accessibilityIdentifier("list-more")
                }
            }
        }
        .foleviFont(.button)
        // In a system toolbar the system colours its buttons for its glass; ours only on our own pill.
        .foregroundStyle(glass ? AnyShapeStyle(Folevi.color.heading) : AnyShapeStyle(.primary))
    }

    @ViewBuilder private var menu: some View {
        Section("View as") {
            Picker("View as", selection: $model.layout) {
                Label("Cards", systemImage: "square.grid.2x2").tag(NotesLayout.cards)
                Label("List", systemImage: "list.bullet").tag(NotesLayout.list)
            }
            .pickerStyle(.inline)
        }
        Section("Sort by") {
            Picker("Sort by", selection: $model.sort) {
                ForEach(model.sortOptions, id: \.0) { option in Text(option.1).tag(option.0) }
            }
            .pickerStyle(.inline)
        }
        let actions = model.screenActions
        if !actions.isEmpty {
            Section {
                ForEach(actions, id: \.self) { action in
                    Button(role: action == .emptyTrash ? .destructive : nil) { run(action) } label: { label(action) }
                }
            }
        }
        if model.kind.view == .folder, let id = model.kind.folderId, let folder = model.menuFolder(id) {
            Section {
                FolderMenuItems(folder: folder, context: model.folderContext, actions: model.actions, dialogs: model.dialogs)
            }
        }
        #if os(macOS)
        Section {
            Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                .keyboardShortcut("r", modifiers: .command)
        }
        #endif
    }

    @ViewBuilder private func label(_ action: NotesListModel.ScreenAction) -> some View {
        switch action {
        case .newNote: Label("New note here", systemImage: "doc.badge.plus")
        case .newFolderInside: Label("New folder inside…", systemImage: "folder.badge.plus")
        case .newTemplate: Label("New template", systemImage: "plus")
        case .generateTemplate: Label("Generate with Foli AI", systemImage: "sparkles")
        case .emptyTrash: Label("Empty Trash", systemImage: "trash")
        case .refresh: Label("Refresh", systemImage: "arrow.clockwise")
        }
    }

    private func run(_ action: NotesListModel.ScreenAction) {
        switch action {
        case .newNote:
            Task { if let id = await model.actions.create(folderId: model.kind.folderId) { navigator.open(.note(id: id), nil) } }
        case .newFolderInside:
            if let id = model.kind.folderId, let folder = model.menuFolder(id) { model.dialogs.open(.newFolder(parent: folder)) }
        case .newTemplate:
            Task { if let id = await model.actions.createTemplate() { navigator.open(.note(id: id), nil) } }
        case .generateTemplate:
            model.startGenerating()
        case .emptyTrash:
            model.confirmation = .emptyTrash(model.total)
        case .refresh:
            Task { await model.refresh() }
        }
    }
}

/// Select mode's leading item.
public struct NotesListLeadingItems: View {
    let model: NotesListModel
    public init(model: NotesListModel) { self.model = model }
    public var body: some View {
        if model.selecting {
            Button(model.allSelected ? "Deselect All" : "Select All") { model.toggleSelectAll() }
                .foleviFont(.button)
                .foregroundStyle(Folevi.color.heading)
                .accessibilityIdentifier("list-select-all")
        }
    }
}

/// Everything a list puts in a SwiftUI toolbar.
public struct NotesListToolbar: ToolbarContent {
    let model: NotesListModel
    public init(model: NotesListModel) { self.model = model }
    public var body: some ToolbarContent {
        ToolbarItem(placement: .navigation) { NotesListLeadingItems(model: model) }
        ToolbarItem(placement: .primaryAction) { NotesListTrailingItems(model: model, glass: !SystemGlass.inToolbars) }
    }
}
