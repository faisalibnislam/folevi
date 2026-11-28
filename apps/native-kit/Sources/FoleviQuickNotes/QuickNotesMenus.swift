// The panel's two AppKit menus: "…" (the panel's actions, then Folevi's menu bar items from the host) and the
// destination picker (each space, its Drafts and its folders, indented under their parents).
import AppKit

/// A menu item that runs a closure.
final class QNMenuItem: NSMenuItem {
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

extension QuickNotesModel {
    func panelMenu() -> NSMenu {
        let menu = NSMenu(title: "Quick Notes")
        menu.autoenablesItems = false
        let rich = activeDot?.isRichText ?? true
        let hasText = !(activeDot?.isEmpty ?? true)
        menu.addItem(QNMenuItem("Save to Note", key: "s", enabled: hasText && !saving) { [weak self] in self?.saveToNote() })
        menu.addItem(.separator())
        menu.addItem(QNMenuItem("New Quick Note", key: "n") { [weak self] in self?.addDot() })
        menu.addItem(QNMenuItem("Rename…", key: "r") { [weak self] in if let id = self?.activeDotID { self?.overlay = .rename(id) } })
        let colors = NSMenu(title: "Color")
        for color in DotColorID.allCases {
            let item = QNMenuItem(color.localizedName.capitalized, state: activeDot?.colorID == color && activeDot?.customHex == nil ? .on : .off) { [weak self] in
                if let id = self?.activeDotID { self?.setColor(id, colorID: color) }
            }
            item.image = ColorSwatch.image(color.nsColor)
            colors.addItem(item)
        }
        let colorItem = NSMenuItem(title: "Color", action: nil, keyEquivalent: "")
        colorItem.submenu = colors
        menu.addItem(colorItem)
        menu.addItem(QNMenuItem("Move Left", key: "[", modifiers: [.command, .option], enabled: (activeIndex ?? 0) > 0) { [weak self] in self?.moveActiveDot(by: -1) })
        menu.addItem(QNMenuItem("Move Right", key: "]", modifiers: [.command, .option], enabled: (activeIndex ?? 0) < dots.count - 1) { [weak self] in self?.moveActiveDot(by: 1) })
        menu.addItem(QNMenuItem(rich ? "Switch to Markdown" : "Switch to Rich Text", key: "t", modifiers: [.command, .shift]) { [weak self] in self?.toggleRichText() })
        let shots = NSMenu(title: "Screenshot")
        shots.addItem(QNMenuItem("Area…", key: "5", modifiers: [.command, .shift]) { [weak self] in self?.capture(.region) })
        shots.addItem(QNMenuItem("Window…") { [weak self] in self?.capture(.window) })
        shots.addItem(QNMenuItem("Entire Screen…") { [weak self] in self?.capture(.display) })
        let shotItem = NSMenuItem(title: "Screenshot", action: nil, keyEquivalent: "")
        shotItem.submenu = shots
        menu.addItem(shotItem)
        menu.addItem(QNMenuItem("Copy as Markdown", key: "c", modifiers: [.command, .shift], enabled: hasText) { [weak self] in self?.editor.activeTextView?.copyAsMarkdown(nil) })
        menu.addItem(QNMenuItem("Clear Text", key: "\u{8}", modifiers: [.command, .option], enabled: hasText) { [weak self] in self?.clearDot() })
        menu.addItem(QNMenuItem("Delete Quick Note…", key: "\u{8}", enabled: dots.count > 1) { [weak self] in self?.requestDelete() })
        menu.addItem(.separator())
        if !settings.isDetached {
            menu.addItem(QNMenuItem(settings.isPinned ? "Unpin" : "Pin on Top", key: "p", modifiers: [.command, .shift]) { [weak self] in self?.panel?.togglePin() })
        }
        menu.addItem(QNMenuItem(settings.isDetached ? "Back to the Menu Bar" : "Open as a Window", key: "d", modifiers: [.command, .option]) { [weak self] in self?.panel?.toggleDetach() })
        let sizes = NSMenu(title: "Size")
        for preset in QuickNotesSettings.PanelSize.allCases {
            sizes.addItem(QNMenuItem(preset.title) { [weak self] in self?.panel?.setSize(preset) })
        }
        let sizeItem = NSMenuItem(title: "Size", action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        menu.addItem(QNMenuItem("Keyboard Shortcuts", key: "/") { [weak self] in self?.overlay = .cheatSheet })
        let app = host?.appMenuItems() ?? []
        if !app.isEmpty {
            menu.addItem(.separator())
            for item in app { menu.addItem(item) }
        }
        return menu
    }

    /// The destination picker: each space with Drafts first, then its folders (sub-folders indented). A space the
    /// person can't add notes to is shown but can't be picked.
    func destinationMenu() -> NSMenu {
        refreshDestinations()
        let menu = NSMenu(title: "Save To")
        menu.autoenablesItems = false
        let current = destination
        guard let spaces, !spaces.isEmpty else {
            let item = NSMenuItem(title: spacesError.map { "Couldn't list the folders: \($0)" } ?? "Loading folders…", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
            menu.addItem(QNMenuItem("Personal › Drafts", state: current == .personalDrafts ? .on : .off) { [weak self] in self?.choose(.personalDrafts) })
            return menu
        }
        for (i, space) in spaces.enumerated() {
            if i > 0 { menu.addItem(.separator()) }
            menu.addItem(.sectionHeader(title: space.canEdit ? space.name : "\(space.name) (view only)"))
            let drafts = QuickNoteDestination(space: space.id, spaceName: space.name)
            let d = QNMenuItem("Drafts", state: current.space == space.id && current.folderId == nil ? .on : .off, enabled: space.canEdit) { [weak self] in self?.choose(drafts) }
            d.image = NSImage(systemSymbolName: "tray", accessibilityDescription: nil)
            menu.addItem(d)
            for folder in space.folders {
                let target = QuickNoteDestination(space: space.id, spaceName: space.name, folderId: folder.id, folderName: folder.name)
                let item = QNMenuItem(folder.name, state: current.space == space.id && current.folderId == folder.id ? .on : .off, enabled: space.canEdit) { [weak self] in self?.choose(target) }
                item.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
                item.indentationLevel = min(folder.depth, 6)
                menu.addItem(item)
            }
        }
        return menu
    }
}
