// A list of notes on the iPhone, as the web draws it (apps/web/src/components/iphone/NoteList.tsx): All notes,
// Drafts, Starred, Archive, Trash, Templates, a folder (its folders first) and a tag. The search field filters
// the list; the notes are two columns of cards or rows (the "…" menu picks, and the sort). Everything comes from
// FoleviScreens' NotesListModel (`notes.list`, windowed).
#if os(iOS)
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneNotesListActions {
    public var open: (String) -> Void
    public var openNote: (String) -> Void
    public var back: () -> Void
    /// The bar's "…": its menu (view, sort and the list's own actions), from where it was tapped.
    public var menu: (CGRect) -> Void
    /// A note's long-press menu, from the card or row it's on.
    public var rowMenu: (NoteRow, CGRect) -> Void
    /// Select mode starts or ends (its bar takes the tab bar's place).
    public var selecting: (Bool) -> Void
    /// A new note (in the folder on show), from the empty screen's New note.
    public var newNote: () -> Void = {}

    public init(open: @escaping (String) -> Void, openNote: @escaping (String) -> Void, back: @escaping () -> Void, menu: @escaping (CGRect) -> Void, rowMenu: @escaping (NoteRow, CGRect) -> Void, selecting: @escaping (Bool) -> Void) {
        self.open = open
        self.openNote = openNote
        self.back = back
        self.menu = menu
        self.rowMenu = rowMenu
        self.selecting = selecting
    }
}

public struct PhoneNotesListScreen: View {
    @Bindable var model: NotesListModel
    let actions: PhoneNotesListActions
    let scrollToTop: Int
    @State private var moreFrame: CGRect = .zero
    @State private var swipes = PhoneSwipeState()
    @Environment(\.colorScheme) private var scheme

