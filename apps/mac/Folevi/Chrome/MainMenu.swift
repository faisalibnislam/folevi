// The menu bar (docs/MAC_POLISH_PLAN.md §3.1), built from MenuModel. Page commands go to the key main window's
// page as { type: "menu", id } (foleviDesktop.onCommand); the page says what it can't do right now
// (foleviDesktop.setMenuState) and those items show off. Commands that make sense anywhere (New Note, Go) bring a
// main window forward first; Close Tab in a window without tabs (Settings) closes that window.
import AppKit
import WebKit

@MainActor
final class MainMenu: NSObject, NSMenuItemValidation, NSMenuDelegate {
    static let shared = MainMenu()

    /// The built items by id (tests and the eval hook find them here).
    private(set) var itemsById: [String: NSMenuItem] = [:]
    private(set) var menusById: [String: NSMenu] = [:]
    private var shareMenu: NSMenu?

    func build() -> NSMenu {
        itemsById = [:]
        menusById = [:]
        let main = NSMenu(title: "Main")
        for spec in MenuModel.menus(debug: Paths.isDebug) {
            let menu = NSMenu(title: spec.title)
            menusById[spec.id] = menu
            fill(menu, spec.nodes)
            let top = NSMenuItem(title: spec.title, action: nil, keyEquivalent: "")
            top.submenu = menu
            main.addItem(top)
            switch spec.id {
            case "window": NSApp.windowsMenu = menu
            case "help": NSApp.helpMenu = menu
            case "go": menu.delegate = self
            default: break
            }
        }
        refreshShortcuts()
        refreshShare()
        refreshUpdates()
        return main
    }

    private func fill(_ menu: NSMenu, _ nodes: [MenuNode]) {
        for node in nodes {
            switch node {
            case .separator:
                menu.addItem(.separator())
            case .item(let spec):
                menu.addItem(item(spec))
            case .submenu(let id, let title, let inner):
                let sub = NSMenu(title: title)
                menusById[id] = sub
                fill(sub, inner)
                let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
                top.submenu = sub
                itemsById[id] = top
                menu.addItem(top)
            case .services:
                let services = NSMenu(title: "Services")
                let top = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
                top.submenu = services
                menu.addItem(top)
                NSApp.servicesMenu = services
            case .share:
                let sub = NSMenu(title: "Share")
                sub.delegate = self
                shareMenu = sub
                let top = NSMenuItem(title: "Share", action: nil, keyEquivalent: "")
                top.submenu = sub
                itemsById["file.share"] = top
                menu.addItem(top)
            }
        }
    }

    private func item(_ spec: MenuItemSpec) -> NSMenuItem {
        let action: Selector
        var target: AnyObject? = self
        switch spec.action {
        case .system(let name):
            action = NSSelectorFromString(name)
            // The first responder (the web view, a window, the app) answers AppKit's own actions.
            target = nil
        case .page, .app:
            action = #selector(runItem(_:))
        }
        let item = NSMenuItem(title: spec.title, action: action, keyEquivalent: spec.key?.key ?? "")
        item.target = target
        item.keyEquivalentModifierMask = Self.mask(spec.key?.mods ?? [])
        item.identifier = NSUserInterfaceItemIdentifier(spec.id)
        item.representedObject = spec.id
        if spec.alternate {
            item.isHidden = true
            item.allowsKeyEquivalentWhenHidden = true
        }
        itemsById[spec.id] = item
        return item
    }

    nonisolated static func mask(_ mods: MenuMods) -> NSEvent.ModifierFlags {
        var m: NSEvent.ModifierFlags = []
        if mods.contains(.cmd) { m.insert(.command) }
        if mods.contains(.shift) { m.insert(.shift) }
        if mods.contains(.opt) { m.insert(.option) }
        if mods.contains(.ctrl) { m.insert(.control) }
        return m
    }

    /// "Quick Add from Any App" shows the global shortcut from Settings (none when it's off).
    func refreshShortcuts() {
        guard let item = itemsById["file.quick-add-anywhere"] else { return }
        let accel = DesktopSettings.current.quickAddShortcut
        if let (key, mask) = Self.menuKey(accel) {
            item.keyEquivalent = key
            item.keyEquivalentModifierMask = mask
        } else {
            item.keyEquivalent = ""
        }
    }

