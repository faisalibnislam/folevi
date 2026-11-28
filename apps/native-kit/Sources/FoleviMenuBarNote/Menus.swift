// The panel's two AppKit menus: "…" (the panel's actions, then Folevi's menu bar items from the host) and the
// destination picker (each space, its Drafts and its folders, indented under their parents).
import AppKit

/// A menu item that runs a closure.
final class ActionMenuItem: NSMenuItem {
    private let run: () -> Void

    init(_ title: String, key: String = "", modifiers: NSEvent.ModifierFlags = .command, state: NSControl.StateValue = .off, enabled: Bool = true, _ run: @escaping () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire(_:)), keyEquivalent: key)
        target = self
        keyEquivalentModifierMask = modifiers
        self.state = state
        isEnabled = enabled
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not from a nib") }

    @objc private func fire(_ sender: Any?) { run() }
}

extension MenuBarNoteModel {
    func panelMenu() -> NSMenu {
        let menu = NSMenu(title: "Note")
        menu.autoenablesItems = false
        menu.addItem(ActionMenuItem("Send to Folevi", key: "\r", enabled: noteID != nil) { [weak self] in self?.sendToFolevi() })
        menu.addItem(ActionMenuItem("New Note Here", key: "n") { [weak self] in self?.newNote() })
        menu.addItem(ActionMenuItem("Open in Folevi", key: "o", modifiers: [.command, .shift], enabled: noteID != nil) { [weak self] in self?.openInFolevi() })
        let shots = NSMenu(title: "Screenshot")
        shots.addItem(ActionMenuItem("Area…", key: "5", modifiers: [.command, .shift]) { [weak self] in self?.capture(.region) })
        shots.addItem(ActionMenuItem("Window…") { [weak self] in self?.capture(.window) })
        shots.addItem(ActionMenuItem("Entire Screen…") { [weak self] in self?.capture(.display) })
        let shotItem = NSMenuItem(title: "Screenshot", action: nil, keyEquivalent: "")
        shotItem.submenu = shots
        menu.addItem(shotItem)
        menu.addItem(.separator())
        if !settings.isDetached {
            menu.addItem(ActionMenuItem(settings.isPinned ? "Unpin" : "Pin on Top", key: "p", modifiers: [.command, .shift]) { [weak self] in self?.panel?.togglePin() })
        }
        menu.addItem(ActionMenuItem(settings.isDetached ? "Back to the Menu Bar" : "Open as a Window", key: "d", modifiers: [.command, .option]) { [weak self] in self?.panel?.toggleDetach() })
        let sizes = NSMenu(title: "Size")
        for preset in MenuBarNoteSettings.PanelSize.allCases {
            sizes.addItem(ActionMenuItem(preset.title) { [weak self] in self?.panel?.setSize(preset) })
        }
        let sizeItem = NSMenuItem(title: "Size", action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        let app = host?.appMenuItems() ?? []
        if !app.isEmpty {
            menu.addItem(.separator())
            for item in app { menu.addItem(item) }
        }
        return menu
    }

    /// Where new notes go: each space with Drafts first, then its folders (sub-folders indented). A space the
    /// person can't add notes to is shown but can't be picked.
    func destinationMenu() -> NSMenu {
        refreshDestinations()
        let menu = NSMenu(title: "New Notes Go To")
        menu.autoenablesItems = false
        let current = destination
        menu.addItem(.sectionHeader(title: "New notes go to"))
        guard let spaces, !spaces.isEmpty else {
            let item = NSMenuItem(title: spacesError.map { "Couldn't list the folders: \($0)" } ?? "Loading folders…", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
            menu.addItem(ActionMenuItem("Personal › Drafts", state: current == .personalDrafts ? .on : .off) { [weak self] in self?.choose(.personalDrafts) })
            return menu
        }
        for space in spaces {
            menu.addItem(.separator())
            menu.addItem(.sectionHeader(title: space.canEdit ? space.name : "\(space.name) (view only)"))
            let drafts = NoteDestination(space: space.id, spaceName: space.name)
            let d = ActionMenuItem("Drafts", state: current.space == space.id && current.folderId == nil ? .on : .off, enabled: space.canEdit) { [weak self] in self?.choose(drafts) }
            d.image = QNStyle.menuImage(.inbox)
            menu.addItem(d)
            for folder in space.folders {
                let target = NoteDestination(space: space.id, spaceName: space.name, folderId: folder.id, folderName: folder.name)
                let item = ActionMenuItem(folder.name, state: current.space == space.id && current.folderId == folder.id ? .on : .off, enabled: space.canEdit) { [weak self] in self?.choose(target) }
                item.image = QNStyle.menuImage(.folder)
                item.indentationLevel = min(folder.depth, 6)
                menu.addItem(item)
            }
        }
        return menu
    }
}