    public init(model: NotesListModel, actions: PhoneNotesListActions, scrollToTop: Int = 0) {
        self.model = model
        self.actions = actions
        self.scrollToTop = scrollToTop
    }

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    public var body: some View {
        let picked = model.selection.count
        let all = picked > 0 && picked >= model.loadedRows.count
        // Select mode: Select All where Back was, how many are picked in the bar's middle, Done.
        PhoneScreen(options, root: model.selecting, scrollToTop: scrollToTop, back: actions.back) {
            WebGlassTextButton(all ? "Deselect All" : "Select All") {
                if all { model.selection = [] } else { model.selection = Set(model.loadedRows.map(\.id)) }
            }
        } trailing: {
            if model.selecting {
                WebGlassTextButton("Done", strong: true) { setSelecting(false) }
            } else {
                HStack(spacing: 8) {
                    if model.selectable && model.total > 0 {
                        WebGlassTextButton("Select") { setSelecting(true) }
                    }
                    WebGlassPill {
                        WebPillButton("\(model.title) options", action: { actions.menu(moreFrame) }) {
                            WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                        }
                        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
                    }
                }
            }
        } header: {
            if model.total > 0 || model.isFiltering {
                PhoneSearchField("Search", text: $model.filter)
            }
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                if !model.subfolders.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(model.subfolders) { f in
                            PhoneListRow(f.name, detail: f.count > 0 ? String(f.count) : nil, action: { actions.open("/folders/\(f.id)") }) {
                                FolderGlyph(colorId: f.colorId, size: 22)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                notes
            }
        }
        .overlay(alignment: .bottom) {
            if model.selecting {
                PhoneSelectBar(actions: model.bulkActions, count: picked) { action in
                    Task {
                        await model.runBulk(action)
                        if action != .move && action != .copy { setSelecting(false) }
                    }
                }
                .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.9), value: model.selecting)
        .notesListSheets(model)
        // Pull to refresh: iOS's own control on the screen's scroll view.
        .refreshable { await model.refresh() }
        .onAppear { model.setVisible(true) }
        .onDisappear {
            model.setVisible(false)
            if model.selecting { setSelecting(false) }
        }
    }

    /// The bar's title, Select mode's status, and a folder's colour washed over its screen.
    private var options: PhoneScreenOptions {
        let picked = model.selection.count
        var o = PhoneScreenOptions(title: model.title, status: model.selecting ? (picked > 0 ? "\(picked) selected" : "Select notes") : nil)
        if model.kind.view == .folder { o.tint = FolderColor.resolve(model.folder?.color).color }
        return o
    }

    private func setSelecting(_ on: Bool) {
        model.selecting = on
        if !on { model.selection = [] }
        actions.selecting(on)
    }

    /// In Select mode a tap picks the note; otherwise it opens.
    private func tap(_ row: NoteRow) {
        if model.selecting {
            if model.selection.contains(row.id) { model.selection.remove(row.id) } else { model.selection.insert(row.id) }
        } else {
            actions.openNote(row.id)
        }
    }

    /// NoteList.tsx swipeFor: Trash restores; elsewhere Star on the left, Trash and Archive on the right.
    private func swipes(_ row: NoteRow) -> (leading: [PhoneSwipeAction], trailing: [PhoneSwipeAction]) {
        let run = { (a: NotesListModel.RowAction) -> () -> Void in { Task { await model.run(a, on: row) } } }
        if model.isTrash {
            return ([PhoneSwipeAction("Restore", icon: .undo2, tone: RGBA(0x3f, 0x7d, 0x58), action: run(.restore))], [])
        }
        let star = model.isStarred(row)
            ? PhoneSwipeAction("Unstar", icon: .starOff, tone: RGBA(0xb0, 0x7a, 0x12), action: run(.unstar))
            : PhoneSwipeAction("Star", icon: .star, tone: RGBA(0xc5, 0x8a, 0x12), action: run(.star))
        let archived = model.kind.view == .archive
        return ([star], [
            PhoneSwipeAction("Trash", icon: .trash, tone: RGBA(0xd6, 0x45, 0x3d), danger: true, action: run(.trash)),
            archived
                ? PhoneSwipeAction("Unarchive", icon: .archiveRestore, tone: RGBA(0x6b, 0x6b, 0x73), action: run(.unarchive))
                : PhoneSwipeAction("Archive", icon: .archive, tone: RGBA(0x6b, 0x6b, 0x73), action: run(.archive)),
        ])
    }

    @ViewBuilder private var notes: some View {
        let grid = ps("phone.grid")
        if model.isLoading {
            LazyVGrid(columns: columns(grid), spacing: 20) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
                        .fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color)
                        .aspectRatio(WebNoteCard.aspect, contentMode: .fit)
                }
            }
            .padding(grid.padding.edgeInsets)
            .accessibilityLabel("Loading")
        } else if model.slots.isEmpty {
            if model.isFiltering {
                PhoneScreenEmpty(icon: nil, title: model.filterEmptyTitle, message: "Try other words, or search everywhere from Home.")
            } else {
                PhoneScreenEmpty(icon: Self.emptyIcon(model.kind.view), title: model.empty.title, message: model.empty.message) {
                    if model.emptyOffersNewNote {
                        WebButton("New note", icon: .plus, variant: .primary, action: actions.newNote)
                    }
                }
            }
        } else if model.layout == .cards {
            LazyVGrid(columns: columns(grid), spacing: 20) {
                ForEach(model.slots) { slot in
                    Group {
                        if let row = slot.row {
                            PhonePressable(scale: 0.97, onTap: { tap(row) }, onLongPress: model.selecting ? nil : { actions.rowMenu(row, $0) }) {
                                WebNoteCard(model.card(row))
                                    .overlay(alignment: .topTrailing) {
                                        if model.selecting { PhoneSelectMark(on: model.selection.contains(row.id)).padding(8) }
                                    }
                            }
                            .phoneZoomSource(row.id)
                            .accessibilityAddTraits(model.selection.contains(row.id) ? .isSelected : [])
                        } else {
                            RoundedRectangle(cornerRadius: FoleviTokens.Radius.container, style: .continuous)
                                .fill(FoleviTokens.Chrome.surfaceSunken.resolve(scheme).color)
                                .aspectRatio(WebNoteCard.aspect, contentMode: .fit)
                        }
                    }
                    .onAppear { model.slotAppeared(slot.index) }
                    .onDisappear { model.slotDisappeared(slot.index) }
                }
            }
            .padding(grid.padding.edgeInsets)
            .environment(\.webPhoneCards, true)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(model.slots) { slot in
                    Group {
                        if let row = slot.row {
                            let rowView = PhonePressable(scale: 1, highlight: true, onTap: { tap(row) }, onLongPress: model.selecting ? nil : { actions.rowMenu(row, $0) }) {
                                PhoneNoteRow(row: row, starred: model.isStarred(row), subtitle: model.subtitle(row), selecting: model.selecting, selected: model.selection.contains(row.id))
                            }
                            if model.selecting {
                                rowView
                            } else {
                                let s = swipes(row)
                                PhoneSwipeRow(id: row.id, leading: s.leading, trailing: s.trailing, state: swipes) { rowView }
                            }
                        } else {
                            Color.clear.frame(height: ps("phone.list.row").height)
                        }
                    }
                    .onAppear { model.slotAppeared(slot.index) }
                    .onDisappear { model.slotDisappeared(slot.index) }
                }
            }
            .padding(.top, ps("phone.list").padding.top)
        }
    }

    private func columns(_ grid: WebComputedStyle) -> [GridItem] {
        // (gap-x-3.5: 14 between the two columns; gap-y-5: 20 between rows.)
        [GridItem(.flexible(), spacing: grid.gap), GridItem(.flexible(), spacing: grid.gap)]
    }

    /// The web's EMPTY table's icons (DocumentBrowser.tsx).
    static func emptyIcon(_ view: NotesListView) -> WebIcon {
        switch view {
        case .all: .files
        case .starred: .star
        case .archive: .archive
        case .trash: .trash
        case .templates: .layoutTemplate
        case .unsorted: .inbox
        case .folder: .folderOpen
        case .tag: .hash
        }
    }
}

