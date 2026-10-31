// The note lists in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): All notes, Drafts, Starred, Archive, Trash,
// Templates, a folder and a tag, drawn natively (FoleviPhone's PhoneNotesListScreen) from a NotesListModel of
// their own, kept while the screen is on its stack.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildNotesScreen: View {
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    /// Select mode on or off (the frame hides its tab bar for the selection's bar).
    let selecting: (Bool) -> Void
    @State private var model: NotesListModel

    init(kind: NotesListKind, frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel, selecting: @escaping (Bool) -> Void) {
        self.frame = frame
        self.menus = menus
        self.phone = phone
        self.selecting = selecting
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : .info) })
        _model = State(initialValue: NotesListModel(client: phone.client, kind: kind, feedback: feedback))
    }

    var body: some View {
        PhoneNotesListScreen(model: model, actions: PhoneNotesListActions(
            open: { frame.open(FrameRoute(path: $0)) },
            openNote: { phone.router?.openNote($0, source: nil, focus: false) },
            back: { frame.back() },
            menu: { showMenu(from: $0) },
            rowMenu: { row, frame in showRowMenu(row, from: frame) },
            selecting: selecting
        ), scrollToTop: frame.scrollToTop)
    }

    /// A note's long-press menu (NoteContextMenu), in the model's groups, coming out of the card or row.
    private func showRowMenu(_ row: FoleviEngine.NoteRow, from anchor: CGRect) {
        var entries: [PhoneMenuEntry] = []
        // (The phone's menu has no Open: a tap opens the note.)
        let groups = model.menu(for: row, wide: false).map { $0.filter { $0 != .open && $0 != .openInNewTab } }.filter { !$0.isEmpty }
        for (i, group) in groups.enumerated() {
            if i > 0 { entries.append(PhoneMenuEntry(.separator(i))) }
            for action in group {
                entries.append(PhoneMenuEntry(.item(model.title(of: action), icon: Self.icon(action), danger: model.isDestructive(action))) {
                    switch action {
                    case .select, .deselect:
                        if !model.selecting {
                            model.selecting = true
                            selecting(true)
                        }
                        if model.selection.contains(row.id) { model.selection.remove(row.id) } else { model.selection.insert(row.id) }
                    case .open:
                        phone.router?.openNote(row.id, source: nil, focus: false)
                    default:
                        Task { await model.run(action, on: row) }
                    }
                })
            }
        }
        menus.show(entries, from: anchor, side: .bottom, align: .start)
    }

    /// The web menu's icons (lucide) for the model's actions.
    static func icon(_ action: NotesListModel.RowAction) -> WebIcon {
        switch action {
        case .open, .editTemplate: .fileText
        case .openInNewTab: .externalLink
        case .star: .star
        case .unstar: .starOff
        case .move: .folderInput
        case .duplicate: .copy
        case .copyTo: .copyPlus
        case .archive: .archive
        case .unarchive: .archiveRestore
        case .select, .deselect: .squareCheck
        case .moveUp: .arrowUp
        case .moveDown: .arrowDown
        case .trash, .deleteForever: .trash
        case .restore: .undo2
        case .useTemplate: .layoutTemplate
        }
    }

    /// The bar's "…" (NoteList.tsx screenMenu): View as Cards or List, Sort by, then the list's own actions.
    private func showMenu(from anchor: CGRect) {
        var entries: [PhoneMenuEntry] = [
            PhoneMenuEntry(.heading("View as")),
            PhoneMenuEntry(.item("Cards", icon: .layoutGrid, checked: model.layout == .cards)) { model.layout = .cards },
            PhoneMenuEntry(.item("List", icon: .list, checked: model.layout == .list)) { model.layout = .list },
            PhoneMenuEntry(.separator()),
            PhoneMenuEntry(.heading("Sort by")),
        ]
        for (sort, label) in model.sortOptions {
            entries.append(PhoneMenuEntry(.item(label, checked: model.sort == sort)) { model.sort = sort })
        }
        if model.isTrash && model.total > 0 {
            entries.append(PhoneMenuEntry(.separator(1)))
            entries.append(PhoneMenuEntry(.item("Empty Trash…", icon: .trash, danger: true)) { model.confirmation = .emptyTrash(model.total) })
        }
        menus.show(entries, from: anchor, side: .bottom, align: .end)
    }
}

extension NotesListKind {
    /// The list a frame route shows, if it's one.
    init?(route: FrameRoute) {
        switch route {
        case .notes(let view): self.init(view)
        case .folder(let id): self = .folder(id)
        case .tag(let id): self = .tag(id)
        default: return nil
        }
    }
}
