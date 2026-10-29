// The menu bar icon (docs/MAC_POLISH_PLAN.md §3.9): Folevi's "F", tinted by the system, and its menu: Quick Add,
// New Note, Search; the recent notes (⌘1 to ⌘8 while it's open); the save state with its dot; the places when
// there are several (choosing one switches); Open Folevi, Settings, Quit. Settings > General can hide it.
import AppKit
import FoleviDesign

@MainActor
final class StatusItem: NSObject, NSMenuDelegate {
    static let shared = StatusItem()

    private(set) var item: NSStatusItem?
    private let menu = NSMenu(title: "Folevi")

    func update() {
        guard DesktopSettings.current.menuBarIcon, !Paths.testing else {
            if let item { NSStatusBar.system.removeStatusItem(item) }
            item = nil
            return
        }
        guard item == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let image = NSImage(named: "StatusItemTemplate")
        image?.isTemplate = true
        image?.accessibilityDescription = "Folevi"
        item.button?.image = image
        item.button?.foleviTooltip = "Folevi"
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        self.item = item
    }

    /// The menu as it is now (built each time it opens).
    func menuNeedsUpdate(_ menu: NSMenu) {
        build(into: menu)
    }

    func build(into menu: NSMenu) {
        menu.removeAllItems()
        let quick = add(menu, "Quick Add Task…") { QuickAddPanel.shared.show() }
        if let (key, mask) = MainMenu.menuKey(DesktopSettings.current.quickAddShortcut) {
            quick.keyEquivalent = key
            quick.keyEquivalentModifierMask = mask
        }
        add(menu, "New Note") { MainMenu.shared.run("file.new-note"); NSApp.activate() }
        add(menu, "Search Folevi…") { MainMenu.shared.run("file.open-quickly"); NSApp.activate() }
        menu.addItem(.separator())

        let several = Chrome.places.count > 1
        if !Chrome.recent.isEmpty {
            header(menu, "Recent Notes")
            for (i, note) in Chrome.recent.prefix(8).enumerated() {
                let title = note.title.isEmpty ? "Untitled" : note.title
                let item = add(menu, title, key: "\(i + 1)") { Chrome.open(path: "/d/\(note.id)", place: note.place); NSApp.activate() }
                item.image = NSImage(systemSymbolName: "doc.text", accessibilityDescription: nil)
                if several, let label = Chrome.placeLabel(note.place) { item.subtitle = label }
            }
            menu.addItem(.separator())
        }
        if !Chrome.status.isEmpty {
            let state = NSMenuItem(title: Chrome.status, action: nil, keyEquivalent: "")
            state.isEnabled = false
            state.image = Self.dot(Self.statusColor(Chrome.status))
            menu.addItem(state)
            menu.addItem(.separator())
        }
        if several {
            let places = NSMenu(title: "Places")
            places.autoenablesItems = false
            let current = WindowManager.shared.currentPlace()
            for id in Chrome.places {
                let item = add(places, Chrome.placeLabel(id) ?? id) { Chrome.switchPlace(id); NSApp.activate() }
                item.state = id == current ? .on : .off
            }
            let top = NSMenuItem(title: "Places", action: nil, keyEquivalent: "")
            top.submenu = places
            menu.addItem(top)
            menu.addItem(.separator())
        }
        add(menu, "Open Folevi") { WindowManager.shared.showMain() }
        add(menu, "Settings…", key: ",") { SettingsWindow.shared.show() }
        menu.addItem(.separator())
        add(menu, "Quit Folevi", key: "q") { NSApp.terminate(nil) }
    }

    // MARK: pieces

    private final class Action: NSObject {
        let run: () -> Void
        init(_ run: @escaping () -> Void) { self.run = run }
        @objc func fire(_ sender: Any?) { run() }
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, key: String = "", _ run: @escaping () -> Void) -> NSMenuItem {
        let action = Action(run)
        let item = NSMenuItem(title: title, action: #selector(Action.fire(_:)), keyEquivalent: key)
        item.target = action
        item.representedObject = action
        item.isEnabled = true
        menu.addItem(item)
        return item
    }

    private func header(_ menu: NSMenu, _ title: String) {
        if #available(macOS 14.0, *) {
            menu.addItem(.sectionHeader(title: title))
        } else {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
    }

    /// The save state's colour: saved green, working blue, offline grey, trouble orange or red. Pure (ChromeTests).
    nonisolated static func statusKind(_ text: String) -> String {
        let t = text.lowercased()
        if t.contains("couldn") || t.contains("error") { return "error" }
        if t.contains("review") || t.contains("conflict") { return "attention" }
        if t.contains("offline") { return "offline" }
        if t.contains("saving") || t.contains("syncing") { return "working" }
        return "saved"
    }

    static func statusColor(_ text: String) -> NSColor {
        switch statusKind(text) {
        case "error": return .systemRed
        case "attention": return .systemOrange
        case "offline": return .systemGray
        case "working": return .systemBlue
        default: return .systemGreen
        }
    }

    static func dot(_ color: NSColor) -> NSImage {
        NSImage(size: NSSize(width: 10, height: 10), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1.5, dy: 1.5)).fill()
            return true
        }
    }
}
