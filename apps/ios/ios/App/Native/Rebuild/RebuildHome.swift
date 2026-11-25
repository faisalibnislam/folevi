// Home in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): the web's iPhone Home drawn natively (FoleviPhone's
// PhoneHomeContent) under the root bar: the place's avatar (account and places), the pill (notifications when
// signed in, with the sync status before it), the large title with the workspace above it, and the search field.
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

struct RebuildHomeScreen: View {
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let home: HomeModel
    let phone: PhoneModel
    let openAccount: () -> Void
    let openNotifications: () -> Void
    /// The sync status's details (the cloud beside the bell).
    let openSync: () -> Void
    let newFolder: (String?) -> Void
    /// A tag's Edit tag… and Delete tag… (its long-press menu).
    @State private var editingTag: TagRow?
    @State private var deletingTag: TagRow?
    @State private var tagName = ""
    @Environment(\.colorScheme) private var scheme
    @Environment(\.phoneOpenSearch) private var openSearch

    private var signedIn: Bool { home.session.value?.mode == .account }

    private var homeOptions: PhoneScreenOptions {
        var o = PhoneScreenOptions(title: "Home", eyebrow: home.eyebrow)
        o.trailingEmpty = !signedIn && !RebuildSync.debugShown
        return o
    }

    var body: some View {
        PhoneScreen(homeOptions, root: true, scrollToTop: frame.scrollToTop) {
            Button(action: openAccount) {
                PhoneHereMark(you: (home.profileName.isEmpty ? "You" : home.profileName, home.session.value?.profile.avatarUrl.flatMap(URL.init(string:))), workspace: home.workspaceMark.map { ($0.name, $0.logoUrl) })
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(home.spaceName): account and places")
        } trailing: {
            // The sync status and the bell (signed in: a library in the cloud). No More: what it held, All folders
            // and Foli DNA, are rows on Home, and Home makes no folders (the owner, 2026-11-19).
            if signedIn || RebuildSync.debugShown {
                WebGlassPill {
                    RebuildSyncButton(phone: phone, action: openSync)
                    if signedIn || RebuildSync.debugShown {
                        WebPillButton("Notifications", action: openNotifications) {
                            WebIconView(.bell, size: 21, strokeWidth: 1.9)
                        }
                    }
                }
            }
        } header: {
            // As today's app: "Search in <place>" under the title, opening Search (the owner, 2026-11-25).
            PhoneSearchOpener("Search in \(home.spaceName)") { openSearch?() }
        } content: {
            PhoneHomeContent(model: home, actions: homeActions)
            .padding(.bottom, 24)
        }
        .folderDialogs(home.dialogs, actions: home.actions, tree: home.tree.value?.folders ?? [])
        .homeNoteSheets(home)
        // Edit tag (the web's dialog: its name; the colours are the menu's own rows).
        .alert("Edit tag", isPresented: Binding(get: { editingTag != nil }, set: { if !$0 { editingTag = nil } }), presenting: editingTag) { tag in
            TextField("Name", text: $tagName)
            Button("Cancel", role: .cancel) { editingTag = nil }
            Button("Save") { saveTag(tag) }
        }
        .alert(deletingTag.map { "Delete #\($0.name)?" } ?? "", isPresented: Binding(get: { deletingTag != nil }, set: { if !$0 { deletingTag = nil } }), presenting: deletingTag) { tag in
            Button("Cancel", role: .cancel) { deletingTag = nil }
            Button("Delete tag", role: .destructive) { deleteTag(tag) }
        } message: { _ in
            Text("The tag is removed from every document. The documents themselves are not affected.")
        }
        .refreshable { await home.refresh() }
        .onAppear { home.setVisible(true) }
        .onDisappear { home.setVisible(false) }
    }

    private var homeActions: PhoneHomeActions {
        var a = PhoneHomeActions(
            open: { frame.open(FrameRoute(path: $0)) },
            openNote: { phone.router?.openNote($0, source: nil, focus: false) }
        )
        a.folderMenu = { card, anchor in
            let context = FolderMenuContext(session: home.session.value, places: home.places.value, links: home.folderLinks, locks: home.locks.error == nil ? home.locks.value : nil)
            PhoneFolderMenu.show(MenuFolder(card), from: anchor, context: context, actions: home.actions, dialogs: home.dialogs, menus: menus, hooks: RebuildFolderHooks.make(frame: frame, phone: phone, newFolder: newFolder))
        }
        a.noteMenu = { row, anchor in showNoteMenu(row, from: anchor) }
        if home.canEdit {
            a.tagMenu = { tag, anchor in showTagMenu(tag, from: anchor) }
        }
        return a
    }

    /// The tag colours, in the web's order and words (Sidebar.tsx TAG_COLORS).
    static let tagColors: [(id: String, label: String)] = [("accent", "Cocoa"), ("moss", "Moss"), ("marigold", "Marigold"), ("plum", "Plum"), ("coral", "Coral"), ("muted", "Gray")]

    /// A tag row's long press (the web's TagMenu): Edit tag…, the other colours, Delete tag….
    private func showTagMenu(_ tag: TagRow, from anchor: CGRect) {
        var entries = [PhoneMenuEntry(.item("Edit tag…")) {
            tagName = tag.name
            editingTag = tag
        }]
        for c in Self.tagColors where c.id != tag.color {
            entries.append(PhoneMenuEntry(.item("Color: \(c.label)", swatch: PhoneHomeContent.tagColor(c.id, scheme).color, id: "color:\(c.id)")) {
                phone.perform { _ = try await phone.client.command(.tagUpdate(id: tag.id, color: c.id)) }
            })
        }
        entries.append(PhoneMenuEntry(.separator(1)))
        entries.append(PhoneMenuEntry(.item("Delete tag…", danger: true)) { deletingTag = tag })
        menus.show(entries, from: anchor, side: .bottom, align: .start)
    }

    private func saveTag(_ tag: TagRow) {
        let name = String(tagName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        guard !name.isEmpty, name != tag.name else { return }
        phone.perform {
            _ = try await phone.client.command(.tagUpdate(id: tag.id, name: name))
            phone.toast("Tag updated", tone: .success)
        }
    }

    private func deleteTag(_ tag: TagRow) {
        phone.perform {
            _ = try await phone.client.command(.tagDelete(id: tag.id))
            phone.toast("Deleted #\(tag.name)", tone: .success)
            if frame.top == .tag(tag.id) { frame.back() }
        }
    }

    /// A note's long press on Home (a recent card, a Starred row): the lists' menu, the same items and icons.
    private func showNoteMenu(_ row: FoleviEngine.NoteRow, from anchor: CGRect) {
        var entries: [PhoneMenuEntry] = []
        for (i, group) in home.noteMenu(for: row).enumerated() {
            if i > 0 { entries.append(PhoneMenuEntry(.separator(i))) }
            for action in group {
                entries.append(PhoneMenuEntry(.item(Self.title(action), icon: RebuildNotesScreen.icon(action), danger: action == .trash)) {
                    Task { await home.run(action, on: row) }
                })
            }
        }
        menus.show(entries, from: anchor, side: .bottom, align: .start)
    }

    private static func title(_ action: NotesListModel.RowAction) -> String {
        switch action {
        case .star: "Bookmark"
        case .unstar: "Remove bookmark"
        case .move: "Move to folder…"
        case .duplicate: "Duplicate"
        case .archive: "Archive"
        case .unarchive: "Unarchive"
        default: "Move to Trash"
        }
    }
}
