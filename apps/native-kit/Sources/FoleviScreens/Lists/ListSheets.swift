// A note list's sheets and alerts (Move to folder, Copy to, Generate with Foli AI, Delete permanently, Empty
// Trash, the folder menu's dialogs) as one modifier, so a host drawing its own list (the Mac's web-matched
// browser) presents the same ones NotesListScreen does.
import SwiftUI
import FoleviDesign
import FoleviEngine

public extension View {
    /// The list model's sheets and alerts: `moving`, `copying`, `generating`, `confirmation` and its folder dialogs.
    func notesListSheets(_ model: NotesListModel) -> some View {
        modifier(NotesListSheets(model: model))
    }
}

struct NotesListSheets: ViewModifier {
    @Bindable var model: NotesListModel
    @Environment(\.screenNavigator) private var navigator
    @Environment(\.screenFeedback) private var feedback

    struct Request: Identifiable {
        let ids: [String]
        var id: String { ids.joined(separator: ",") }
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: Binding { model.moving.map { Request(ids: $0) } } set: { if $0 == nil { model.moving = nil } }) { request in
                MoveNotesSheet(count: request.ids.count, targets: model.moveTargets) { target in
                    Task { await model.move(request.ids, to: target) }
                } onCancel: { model.moving = nil }
            }
            .sheet(item: Binding { model.copying.map { Request(ids: $0) } } set: { if $0 == nil { model.copying = nil } }) { request in
                CopyToSheet(client: model.client, spaces: model.copyTargets, count: request.ids.count) { space, folder in
                    model.copying = nil
                    model.selecting = false
                    Task { await model.actions.copy(request.ids, to: space, folder: folder) }
                } onCancel: { model.copying = nil }
            }
            .sheet(isPresented: Binding(get: { model.generating != nil }, set: { if !$0 { model.generating = nil } })) {
                if let g = model.generating {
                    GenerateSheet(model: g) { id in
                        model.generating = nil
                        feedback.toast(ScreenToast("Saved to Templates", tone: .success, actionTitle: "Open") { navigator.open(.note(id: id), nil) })
                    } onCancel: { model.generating = nil }
                }
            }
            .alert(model.confirmation.map { model.confirmationText($0).title } ?? "", isPresented: Binding { model.confirmation != nil } set: { if !$0 { model.confirmation = nil } }, presenting: model.confirmation) { c in
                Button("Cancel", role: .cancel) { model.confirmation = nil }
                Button(model.confirmationText(c).button, role: .destructive) { Task { await model.confirm(c) } }
            } message: { c in
                Text(model.confirmationText(c).message)
            }
            .folderDialogs(model.dialogs, actions: model.actions, tree: model.tree.value?.folders ?? [])
    }
}

public extension FolderMenuItems {
    /// Runs a folder menu item outside the SwiftUI menu (a host drawing its own menus): the same actions.
    @MainActor
    static func perform(_ item: FolderMenuItem, folder: MenuFolder, context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState, navigator: ScreenNavigator, feedback: ScreenFeedback) {
        switch item {
        case .newNote:
            Task {
                if let id = await actions.create(folderId: folder.id) { navigator.open(.note(id: id), nil) }
            }
        case .newFolderInside: dialogs.open(.newFolder(parent: folder))
        case .rename: dialogs.open(.rename(folder))
        case .color, .lock: break
        case .move: dialogs.open(.move(folder))
        case .movePlaces: navigator.open(.movePlaces(folders: [folder.id], notes: []), nil)
        case .moveToTop:
            Task { await actions.moveFolder(folder.id, to: FolderRules.Place(parentId: nil, afterId: context.links.filter { $0.parentId == nil }.last?.id), message: "Moved to the top level") }
        case .askAI: navigator.open(.foliAI(about: .folder(id: folder.id, name: folder.name)), nil)
        case .copyLink:
            feedback.copy(FoleviLinks.folder(folder.id))
            feedback.toast(ScreenToast("Link copied", tone: .success))
        case .invite:
            if let space = context.inviteSpace { navigator.open(.invite(space: space), nil) }
        case .delete: dialogs.open(.delete(folder, subfolders: context.subfolderCount(folder.id)))
        }
    }
}