    /// An Electron accelerator as an NSMenuItem key ("Alt+Space" → " ", option).
    nonisolated static func menuKey(_ accelerator: String) -> (String, NSEvent.ModifierFlags)? {
        guard !accelerator.isEmpty else { return nil }
        var parts = accelerator.components(separatedBy: "+")
        guard let key = parts.popLast() else { return nil }
        var mask: NSEvent.ModifierFlags = []
        for p in parts {
            switch p {
            case "Command", "Cmd", "CommandOrControl", "CmdOrCtrl", "Super", "Meta": mask.insert(.command)
            case "Control", "Ctrl": mask.insert(.control)
            case "Alt", "Option": mask.insert(.option)
            case "Shift": mask.insert(.shift)
            default: return nil
            }
        }
        let named: [String: String] = ["Space": " ", "Tab": "\t", "Return": "\r", "Enter": "\r", "Escape": "\u{1b}", "Backspace": "\u{8}", "Delete": "\u{7f}", "Plus": "+",
                                       "Up": String(UnicodeScalar(0xF700)!), "Down": String(UnicodeScalar(0xF701)!), "Left": String(UnicodeScalar(0xF702)!), "Right": String(UnicodeScalar(0xF703)!)]
        if let n = named[key] { return (n, mask) }
        if key.count == 1 { return (key.lowercased(), mask) }
        if key.hasPrefix("F"), let n = Int(key.dropFirst()), (1...24).contains(n) { return (String(UnicodeScalar(0xF704 + n - 1)!), mask) }
        return nil
    }

    // MARK: running items

    @objc func runItem(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        run(id)
    }

    /// Runs a menu item by id (also the eval hook's "menu" command): page commands to their page, app ones here.
    func run(_ raw: String) {
        let id = raw.hasSuffix(".alt") ? String(raw.dropLast(4)) : raw
        guard let spec = Self.specs[id] else { return }
        switch spec.action {
        case .page(let command): sendToPage(command, needsWindow: spec.needsWindow)
        case .app(let command): runApp(command)
        case .system(let name): NSApp.sendAction(NSSelectorFromString(name), to: nil, from: itemsById[id])
        }
    }

    private func sendToPage(_ id: String, needsWindow: Bool) {
        // Close Tab in a window that has no tabs (Settings, Quick Add): that window closes.
        if id == "file.close-tab", let key = NSApp.keyWindow, !WindowManager.shared.mains.contains(where: { $0.window === key }) {
            key.performClose(nil)
            return
        }
        // A window with the native frame runs its commands natively (Frame/NativeFrame.swift).
        if let frame = NativeFrame.controller(for: Chrome.keyMainView), FrameCommands.run(id, frame: frame) { return }
        if let view = Chrome.keyMainView {
            // Find in a page that has no find bar of its own: the system's (WKWebView is a text finder client).
            if let action = Self.finderActions[id], Chrome.states[ObjectIdentifier(view)]?.find != true {
                let tagged = NSMenuItem()
                tagged.tag = action.rawValue
                view.performTextFinderAction(tagged)
                return
            }
            Events.command(["type": "menu", "id": id], to: view)
            return
        }
        guard !needsWindow else { return }
        // A command that makes sense anywhere: a main window comes forward (opening one if none is left).
        WindowManager.shared.showMain()
        guard let view = WindowManager.shared.frontMain?.view else { return }
        if view.loaded {
            Events.command(["type": "menu", "id": id], to: view)
        } else {
            pendingForLoad[ObjectIdentifier(view), default: []].append(id)
        }
    }

