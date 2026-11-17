// Home in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): the web's iPhone Home drawn natively (FoleviPhone's
// PhoneHomeContent) under the root bar: the place's avatar (account and places), the pill (notifications when
// signed in, and More), the large title with the workspace above it, and the search field.
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
    let newFolder: (String?) -> Void
    @State private var moreFrame: CGRect = .zero
    /// A tag's Edit tag… and Delete tag… (its long-press menu).
    @State private var editingTag: TagRow?
    @State private var deletingTag: TagRow?
    @State private var tagName = ""
    @Environment(\.colorScheme) private var scheme
    /// Foli DNA's saved views (`graph.views`, small: it doesn't load the map), watched once Foli DNA is on here.
    @State private var dnaViews: ValueStore<GraphViewsValue>?

    private var signedIn: Bool { home.session.value?.mode == .account }

    var body: some View {
        PhoneScreen(PhoneScreenOptions(title: "Home", eyebrow: home.eyebrow), root: true, scrollToTop: frame.scrollToTop) {
            Button(action: openAccount) {
                PhoneHereMark(you: (home.profileName.isEmpty ? "You" : home.profileName, home.session.value?.profile.avatarUrl.flatMap(URL.init(string:))), workspace: home.workspaceMark.map { ($0.name, $0.logoUrl) })
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(home.spaceName): account and places")
        } trailing: {
            WebGlassPill {
                if signedIn {
                    WebPillButton("Notifications", action: openNotifications) {
                        WebIconView(.bell, size: 21, strokeWidth: 1.9)
                    }
                }
                // (A moment after the press: opened in the same update as the pill's own press, the menu was lost.)
                WebPillButton("More", action: { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { showMore(from: moreFrame) } }) {
                    WebIconView(.ellipsis, size: 24, strokeWidth: 2.2)
                }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { moreFrame = $0 }
            }
        } header: {
            PhoneSearchButton(home.searchPrompt) { frame.open(.search("")) }
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
        .onChange(of: home.graphOn, initial: true) { _, on in
            if on, dnaViews == nil { dnaViews = phone.client.watch(.graphViews()) }
        }
    }

    private var homeActions: PhoneHomeActions {
        var a = PhoneHomeActions(
            open: { frame.open(FrameRoute(path: $0)) },
            openNote: { phone.router?.openNote($0, source: nil, focus: false) },
            foldersMenu: { showMore(from: $0, graph: false) }
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

    /// The pill's More and the Folders section's "…": New folder, All folders (and Foli DNA with its saved views,
    /// as the sidebar lists them under it, from the pill).
    private func showMore(from anchor: CGRect, graph: Bool = true) {
        var entries = [
            PhoneMenuEntry(.item("New folder", icon: .folderPlus)) { newFolder(nil) },
            PhoneMenuEntry(.item("All folders", icon: .files)) { frame.open(FrameRoute(path: "/folders")) },
        ]
        if graph && home.graphOn {
            entries.append(PhoneMenuEntry(.item("Foli DNA", icon: .waypoints)) { frame.open(FrameRoute(path: "/graph")) })
            for view in Self.dnaMenuViews(dnaViews?.value) {
                let id = view.id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? view.id
                entries.append(PhoneMenuEntry(.item(view.name, icon: .waypoints, id: "dna-view:\(view.id)")) { frame.open(FrameRoute(path: "/graph?view=\(id)")) })
            }
        }
        menus.show(entries, from: anchor, side: .bottom, align: .end)
    }

    /// The saved views the menu lists: the sidebar's first five (Sidebar.tsx SIDEBAR_LIMIT).
    static func dnaMenuViews(_ value: GraphViewsValue?) -> [GraphSavedView] {
        Array((value?.views ?? []).prefix(5))
    }
}
