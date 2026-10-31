// Folders in the rebuild frame (docs/IOS_REBUILD_PLAN.md, I3): All folders (FoleviPhone's PhoneAllFoldersScreen
// from an AllFoldersModel) and New folder (the web's card, over everything, from Home, All folders or a folder).
import SwiftUI
import FoleviDesign
import FoleviEngine
import FoleviPhone
import FoleviScreens

/// New folder asked for: inside which folder it starts (nil: the top level).
struct NewFolderRequest: Identifiable {
    let id = UUID()
    var parent: String?
}

struct RebuildAllFoldersScreen: View {
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    let newFolder: (String?) -> Void
    @State private var model: AllFoldersModel

    init(frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel, newFolder: @escaping (String?) -> Void) {
        self.frame = frame
        self.menus = menus
        self.phone = phone
        self.newFolder = newFolder
        _model = State(initialValue: AllFoldersModel(client: phone.client))
    }

    var body: some View {
        PhoneAllFoldersScreen(model: model, open: { frame.open(FrameRoute(path: $0)) }, back: { frame.back() }, menu: { showMenu(from: $0) }, scrollToTop: frame.scrollToTop)
    }

    /// IphoneFolders' menu: New folder, View as Tiles or List, Sort by.
    private func showMenu(from anchor: CGRect) {
        var entries: [PhoneMenuEntry] = []
        if model.canEdit {
            entries.append(PhoneMenuEntry(.item("New folder", icon: .folderPlus)) { newFolder(nil) })
            entries.append(PhoneMenuEntry(.separator()))
        }
        entries += [
            PhoneMenuEntry(.heading("View as")),
            PhoneMenuEntry(.item("Tiles", icon: .layoutGrid, checked: model.layout != .list)) { model.layout = .tiles },
            PhoneMenuEntry(.item("List", icon: .list, checked: model.layout == .list)) { model.layout = .list },
            PhoneMenuEntry(.separator(1)),
            PhoneMenuEntry(.heading("Sort by")),
        ]
        for (sort, label) in model.sortOptions {
            entries.append(PhoneMenuEntry(.item(label, checked: model.sort == sort)) { model.sort = sort })
        }
        menus.show(entries, from: anchor, side: .bottom, align: .end)
    }
}

/// New folder's card: made through the engine (`folder.create`), then opened.
struct RebuildNewFolder: View {
    let request: NewFolderRequest
    let frame: PhoneFrameModel
    let menus: PhoneMenus
    let phone: PhoneModel
    let close: () -> Void
    @State private var tree: ValueStore<FoldersTreeValue>

    init(request: NewFolderRequest, frame: PhoneFrameModel, menus: PhoneMenus, phone: PhoneModel, close: @escaping () -> Void) {
        self.request = request
        self.frame = frame
        self.menus = menus
        self.phone = phone
        self.close = close
        _tree = State(initialValue: phone.client.watch(.foldersTree(space: nil)))
    }

    var body: some View {
        PhoneCardSheet(title: "New folder", close: close) {
            PhoneNewFolderForm(folders: tree.value?.folders ?? [], parent: request.parent, pickParent: { anchor, current, pick in
                var entries = [PhoneMenuEntry(.item("Top level", checked: current == nil)) { pick(nil) }]
                for f in tree.value?.folders ?? [] {
                    entries.append(PhoneMenuEntry(.item(String(repeating: "\u{00a0}\u{00a0}\u{00a0}", count: f.depth) + f.name, checked: current == f.id)) { pick(f.id) })
                }
                menus.show(entries, from: anchor, side: .bottom, align: .end)
            }, create: { name, color, parent in
                Task { @MainActor in
                    do {
                        let made = try await phone.client.command(.folderCreate(name: name, parentId: parent, color: color))
                        close()
                        frame.open(.folder(made.id))
                    } catch {
                        phone.toast(ScreenErrors.message(error), tone: .error)
                    }
                }
            })
        }
    }
}
