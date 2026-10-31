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
    @State private var model: NotesListModel

    init(kind: NotesListKind, frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel) {
        self.frame = frame
        self.menus = menus
        self.phone = phone
        let feedback = ScreenFeedback(toast: { [weak phone] t in phone?.toast(t.message, tone: t.tone == .error ? .error : .info) })
        _model = State(initialValue: NotesListModel(client: phone.client, kind: kind, feedback: feedback))
    }

    var body: some View {
        PhoneNotesListScreen(model: model, actions: PhoneNotesListActions(
            open: { frame.open(FrameRoute(path: $0)) },
            openNote: { phone.router?.openNote($0, source: nil, focus: false) },
            back: { frame.back() },
            menu: { showMenu(from: $0) }
        ), scrollToTop: frame.scrollToTop)
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