    /// Every item of the model by id (validation runs for each item each time a menu opens).
    static let specs: [String: MenuItemSpec] = Dictionary(MenuModel.allItems(debug: Paths.isDebug).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

    static let finderActions: [String: NSTextFinder.Action] = [
        "edit.find": .showFindInterface, "edit.find-next": .nextMatch, "edit.find-previous": .previousMatch, "edit.find-selection": .setSearchString,
    ]

    /// Commands for a window that was still loading when they were chosen.
    var pendingForLoad: [ObjectIdentifier: [String]] = [:]

    func viewLoaded(_ view: FoleviWebView) {
        for id in pendingForLoad.removeValue(forKey: ObjectIdentifier(view)) ?? [] { Events.command(["type": "menu", "id": id], to: view) }
    }

    private func runApp(_ id: String) {
        switch id {
        case "app.settings": SettingsWindow.shared.show()
        case "app.check-for-updates": Chrome.checkForUpdates?()
        case "file.quick-add-anywhere": QuickAddPanel.shared.show()
        case "file.new-window":
            WindowManager.shared.openMain(path: "/documents")
            NSApp.activate()
        case "file.print":
            guard let view = Chrome.keyMainView ?? Chrome.keyView else { return }
            if let print = Chrome.print { print(view) } else { Self.printPage(view) }
        case "view.actual-size": Zoom.set(1)
        case "view.zoom-in": Zoom.step(+1)
        case "view.zoom-out": Zoom.step(-1)
        case "debug.reload": Chrome.keyView?.reload()
        case "debug.reload-all": WindowManager.shared.allViews.forEach { $0.reload() }
        case "debug.support-folder": NSWorkspace.shared.activateFileViewerSelecting([Paths.supportFolder])
        default: break
        }
    }

    /// The page's own print (its print styles), through the system's print panel as a sheet.
    static func printPage(_ view: FoleviWebView) {
        let info = NSPrintInfo.shared
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        let op = view.printOperation(with: info)
        op.view?.frame = view.bounds
        if let window = view.window {
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
    }

    // MARK: validation (enabled, checked, titles)

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let id = item.representedObject as? String else { return true }
        let base = id.hasSuffix(".alt") ? String(id.dropLast(4)) : id
        let view = Chrome.keyMainView
        var state = view.flatMap { Chrome.states[ObjectIdentifier($0)] } ?? PageState()
        let frame = NativeFrame.controller(for: view)
        if let frame {
            // The framed window's state: its sidebar, the note's focus mode and lock, the list's layout, the theme.
            state.sidebar = !frame.model.sidebarCollapsed
            state.focus = frame.model.focusMode
            state.locked = frame.model.noteLocked
            var checked = Set<String>()
            if let cards = frame.root.split.content.listShowsCards { checked.insert(cards ? "view.cards" : "view.list") }
            switch frame.model.session.value?.appearance {
            case .light?: checked.insert("view.appearance-light")
            case .dark?: checked.insert("view.appearance-dark")
            case .system?: checked.insert("view.appearance-system")
            case nil: break
            }
            state.checked = checked
        }
        item.state = state.checked.contains(base) ? .on : .off
        switch base {
        case "view.sidebar": item.title = state.sidebar == false ? "Show Sidebar" : "Hide Sidebar"
        case "view.inspector": item.title = state.inspector == true ? "Hide Inspector" : "Show Inspector"
        case "view.focus": item.state = state.focus == true ? .on : .off
        case "note.lock": item.title = state.locked == true ? "Unlock" : "Lock"
        default: break
        }
        // Foli AI's items are hidden while AI is off (Go's menuNeedsUpdate hides it; its ⌘J does nothing).
        if base == "go.ask-ai", state.ai == false { return false }
        guard let spec = Self.specs[base] else { return true }
        switch spec.action {
        case .page(let command):
            if command == "file.close-tab" { return NSApp.keyWindow != nil || view != nil }
            if spec.needsWindow && view == nil { return false }
            if let frame, let on = FrameCommands.isEnabled(command, frame: frame) { return on }
            return !state.disabled.contains(command)
        case .app(let command):
            switch command {
            case "app.check-for-updates":
                if let t = Chrome.updateTitle?() { item.title = t }
                return Chrome.checkForUpdates != nil
            case "file.print": return Chrome.keyMainView != nil
            case "view.actual-size": return Zoom.level != 1
            case "view.zoom-in": return Zoom.level < Zoom.levels.last!
            case "view.zoom-out": return Zoom.level > Zoom.levels.first!
            case "debug.reload": return Chrome.keyView != nil
            default: return true
            }
        case .system:
            return true
        }
    }

    // MARK: File > Share (WM5's services)

    func menuNeedsUpdate(_ menu: NSMenu) {
        if menu === menusById["go"] {
            let state = Chrome.keyMainView.flatMap { Chrome.states[ObjectIdentifier($0)] }
            itemsById["go.ask-ai"]?.isHidden = state?.ai == false
            return
        }
        guard menu === shareMenu else { return }
        menu.removeAllItems()
        guard let view = Chrome.keyMainView, let items = Chrome.shareItems?(view), !items.isEmpty else {
            let none = NSMenuItem(title: "Nothing to share", action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
            return
        }
        items.forEach(menu.addItem)
    }

    /// Check for Updates… or Restart to Update (WM3's Updater); hidden while updates are off (Debug builds).
    func refreshUpdates() {
        guard let item = itemsById["app.check-for-updates"] else { return }
        let title = Chrome.updateTitle?()
        item.isHidden = title == nil
        if let title { item.title = title }
    }

    /// File > Share shows only once something fills it (WM5).
    func refreshShare() {
        itemsById["file.share"]?.isHidden = Chrome.shareItems == nil
    }
}

/// ⌘+ / ⌘- / ⌘0: every main window's page zoom, remembered for the app (polish §3.15: the system text size).
@MainActor
enum Zoom {
    static let levels: [Double] = [0.75, 0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]
    private static let key = "folevi.zoom"

    static var level: Double {
        let v = Paths.defaults.double(forKey: key)
        return v == 0 ? 1 : v
    }

    static func set(_ value: Double) {
        let v = levels.min { abs($0 - value) < abs($1 - value) } ?? 1
        Paths.defaults.set(v, forKey: key)
        apply()
    }

    static func step(_ by: Int) {
        let i = levels.firstIndex { $0 >= level - 0.001 } ?? levels.firstIndex(of: 1)!
        set(levels[max(0, min(levels.count - 1, i + by))])
    }

    static func apply(to view: FoleviWebView? = nil) {
        let views = view.map { [$0] } ?? WindowManager.shared.allViews.filter { $0.role != .runner }
        for v in views { v.pageZoom = level }
        // The window buttons follow the page's top bar at its new size.
        if view == nil { TitleBar.relayoutAll() }
    }
}