/// A note as a row (the list layout): its page glyph, the title (a star after it when starred), and when it
/// changed with its folder or "Draft" under it; 64 tall at least, the hairline from the text.
struct PhoneNoteRow: View {
    let row: NoteRow
    let starred: Bool
    let subtitle: String
    var selecting = false
    var selected = false
    @Environment(\.colorScheme) private var scheme

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    var body: some View {
        let r = ps("phone.list.row")
        let body = ps("phone.list.body")
        let title = ps("phone.list.title")
        let sub = ps("phone.list.sub")
        HStack(spacing: r.gap) {
            if selecting {
                PhoneSelectCircle(on: selected)
            } else {
                PhoneNoteGlyph(folderColorId: row.folder?.color, template: row.kind == "template")
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.title.isEmpty ? "Untitled" : row.title).webText(title.text).lineLimit(1)
                        .foregroundStyle(title.color.color)
                    if starred {
                        WebIconView(.star, size: 13).foregroundStyle(sub.color.color)
                            .accessibilityLabel("Starred")
                    }
                }
                Text(subtitle).webText(sub.text).lineLimit(1).foregroundStyle(sub.color.color)
            }
            .padding(.vertical, body.padding.top)
            .frame(maxWidth: .infinity, minHeight: body.height, alignment: .leading)
            .overlay(alignment: .bottom) { PhoneRowHairlineView() }
        }
        .padding(.leading, r.padding.left)
        .padding(.trailing, r.padding.right)
        .contentShape(Rectangle())
    }
}

/// A tap and a long press on the same thing (a card, a row): pressed it shrinks (cards) or takes the press fill
/// (rows); held, `onLongPress` gets its frame on screen for the menu to come out of.
struct PhonePressable<Content: View>: View {
    var scale: CGFloat = 0.97
    var highlight = false
    let onTap: () -> Void
    let onLongPress: ((CGRect) -> Void)?
    @ViewBuilder let content: () -> Content
    @State private var pressed = false
    @State private var frame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        content()
            .background {
                if highlight && pressed { WebStyles.vars["liquid-press"]?.resolve(scheme).color ?? Color.black.opacity(0.06) }
            }
            .scaleEffect(pressed ? scale : 1)
            .animation(.easeOut(duration: pressed ? 0 : 0.15), value: pressed)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
            .onTapGesture(perform: onTap)
            .onLongPressGesture(minimumDuration: 0.45) {
                guard let onLongPress else { return }
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                #endif
                onLongPress(frame)
            } onPressingChanged: { pressed = $0 }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: "More actions") { onLongPress?(frame) }
    }
}

/// SelectMark: the check on a card in Select mode, a 28 pt disc in its corner.
struct PhoneSelectMark: View {
    let on: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            Circle().fill(on ? FoleviTokens.Chrome.heading.resolve(scheme).color : Color.white.opacity(0.85))
            if on {
                WebIconView(.check, size: 16, strokeWidth: 3).foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            } else {
                Circle().strokeBorder(Color.black.opacity(0.25), lineWidth: 1.5)
            }
        }
        .frame(width: 28, height: 28)
        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
        .animation(.easeOut(duration: 0.15), value: on)
    }
}

/// SelectCircle: a row's ring in Select mode (iOS's own: empty, or filled with a tick).
struct PhoneSelectCircle: View {
    let on: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            if on {
                Circle().fill(FoleviTokens.Chrome.heading.resolve(scheme).color)
                WebIconView(.check, size: 14, strokeWidth: 3).foregroundStyle(FoleviTokens.Chrome.canvas.resolve(scheme).color)
            } else {
                Circle().strokeBorder(FoleviTokens.Chrome.lineStrong.resolve(scheme).color, lineWidth: 1.5)
            }
        }
        .frame(width: 22, height: 22)
        .frame(width: 28, height: 28)
        .animation(.easeOut(duration: 0.15), value: on)
    }
}

/// SelectBar: Select mode's bar in the tab bar's place and shape, what to do with the picked notes.
struct PhoneSelectBar: View {
    let actions: [BulkAction]
    let count: Int
    let run: (BulkAction) -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            let bottom = geo.safeAreaInsets.bottom
            HStack(spacing: 0) {
                ForEach(actions) { a in
                    Button { run(a) } label: {
                        VStack(spacing: 2) {
                            WebIconView(Self.icon(a), size: 22)
                            Text(a.title).webText(.role(.caption2, weight: 500)).lineLimit(1)
                        }
                        .foregroundStyle((a.destructive ? FoleviTokens.Chrome.destructive : FoleviTokens.Chrome.heading).resolve(scheme).color)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(GlassPressStyle())
                    .disabled(count == 0)
                    .opacity(count == 0 ? 0.35 : 1)
                }
            }
            .padding(4)
            .frame(height: 64)
            .liquidGlass()
            .padding(.horizontal, 16)
            .padding(.bottom, max(10, bottom - 10))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .ignoresSafeArea(edges: .bottom)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Selected notes")
    }

    static func icon(_ a: BulkAction) -> WebIcon {
        switch a {
        case .move: .folderInput
        case .copy: .copyPlus
        case .star: .star
        case .unstar: .starOff
        case .archive: .archive
        case .unarchive: .archiveRestore
        case .trash, .deleteForever: .trash
        case .restore: .undo2
        }
    }
}
#endif
