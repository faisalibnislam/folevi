// The menu bar icon (docs/MAC_POLISH_PLAN.md §3.9): Folevi's "F", tinted by the system. A click opens the menu
// bar note (MenuBarNoteHost.swift, 2026-11-28); a right-click or Control-click shows the menu it had before: Quick Add,
// New Note, Search; the recent notes (⌘1 to ⌘8 while it's open); the save state with its dot; the places when
// there are several (choosing one switches); Open Folevi, Settings, Quit. The same items end the menu bar
// note's own menu (`appItems`). Settings > General can hide the icon.
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
        item.button?.foleviTooltip = "Folevi note"
        item.button?.setAccessibilityLabel("Folevi note")
        item.button?.target = self
        item.button?.action = #selector(clicked(_:))
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        menu.delegate = self
        menu.autoenablesItems = false
        self.item = item
    }

    /// A click opens the menu bar note; a right-click or Control-click, the menu.
    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            guard let item else { return }
            item.menu = menu
            item.button?.performClick(nil)
            item.menu = nil
            return
        }
        MacMenuBarNote.shared.toggle()
    }

    /// The icon's frame on screen (the menu bar note opens under it), nil before the menu bar has placed it.
    var buttonScreenFrame: NSRect? {
        guard let button = item?.button, let window = button.window else { return nil }
        return window.convertToScreen(button.convert(button.bounds, to: nil))
    }

    /// Highlighted while the menu bar note shows, as a menu's icon is while its menu is open.
    func setHighlighted(_ on: Bool) {
        item?.button?.highlight(on)
    }

    /// The menu's items for the menu bar note's own menu: the same, with the recent notes in a submenu and no keys
    /// (the panel's own shortcuts come first there).
    func appItems() -> [NSMenuItem] {
        let temp = NSMenu()
        build(into: temp, forPanel: true)
        let items = temp.items
        temp.removeAllItems()
        return items
    }

    /// The menu as it is now (built each time it opens).
    func menuNeedsUpdate(_ menu: NSMenu) {
        build(into: menu)
    }

    func build(into menu: NSMenu, forPanel: Bool = false) {
        menu.removeAllItems()
        if !forPanel {
            let notes = add(menu, "Menu Bar Note") { MacMenuBarNote.shared.show() }
            if let (key, mask) = MainMenu.menuKey(DesktopSettings.current.quickAddShortcut) {
                notes.keyEquivalent = key
                notes.keyEquivalentModifierMask = mask
            }
        }
        add(menu, "Quick Add Task…") {
            if forPanel { MacMenuBarNote.shared.note.hide() }
            QuickAddPanel.shared.show()
        }
        add(menu, "New Note") { MainMenu.shared.run("file.new-note"); NSApp.activate() }
        add(menu, "Search Folevi…") { MainMenu.shared.run("file.open-quickly"); NSApp.activate() }
        menu.addItem(.separator())

        let several = Chrome.places.count > 1
        if !Chrome.recent.isEmpty {
            let target: NSMenu
            if forPanel {
                target = NSMenu(title: "Recent Notes")
                target.autoenablesItems = false
                let top = NSMenuItem(title: "Recent Notes", action: nil, keyEquivalent: "")
                top.submenu = target
                menu.addItem(top)
            } else {
                header(menu, "Recent Notes")
                target = menu
            }
            for (i, note) in Chrome.recent.prefix(8).enumerated() {
                let title = note.title.isEmpty ? "Untitled" : note.title
                let item = add(target, title, key: forPanel ? "" : "\(i + 1)") { Chrome.open(path: "/d/\(note.id)", place: note.place); NSApp.activate() }
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
        add(menu, "Settings…", key: forPanel ? "" : ",") {
            WindowManager.shared.showMain(path: "/settings")
            NSApp.activate()
        }
        menu.addItem(.separator())
        add(menu, "Quit Folevi", key: forPanel ? "" : "q") { NSApp.terminate(nil) }
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
