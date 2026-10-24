// A note list (plan 5.4; web iphone/NoteList.tsx and DocumentBrowser.tsx): the filter field, a folder's
// subfolders as cards (drop targets), Templates' built-in ones, then the notes as cards (a grid) or as rows
// (a List, so swipes, the system's multi-select, reordering by drag and arrow keys come native). Rows load
// by window: each position reports when it appears, and the store moves its window, so 5,000 notes scroll
// with a few hundred rows in memory. Select mode puts the selection bar where the tab bar was.
import SwiftUI
import FoleviDesign
import FoleviEngine

public struct NotesListScreen: View {
    @Bindable var model: NotesListModel
    @State private var width: CGFloat = 390
    @FocusState private var focused: String?
    /// Every row is this tall (placeholders too), so lists of thousands never re-measure rows as the window
    /// moves; it grows with Dynamic Type.
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 62
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(model: NotesListModel) { self.model = model }

    private var compact: Bool { width < 600 }
    private var gutter: CGFloat { compact ? 16 : 28 }

    private var showsBar: Bool {
        #if os(macOS)
        model.selecting || model.selection.count > 1
        #else
        model.selecting
        #endif
    }

    public var body: some View {
        Group {
            if model.layout == .list || typeSize.isAccessibilitySize && model.layout == .list {
                listLayout
            } else {
                gridLayout
            }
        }
        .background(Folevi.color.canvas)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .safeAreaInset(edge: .bottom) {
            if showsBar {
                SelectionBar(model: model).padding(.horizontal, 16).padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .foleviAnimation(FoleviTokens.Motion.base, value: showsBar)
        .sheet(item: movingBinding) { request in
            MoveNotesSheet(count: request.ids.count, targets: model.moveTargets) { target in
                Task { await model.move(request.ids, to: target) }
            } onCancel: { model.moving = nil }
        }
        .sheet(isPresented: Binding(get: { model.generating != nil }, set: { if !$0 { model.generating = nil } })) {
            if let g = model.generating {
                GenerateSheet(model: g) { id in
                    model.generating = nil
                    feedback.toast(ScreenToast("Saved to Templates", tone: .success, actionTitle: "Open") { navigator.open(.note(id: id), nil) })
                } onCancel: { model.generating = nil }
            }
        }
        .sheet(item: copyingBinding) { request in
            CopyToSheet(client: model.client, spaces: model.copyTargets, count: request.ids.count) { space, folder in
                model.copying = nil
                model.selecting = false
                Task { await model.actions.copy(request.ids, to: space, folder: folder) }
            } onCancel: { model.copying = nil }
        }
        .alert(confirmTitle, isPresented: confirmShown, presenting: model.confirmation) { c in
            Button("Cancel", role: .cancel) { model.confirmation = nil }
            Button(model.confirmationText(c).button, role: .destructive) { Task { await model.confirm(c) } }
        } message: { c in
            Text(model.confirmationText(c).message)
        }
        .folderDialogs(model.dialogs, actions: model.actions, tree: model.tree.value?.folders ?? [])
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
        .accessibilityIdentifier("notes-list-\(model.kind.view.rawValue)")
    }

    // MARK: Header (filter, subfolders, built-in templates)

    @ViewBuilder private var header: some View {
        if model.total > 0 || !model.filter.isEmpty {
            SearchField(text: $model.filter, prompt: "Search")
                .padding(.horizontal, gutter)
                .padding(.top, 6)
                .padding(.bottom, 6)
                .accessibilityIdentifier("list-filter")
        }
        if model.kind.view == .folder {
            subfolders
        }
        if let templates = model.builtIns?.value?.templates, !templates.isEmpty {
            builtInTemplates(templates)
        }
    }

    @ViewBuilder private var subfolders: some View {
        let cards = model.subfolders
        if !cards.isEmpty || model.kind.view == .folder {
            VStack(alignment: .leading, spacing: 6) {
                // Where this folder is: chips that open its ancestors and take drops (un-nesting a folder).
                FolderPathBar(ancestors: model.ancestors, actions: model.actions, links: model.folderLinks)
                    .padding(.horizontal, gutter)
                if !cards.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(cards) { card in
                                if let folder = model.menuFolder(card.id) {
                                    FolderCardCell(
                                        card: card,
                                        folder: folder,
                                        context: model.folderContext,
                                        actions: model.actions,
                                        dialogs: model.dialogs,
                                        onOpen: { navigator.open(.folder(id: card.id), $0) },
                                        onDropNotes: { items in Task { await model.dropNotes(items, into: card.id) } },
                                        onDropFolder: { item, zone in Task { await model.dropFolder(item, on: card.id, zone: zone) } }
                                    )
                                    .frame(width: compact ? 132 : 150)
                                }
                            }
                        }
                        .padding(.horizontal, gutter)
                        .padding(.vertical, 8)
                    }
                    .accessibilityLabel("Folders inside")
                }
            }
            .padding(.bottom, 4)
        }
    }

    private func builtInTemplates(_ templates: [BuiltInTemplate]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader("Built-in templates", style: .caps).padding(.bottom, 4)
            ForEach(templates, id: \.key) { t in
                Button {
                    Task {
                        if let id = await model.actions.create(folderId: nil, templateId: t.key, title: t.name) { navigator.open(.note(id: id), nil) }
                    }
                } label: {
                    ListRow(t.name, subtitle: t.description, systemImage: TemplateIcons.symbol(t.icon))
                }
                .buttonStyle(RowPressStyle())
                .accessibilityLabel("New note from \(t.name)")
                RowDivider()
            }
            SectionHeader("Your templates", style: .caps).padding(.top, 18)
        }
        .padding(.horizontal, gutter)
        .padding(.top, 8)
    }

    // MARK: States

    @ViewBuilder private var emptyOrLoading: some View {
        if model.isLoading {
            if model.layout == .cards {
                LazyVGrid(columns: gridColumns, spacing: 22) { ForEach(0..<4, id: \.self) { _ in PlaceholderCard() } }
                    .padding(.horizontal, gutter)
                    .padding(.top, 12)
                    .accessibilityLabel("Loading")
            } else {
                VStack(spacing: 0) { ForEach(0..<6, id: \.self) { _ in PlaceholderRow() } }
                    .padding(.horizontal, gutter)
                    .accessibilityLabel("Loading")
            }
        } else if !model.filter.trimmingCharacters(in: .whitespaces).isEmpty {
            EmptyState(systemImage: "magnifyingglass", title: model.filterEmptyTitle, message: "Try other words, or search everywhere from Home.")
                .padding(.top, 30)
        } else {
            let e = model.empty
            EmptyState(systemImage: e.symbol, title: e.title, message: e.message, actionTitle: model.emptyOffersNewNote ? "New note" : nil) {
                Task { await newNote() }
            }
            .padding(.top, 30)
        }
    }

    private var isEmpty: Bool { model.isFiltering ? model.slots.isEmpty : model.total == 0 }

    // MARK: Grid (cards)

    private var columnCount: Int {
        if typeSize.isAccessibilitySize { return 1 }
        let minCard: CGFloat = compact ? 150 : 180
        return max(2, Int((width - gutter * 2 + 16) / (minCard + 16)))
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: compact ? 14 : 18, alignment: .top), count: columnCount)
    }

    private var gridLayout: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                header
                if isEmpty {
                    emptyOrLoading
                } else {
                    LazyVGrid(columns: gridColumns, spacing: compact ? 20 : 26) {
                        if model.isFiltering {
                            ForEach(model.slots) { slot in gridCell(slot) }
                        } else {
                            // Index identity over a range: moving the window changes what a position shows,
                            // never the list's identity, so 5,000 positions cost nothing to diff.
                            ForEach(0..<model.total, id: \.self) { i in
                                gridCell(model.slot(at: i))
                                    .onAppear { model.slotAppeared(i) }
                                    .onDisappear { model.slotDisappeared(i) }
                            }
                        }
                    }
                    .padding(.horizontal, gutter)
                    .padding(.top, 10)
                }
            }
            .padding(.bottom, 120)
        }
        .refreshable { await model.refresh() }
        .focusable()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .return, .space]) { press in
            handleKey(press.key)
        }
    }

    @ViewBuilder private func gridCell(_ slot: NoteSlot) -> some View {
        if let row = slot.row {
            let selected = model.selection.contains(row.id)
            NoteCardCell(
                row: row,
                model: model.card(row),
                selecting: model.selecting,
                selected: selected,
                onTap: { open(row, $0) },
                onToggle: { model.toggle(row.id) },
                accessibilityActions: accessibilityActions(row),
                drag: model.dragItem(for: row)
            ) {
                rowMenu(row)
            }
            .opacity(model.actions.isHidden(row.id) ? 0.35 : 1)
            .overlay {
                if focused == row.id {
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.panel, style: .continuous).strokeBorder(Folevi.color.focus, lineWidth: 2).padding(-4)
                }
            }
            #if os(macOS)
            .simultaneousGesture(TapGesture().modifiers(.command).onEnded { model.toggle(row.id) })
            #endif
        } else {
            PlaceholderCard()
        }
    }

    /// Arrow keys move between cards, Return opens, Space selects (iPad keyboards and the Mac).
    private func handleKey(_ key: KeyEquivalent) -> KeyPress.Result {
        let ids = model.loadedRows.map(\.id)
        guard !ids.isEmpty else { return .ignored }
        let i = focused.flatMap { ids.firstIndex(of: $0) } ?? -1
        switch key {
        case .return:
            guard i >= 0, let row = model.loadedRows.first(where: { $0.id == ids[i] }) else { return .ignored }
            open(row, CardFrames.shared.source(for: row.id))
            return .handled
        case .space:
            guard i >= 0 else { return .ignored }
            model.selecting = true
            model.toggle(ids[i])
            return .handled
        default:
            let step: Int = switch key {
            case .leftArrow: -1
            case .rightArrow: 1
            case .upArrow: -columnCount
            default: columnCount
            }
            let next = i < 0 ? 0 : min(max(0, i + step), ids.count - 1)
            focused = ids[next]
            return .handled
        }
    }

    // MARK: List (rows)

    /// The List selects positions (the ForEach's own ids), so it never has to read a tag from each of
    /// thousands of rows; the model keeps note ids. Selected notes outside the loaded window stay selected.
    private var selectionBinding: Binding<Set<Int>> {
        Binding {
            let state = model.store.state
            var out = Set<Int>()
            for (i, id) in state.order.enumerated() where model.selection.contains(id) { out.insert(state.start + i) }
            return out
        } set: { positions in
            let state = model.store.state
            let windowIds = Set(state.order)
            let picked = positions.compactMap { state.row(at: $0)?.id }
            model.selection = model.selection.subtracting(windowIds).union(picked)
        }
    }

    private func rows(at positions: Set<Int>) -> [NoteRow] {
        positions.sorted().compactMap { model.store.state.row(at: $0) }
    }

    private var listLayout: some View {
        List(selection: selectionBinding) {
            Section {
                header
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                if isEmpty {
                    emptyOrLoading
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
            }
            .selectionDisabled()
            Section {
                if model.isFiltering {
                    ForEach(model.slots, id: \.index) { slot in
                        listRow(slot)
                            .listRowBackground(Color.clear)
                            .listRowSeparatorTint(Folevi.color.line)
                            .listRowInsets(EdgeInsets(top: 0, leading: gutter, bottom: 0, trailing: gutter))
                    }
                } else {
                    ForEach(0..<model.total, id: \.self) { i in
                        listRow(model.slot(at: i))
                            .onAppear { model.slotAppeared(i) }
                            .onDisappear { model.slotDisappeared(i) }
                            .listRowBackground(Color.clear)
                            .listRowSeparatorTint(Folevi.color.line)
                            .listRowInsets(EdgeInsets(top: 0, leading: gutter, bottom: 0, trailing: gutter))
                    }
                    .onMove(perform: model.canArrange ? { from, to in Task { await model.reorder(from: from, to: to) } } : nil)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        #if os(iOS)
        .environment(\.editMode, .constant(model.selecting ? .active : .inactive))
        #endif
        .contextMenu(forSelectionType: Int.self) { positions in
            selectionMenu(Set(rows(at: positions).map(\.id)))
        } primaryAction: { positions in
            guard positions.count == 1, let row = rows(at: positions).first, !model.selecting else { return }
            open(row, CardFrames.shared.source(for: row.id))
        }
        .refreshable { await model.refresh() }
    }

    @ViewBuilder private func listRow(_ slot: NoteSlot) -> some View {
        if let row = slot.row {
            NoteRowView(row: row, title: row.title.isEmpty ? "Untitled" : row.title, subtitle: model.subtitle(row), starred: model.isStarred(row))
                .frame(height: rowHeight)
                .opacity(model.actions.isHidden(row.id) ? 0.35 : 1)
                .modifier(RecordsFrame(id: row.id, kind: .noteRow))
                .draggable(model.dragItem(for: row)) {
                    DragStack(count: model.dragItem(for: row).notes.count) {
                        NoteRowView(row: row, title: row.title.isEmpty ? "Untitled" : row.title, subtitle: model.subtitle(row), starred: model.isStarred(row)).frame(width: 300).padding(.horizontal, 10).background(Folevi.color.surfaceRaised)
                    }
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    ForEach(model.leadingSwipes(row), id: \.self) { action in swipeButton(action, row) }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: !model.isTrash) {
                    ForEach(model.trailingSwipes(row), id: \.self) { action in swipeButton(action, row) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(CardMapping.rowAccessibility(row, inTrash: model.isTrash, starred: model.isStarred(row)))
                .accessibilityAddTraits(.isButton)
                .accessibilityActions {
                    ForEach(Array(accessibilityActions(row).enumerated()), id: \.offset) { _, a in Button(a.0, action: a.1) }
                }
                .accessibilityIdentifier("note-row-\(row.id)")
        } else {
            PlaceholderRow().frame(height: rowHeight).selectionDisabled()
        }
    }

    private func swipeButton(_ action: NotesListModel.RowAction, _ row: NoteRow) -> some View {
        Button(role: model.isDestructive(action) && action != .deleteForever ? .destructive : nil) {
            Task { await model.run(action, on: row) }
        } label: {
            Label(swipeTitle(action), systemImage: model.symbol(of: action))
        }
        .tint(swipeTint(action))
    }

    private func swipeTitle(_ action: NotesListModel.RowAction) -> String {
        switch action {
        case .trash: "Trash"
        case .move: "Move"
        case .deleteForever: "Delete"
        default: model.title(of: action)
        }
    }

    private func swipeTint(_ action: NotesListModel.RowAction) -> Color {
        switch action {
        case .star, .unstar: Folevi.color.marigold
        case .trash, .deleteForever: Folevi.color.destructive
        case .restore: Folevi.color.moss
        case .move: Folevi.color.accentStrong
        default: Folevi.color.inkMuted
        }
    }

    // MARK: Menus

    @ViewBuilder private func rowMenu(_ row: NoteRow) -> some View {
        let groups = model.menu(for: row, wide: !compact)
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { action in
                Button(role: model.isDestructive(action) ? .destructive : nil) {
                    perform(action, on: row)
                } label: {
                    Label(model.title(of: action), systemImage: model.symbol(of: action))
                }
            }
        }
    }

    /// The List's menu: one note's menu, or the bulk actions for several selected.
    @ViewBuilder private func selectionMenu(_ ids: Set<String>) -> some View {
        let rows = model.loadedRows.filter { ids.contains($0.id) }
        if rows.count == 1, let row = rows.first {
            rowMenu(row)
        } else if rows.count > 1 {
            ForEach(model.bulkActions) { action in
                Button(role: action.destructive ? .destructive : nil) {
                    model.selection = ids
                    Task { await model.runBulk(action) }
                } label: {
                    Label("\(action.title) \(notesText(rows.count))", systemImage: action.symbol)
                }
            }
        }
    }

    private func perform(_ action: NotesListModel.RowAction, on row: NoteRow) {
        switch action {
        case .open, .editTemplate: open(row, CardFrames.shared.source(for: row.id))
        case .openInNewTab: navigator.open(.noteInNewTab(id: row.id), nil)
        case .useTemplate:
            Task {
                if let id = await model.actions.create(folderId: nil, templateId: row.id, title: row.title) { navigator.open(.note(id: id), nil) }
            }
        default: Task { await model.run(action, on: row) }
        }
    }

    private func accessibilityActions(_ row: NoteRow) -> [(String, () -> Void)] {
        (model.leadingSwipes(row) + model.trailingSwipes(row)).map { action in
            (model.title(of: action), { perform(action, on: row) })
        }
    }

    private func open(_ row: NoteRow, _ source: CardSource?) {
        navigator.open(.note(id: row.id), source)
    }

    private func newNote() async {
        if let id = await model.actions.create(folderId: model.kind.folderId) { navigator.open(.note(id: id), nil) }
    }

    // MARK: Sheets and alerts

    struct MoveRequest: Identifiable {
        let ids: [String]
        var id: String { ids.joined(separator: ",") }
    }

    private var movingBinding: Binding<MoveRequest?> {
        Binding { model.moving.map { MoveRequest(ids: $0) } } set: { if $0 == nil { model.moving = nil } }
    }

    private var copyingBinding: Binding<MoveRequest?> {
        Binding { model.copying.map { MoveRequest(ids: $0) } } set: { if $0 == nil { model.copying = nil } }
    }

    private var confirmShown: Binding<Bool> {
        Binding { model.confirmation != nil } set: { if !$0 { model.confirmation = nil } }
    }

    private var confirmTitle: String {
        model.confirmation.map { model.confirmationText($0).title } ?? ""
    }
}

/// Select mode's bar (web NoteList.tsx SelectBar): the bulk actions in a glass capsule where the tab bar was.
struct SelectionBar: View {
    let model: NotesListModel

    var body: some View {
        HStack(spacing: 2) {
            ForEach(model.bulkActions) { action in
                Button { Task { await model.runBulk(action) } } label: { barLabel(action) }
                    .buttonStyle(.plain)
                    .disabled(model.selection.isEmpty)
            }
        }
        .padding(4)
        .frame(height: 64)
        .foleviGlass(in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selected notes, \(model.selectionStatus)")
        .accessibilityIdentifier("selection-bar")
    }

    private func barLabel(_ action: BulkAction) -> some View {
        VStack(spacing: 3) {
            Image(systemName: action.symbol).font(.system(size: 19, weight: .regular))
            Text(action.title).font(FoleviFonts.font(.ui, size: 11, weight: .medium)).lineLimit(1)
        }
        .foregroundStyle(action.destructive ? Folevi.color.destructive : Folevi.color.heading)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .opacity(model.selection.isEmpty ? 0.35 : 1)
    }
}

/// Where Move puts notes: Drafts and every folder, indented by depth.
struct MoveNotesSheet: View {
    let count: Int
    let targets: [(target: FolderTarget, depth: Int, color: String?)]
    let onPick: (FolderTarget) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(targets.enumerated()), id: \.offset) { _, t in
                    Button { onPick(t.target) } label: {
                        HStack(spacing: 10) {
                            if t.target.id == nil {
                                Image(systemName: "tray").frame(width: 20).foregroundStyle(Folevi.color.inkMuted)
                            } else {
                                FolderGlyph(colorId: t.color, size: 20)
                            }
                            Text(t.target.name).foleviFont(.body).foregroundStyle(Folevi.color.ink)
                        }
                        .padding(.leading, CGFloat(t.depth) * 18)
                    }
                }
            }
            .navigationTitle(count == 1 ? "Move note" : "Move \(notesText(count))")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) } }
        }
        .frame(minWidth: 360, minHeight: 420)
        .presentationDetents([.medium, .large])
    }
}

/// The web's template tile icons as SF Symbols.
enum TemplateIcons {
    static func symbol(_ name: String) -> String {
        switch name {
        case "calendar", "calendar-days": "calendar"
        case "list-checks", "check-square": "checklist"
        case "users", "user": "person.2"
        case "book", "book-open": "book"
        case "target": "target"
        case "lightbulb": "lightbulb"
        case "briefcase": "briefcase"
        case "sun": "sun.max"
        case "pen", "pencil": "pencil"
        default: "doc.text"
        }
    }
}
