// A list of notes on the iPhone, as the web draws it (apps/web/src/components/iphone/NoteList.tsx): All notes,
// Drafts, Starred, Archive, Trash, Templates, a folder (its folders first) and a tag. The search field filters
// the list; the notes are two columns of cards or rows (the "…" menu picks, and the sort). Everything comes from
// FoleviScreens' NotesListModel (`notes.list`, windowed).
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneNotesListActions {
    public var open: (String) -> Void
    public var openNote: (String) -> Void
    public var back: () -> Void
    /// The bar's "…": its menu (view, sort and the list's own actions), from where it was tapped.
    public var menu: (CGRect) -> Void

    public init(open: @escaping (String) -> Void, openNote: @escaping (String) -> Void, back: @escaping () -> Void, menu: @escaping (CGRect) -> Void) {
        self.open = open
        self.openNote = openNote
        self.back = back
        self.menu = menu
    }
}

public struct PhoneNotesListScreen: View {
    @Bindable var model: NotesListModel
    let actions: PhoneNotesListActions
    let scrollToTop: Int
    @State private var moreFrame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    public init(model: NotesListModel, actions: PhoneNotesListActions, scrollToTop: Int = 0) {
        self.model = model
        self.actions = actions
        self.scrollToTop = scrollToTop
    }

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    public var body: some View {
        PhoneScreen(PhoneScreenOptions(title: model.title), root: false, scrollToTop: scrollToTop, back: actions.back) {
            EmptyView()
        } trailing: {
            HStack(spacing: 8) {
                if model.selectable && model.total > 0 {
                    WebGlassTextButton("Select") { model.selecting = true }
                }
                WebGlassPill {
                    WebPillButton("\(model.title) options", action: { actions.menu(moreFrame) }) {
                        WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                    }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
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
        .onAppear { model.setVisible(true) }
        .onDisappear { model.setVisible(false) }
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
                PhoneScreenEmpty(icon: Self.emptyIcon(model.kind.view), title: model.empty.title, message: model.empty.message)
            }
        } else if model.layout == .cards {
            LazyVGrid(columns: columns(grid), spacing: 20) {
                ForEach(model.slots) { slot in
                    Group {
                        if let row = slot.row {
                            Button { actions.openNote(row.id) } label: {
                                WebNoteCard(model.card(row))
                            }
                            .buttonStyle(PhoneCardPressStyle())
                            .phoneZoomSource(row.id)
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
                            PhoneNoteRow(row: row, starred: model.isStarred(row), subtitle: model.subtitle(row)) { actions.openNote(row.id) }
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
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme

    private func ps(_ id: String) -> WebComputedStyle { WebStyles.named(id).resolve(scheme) }

    var body: some View {
        let r = ps("phone.list.row")
        let body = ps("phone.list.body")
        let title = ps("phone.list.title")
        let sub = ps("phone.list.sub")
        Button(action: action) {
            HStack(spacing: r.gap) {
                PhoneNoteGlyph(folderColorId: row.folder?.color, template: row.kind == "template")
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
        .buttonStyle(PhoneRowPressStyle())
    }
}
