// The Dock icon's menu (docs/MAC_POLISH_PLAN.md §3.9): New Note, Quick Add Task, New Window; up to five recent
// notes; the places when there are several. The badge is Chrome.updateBadge (the unread count over every place).
import AppKit

/// A menu item that runs a closure.
final class BlockMenuItem: NSMenuItem {
    private let block: () -> Void

    init(_ title: String, key: String = "", _ block: @escaping () -> Void) {
        self.block = block
        super.init(title: title, action: #selector(fire(_:)), keyEquivalent: key)
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("not from a nib") }

    @objc private func fire(_ sender: Any?) { block() }
}

@MainActor
enum DockMenu {
    static func build() -> NSMenu {
        let menu = NSMenu(title: "Folevi")
        menu.addItem(BlockMenuItem("New Note") { MainMenu.shared.run("file.new-note"); NSApp.activate() })
        menu.addItem(BlockMenuItem("Quick Add Task") { QuickAddPanel.shared.show() })
        menu.addItem(BlockMenuItem("New Window") {
            WindowManager.shared.openMain(path: "/documents")
            NSApp.activate()
        })
        if !Chrome.recent.isEmpty {
            menu.addItem(.separator())
            for note in Chrome.recent.prefix(5) {
                menu.addItem(BlockMenuItem(note.title.isEmpty ? "Untitled" : note.title) { Chrome.open(path: "/d/\(note.id)", place: note.place); NSApp.activate() })
            }
        }
        if Chrome.places.count > 1 {
            menu.addItem(.separator())
            let places = NSMenu(title: "Places")
            let current = WindowManager.shared.currentPlace()
            for id in Chrome.places {
                let item = BlockMenuItem(Chrome.placeLabel(id) ?? id) { Chrome.switchPlace(id); NSApp.activate() }
                item.state = id == current ? .on : .off
                places.addItem(item)
            }
            let top = NSMenuItem(title: "Places", action: nil, keyEquivalent: "")
            top.submenu = places
            menu.addItem(top)
        }
        return menu
    }
}

extension AppDelegate {
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        DockMenu.build()
    }
}
