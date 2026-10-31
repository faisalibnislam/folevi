// A folder's menu on the iPhone (the web folder card's "…" and its long press): the kit's items in its groups
// (FolderMenuItem.groups: new note, new folder inside, rename, colour, move, …, delete) as the phone's menu,
// Change color opening the folder colours as a menu of its own. What they do is the kit's (NoteActions, the
// folder dialogs the screen shows with `.folderDialogs`).
#if os(iOS)
import SwiftUI
import UIKit
import FoleviDesign
import FoleviEngine
import FoleviScreens

public struct PhoneFolderMenuHooks {
    public var open: (String) -> Void
    public var openNote: (String) -> Void
    /// New folder's card, inside this folder.
    public var newFolder: (String) -> Void
    public var askAI: (String, String) -> Void
    public var toast: (String) -> Void

    public init(open: @escaping (String) -> Void, openNote: @escaping (String) -> Void, newFolder: @escaping (String) -> Void, askAI: @escaping (String, String) -> Void, toast: @escaping (String) -> Void) {
        self.open = open
        self.openNote = openNote
        self.newFolder = newFolder
        self.askAI = askAI
        self.toast = toast
    }
}

@MainActor
public enum PhoneFolderMenu {
    /// Shows the menu for `folder` out of `anchor`.
    public static func show(_ folder: MenuFolder, from anchor: CGRect, context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState, menus: PhoneMenus, hooks: PhoneFolderMenuHooks) {
        var entries: [PhoneMenuEntry] = []
        for (i, group) in FolderMenuItem.groups(for: folder, in: context).enumerated() {
            if i > 0 { entries.append(PhoneMenuEntry(.separator(i))) }
            for item in group {
                entries.append(PhoneMenuEntry(.item(item.title, icon: icon(item), danger: item == .delete, checked: item == .lock && context.isLocked(folder.id))) {
                    run(item, folder: folder, anchor: anchor, context: context, actions: actions, dialogs: dialogs, menus: menus, hooks: hooks)
                })
            }
        }
        menus.show(entries, from: anchor, side: .bottom, align: .start)
    }

    private static func run(_ item: FolderMenuItem, folder: MenuFolder, anchor: CGRect, context: FolderMenuContext, actions: NoteActions, dialogs: FolderDialogState, menus: PhoneMenus, hooks: PhoneFolderMenuHooks) {
        switch item {
        case .newNote:
            Task { if let id = await actions.create(folderId: folder.id) { hooks.openNote(id) } }
        case .newFolderInside: hooks.newFolder(folder.id)
        case .rename: dialogs.open(.rename(folder))
        case .color:
            // The colours, a menu of their own out of the same place (after this one has gone).
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                let current = FolderColor.resolve(folder.color).id
                menus.show(FoleviTokens.folderColors.map { c in
                    PhoneMenuEntry(.item(c.name, checked: c.id == current)) {
                        Task { await actions.setFolderColor(folder.id, c.id == FolderColor.defaultId ? nil : c.id) }
                    }
                }, from: anchor, side: .bottom, align: .start)
            }
        case .move: dialogs.open(.move(folder))
        case .movePlaces: hooks.toast("Moving folders between places comes to the app with the next update.")
        case .moveToTop:
            Task { await actions.moveFolder(folder.id, to: FolderRules.Place(parentId: nil, afterId: context.links.filter { $0.parentId == nil }.last?.id), message: "Moved to the top level") }
        case .askAI: hooks.askAI(folder.id, folder.name)
        case .lock: dialogs.open(.lock(folder, locked: context.isLocked(folder.id), level: context.level))
        case .copyLink:
            UIPasteboard.general.string = FoleviLinks.folder(folder.id)
            hooks.toast("Link copied")
        case .invite: hooks.toast("Inviting people comes to the app with the next update.")
        case .delete: dialogs.open(.delete(folder, subfolders: context.subfolderCount(folder.id)))
        }
    }

    static func icon(_ item: FolderMenuItem) -> WebIcon {
        switch item {
        case .newNote: .filePlusCorner
        case .newFolderInside: .folderPlus
        case .rename: .pencil
        case .color: .palette
        case .move: .folderInput
        case .movePlaces: .arrowRightLeft
        case .moveToTop: .arrowUpToLine
        case .askAI: .sparkles
        case .lock: .lock
        case .copyLink: .link
        case .invite: .userPlus
        case .delete: .trash
        }
    }
}
#endif
